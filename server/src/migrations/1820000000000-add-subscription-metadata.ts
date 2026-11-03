import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionMetadata1820000000000 implements MigrationInterface {
  name = 'AddSubscriptionMetadata1820000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "note" varchar(200), ADD COLUMN IF NOT EXISTS "supportUrl" varchar(2048), ADD COLUMN IF NOT EXISTS "websiteUrl" varchar(2048)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "subscription" DROP COLUMN IF EXISTS "note", DROP COLUMN IF EXISTS "supportUrl", DROP COLUMN IF EXISTS "websiteUrl"',
    );
  }
}
