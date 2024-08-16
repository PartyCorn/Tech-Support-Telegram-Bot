import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity()
export class BlackList {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: string;

  @Column()
  publicName!: string;

  @Column()
  reason!: string;

  @Column()
  blockedBy!: string;

  @Column()
  blockedAt!: Date;
}