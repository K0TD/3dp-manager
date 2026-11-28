import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { Node } from '../../nodes/entities/node.entity';

@Entity()
export class Tunnel {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  ip: string;

  @Column({ default: 22 })
  sshPort: number;

  @Column()
  username: string;

  @Column({ select: false, nullable: true })
  password?: string;

  @Column({ type: 'text', select: false, nullable: true })
  privateKey?: string;

  @Column({ nullable: true })
  domain: string;

  @Column({ nullable: true })
  nodeId?: string;

  @ManyToOne(() => Node, (node) => node.tunnels, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  node?: Node;

  @Column({ type: 'simple-array', nullable: true })
  ports?: number[];

  @Column({ type: 'varchar', length: 255, nullable: true })
  tcpPorts?: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  udpPorts?: string | null;

  @Column({ default: false })
  isInstalled: boolean;
}
