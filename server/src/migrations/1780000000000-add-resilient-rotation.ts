import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddResilientRotation1780000000000 implements MigrationInterface {
  name = 'AddResilientRotation1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      ALTER TABLE "inbound"
      ADD COLUMN IF NOT EXISTS "status" character varying NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS "generationId" uuid,
      ADD COLUMN IF NOT EXISTS "cleanupAttempts" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "nextCleanupAt" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "lastCleanupError" text,
      ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP NOT NULL DEFAULT now()
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inbound_cleanup"
      ON "inbound" ("status", "nextCleanupAt")
    `);
    await queryRunner.query(`
      ALTER TABLE "node"
      ADD COLUMN IF NOT EXISTS "healthStatus" character varying NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "responseTimeMs" integer,
      ADD COLUMN IF NOT EXISTS "consecutiveFailures" integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "lastError" text,
      ADD COLUMN IF NOT EXISTS "allowInvalidTls" boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP
    `);
    await queryRunner.query(`
      ALTER TABLE "node" ALTER COLUMN "allowInvalidTls" SET DEFAULT false
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rotation_operation" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "status" character varying NOT NULL DEFAULT 'queued',
        "subscriptionIds" text,
        "results" text,
        "error" text,
        "startedAt" TIMESTAMP,
        "finishedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rotation_operation_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rotation_operation_status"
      ON "rotation_operation" ("status", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "rotation_operation"`);
    await queryRunner.query(`ALTER TABLE "node" DROP COLUMN IF EXISTS "deletedAt"`);
    await queryRunner.query(`ALTER TABLE "node" DROP COLUMN IF EXISTS "allowInvalidTls"`);
    await queryRunner.query(`ALTER TABLE "node" DROP COLUMN IF EXISTS "lastError"`);
    await queryRunner.query(`ALTER TABLE "node" DROP COLUMN IF EXISTS "consecutiveFailures"`);
    await queryRunner.query(`ALTER TABLE "node" DROP COLUMN IF EXISTS "responseTimeMs"`);
    await queryRunner.query(`ALTER TABLE "node" DROP COLUMN IF EXISTS "lastCheckedAt"`);
    await queryRunner.query(`ALTER TABLE "node" DROP COLUMN IF EXISTS "healthStatus"`);
    await queryRunner.query(`ALTER TABLE "inbound" DROP COLUMN IF EXISTS "createdAt"`);
    await queryRunner.query(`ALTER TABLE "inbound" DROP COLUMN IF EXISTS "lastCleanupError"`);
    await queryRunner.query(`ALTER TABLE "inbound" DROP COLUMN IF EXISTS "nextCleanupAt"`);
    await queryRunner.query(`ALTER TABLE "inbound" DROP COLUMN IF EXISTS "cleanupAttempts"`);
    await queryRunner.query(`ALTER TABLE "inbound" DROP COLUMN IF EXISTS "generationId"`);
    await queryRunner.query(`ALTER TABLE "inbound" DROP COLUMN IF EXISTS "status"`);
  }
}
