import { Telegraf, Markup, Context } from 'telegraf';
import { Update } from 'telegraf/typings/core/types/typegram';
import { Between, Not, In } from 'typeorm';
import { initializeDatabase, AppDataSource } from './database';
import { Admin } from './models/Admin';
import { Ticket } from './models/Ticket';
import { BlackList } from './models/BlackList';
import { getCategoryKeyboard, createTicketButtons } from './keyboardButtons';

const bot = new Telegraf('<YOUR_BOT_TOKEN_HERE>');

bot.telegram.setMyCommands([{ command: '/start', description: 'Начало работы с ботом' }]);

const appName = 'Your App Name Here';
const adminIds = ['1234567890']; // Замените на реальные ID администраторов
const notificationInterval = 1 * 60 * 60 * 1000; // Интервал уведомления администраторов, указан 1 час
const notificationThreshold = 10; // Количество тикетов для немедленного уведомления
const notificationWindow = 30 * 60 * 1000; // Временное окно для отслеживания тикетов в миллисекундах (например, 30 минут)
const maximumTicketsPerUser = 2; // Количество активныв тикетов на одного пользователя
const USERS_PER_PAGE = 20; // Количество пользователей, которые нужно вывести на 1 страницу (для чёрного списка)

let ticketTimestamps: number[] = []; // Массив для хранения временных меток новых тикетов
const activeReplies = new Map<number, number>(); // Храним ID администратора и тикет
const userStates = new Map<number, 'creating_ticket' | 'replying_ticket' | `replying_to_admin_${string}` | null>();
const userCategories = new Map<number, string>(); // Храним категорию для каждого пользователя

function formatTicketMessage(ticket: Ticket): string {
  const formattedMessages = ticket.messages.map(
    (msg) => `${new Date(msg.timestamp).toLocaleString('ru-RU')}\n${(msg.sender === 'admin' ? 'Администратор' : 'Пользователь') + ` (${msg.senderName}):`}\n${msg.text}\n`
  ).join('\n');

  return `Тикет #${ticket.id} (${ticket.userId})\nКатегория: ${ticket.category}\nСообщения:\n\n${formattedMessages}`;
}

function formatTicketLog(ticket: Ticket) {
  let log = `Обращение #${ticket.id} (${ticket.category}): ${ticket.messages[0].text}\n\n`;

  ticket.messages.slice(1).forEach(msg => {
    log += `${new Date(msg.timestamp).toLocaleString('ru-RU')}\n${(msg.sender === 'admin' ? 'Администратор' : 'Пользователь') + ` (${msg.senderName}):`}\n${msg.text}\n\n`;
  });

  return log;
}

const addTicketTimestamp = (timestamp: number) => {
  ticketTimestamps.push(timestamp);
  const currentTime = Date.now();
  ticketTimestamps = ticketTimestamps.filter(t => currentTime - t <= notificationWindow);
};

const checkImmediateNotification = async () => {
  if (ticketTimestamps.length >= notificationThreshold) {
    notifyAdminsImmediately();
    ticketTimestamps = [];
  }
};

const notifyAdminsImmediately = async () => {
  const adminRepository = AppDataSource.getRepository(Admin);
  const currentTime = new Date();
  const windowStartTime = new Date(currentTime.getTime() - notificationWindow);

  const newTickets = await AppDataSource.getRepository(Ticket).find({
    where: {
      status: 'active',
      createdAt: Between(windowStartTime, currentTime)
    }
  });

  if (newTickets.length > 0) {
    const ticketCounts: { [key: string]: number } = newTickets.reduce((acc, ticket) => {
      acc[ticket.category] = (acc[ticket.category] || 0) + 1;
      return acc;
    }, {} as { [key: string]: number });

    const message = `За последние ${formatDuration(notificationWindow / 1000)} было получено ${getDeclension(newTickets.length, "новое обращение", "новых обращения", "новых обращений")}:\n` +
                    Object.entries(ticketCounts)
                      .map(([category, count]) => `${category}: ${count}`)
                      .join('\n');

    const admins = await adminRepository.find();
    for (const admin of admins) {
      await bot.telegram.sendMessage(admin.adminId, message, getCategoryKeyboard());
    }
  }
};

bot.start(async (ctx) => {
  const adminRepository = AppDataSource.getRepository(Admin);
  const isAdmin = await adminRepository.findOne({ where: { adminId: ctx.from.id.toString() } });

  await ctx.reply(isAdmin ? 'Список тикетов' : `Добро пожаловать в поддержку ${appName}! Выберите категорию, чтобы создать обращение (максимум ${maximumTicketsPerUser}):`, getCategoryKeyboard());
});

// Функция для получения активных тикетов от незаблокированных пользователей
async function getActiveTicketsExcludingBlacklistedUsers(category: string) {
  const ticketRepository = AppDataSource.getRepository(Ticket);
  const blackListRepository = AppDataSource.getRepository(BlackList);

  const blacklistedUsers = await blackListRepository.find();
  const blacklistedUserIds = blacklistedUsers.map(user => user.userId);

  const tickets = await ticketRepository.find({
    where: {
      category,
      status: 'active',
      userId: Not(In(blacklistedUserIds)) // Исключаем тикеты юзеров, находящихся в ЧС
    },
    order: { createdAt: 'ASC' }
  });

  return tickets;
}

// Функция для отправки сообщения с тикетом
async function sendTicketMessage(ctx: Context<Update>, ticket: Ticket) {
  const text = formatTicketMessage(ticket);
  if (text.length < 4096) {
    await ctx.reply(text, createTicketButtons(ticket.id));
  } else {
    await ctx.reply('Сообщение слишком длинное. Пожалуйста, скачайте лог файла.', createTicketButtons(ticket.id));
  }
}

// Обработчик команды для администратора (и немного для юзера)
bot.hears(['Идеи и предложения', 'Сообщить об ошибке', 'Общие вопросы'], async (ctx) => {
  const category = ctx.message.text;
  const adminRepository = AppDataSource.getRepository(Admin);
  const isAdmin = await adminRepository.findOne({ where: { adminId: ctx.from.id.toString() } });

  if (isAdmin) {
    const tickets = await getActiveTicketsExcludingBlacklistedUsers(category);

    if (tickets.length > 0) {
      const ticket = tickets[0]; // Берем первый тикет
      await sendTicketMessage(ctx, ticket);
    } else {
      await ctx.reply('Нет активных тикетов в этой категории.', getCategoryKeyboard());
    }
  } else {
    await ctx.reply(`Пожалуйста, опишите ваш запрос в категории "${category}":`);
    userStates.set(ctx.from.id, 'creating_ticket'); // Устанавливаем состояние для пользователя
  }
  userCategories.set(ctx.from.id, category); // Сохраняем категорию
});

bot.action(/download_ticket_log_(\d+)/, async (ctx) => {
  const ticketId = parseInt(ctx.match[1], 10);
  const ticketRepository = AppDataSource.getRepository(Ticket);

  try {
    const ticket = await ticketRepository.findOne({ where: { id: ticketId } });

    if (ticket) {
      const logContent = formatTicketLog(ticket);
      const logBuffer = Buffer.from(logContent, 'utf-8');

      await ctx.replyWithDocument({ source: logBuffer, filename: `ticket_log_${ticketId}.txt` });
    } else {
      await ctx.reply('Тикет не найден.');
    }
  } catch (error) {
    await ctx.reply('Произошла ошибка при создании файла лога.');
    console.error('Ошибка при генерации файла лога:', error);
  }
});


bot.action(/close_ticket_(\d+)/, async (ctx) => {
  const ticketId = parseInt(ctx.match[1], 10);
  const ticketRepository = AppDataSource.getRepository(Ticket);
  const adminRepository = AppDataSource.getRepository(Admin);
  
  const admins = await adminRepository.find();
  const adminIds = admins.map(admin => admin.adminId);

  try {
    const ticket = await ticketRepository.findOne({ where: { id: ticketId } });
    if (ticket) {
      ticket.status = 'closed';
      await ticketRepository.save(ticket);
      
      await ctx.editMessageText(`Тикет #${ticket.id} закрыт.`);
      
      try {
        // Уведомляем пользователя, что его тикет был закрыт администратором
        if (adminIds.includes(ctx.from.id.toString())) {
          await ctx.telegram.sendMessage(ticket.userId, `Ваш тикет #${ticket.id} был закрыт администратором.`, getCategoryKeyboard());
        }
      } catch (error) {
        console.error('Ошибка при отправке сообщения пользователю:', error);
      }
    } else {
      await ctx.editMessageText('Тикет не найден или уже закрыт.');
    }
    await ctx.answerCbQuery();
  } catch (error) {
    await ctx.reply('Произошла ошибка при закрытии тикета.', getCategoryKeyboard());
  }
});


bot.action(/reply_ticket_(\d+)/, async (ctx) => {
  const ticketId = parseInt(ctx.match[1], 10);
  await ctx.reply('Напишите ваш ответ:', Markup.inlineKeyboard([Markup.button.callback('Отменить', `cancel_reply_${ctx.from.id}`)]));
  activeReplies.set(ctx.from.id, ticketId);
  userStates.set(ctx.from.id, 'replying_ticket'); // Устанавливаем состояние для администратора
  await ctx.answerCbQuery();
});

bot.action(/cancel_reply_(\d+)/, async (ctx) => {
  const userId = parseInt(ctx.match[1], 10);
  activeReplies.delete(userId);
  userStates.delete(ctx.from.id);
  await ctx.reply('Ответ на тикет отменен.');
  await ctx.answerCbQuery();
});

// Обработчик действия для показа следующего тикета
bot.action(/next_ticket_(\d+)/, async (ctx) => {
  const currentTicketId = parseInt(ctx.match[1], 10);

  try {
    const category = userCategories.get(ctx.from.id);
    if (!category) return;
    const tickets = await getActiveTicketsExcludingBlacklistedUsers(category); // Не указываем категорию, чтобы получить все тикеты
    const currentTicketIndex = tickets.findIndex(ticket => ticket.id === currentTicketId);

    if (currentTicketIndex >= 0 && currentTicketIndex < tickets.length - 1) {
      const nextTicket = tickets[currentTicketIndex + 1];
      await sendTicketMessage(ctx, nextTicket);
    } else {
      await ctx.reply('Нет больше тикетов.', getCategoryKeyboard());
    }
  } catch (error) {
    await ctx.reply('Произошла ошибка при получении следующего тикета.');
  }
  await ctx.answerCbQuery();
});

bot.action(/cancel_reply_to_admin_(\d+)/, async (ctx) => {
  const adminId = parseInt(ctx.match[1], 10);

  // Убираем состояние и активный ответ
  userStates.delete(ctx.from.id);
  activeReplies.delete(ctx.from.id);

  await ctx.reply('Ответ администратору был отменен.');
  await ctx.answerCbQuery();
});

bot.action('cancel_ticket_view', async (ctx) => {
  await ctx.deleteMessage();
  await ctx.reply('Просмотр тикетов отменен.', getCategoryKeyboard());
  await ctx.answerCbQuery();
});

// Реализация Чёрного Списка
function escapeMarkdown(text: string): string {
  const markdownChars = ['_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'];

  return text.split('').map(char => {
    if (markdownChars.includes(char)) {
      return `\\${char}`; // экранирование символа
    }
    return char;
  }).join('');
}

const getBlacklistedUsers = async (page: number = 1) => {
  const blacklistRepository = AppDataSource.getRepository(BlackList);
  const [users, total] = await blacklistRepository.findAndCount({
    order: { blockedAt: 'ASC' },
    skip: (page - 1) * USERS_PER_PAGE,
    take: USERS_PER_PAGE,
  });

  return { users, total };
};

const createPaginationButtons = (page: number, totalPages: number) => {
  const buttons = [];

  if (page > 1) {
    buttons.push(Markup.button.callback('⬅️ Назад', `blacklist_page_${page - 1}`));
  }

  buttons.push(Markup.button.callback(`Страница ${page}/${totalPages}`, 'noop'));

  if (page < totalPages) {
    buttons.push(Markup.button.callback('Вперед ➡️', `blacklist_page_${page + 1}`));
  }

  return buttons;
};

const formatBlacklistedUsers = (users: BlackList[], total: number, page: number, totalPages: number) => {
  let message = `*Черный список* _\\(${getDeclension(total, 'запись', 'записи', 'записей')}\\)_\n\n`;

  users.forEach(user => {
    message += `${user.id}: ${user.publicName}, \`${user.userId}\`\n${user.blockedBy} в ${escapeMarkdown(new Date(user.blockedAt).toLocaleString('ru-RU'))}\nПричина: ${user.reason}\n\n`;
  });

  if (users) message += 'Действия: /block \\| /unblock'

  return message.trim();
};

bot.command('blacklist', async (ctx) => {
  const adminRepository = AppDataSource.getRepository(Admin);
  const admin = await adminRepository.findOne({ where: { adminId: ctx.from.id.toString() } });

  if (!admin) {
    return;
  }

  const page = 1; // Стартовая страница
  const { users, total } = await getBlacklistedUsers(page);
  const totalPages = Math.ceil(total / USERS_PER_PAGE);

  const message = formatBlacklistedUsers(users, total, page, totalPages);

  await ctx.replyWithMarkdownV2(message, Markup.inlineKeyboard(createPaginationButtons(page, totalPages)));
});

bot.action(/blacklist_page_(\d+)/, async (ctx) => {
  const page = parseInt(ctx.match[1], 10);
  const { users, total } = await getBlacklistedUsers(page);
  const totalPages = Math.ceil(total / USERS_PER_PAGE);

  const message = formatBlacklistedUsers(users, total, page, totalPages);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(createPaginationButtons(page, totalPages))
  });
  await ctx.answerCbQuery();
});

bot.command('block', async (ctx) => {
  const messageParts = ctx.message.text.split(' '); 
  const userId = messageParts[1];
  const reason = messageParts.slice(2).join(' ');

  const adminRepository = AppDataSource.getRepository(Admin);
  const admin = await adminRepository.findOne({ where: { adminId: ctx.from.id.toString() } });

  if (!admin) {
    return;
  }

  if (!userId || !reason) {
    return ctx.reply('Пожалуйста, укажите userId и причину блокировки. Формат: /block 1234567890 Причина (пробелы включены)');
  }

  const blacklistRepository = AppDataSource.getRepository(BlackList);
  const ticketRepository = AppDataSource.getRepository(Ticket);
  
  // Проверка на наличие пользователя в черном списке
  const existingUser = await blacklistRepository.findOne({ where: { userId } });
  if (existingUser) {
    return ctx.replyWithMarkdownV2(`Пользователь уже находится в черном списке\\. Чтобы разблокировать: \`/unblock ${userId}\``);
  }

  try {
    const ticket = await ticketRepository.findOne({ where: { userId: userId } })
    const publicName = ticket ? ticket.messages[0].senderName : 'unknown';
    
    const newBlackListEntry = new BlackList();
    newBlackListEntry.userId = userId;
    newBlackListEntry.publicName = escapeMarkdown(publicName);
    newBlackListEntry.reason = escapeMarkdown(reason);
    newBlackListEntry.blockedBy = escapeMarkdown(ctx.from.first_name);
    newBlackListEntry.blockedAt = new Date();

    await blacklistRepository.save(newBlackListEntry);

    await ctx.replyWithMarkdownV2(`Пользователь ${publicName} \\(${userId}\\) был добавлен в черный список\\.\nПричина: ${newBlackListEntry.reason}`);
  } catch (error) {
    console.error(error);
    await ctx.reply('Не удалось добавить пользователя в черный список. Проверьте правильность userId.');
  }
});

bot.command('unblock', async (ctx) => {
  const messageParts = ctx.message.text.split(' '); 
  const userId = messageParts[1];

  const adminRepository = AppDataSource.getRepository(Admin);
  const admin = await adminRepository.findOne({ where: { adminId: ctx.from.id.toString() } });

  if (!admin) {
    return;
  }

  if (!userId) {
    return ctx.reply('Пожалуйста, укажите userId для удаления из черного списка. Формат: /unblock 1234567890');
  }

  const blacklistRepository = AppDataSource.getRepository(BlackList);
  
  // Поиск пользователя в черном списке
  const blacklistedUser = await blacklistRepository.findOne({ where: { userId } });

  if (!blacklistedUser) {
    return ctx.reply('Пользователь не найден в черном списке.');
  }

  try {
    await blacklistRepository.remove(blacklistedUser);
    await ctx.replyWithMarkdownV2(`Пользователь ${blacklistedUser.publicName} \\(${userId}\\) был удален из черного списка\\.`);
  } catch (error) {
    console.error(error);
    await ctx.reply('Произошла ошибка при удалении пользователя из черного списка.');
  }
});

// Заглушка для кнопки "Страница x/y"
bot.action('noop', async (ctx) => {
  await ctx.answerCbQuery();
});

async function isUserBlacklisted(userId: string): Promise<boolean> {
  const blackListRepository = AppDataSource.getRepository(BlackList);
  
  const userInBlackList = await blackListRepository.findOne({ where: { userId } });
  return !!userInBlackList; // Вернёт true, если пользователь найден в ЧС
}

// Продолжение Кода
bot.on('text', async (ctx) => {
  const state = userStates.get(ctx.from.id);

  if (state === 'creating_ticket') {
    const category = userCategories.get(ctx.from.id); // Получаем категорию из мапы
    const userId = ctx.from.id.toString();

    userStates.delete(ctx.from.id); // Сбрасываем состояние
    userCategories.delete(ctx.from.id); // Удаляем категорию из мапы

    if (!category) {
      await ctx.reply('Произошла ошибка: категория не найдена.');
      return;
    }

    const ticketRepository = AppDataSource.getRepository(Ticket);

    const activeTickets = await ticketRepository.count({ where: { userId, status: 'active' } });

    if (activeTickets >= maximumTicketsPerUser) {
      await ctx.reply(`У вас уже есть ${maximumTicketsPerUser} активных тикета. Пожалуйста, дождитесь их обработки.`);
      return;
    }

    if (await isUserBlacklisted(userId)) {
      await ctx.reply('Вы находитесь в черном списке и не можете создавать тикеты.');
      return;
    }

    const ticket = new Ticket();
    ticket.userId = userId;
    ticket.category = category;
    ticket.messages = [];
    ticket.status = 'active';
    ticket.createdAt = new Date();
    ticket.updatedAt = new Date();

    const newMessage = {
      sender: 'user',
      senderName: ctx.from.first_name,
      text: ctx.message.text,
      timestamp: new Date(),
    };
    ticket.messages.push(newMessage);
    ticket.updatedAt = new Date();

    await ticketRepository.save(ticket);

    addTicketTimestamp(Date.now());
    checkImmediateNotification();

    await ctx.reply(`Спасибо, что обратились к нам, номер вашего обращения #${ticket.id}. Если ваш вопрос был решён, нажмите на кнопку ниже. Среднее время ответа: ~1 день.`,
      Markup.inlineKeyboard([
        Markup.button.callback('Закрыть тикет', `close_ticket_${ticket.id}`)
      ]));
  } else if (state === 'replying_ticket') {
    if (!activeReplies.has(ctx.from.id)) return;
    
    const ticketId = activeReplies.get(ctx.from.id);
    const reply = ctx.message.text;

    const ticketRepository = AppDataSource.getRepository(Ticket);

    try {
      const ticket = await ticketRepository.findOne({ where: { id: ticketId } });
      if (ticket) {
        await bot.telegram.sendMessage(ticket.userId, `Ответ на ваш тикет #${ticket.id}: ${reply}`);

        const newMessage = {
          sender: 'admin',
          senderName: ctx.from.first_name,
          text: ctx.message.text,
          timestamp: new Date(),
        };
        
        ticket.messages.push(newMessage);
        ticket.updatedAt = new Date();
        await ticketRepository.save(ticket);

        // ticket.status = 'replied';
        // await ticketRepository.save(ticket);

        await ctx.reply('Ответ был отправлен.');

        activeReplies.delete(ctx.from.id);
        userStates.delete(ctx.from.id);

        await bot.telegram.sendMessage(
          ticket.userId, 
          `Ответ на ваш тикет #${ticket.id}: ${reply}\n\nВы можете ответить администратору, просто напишите сообщение.`, 
          Markup.inlineKeyboard([
            Markup.button.callback('Отменить ответ', `cancel_reply_to_admin_${ctx.from.id}`),
            Markup.button.callback('Закрыть тикет', `close_ticket_${ticket.id}`)
          ])
        );
        userStates.set(+ticket.userId, `replying_to_admin_${ctx.from.id}`);
      } else {
        await ctx.reply('Тикет не найден.');
      }
    } catch (error) {
      await ctx.reply('Произошла ошибка при отправке ответа.');
    }
  } else if (state && state.startsWith('replying_to_admin_')) {
    const adminId = +state.split('_')[3];
    const ticketId = activeReplies.get(adminId);
    const ticketRepository = AppDataSource.getRepository(Ticket);

    try {
      const ticket = await ticketRepository.findOne({ where: { id: ticketId } });
      if (ticket) {
        await bot.telegram.sendMessage(adminId, `Ответ от пользователя ${ticket.messages[0].senderName} на тикет #${ticket.id}: ${ctx.message.text}`);

        const newMessage = {
          sender: 'user',
          senderName: ctx.from.first_name,
          text: ctx.message.text,
          timestamp: new Date(),
        };
        
        ticket.messages.push(newMessage);
        ticket.updatedAt = new Date();
        await ticketRepository.save(ticket);

        await ctx.reply('Ваш ответ был отправлен.');
        userStates.delete(ctx.from.id);
      } else {
        await ctx.reply('Тикет не найден.');
      }
    } catch (error) {
      await ctx.reply('Произошла ошибка при отправке ответа.');
    }
  }
});

// Функция для уведомления администраторов о новых тикетах
const notifyAdmins = async () => {
  const adminRepository = AppDataSource.getRepository(Admin);
  const ticketRepository = AppDataSource.getRepository(Ticket);

  const admins = await adminRepository.find();
  const newTickets = await ticketRepository.find({ where: { status: 'active' } });

  if (newTickets.length > 0) {
    // Группировка тикетов по категориям
    const ticketCounts: { [key: string]: number } = newTickets.reduce((acc, ticket) => {
      acc[ticket.category] = (acc[ticket.category] || 0) + 1;
      return acc;
    }, {} as { [key: string]: number });

    const message = `За последние ${formatDuration(notificationInterval)} было получено ${getDeclension(newTickets.length, "обращение", "обращения", "обращений")}:\n` +
                    Object.entries(ticketCounts)
                      .map(([category, count]) => `${category}: ${count}`)
                      .join('\n');

    for (const admin of admins) {
      await bot.telegram.sendMessage(admin.adminId, message);
    }
  }
};

function getDeclension(num: number, singular: string, few: string, many: string): string {
  const absNum = Math.abs(num) % 100;
  const lastDigit = absNum % 10;

  if (absNum > 10 && absNum < 20) {
    return `${num} ${many}`;
  }
  if (lastDigit > 1 && lastDigit < 5) {
    return `${num} ${few}`;
  }
  if (lastDigit === 1) {
    return `${num} ${singular}`;
  }
  return `${num} ${many}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const remainingSeconds = seconds % 60;
  const remainingMinutes = minutes % 60;
  const remainingHours = hours % 24;

  if (days > 0) {
    return getDeclension(days, "день", "дня", "дней");
  }
  if (remainingHours > 0) {
    return getDeclension(remainingHours, "час", "часа", "часов");
  }
  if (remainingMinutes > 0) {
    return getDeclension(remainingMinutes, "минута", "минуты", "минут");
  }
  return getDeclension(remainingSeconds, "секунда", "секунды", "секунд");
}

async function updateAdmins(adminIds: string[]) {
  const adminRepository = AppDataSource.getRepository(Admin);

  // Сначала добавляем новых администраторов
  for (const adminId of adminIds) {
    const adminExists = await adminRepository.findOne({ where: { adminId } });

    if (!adminExists) {
      const newAdmin = new Admin();
      newAdmin.adminId = adminId;
      await adminRepository.save(newAdmin);
    }
  }

  // Затем удаляем администраторов, которых нет в adminIds
  const allAdmins = await adminRepository.find();
  for (const admin of allAdmins) {
    if (!adminIds.includes(admin.adminId)) {
      await adminRepository.remove(admin);
    }
  }
}

setInterval(notifyAdmins, notificationInterval);

const startBot = async () => {
  initializeDatabase().then(() => {
    updateAdmins(adminIds).then(() => console.log('Администраторы обновлены.'));
    bot.launch();
    console.log('Bot started...');
  }).catch(error => {
    console.error('Database initialization failed:', error);
  });
};

startBot();