import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Inbound } from '../../inbounds/entities/inbound.entity';
import { Subscription } from '../../subscriptions/entities/subscription.entity';
import { Tunnel } from '../../tunnels/entities/tunnel.entity';
import type { NodeCapabilities } from '../node-capabilities';

export enum NodeAuthType {
  Password = 'password',
  Token = 'token',
}

export enum NodeProtocol {
  Http = 'http',
  Https = 'https',
}

export enum NodeHealthStatus {
  Unknown = 'unknown',
  Online = 'online',
  Degraded = 'degraded',
  Offline = 'offline',
  AuthError = 'auth_error',
  Deleting = 'deleting',
}

@Entity()
export class Node {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  url?: string;

  @Column({ nullable: true })
  host?: string;

  @Column({ nullable: true })
  domain?: string;

  @Column({ nullable: true })
  ip?: string;

  @Column({ nullable: true })
  flag?: string;

  @Column({ type: 'int', nullable: true })
  port?: number;

  @Column({
    type: 'enum',
    enum: NodeProtocol,
    default: NodeProtocol.Https,
    nullable: true,
  })
  protocol?: NodeProtocol;

  @Column({ type: 'enum', enum: NodeAuthType, default: NodeAuthType.Password })
  authType: NodeAuthType;

  @Column({ nullable: true })
  login?: string;

  @Column({ select: false, nullable: true })
  password?: string;

  @Column({ select: false, nullable: true })
  token?: string;

  @Column({ default: false })
  isMain: boolean;

  @Column({ nullable: true })
  version?: string;

  @Column({ nullable: true })
  xrayVersion?: string;

  @Column({ type: 'simple-json', nullable: true })
  capabilities?: NodeCapabilities;

  @Column({ type: 'timestamp', nullable: true })
  compatibilityCheckedAt?: Date;

  @Column({ type: 'text', nullable: true })
  webCertificateFile?: string;

  @Column({ type: 'text', nullable: true })
  webKeyFile?: string;

  @Column({ type: 'varchar', default: NodeHealthStatus.Unknown })
  healthStatus: NodeHealthStatus;

  @Column({ type: 'timestamp', nullable: true })
  lastCheckedAt?: Date;

  @Column({ type: 'int', nullable: true })
  responseTimeMs?: number;

  @Column({ type: 'int', default: 0 })
  consecutiveFailures: number;

  @Column({ type: 'text', nullable: true })
  lastError?: string;

  @Column({ default: false })
  allowInvalidTls: boolean;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;

  @OneToMany(() => Subscription, (subscription) => subscription.node)
  subscriptions: Subscription[];

  @OneToMany(() => Inbound, (inbound) => inbound.node)
  inbounds: Inbound[];

  @OneToMany(() => Tunnel, (tunnel) => tunnel.node)
  tunnels: Tunnel[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
