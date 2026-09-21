import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInboundOrder1790000000000 implements MigrationInterface {
  name = 'AddInboundOrder1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      ALTER TABLE "inbound"
      ADD COLUMN IF NOT EXISTS "configId" uuid,
      ADD COLUMN IF NOT EXISTS "position" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      UPDATE "subscription" AS subscription
      SET "inboundsConfig" = (
        SELECT jsonb_agg(
          CASE
            WHEN config ? 'configId' THEN config
            ELSE config || jsonb_build_object('configId', uuid_generate_v4()::text)
          END
          ORDER BY ordinal
        )::text AS config
        FROM jsonb_array_elements(subscription."inboundsConfig"::jsonb)
          WITH ORDINALITY AS entries(config, ordinal)
      )
      WHERE subscription."inboundsConfig" IS NOT NULL
        AND subscription."inboundsConfig" <> '[]'
    `);
    await queryRunner.query(`
      WITH ranked_inbounds AS (
        SELECT id, "subscriptionId",
          row_number() OVER (PARTITION BY "subscriptionId" ORDER BY id) AS ordinal
        FROM "inbound"
        WHERE status = 'active'
      ), ranked_configs AS (
        SELECT subscription.id AS "subscriptionId",
          (entry.config->>'configId')::uuid AS "configId",
          entry.ordinal
        FROM "subscription" AS subscription
        CROSS JOIN LATERAL jsonb_array_elements(subscription."inboundsConfig"::jsonb)
          WITH ORDINALITY AS entry(config, ordinal)
        WHERE subscription."inboundsConfig" IS NOT NULL
      )
      UPDATE "inbound" AS inbound
      SET "configId" = config."configId",
          "position" = config.ordinal - 1
      FROM ranked_inbounds AS ranked
      JOIN ranked_configs AS config
        ON config."subscriptionId" = ranked."subscriptionId"
       AND config.ordinal = ranked.ordinal
      WHERE inbound.id = ranked.id
    `);
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id,
          row_number() OVER (PARTITION BY "subscriptionId" ORDER BY id) - 1 AS position
        FROM "inbound"
        WHERE "configId" IS NULL
      )
      UPDATE "inbound" AS inbound
      SET "position" = ranked.position
      FROM ranked
      WHERE inbound.id = ranked.id
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inbound_subscription_position"
      ON "inbound" ("subscriptionId", "position")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_inbound_subscription_position"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound" DROP COLUMN IF EXISTS "position"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound" DROP COLUMN IF EXISTS "configId"`,
    );
    await queryRunner.query(`
      UPDATE "subscription" AS subscription
      SET "inboundsConfig" = (
        SELECT jsonb_agg(config - 'configId' ORDER BY ordinal)::text
        FROM jsonb_array_elements(subscription."inboundsConfig"::jsonb)
          WITH ORDINALITY AS entries(config, ordinal)
      )
      WHERE subscription."inboundsConfig" IS NOT NULL
        AND subscription."inboundsConfig" <> '[]'
    `);
  }
}
