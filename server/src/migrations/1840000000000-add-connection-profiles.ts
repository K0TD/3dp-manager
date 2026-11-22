import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConnectionProfiles1840000000000 implements MigrationInterface {
  name = 'AddConnectionProfiles1840000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "connection_profile" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(160) NOT NULL,
        "kind" character varying(32) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "subscriptionId" uuid,
        "nodeId" uuid,
        "configId" uuid,
        "port" integer,
        "sni" character varying(253),
        "rotationPolicy" character varying(32) NOT NULL DEFAULT 'fixed_domain',
        "spec" text,
        "monitoringConfig" text,
        "lastCheckStatus" character varying(16) NOT NULL DEFAULT 'unknown',
        "lastCheckResult" text,
        "lastCheckedAt" TIMESTAMP,
        "activeRevision" integer NOT NULL DEFAULT 1,
        "previousSnapshot" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_connection_profile_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_connection_profile_subscription"
          FOREIGN KEY ("subscriptionId") REFERENCES "subscription"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_connection_profile_node"
          FOREIGN KEY ("nodeId") REFERENCES "node"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_connection_profile_kind"
      ON "connection_profile" ("kind")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_connection_profile_subscription"
      ON "connection_profile" ("subscriptionId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_connection_profile_node"
      ON "connection_profile" ("nodeId")
    `);
    await queryRunner.query(`
      ALTER TABLE "inbound"
      ADD COLUMN IF NOT EXISTS "profileId" uuid,
      ADD COLUMN IF NOT EXISTS "profileKind" character varying(32),
      ADD COLUMN IF NOT EXISTS "clientProfileJson" text
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_inbound_connection_profile'
        ) THEN
          ALTER TABLE "inbound"
          ADD CONSTRAINT "FK_inbound_connection_profile"
          FOREIGN KEY ("profileId") REFERENCES "connection_profile"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inbound" DROP CONSTRAINT IF EXISTS "FK_inbound_connection_profile"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound" DROP COLUMN IF EXISTS "clientProfileJson"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound" DROP COLUMN IF EXISTS "profileKind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound" DROP COLUMN IF EXISTS "profileId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_connection_profile_node"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_connection_profile_subscription"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_connection_profile_kind"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "connection_profile"`);
  }
}
