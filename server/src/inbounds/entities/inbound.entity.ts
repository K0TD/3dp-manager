import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { Subscription } from '../../subscriptions/entities/subscription.entity';
import { Node } from '../../nodes/entities/node.entity';
import { Tunnel } from '../../tunnels/entities/tunnel.entity';
import type { ProxyConnection } from '../connection-profiles';

export enum InboundStatus {
  Staged = 'staged',
  Active = 'active',
  PendingCleanup = 'pending_cleanup',
}

@Entity()
export class Inbound {
  // Derived response fields; credentials remain in the existing link column.
  connection?: ProxyConnection;
  wireguardConfig?: string;

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

  @Column({ type: 'uuid', nullable: true })
  configId?: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'varchar', default: InboundStatus.Active })
  status: InboundStatus;

  @Column({ type: 'uuid', nullable: true })
  generationId?: string;

  @Column({ type: 'uuid', nullable: true })
  profileId?: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  profileKind?: string | null;

  @Column({ type: 'uuid', nullable: true, select: false })
  clientId?: string;

  @Column({ type: 'text', nullable: true })
  clientProfileJson?: string | null;

  @Column({ type: 'int', default: 0 })
  cleanupAttempts: number;

  @Column({ type: 'timestamp', nullable: true })
  nextCleanupAt?: Date;

  @Column({ type: 'text', nullable: true })
  lastCleanupError?: string;

  @Column({ type: 'uuid', nullable: true })
  subscriptionId?: string;

  @ManyToOne(() => Subscription, (sub) => sub.inbounds, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscriptionId' })
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
