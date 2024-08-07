import { Telegraf, Markup } from 'telegraf';
import { Between } from 'typeorm';
import { initializeDatabase, AppDataSource } from './database';
import { Admin } from './models/Admin';
import { Ticket } from './models/Ticket';
import { getCategoryKeyboard, createTicketButtons } from './keyboardButtons';

const bot = new Telegraf('<YOUR_BOT_TOKEN_HERE>');

bot.telegram.setMyCommands([{ command: '/start', description: 'Начало работы с ботом' }]);

const appName = 'Your App Name Here';
const adminIds = ['1234567890']; // Замените на реальные ID администраторов
const notificationInterval = 1 * 60 * 60 * 1000; // Интервал уведомления администраторов, указан 1 час
const notificationThreshold = 10; // Количество тикетов для немедленного уведомления
const notificationWindow = 30 * 60 * 1000; // Временное окно для отслеживания тикетов в миллисекундах (например, 30 минут)
const maximumTicketsPerUser = 2; // Количество активныв тикетов на одного пользователя

let ticketTimestamps: number[] = []; // Массив для хранения временных меток новых тикетов
const activeReplies = new Map<number, number>(); // Храним ID администратора и тикет
const userStates = new Map<number, 'creating_ticket' | 'replying_ticket' | null>();
const userCategories = new Map<number, string>(); // Храним категорию для каждого пользователя

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

bot.hears(['Идеи и предложения', 'Сообщить об ошибке', 'Общие вопросы'], async (ctx) => {
  const category = ctx.message.text;
  const adminRepository = AppDataSource.getRepository(Admin);
  const isAdmin = await adminRepository.findOne({ where: { adminId: ctx.from.id.toString() } });

  if (isAdmin) {
    const ticketRepository = AppDataSource.getRepository(Ticket);
    const tickets = await ticketRepository.find({ where: { category, status: 'active' }, order: { createdAt: 'ASC' } });

    if (tickets.length > 0) {
      const ticket = tickets[0]; // Берем первый тикет
      await ctx.reply(`Тикет #${ticket.id}\nКатегория: ${ticket.category}\nСообщение: ${ticket.message}`, createTicketButtons(ticket.id));
    } else {
      await ctx.reply('Нет активных тикетов в этой категории.', getCategoryKeyboard());
    }
  } else {
    await ctx.reply(`Пожалуйста, опишите ваш запрос в категории "${category}":`);
    userStates.set(ctx.from.id, 'creating_ticket'); // Устанавливаем состояние для пользователя
    userCategories.set(ctx.from.id, category); // Сохраняем категорию
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

bot.action(/next_ticket_(\d+)/, async (ctx) => {
  const currentTicketId = parseInt(ctx.match[1], 10);
  const ticketRepository = AppDataSource.getRepository(Ticket);

  try {
    const tickets = await ticketRepository.find({ where: { status: 'active' }, order: { createdAt: 'ASC' } });
    const currentTicketIndex = tickets.findIndex(ticket => ticket.id === currentTicketId);
    
    if (currentTicketIndex >= 0 && currentTicketIndex < tickets.length - 1) {
      const nextTicket = tickets[currentTicketIndex + 1];
      await ctx.editMessageText(`Тикет #${nextTicket.id}\nКатегория: ${nextTicket.category}\nСообщение: ${nextTicket.message}`, createTicketButtons(nextTicket.id));
    } else {
      await ctx.reply('Нет больше тикетов.', getCategoryKeyboard());
    }
  } catch (error) {
    await ctx.reply('Произошла ошибка при получении следующего тикета.');
  }
  await ctx.answerCbQuery();
});

bot.action('cancel_ticket_view', async (ctx) => {
  await ctx.deleteMessage();
  await ctx.reply('Просмотр тикетов отменен.', getCategoryKeyboard());
  await ctx.answerCbQuery();
});

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

    const ticket = new Ticket();
    ticket.userId = userId;
    ticket.category = category;
    ticket.message = ctx.message.text;
    ticket.status = 'active';
    ticket.createdAt = new Date();
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

        // ticket.status = 'replied';
        // await ticketRepository.save(ticket);

        await ctx.reply('Ответ был отправлен.');
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