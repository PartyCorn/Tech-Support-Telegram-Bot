import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class Ticket {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: string;

  @Column()
  category!: string;

  @Column()
  message!: string;

  @Column()
  status!: string; // active, closed

  @Column()
  createdAt!: Date;

  @Column()
  updatedAt!: Date;
}
