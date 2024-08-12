import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';

@Entity()
export class Ticket {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: string;

  @Column()
  category!: string;

  @Column('json')
  messages!: Array<{ sender: string; senderName: string; text: string; timestamp: Date }>;

  @Column()
  status!: string; // active, closed

  @Column()
  createdAt!: Date;

  @Column()
  updatedAt!: Date;
}
