import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomation1850000000000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`
      CREATE TABLE "api_token" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name" varchar NOT NULL,
        "digest" varchar NOT NULL UNIQUE,
        "scopes" text NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "revokedAt" timestamptz,
        "lastUsedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await query.query(`
      ALTER TABLE "rotation_operation"
        ADD COLUMN "target" text,
        ADD COLUMN "idempotency" varchar(64) UNIQUE,
        ADD COLUMN "requestFingerprint" varchar(64),
        ADD COLUMN "apiTokenId" uuid
    `);
    await query.query('ALTER TABLE "inbound" ADD COLUMN "clientId" uuid');
  }

  async down(query: QueryRunner): Promise<void> {
    await query.query('ALTER TABLE "inbound" DROP COLUMN "clientId"');
    await query.query(`
      ALTER TABLE "rotation_operation" DROP COLUMN "target",
        DROP COLUMN "idempotency", DROP COLUMN "requestFingerprint", DROP COLUMN "apiTokenId"
    `);
    await query.query('DROP TABLE "api_token"');
  }
}
