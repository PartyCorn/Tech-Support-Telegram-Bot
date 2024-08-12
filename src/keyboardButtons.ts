import { Markup } from 'telegraf';

export const getCategoryKeyboard = () => {
  return Markup.keyboard([
    [{ text: 'Идеи и предложения' }],
    [{ text: 'Сообщить об ошибке' }],
    [{ text: 'Общие вопросы' }]
  ]).oneTime().resize();
};

export const createTicketButtons = (ticketId: number) => {
  return Markup.inlineKeyboard([[
    Markup.button.callback('Ответить', `reply_ticket_${ticketId}`),
    Markup.button.callback('Следующий тикет', `next_ticket_${ticketId}`),
    Markup.button.callback('Закрыть тикет', `close_ticket_${ticketId}`)
  ],
  [Markup.button.callback('Скачать лог', `download_ticket_log_${ticketId}`)],
  [Markup.button.callback('Отмена', 'cancel_ticket_view')]]);
};