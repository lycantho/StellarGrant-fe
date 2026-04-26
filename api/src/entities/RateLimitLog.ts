import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

@Entity()
export class RateLimitLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 64 })
  ip!: string;

  @Column({ type: "varchar", length: 255 })
  path!: string;

  @Column({ type: "varchar", length: 16 })
  method!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  userAgent!: string;

  @CreateDateColumn()
  createdAt!: Date;
}