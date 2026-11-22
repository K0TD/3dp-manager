import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Subscription } from '../../subscriptions/entities/subscription.entity';
import { Node } from '../../nodes/entities/node.entity';
import type {
  ManagedProfileKind,
  ManagedProfileSettings,
  ProfileCheckStatus,
  ProfileCompatibilityReport,
  ProfileMonitoringExtension,
  ProfileRotationPolicy,
} from '../connection-profile.types';

export interface ConnectionProfileSnapshot {
  revision: number;
  savedAt: string;
  name: string;
  kind: ManagedProfileKind;
  port?: number | null;
  sni?: string | null;
  rotationPolicy: ProfileRotationPolicy;
  spec: ManagedProfileSettings;
}

@Entity('connection_profile')
export class ConnectionProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 32 })
  kind: ManagedProfileKind;

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'uuid', nullable: true })
  subscriptionId?: string | null;

  @ManyToOne(() => Subscription, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subscriptionId' })
  subscription?: Subscription | null;

  @Column({ type: 'uuid', nullable: true })
  nodeId?: string | null;

  @ManyToOne(() => Node, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'nodeId' })
  node?: Node | null;

  @Column({ type: 'uuid', nullable: true })
  configId?: string | null;

  @Column({ type: 'int', nullable: true })
  port?: number | null;

  @Column({ type: 'varchar', length: 253, nullable: true })
  sni?: string | null;

  @Column({ type: 'varchar', length: 32, default: 'fixed_domain' })
  rotationPolicy: ProfileRotationPolicy;

  @Column({ type: 'simple-json', nullable: true })
  spec: ManagedProfileSettings;

  @Column({ type: 'simple-json', nullable: true })
  monitoringConfig?: ProfileMonitoringExtension | null;

  @Column({ type: 'varchar', length: 16, default: 'unknown' })
  lastCheckStatus: ProfileCheckStatus;

  @Column({ type: 'simple-json', nullable: true })
  lastCheckResult?: ProfileCompatibilityReport | null;

  @Column({ type: 'timestamp', nullable: true })
  lastCheckedAt?: Date | null;

  @Column({ type: 'int', default: 1 })
  activeRevision: number;

  @Column({ type: 'simple-json', nullable: true })
  previousSnapshot?: ConnectionProfileSnapshot | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
