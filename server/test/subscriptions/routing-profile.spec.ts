import {
  buildHappRoutingLink,
  buildIncyRoutingLink,
} from 'src/subscriptions/routing-profile';

describe('routing profiles', () => {
  const json = '{"Name":"Маршрут"}';
  const encoded = Buffer.from(json).toString('base64');
  it.each([json, encoded, `happ://routing/add/${encoded}`])(
    'encodes Happ %s',
    (value) => {
      expect(buildHappRoutingLink(value)).toBe(`happ://routing/add/${encoded}`);
    },
  );
  it('preserves routing commands and INCY URL profiles', () => {
    expect(buildHappRoutingLink(`happ://routing/onadd/${encoded}`)).toBe(
      `happ://routing/onadd/${encoded}`,
    );
    expect(buildHappRoutingLink('happ://routing/off')).toBe(
      'happ://routing/off',
    );
    expect(buildIncyRoutingLink('incy://routing/off')).toBe(
      'incy://routing/off',
    );
    expect(buildIncyRoutingLink(json)).toBe(`incy://routing/add/${encoded}`);
    expect(buildIncyRoutingLink('https://example.com/p')).toBe(
      'incy://autorouting/add/https://example.com/p',
    );
    expect(
      buildIncyRoutingLink('incy://routing/onadd/https://example.com/p'),
    ).toBe('incy://routing/onadd/https://example.com/p');
  });
  it.each(['', '[]', 'null', 'invalid', 'e30=\nvless://injected'])(
    'rejects invalid Happ %s',
    (value) => expect(() => buildHappRoutingLink(value)).toThrow(),
  );
  it.each([
    '',
    '[]',
    'incy://autorouting/add/file:///tmp/a',
    'https://example.com/x\nvless://injected',
  ])('rejects invalid INCY %s', (value) =>
    expect(() => buildIncyRoutingLink(value)).toThrow(),
  );
});
