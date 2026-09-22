import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoutingPresets1810000000000 implements MigrationInterface {
  name = 'AddRoutingPresets1810000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "node" ADD COLUMN IF NOT EXISTS "routingPresets" text',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "node" DROP COLUMN IF EXISTS "routingPresets"',
    );
  }
}
