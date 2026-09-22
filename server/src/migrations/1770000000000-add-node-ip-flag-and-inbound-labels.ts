import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNodeIpFlagAndInboundLabels1770000000000 implements MigrationInterface {
  name = 'AddNodeIpFlagAndInboundLabels1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "node"
      ADD COLUMN IF NOT EXISTS "ip" character varying,
      ADD COLUMN IF NOT EXISTS "flag" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "node" DROP COLUMN IF EXISTS "flag"`);
    await queryRunner.query(`ALTER TABLE "node" DROP COLUMN IF EXISTS "ip"`);
  }
}
