import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOperationErrorDetails1830000000000 implements MigrationInterface {
  name = 'AddOperationErrorDetails1830000000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "rotation_operation" ADD COLUMN IF NOT EXISTS "errorDetails" text',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "rotation_operation" DROP COLUMN IF EXISTS "errorDetails"',
    );
  }
}
