import { MigrationInterface, QueryRunner } from 'typeorm';

interface SubscriptionFlagDefaults {
  id: string;
  inboundsConfig: string;
  defaults: Array<{ position: number; flag: string }>;
}

function decodeFlag(flag: string): string {
  try {
    return decodeURIComponent(flag);
  } catch {
    return flag;
  }
}

export class AddConnectionProfileFlag1880000000000 implements MigrationInterface {
  async up(query: QueryRunner): Promise<void> {
    await query.query('ALTER TABLE "connection_profile" ADD COLUMN "flag" text');

    // Use the same node precedence as rotation to identify legacy node defaults.
    const { records } = await query.query(`
      WITH subscriptions_with_flags AS (
        SELECT id, name, "nodeId", "inboundsConfig" FROM "subscription"
        WHERE "inboundsConfig" LIKE '%"flag"%'
        ORDER BY id
        FOR UPDATE
      )
      SELECT sub.id, sub."inboundsConfig", jsonb_agg(jsonb_build_object(
        'position', desired.position - 1, 'flag', node.flag
      )) AS defaults
      FROM subscriptions_with_flags AS sub
      CROSS JOIN LATERAL jsonb_array_elements(CASE
        WHEN jsonb_typeof(sub."inboundsConfig"::jsonb) = 'array' THEN sub."inboundsConfig"::jsonb
        ELSE '[]'::jsonb
      END) WITH ORDINALITY AS desired(config, position)
      CROSS JOIN LATERAL (
        SELECT candidate.flag FROM "node" AS candidate
        WHERE candidate."deletedAt" IS NULL
        ORDER BY CASE
          WHEN candidate.id::text = COALESCE(NULLIF(lower(desired.config->>'nodeId'), ''), sub."nodeId"::text) THEN 0
          WHEN lower(trim(candidate.name)) = lower(trim(sub.name)) THEN 1
          WHEN candidate."isMain" THEN 2
          ELSE 3
        END, candidate."createdAt", candidate.id
        LIMIT 1
      ) AS node
      WHERE desired.config->>'type' IN ('xhttp-stable', 'self-sni', 'https-fallback')
        AND desired.config->>'flag' <> '' AND node.flag <> ''
        AND (
          NULLIF(desired.config->>'profileId', '') IS NOT NULL OR EXISTS (
            SELECT 1 FROM "connection_profile" AS profile
            WHERE profile."configId"::text = lower(desired.config->>'configId')
              AND profile.kind = desired.config->>'type'
              AND (profile."subscriptionId" IS NULL OR profile."subscriptionId" = sub.id)
          )
        )
      GROUP BY sub.id, sub."inboundsConfig"
    `, undefined, true);

    for (const { id, inboundsConfig, defaults } of records as SubscriptionFlagDefaults[]) {
      const configs = JSON.parse(inboundsConfig) as Array<{ flag?: string }>;
      let changed = false;
      for (const { position, flag } of defaults) {
        const config = configs[position];
        if (
          typeof config?.flag === 'string' &&
          decodeFlag(config.flag) === decodeFlag(flag)
        ) {
          delete config.flag;
          changed = true;
        }
      }
      if (changed) {
        await query.query(
          'UPDATE "subscription" SET "inboundsConfig" = $1 WHERE id = $2',
          [JSON.stringify(configs), id],
        );
      }
    }
  }

  async down(query: QueryRunner): Promise<void> {
    await query.query('ALTER TABLE "connection_profile" DROP COLUMN "flag"');
  }
}
