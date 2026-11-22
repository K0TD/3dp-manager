import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionDisplayOrder1870000000000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(
      'ALTER TABLE "subscription" ADD COLUMN "displayOrder" integer',
    );
  }

  async down(query: QueryRunner): Promise<void> {
    await query.query('ALTER TABLE "subscription" DROP COLUMN "displayOrder"');
  }
}
