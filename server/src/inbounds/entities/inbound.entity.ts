import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { Subscription } from '../../subscriptions/entities/subscription.entity';
import { Node } from '../../nodes/entities/node.entity';
import { Tunnel } from '../../tunnels/entities/tunnel.entity';

export enum InboundStatus {
  Staged = 'staged',
  Active = 'active',
  PendingCleanup = 'pending_cleanup',
}

@Entity()
export class Inbound {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  xuiId: number;

  @Column()
  port: number;

  @Column()
  protocol: string;

  @Column({ nullable: true })
  remark: string;

  @Column({ type: 'text', nullable: true })
  link: string;

  @Column({ type: 'varchar', default: InboundStatus.Active })
  status: InboundStatus;

  @Column({ type: 'uuid', nullable: true })
  generationId?: string;

  @Column({ type: 'int', default: 0 })
  cleanupAttempts: number;

  @Column({ type: 'timestamp', nullable: true })
  nextCleanupAt?: Date;

  @Column({ type: 'text', nullable: true })
  lastCleanupError?: string;

  @ManyToOne(() => Subscription, (sub) => sub.inbounds, { onDelete: 'CASCADE' })
  subscription: Subscription;

  @Column({ nullable: true })
  nodeId?: string;

  @ManyToOne(() => Node, (node) => node.inbounds, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  node?: Node;

  @Column({ nullable: true })
  relayServerId?: number;

  @ManyToOne(() => Tunnel, { nullable: true, onDelete: 'SET NULL' })
  relayServer?: Tunnel;

  @CreateDateColumn()
  createdAt: Date;
}
