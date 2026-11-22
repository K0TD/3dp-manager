import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const API_SCOPES = [
  'diagnostics:read',
  'rotation:retry',
  'cleanup:retry',
  'inbounds:repair',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

@Entity()
export class ApiToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true, select: false })
  digest: string;

  @Column({ type: 'simple-json' })
  scopes: ApiScope[];

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt?: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt?: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
