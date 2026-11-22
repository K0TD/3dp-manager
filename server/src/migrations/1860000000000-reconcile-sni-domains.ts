import { MigrationInterface, QueryRunner } from 'typeorm';

const domains = [
  'swdist.apple.com',
  'swcdn.apple.com',
  'gateway.icloud.com',
  'weather-data.apple.com',
  'c.s-microsoft.com',
  'www.microsoft.com',
  'update.microsoft.com',
  'dl.google.com',
  'www.samsung.com',
  'samsungotacdn.com',
  'download.nvidia.com',
  'www.nvidia.com',
  'debian.org',
  'archive.ubuntu.com',
];

export class ReconcileSniDomains1860000000000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query(`UPDATE "domain" SET "isEnabled" = false
      WHERE lower(rtrim("name", '.')) = 'speedtest.net'
      OR lower(rtrim("name", '.')) LIKE '%.speedtest.net'`);
    await query.query(`
      INSERT INTO "domain" ("name")
      SELECT unnest(ARRAY['ya.ru', 'vk.com', 'ok.ru', 'gosuslugi.ru', 'ozon.ru',
        'max.ru', 'vkvideo.ru', 'rutube.ru', 'kinopoisk.ru', 'avito.ru'])
      WHERE NOT EXISTS (SELECT 1 FROM "domain")
      ON CONFLICT ("name") DO NOTHING
    `);
    await query.query(
      `
      INSERT INTO "domain" ("name")
      SELECT entry.name FROM unnest($1::varchar[]) AS entry(name)
      WHERE NOT EXISTS (SELECT 1 FROM "domain" WHERE lower(rtrim("domain"."name", '.')) = entry.name)
      ON CONFLICT ("name") DO NOTHING
    `,
      [domains],
    );
  }

  async down(): Promise<void> {
    // Keep imported domains and operator changes when rolling back application code.
  }
}
