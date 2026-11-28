import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionClientAndUsage1900000000000 implements MigrationInterface {
  name = 'AddSubscriptionClientAndUsage1900000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "subscription" ADD COLUMN IF NOT EXISTS "clientId" varchar(255), ADD COLUMN IF NOT EXISTS "clientAutoCreate" boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS "clientUsage" text',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "subscription" DROP COLUMN IF EXISTS "clientId", DROP COLUMN IF EXISTS "clientAutoCreate", DROP COLUMN IF EXISTS "clientUsage"',
    );
  }
}
