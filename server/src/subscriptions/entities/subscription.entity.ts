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

  @Column({ default: true })
  isEnabled: boolean;

  @Column({ default: true })
  isAutoRotationEnabled: boolean;

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
