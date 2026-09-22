import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNodesAndNodeRelations1765960000000 implements MigrationInterface {
  name = 'AddNodesAndNodeRelations1765960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'node_protocol_enum') THEN
          CREATE TYPE "node_protocol_enum" AS ENUM ('http', 'https');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'node_authtype_enum') THEN
          CREATE TYPE "node_authtype_enum" AS ENUM ('password', 'token');
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "node" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "url" character varying,
        "host" character varying,
        "port" integer,
        "protocol" "node_protocol_enum" DEFAULT 'https',
        "authType" "node_authtype_enum" NOT NULL DEFAULT 'password',
        "login" character varying,
        "password" character varying,
        "token" character varying,
        "isMain" boolean NOT NULL DEFAULT false,
        "version" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_node_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "node"
      ADD COLUMN IF NOT EXISTS "url" character varying
    `);

    await queryRunner
      .query(
        `
      ALTER TABLE "node"
      ALTER COLUMN "host" DROP NOT NULL,
      ALTER COLUMN "port" DROP NOT NULL,
      ALTER COLUMN "protocol" DROP NOT NULL
    `,
      )
      .catch(() => undefined);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_node_single_main"
      ON "node" ("isMain")
      WHERE "isMain" = true
    `);

    await queryRunner.query(`
      ALTER TABLE "subscription"
      ADD COLUMN IF NOT EXISTS "nodeId" uuid,
      ADD COLUMN IF NOT EXISTS "relayServerId" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "inbound"
      ADD COLUMN IF NOT EXISTS "nodeId" uuid,
      ADD COLUMN IF NOT EXISTS "relayServerId" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "tunnel"
      ADD COLUMN IF NOT EXISTS "nodeId" uuid,
      ADD COLUMN IF NOT EXISTS "ports" text
    `);

    await queryRunner
      .query(
        `
      ALTER TABLE "subscription"
      ADD CONSTRAINT "FK_subscription_node"
      FOREIGN KEY ("nodeId") REFERENCES "node"("id") ON DELETE SET NULL
    `,
      )
      .catch(() => undefined);

    await queryRunner
      .query(
        `
      ALTER TABLE "subscription"
      ADD CONSTRAINT "FK_subscription_relay"
      FOREIGN KEY ("relayServerId") REFERENCES "tunnel"("id") ON DELETE SET NULL
    `,
      )
      .catch(() => undefined);

    await queryRunner
      .query(
        `
      ALTER TABLE "inbound"
      ADD CONSTRAINT "FK_inbound_node"
      FOREIGN KEY ("nodeId") REFERENCES "node"("id") ON DELETE SET NULL
    `,
      )
      .catch(() => undefined);

    await queryRunner
      .query(
        `
      ALTER TABLE "inbound"
      ADD CONSTRAINT "FK_inbound_relay"
      FOREIGN KEY ("relayServerId") REFERENCES "tunnel"("id") ON DELETE SET NULL
    `,
      )
      .catch(() => undefined);

    await queryRunner
      .query(
        `
      ALTER TABLE "tunnel"
      ADD CONSTRAINT "FK_tunnel_node"
      FOREIGN KEY ("nodeId") REFERENCES "node"("id") ON DELETE SET NULL
    `,
      )
      .catch(() => undefined);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "tunnel" DROP CONSTRAINT IF EXISTS "FK_tunnel_node"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound" DROP CONSTRAINT IF EXISTS "FK_inbound_relay"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound" DROP CONSTRAINT IF EXISTS "FK_inbound_node"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription" DROP CONSTRAINT IF EXISTS "FK_subscription_relay"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription" DROP CONSTRAINT IF EXISTS "FK_subscription_node"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tunnel" DROP COLUMN IF EXISTS "ports"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tunnel" DROP COLUMN IF EXISTS "nodeId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound" DROP COLUMN IF EXISTS "relayServerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "inbound" DROP COLUMN IF EXISTS "nodeId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription" DROP COLUMN IF EXISTS "relayServerId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "subscription" DROP COLUMN IF EXISTS "nodeId"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_node_single_main"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "node"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "node_authtype_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "node_protocol_enum"`);
  }
}
