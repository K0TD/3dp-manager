import { BadRequestException } from '@nestjs/common';

export function buildHappRoutingLink(profile?: string): string {
  const value = profile?.trim() || '';
  if (value === 'happ://routing/off') return value;
  const match = /^happ:\/\/routing\/(add|onadd)\/([^\s]+)$/.exec(value);
  const payload = match?.[2] || value;
  try {
    if (!payload.startsWith('{') && !/^[A-Za-z0-9+/]+={0,2}$/.test(payload))
      throw new Error();
    const decoded = payload.startsWith('{')
      ? payload
      : Buffer.from(payload, 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error();
    return `happ://routing/${match?.[1] || 'add'}/${Buffer.from(JSON.stringify(parsed)).toString('base64')}`;
  } catch {
    throw new BadRequestException(
      'Invalid Happ routing profile: expected a JSON object, base64 or happ://routing link',
    );
  }
}

export function buildIncyRoutingLink(profile?: string): string {
  const value = profile?.trim() || '';
  const match =
    /^(?:incy)?:\/\/(routing|autorouting)\/(add|onadd)\/([^\s]+)$/.exec(value);
  const payload = match?.[3] || value;
  try {
    if (match?.[1] === 'autorouting' || /^https?:\/\//.test(payload)) {
      if (/\s/.test(payload)) throw new Error();
      const url = new URL(payload);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname)
        throw new Error();
      return `incy://${match?.[1] || 'autorouting'}/${match?.[2] || 'add'}/${payload}`;
    }
    return buildHappRoutingLink(
      value.replace(/^(?:incy)?:\/\/routing\//, 'happ://routing/'),
    ).replace(/^happ:/, 'incy:');
  } catch {
    throw new BadRequestException(
      'Invalid INCY routing profile: expected a JSON object, base64, HTTP(S) URL or incy://routing link',
    );
  }
}
