import { validateSync } from 'class-validator';
import { UpdateRoutingPresetsDto } from '../../src/nodes/dto/routing-presets.dto';

describe('routing preset request validation', () => {
  const request = (extra: Record<string, unknown>) =>
    Object.assign(new UpdateRoutingPresetsDto(), {
      blockRussia: false,
      blockIpCheckers: false,
      revision: 'a'.repeat(64),
      ...extra,
    });

  it.each([{}, { googleIpv4: true }, { googleIpv4: false }])(
    'accepts legacy requests and explicit booleans: %j',
    (extra) => {
      expect(validateSync(request(extra))).toEqual([]);
    },
  );

  it.each([null, 'true', 'false', 1, 0, {}, []])(
    'rejects invalid Google selection %j',
    (googleIpv4) => {
      expect(
        validateSync(request({ googleIpv4 })).map((error) => error.property),
      ).toEqual(['googleIpv4']);
    },
  );
});
