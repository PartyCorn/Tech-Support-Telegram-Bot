import { DataSource } from 'typeorm';
import { Admin } from './models/Admin';
import { Ticket } from './models/Ticket';
import { BlackList } from './models/BlackList';

export const AppDataSource = new DataSource({
  type: 'sqlite',
  database: 'tech-support-bot.sqlite',
  entities: [Admin, Ticket, BlackList],
  synchronize: true,
});

export const initializeDatabase = async () => {
  await AppDataSource.initialize();
};
