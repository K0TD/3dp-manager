import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline for fresh installations. Every statement is idempotent so an
 * installation created by the old synchronize=true setup can adopt migrations.
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "setting" (
        "key" character varying NOT NULL,
        "value" character varying NOT NULL,
        "description" character varying,
        CONSTRAINT "PK_setting_key" PRIMARY KEY ("key")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "domain" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "isEnabled" boolean NOT NULL DEFAULT true,
        CONSTRAINT "UQ_domain_name" UNIQUE ("name"),
        CONSTRAINT "PK_domain_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "subscription" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "uuid" character varying NOT NULL,
        "isEnabled" boolean NOT NULL DEFAULT true,
        "isAutoRotationEnabled" boolean NOT NULL DEFAULT true,
        "inboundsConfig" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_subscription_uuid" UNIQUE ("uuid"),
        CONSTRAINT "PK_subscription_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tunnel" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "ip" character varying NOT NULL,
        "sshPort" integer NOT NULL DEFAULT 22,
        "username" character varying NOT NULL,
        "password" character varying,
        "privateKey" text,
        "domain" character varying,
        "isInstalled" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_tunnel_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inbound" (
        "id" SERIAL NOT NULL,
        "xuiId" integer NOT NULL,
        "port" integer NOT NULL,
        "protocol" character varying NOT NULL,
        "remark" character varying,
        "link" text,
        "subscriptionId" uuid,
        CONSTRAINT "PK_inbound_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "inbound"
      ADD CONSTRAINT "FK_inbound_subscription"
      FOREIGN KEY ("subscriptionId") REFERENCES "subscription"("id") ON DELETE CASCADE
    `).catch(() => undefined);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "inbound"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tunnel"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscription"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "domain"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "setting"`);
  }
}
