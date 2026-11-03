import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSubscriptionDto } from 'src/subscriptions/dto/create-subscription.dto';
import { UpdateSubscriptionDto } from 'src/subscriptions/dto/update-subscription.dto';

describe('subscription metadata validation', () => {
  it.each([
    { note: 'n'.repeat(201) },
    { supportUrl: 'ftp://example.com' },
    { websiteUrl: 'tg://resolve?domain=help' },
    { websiteUrl: 'https://example.com/' + 'x'.repeat(2048) },
  ])('rejects invalid metadata %j', async (metadata) => {
    const dto = plainToInstance(CreateSubscriptionDto, {
      name: 'Test',
      ...metadata,
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
  it.each([
    {
      note: 'Примечание',
      supportUrl: 'tg://resolve?domain=help',
      websiteUrl: 'https://example.com',
    },
    { supportUrl: '', websiteUrl: '' },
  ])('accepts valid metadata %j', async (metadata) => {
    expect(
      await validate(
        plainToInstance(CreateSubscriptionDto, { name: 'Test', ...metadata }),
      ),
    ).toHaveLength(0);
  });
});

describe('connection count validation', () => {
  const connection = { type: 'custom', link: 'vless://test' };
  const routing = [
    { type: 'happ-routing', routingProfile: '{}' },
    { type: 'incy-routing', routingProfile: '{}' },
  ];
  it('accepts 20 connections plus routing profiles on create and update', async () => {
    const inboundsConfig = [
      ...Array.from({ length: 20 }, () => connection),
      ...routing,
    ];
    expect(
      await validate(
        plainToInstance(CreateSubscriptionDto, {
          name: 'Test',
          inboundsConfig,
        }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(UpdateSubscriptionDto, { inboundsConfig }),
      ),
    ).toHaveLength(0);
  });
  it('rejects 21 connections even with routing profiles interleaved', async () => {
    const inboundsConfig = [
      routing[0],
      ...Array.from({ length: 21 }, () => connection),
      routing[1],
    ];
    const errors = await validate(
      plainToInstance(CreateSubscriptionDto, { name: 'Test', inboundsConfig }),
    );
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'inboundsConfig',
          constraints: expect.objectContaining({
            maxConnectionCount: expect.any(String),
          }),
        }),
      ]),
    );
  });
});
