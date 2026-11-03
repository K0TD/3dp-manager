import {
  normalizeOperationError,
  redactOperationError,
} from 'src/rotation/operation-error';

describe('operation error normalization', () => {
  it.each([
    ['Node is unreachable (ECONNREFUSED)', 'ECONNREFUSED'],
    ['Node is unreachable (ENOTFOUND)', 'DNS_FAILED'],
    ['connect ECONNRESET', 'ECONNRESET'],
    ['Connection timed out (ETIMEDOUT)', 'TIMEOUT'],
    ['The operation was aborted', 'TIMEOUT'],
    ['3x-ui returned HTTP 401', 'PANEL_AUTH_FAILED'],
    ['Authentication was rejected', 'PANEL_AUTH_FAILED'],
    ['3x-ui returned HTTP 403', 'PANEL_FORBIDDEN'],
    ['3x-ui returned HTTP 404', 'PANEL_NOT_FOUND'],
    ['3x-ui returned HTTP 503', 'PANEL_SERVER_ERROR'],
    ['Go struct unmarshal error', 'PANEL_INVALID_PAYLOAD'],
    ['invalid CSRF token', 'CSRF_FAILED'],
    [
      'json: cannot unmarshal string into Go struct field Client.tgId of type int64',
      'PANEL_INVALID_PAYLOAD',
    ],
    ['listen tcp :443: bind: address already in use', 'PORT_IN_USE'],
    [
      '3x-ui returned HTTP 500: listen tcp :443: bind: address already in use',
      'PORT_IN_USE',
    ],
    ['Port 20000 is already in use', 'PORT_IN_USE'],
    ['duplicate tag: in-443', 'DUPLICATE_TAG'],
    ['3x-ui отклонил создание инбаунда', 'PANEL_REJECTED'],
    ['Failed to delete inbound 101 from 3x-ui', 'INBOUND_DELETE_FAILED'],
    ['SSH command timeout after 120000ms', 'SSH_TIMEOUT'],
    ['SSH Error: connect ECONNREFUSED', 'SSH_FAILED'],
    ['Node is unreachable', 'NODE_UNAVAILABLE'],
    ['неизвестный сбой', 'OPERATION_FAILED'],
  ])('maps %s to %s', (message, code) => {
    expect(
      normalizeOperationError(message, { node: 'Moscow', stage: 'create' }),
    ).toMatchObject({
      code,
      node: 'Moscow',
      raw: message,
      title: expect.any(String),
      hint: expect.any(String),
    });
  });

  it('includes the failed connection and port in a port conflict', () => {
    expect(
      normalizeOperationError('listen: address already in use', {
        node: 'X',
        stage: 'create',
        inboundType: 'vless-xhttp-reality',
        port: 443,
      }),
    ).toMatchObject({
      code: 'PORT_IN_USE',
      stage: 'create',
      inboundType: 'vless-xhttp-reality',
      port: 443,
      title:
        'Панель отклонила создание vless-xhttp-reality на порту 443: порт уже занят',
      hint: 'Выберите другой порт или освободите его.',
    });
    expect(
      normalizeOperationError('Node is unreachable (ECONNREFUSED)', {
        node: 'X',
      }).title,
    ).toBe('Нода «X» недоступна: соединение отклонено (ECONNREFUSED)');
  });

  it('classifies a free-form panel rejection when the caller identifies its source', () => {
    expect(
      normalizeOperationError('something went wrong', {
        panelRejected: true,
        stage: 'create',
      }),
    ).toMatchObject({ code: 'PANEL_REJECTED', stage: 'create' });
  });

  it('uses SSH context for a command error without an SSH prefix', () => {
    expect(
      normalizeOperationError('Exit code 1. Output: permission denied', {
        stage: 'ssh',
      }),
    ).toMatchObject({ code: 'SSH_FAILED', stage: 'ssh' });
  });

  it.each([
    'password',
    'privateKey',
    'token',
    'cookie',
    'clientId',
    'id',
    'uuid',
  ])('redacts %s in panel JSON embedded at multiple escaping depths', (key) => {
    const secret = `short-${key}-secret`;
    let embedded = JSON.stringify({ [key]: secret, other: 'value' });
    for (let level = 1; level <= 4; level++) {
      const panelMessage = `3x-ui отказ: ${JSON.stringify({ settings: embedded })}`;
      const details = normalizeOperationError(panelMessage, {
        stage: 'create',
      });
      expect(details.raw).not.toContain(secret);
      expect(details.raw).toContain('3x-ui отказ:');
      embedded = JSON.stringify({ data: embedded });
    }
  });

  it('redacts plain short client IDs and preserves unrelated diagnostic text', () => {
    const raw = redactOperationError(
      '{"id":"short-client-id","uuid":"short-uuid","port":443}',
    );
    expect(raw).not.toContain('short-client-id');
    expect(raw).not.toContain('short-uuid');
    expect(raw).toContain('443');
    expect(redactOperationError('invalid: diagnostic')).toBe(
      'invalid: diagnostic',
    );
  });

  it('redacts secrets before truncation from raw and contextual fields', () => {
    const value = [
      '{"password":"short password","token":"shortToken","privateKey":"privateValue","id":"123e4567-e89b-12d3-a456-426614174000"}',
      'Authorization: Bearer visibleBearer',
      'Cookie: session=visibleCookie',
      'https://admin:secret@example.test/path?token=visibleQuery',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nvisiblePrivateKey\n-----END OPENSSH PRIVATE KEY-----',
      'secret=abc123',
    ].join('\n');
    const details = normalizeOperationError(value, {
      node: 'token=visibleNode',
      inboundType: 'vless',
    });
    for (const secret of [
      'short password',
      'shortToken',
      'privateValue',
      '123e4567-e89b-12d3-a456-426614174000',
      'visibleBearer',
      'visibleCookie',
      'admin:secret',
      'visibleQuery',
      'visiblePrivateKey',
      'abc123',
      'visibleNode',
    ]) {
      expect(JSON.stringify(details)).not.toContain(secret);
    }
    expect(redactOperationError('x'.repeat(3000))).toHaveLength(8);
    expect(
      redactOperationError('bad '.repeat(1000)).length,
    ).toBeLessThanOrEqual(2048);
  });
});
