import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
} from 'typeorm';
import { Inbound } from '../../inbounds/entities/inbound.entity';
import { Node } from '../../nodes/entities/node.entity';
import { Tunnel } from '../../tunnels/entities/tunnel.entity';
import type { ManagedProfileSettings } from '../../profiles/connection-profile.types';

@Entity()
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  note?: string;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  supportUrl?: string;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  websiteUrl?: string;

  @Column({ unique: true })
  uuid: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  clientId?: string | null;

  @Column({ default: false })
  clientAutoCreate?: boolean;

  @Column({ type: 'simple-json', nullable: true })
  clientUsage?: {
    upload: number;
    download: number;
    total: number;
    expire: number;
  } | null;

  @Column({ default: true })
  isEnabled: boolean;

  @Column({ default: true })
  isAutoRotationEnabled: boolean;

  @Column({ type: 'integer', nullable: true, select: false, update: false })
  displayOrder?: number;

  @Column({ type: 'simple-json', nullable: true })
  inboundsConfig: Array<{
    configId?: string;
    type?: string;
    port?: number | string;
    sni?: string;
    certificateMode?: 'node' | 'custom';
    tlsServerName?: string;
    link?: string;
    routingProfile?: string;
    nodeId?: string;
    relayServerId?: number;
    flag?: string;
    name?: string;
    certificateFile?: string;
    keyFile?: string;
    profileId?: string;
    profileSettings?: ManagedProfileSettings;
    enabled?: boolean;
    disabledReason?: string;
  }>;

  @Column({ type: 'uuid', nullable: true })
  nodeId?: string | null;

  @ManyToOne(() => Node, (node) => node.subscriptions, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  node?: Node | null;

  @Column({ nullable: true })
  relayServerId?: number;

  @ManyToOne(() => Tunnel, { nullable: true, onDelete: 'SET NULL' })
  relayServer?: Tunnel;

  @OneToMany(() => Inbound, (inbound) => inbound.subscription)
  inbounds: Inbound[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
