import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RotationOperationStatus {
  Queued = 'queued',
  Running = 'running',
  Succeeded = 'succeeded',
  Partial = 'partial',
  Failed = 'failed',
}

export interface RotationNodeResult {
  subscriptionId: string;
  subscriptionName: string;
  nodeId?: string;
  nodeName: string;
  status: 'succeeded' | 'preserved' | 'failed';
  created: number;
  pendingCleanup: number;
  message?: string;
}

@Entity()
export class RotationOperation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', default: RotationOperationStatus.Queued })
  status: RotationOperationStatus;

  @Column({ type: 'simple-json', nullable: true })
  subscriptionIds?: string[];

  @Column({ type: 'simple-json', nullable: true })
  results?: RotationNodeResult[];

  @Column({ type: 'text', nullable: true })
  error?: string;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
