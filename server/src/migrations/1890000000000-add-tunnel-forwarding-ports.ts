import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTunnelForwardingPorts1890000000000 implements MigrationInterface {
  name = 'AddTunnelForwardingPorts1890000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "tunnel" ADD COLUMN IF NOT EXISTS "tcpPorts" varchar(255), ADD COLUMN IF NOT EXISTS "udpPorts" varchar(255)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "tunnel" DROP COLUMN IF EXISTS "tcpPorts", DROP COLUMN IF EXISTS "udpPorts"',
    );
  }
}
