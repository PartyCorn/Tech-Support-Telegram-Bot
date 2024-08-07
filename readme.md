# Бот-техподдержка

## Описание

Этот бот предназначен для поддержки пользователей проекта, обеспечивая эффективную коммуникацию между администрацией и пользователями. Бот работает на платформе Telegram и предоставляет удобный интерфейс для создания и управления тикетами техподдержки.

## Возможности

- **Категории вопросов**: бот поддерживает разделение вопросов на три категории: "Идеи и предложения", "Сообщить об ошибке", "Общие вопросы".
- **Создание тикетов**: пользователи могут легко создать тикет, выбрав соответствующую категорию и написав обращение. Бот подтверждает создание тикета и предоставляет его номер.
- **Ограничение активных тикетов**: на одного пользователя может быть не более N активных обращений одновременно.
- **Уведомления для администраторов**: бот уведомляет администраторов о новых тикетах и ответах пользователей каждые N времени, а также немедленно при наличии нескольких новых сообщений.
- **Управление тикетами для администраторов**: администраторы могут просматривать список тикетов по категориям, отвечать на обращения и закрывать тикеты с помощью удобного интерфейса.

## Установка и запуск

### Требования

- Node.js (JS/TS)
- SQLite

### Установка зависимостей

1. Клонируйте репозиторий:
   ```bash
   git clone https://github.com/PartyCorn/Tech-Support-Telegram-Bot.git
   cd Tech-Support-Telegram-Bot
   ```

2. Установите необходимые зависимости:
   ```bash
   npm install
   ```

### Настройка

1. В файле `bot.ts` в корневой директории проекта измените следующие переменные в зависимости от ваших нужд:
   ```ts
    const appName = 'Your App Name Here'
    const adminIds = ['1234567890']; // Замените на реальные ID администраторов
    const notificationInterval = 1 * 60 * 60 * 1000; // Интервал уведомления администраторов, указан 1 час
    const notificationThreshold = 10; // Количество тикетов для немедленного уведомления
    const notificationWindow = 30 * 60 * 1000; // Временное окно для отслеживания тикетов в миллисекундах (например, 30 минут)
    const maximumTicketsPerUser = 2; // Количество активныв тикетов на одного пользователя
   ```

### Запуск

1. Запустите бота:
   ```bash
   npm start
   ```

Бот будет запущен и готов к использованию на платформе Telegram.

## Используемые библиотеки

- [telegraf](https://github.com/telegraf/telegraf) – библиотека для работы с Telegram Bot API.
- [sqlite3](https://github.com/TryGhost/node-sqlite3) – библиотека для работы с SQLite.

## Лицензия

Этот проект лицензирован под MIT License. Подробности см. в файле [LICENSE](LICENSE).