import { AutomationService } from 'src/automation/automation.service';

describe('Rotation diagnostics export', () => {
  it('returns the technical cause of an old operation with no inbound results', async () => {
    const technicalDetails =
      'insert or update on table "inbound" violates foreign key constraint "FK_inbound_connection_profile"';
    const message = `${technicalDetails}\nDETAIL: Key (profileId)=(private-value) is not present`;
    const rotation = {
      getOperation: jest.fn().mockResolvedValue({
        id: 'op',
        status: 'failed',
        error: message,
        errorDetails: { stage: 'rotation', code: 'OPERATION_FAILED' },
        results: [],
      }),
    };
    const service = new AutomationService(
      undefined!,
      undefined!,
      undefined!,
      rotation as never,
    );

    const report = await service.getOperation('op');
    expect(report).toMatchObject({
      error: {
        code: 'CONNECTION_PROFILE_NOT_FOUND',
        stage: 'rotation',
        technicalDetails,
      },
      results: [],
    });
    expect(JSON.stringify(report)).not.toContain('private-value');
  });

  it('includes probe attempts and preserves diagnostics for legacy operations without exposing raw output', async () => {
    const fakeProbe = {
      success: false,
      engine: 'xray-core',
      targetAddress: 'node.example.org',
      targetPort: 12345,
      stage: 'http',
      tcpReachable: true,
      tcpDurationMs: 30,
      failure: 'TUNNEL_CLOSED',
      error: 'RAW_SECRET',
      probeUrl: 'http://example.org/private',
      attempts: [
        {
          host: 'first.example.org',
          port: 80,
          stage: 'http',
          durationMs: 220,
          failure: 'TUNNEL_CLOSED',
          signal: 'EOF',
          error: 'RAW_SECRET',
        },
      ],
    };
    const legacyError = {
      code: 'PANEL_REJECTED',
      raw: 'port 20443 already used RAW_SECRET',
      port: 20443,
      stage: 'create',
    };
    const rotation = {
      getOperation: jest.fn().mockResolvedValue({
        id: 'op',
        status: 'partial',
        results: [
          {
            subscriptionId: 'sub',
            nodeId: 'node',
            panelVersion: '3.8.5',
            xrayVersion: '26.7.28',
            inboundResults: [
              {
                configId: 'config',
                status: 'preserved',
                xuiId: 24,
                canary: fakeProbe,
              },
            ],
          },
          {
            subscriptionId: 'sub',
            canaryResults: [fakeProbe],
            errorDetails: legacyError,
          },
        ],
      }),
    };
    const subscriptions = { find: jest.fn().mockResolvedValue([]) };
    const service = new AutomationService(
      undefined!,
      undefined!,
      subscriptions as never,
      rotation as never,
    );

    const report = await service.getOperation('op');
    expect(report).toMatchObject({
      results: [
        {
          xrayVersion: '26.7.28',
          panelVersion: '3.8.5',
          inbounds: [
            {
              xuiId: 24,
              canary: {
                targetAddress: 'node.example.org',
                attempts: [
                  {
                    host: 'first.example.org',
                    signal: 'EOF',
                    failure: 'TUNNEL_CLOSED',
                  },
                ],
              },
            },
          ],
        },
        {
          canary: [{ tcpReachable: true }],
          error: { code: 'PORT_CONFLICT', port: 20443 },
        },
      ],
    });
    expect(JSON.stringify(report)).not.toMatch(/RAW_SECRET|\/private/);
  });
});
