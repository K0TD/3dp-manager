import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNodeCapabilities1800000000000 implements MigrationInterface {
  name = 'AddNodeCapabilities1800000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "node"
      ADD COLUMN IF NOT EXISTS "xrayVersion" character varying,
      ADD COLUMN IF NOT EXISTS "capabilities" text,
      ADD COLUMN IF NOT EXISTS "compatibilityCheckedAt" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "webCertificateFile" text,
      ADD COLUMN IF NOT EXISTS "webKeyFile" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "node"
      DROP COLUMN IF EXISTS "webKeyFile",
      DROP COLUMN IF EXISTS "webCertificateFile",
      DROP COLUMN IF EXISTS "compatibilityCheckedAt",
      DROP COLUMN IF EXISTS "capabilities",
      DROP COLUMN IF EXISTS "xrayVersion"
    `);
  }
}
