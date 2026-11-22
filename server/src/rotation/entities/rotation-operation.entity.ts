import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { XuiInboundDiagnostic } from '../../xui/xui-contract';
import type { OperationErrorDetails } from '../operation-error';
import type { ClientConnectionProbeResult } from '../../profiles/connection-profile.types';

export interface RotationInboundDiagnostic extends XuiInboundDiagnostic {
  configId?: string;
  name?: string;
}

export enum RotationOperationStatus {
  Queued = 'queued',
  Running = 'running',
  Succeeded = 'succeeded',
  Partial = 'partial',
  Failed = 'failed',
}

export interface RotationConfigResult {
  configId?: string;
  type?: string;
  name?: string;
  status: 'activated' | 'unchanged' | 'superseded' | 'preserved' | 'failed';
  previousActive: boolean;
  port?: number;
  cleanupQueued?: boolean;
  xuiId?: number;
  error?: OperationErrorDetails;
  conflict?: { xuiId?: number; listen?: string; subscriptionId?: string };
  canary?: ClientConnectionProbeResult & {
    sni?: string;
    host?: string;
    path?: string;
    mode?: string;
  };
}

export interface RotationTarget {
  operationId: string;
  subscriptionId: string;
  configId: string;
  version?: string;
  patch?: {
    port?: number | 'random';
    sni?: string;
    mode?: 'auto' | 'packet-up' | 'stream-one';
    path?: string;
  };
}

export interface RotationNodeResult {
  subscriptionId: string;
  subscriptionName: string;
  nodeId?: string;
  nodeName: string;
  panelVersion?: string;
  xrayVersion?: string;
  status: 'succeeded' | 'partial' | 'preserved' | 'failed';
  inboundResults?: RotationConfigResult[];
  created: number;
  preserved?: number;
  pendingCleanup: number;
  rolledBack?: boolean;
  canaryResults?: ClientConnectionProbeResult[];
  message?: string;
  errorDetails?: OperationErrorDetails;
  details?: {
    phase: string;
    inbounds: RotationInboundDiagnostic[];
    blockingInbound?: XuiInboundDiagnostic & {
      subscriptionId?: string;
      subscriptionName?: string;
    };
  };
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

  @Column({ type: 'simple-json', nullable: true })
  target?: RotationTarget;

  @Column({ type: 'varchar', length: 64, unique: true, nullable: true })
  idempotency?: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  requestFingerprint?: string;

  @Column({ type: 'uuid', nullable: true })
  apiTokenId?: string;

  @Column({ type: 'text', nullable: true })
  error?: string;

  @Column({ type: 'simple-json', nullable: true })
  errorDetails?: OperationErrorDetails | null;

  @Column({ type: 'timestamp', nullable: true })
  startedAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt?: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
