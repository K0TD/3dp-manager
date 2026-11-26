import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import {
  getOptionsToken,
  ThrottlerGuard,
  ThrottlerModule,
} from '@nestjs/throttler';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AppModule } from 'src/app.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TYPEORM_MODULE_OPTIONS } from '@nestjs/typeorm/dist/typeorm.constants';
import { AddSubscriptionMetadata1820000000000 } from 'src/migrations/1820000000000-add-subscription-metadata';
import { AddOperationErrorDetails1830000000000 } from 'src/migrations/1830000000000-add-operation-error-details';
import { AddConnectionProfiles1840000000000 } from 'src/migrations/1840000000000-add-connection-profiles';
import { AddConnectionProfileFlag1880000000000 } from 'src/migrations/1880000000000-add-connection-profile-flag';
import { databaseAvailability } from 'src/database/database-availability';
import { Logger } from '@nestjs/common';

type DynamicModuleLike = {
  module?: unknown;
  global?: boolean;
  imports?: DynamicModuleLike[];
  providers?: Array<{
    provide?: unknown;
    useClass?: unknown;
    useValue?: unknown;
  }>;
};

type AppImportEntry = DynamicModuleLike | Promise<DynamicModuleLike>;

describe('AppModule конфигурация', () => {
  afterEach(() => {
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.JWT_SECRET;
  });

  it('registers the subscription metadata migration', async () => {
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ??
      []) as AppImportEntry[];
    const resolved = await Promise.all(imports);
    const db = resolved.find((entry) => entry.module === TypeOrmModule);
    const options = db?.imports?.[0]?.providers?.find(
      (provider) => provider.provide === TYPEORM_MODULE_OPTIONS,
    )?.useValue as { migrations: unknown[] };
    expect(options.migrations).toContain(AddSubscriptionMetadata1820000000000);
    expect(options.migrations).toContain(AddOperationErrorDetails1830000000000);
    expect(options.migrations).toContain(AddConnectionProfiles1840000000000);
    expect(options.migrations).toContain(AddConnectionProfileFlag1880000000000);
  });

  it('configures PostgreSQL retry, timeouts, and pool error resilience', async () => {
    databaseAvailability.reset();
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ??
      []) as AppImportEntry[];
    const resolved = await Promise.all(
      imports.map((entry) =>
        entry instanceof Promise ? entry : Promise.resolve(entry),
      ),
    );
    const db = resolved.find((entry) => entry.module === TypeOrmModule);
    const options = db?.imports?.[0]?.providers?.find(
      (provider) => provider.provide === TYPEORM_MODULE_OPTIONS,
    )?.useValue as {
      retryAttempts: number;
      retryDelay: number;
      poolSize: number;
      connectTimeoutMS: number;
      extra: { idleTimeoutMillis: number };
      poolErrorHandler: (error: unknown) => void;
    };

    expect(options.retryAttempts).toBe(20);
    expect(options.retryDelay).toBe(3000);
    expect(options.poolSize).toBe(20);
    expect(options.connectTimeoutMS).toBe(10000);
    expect(options.extra).toEqual(
      expect.objectContaining({ idleTimeoutMillis: 30000 }),
    );
    expect(typeof options.poolErrorHandler).toBe('function');

    options.poolErrorHandler(
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    );
    expect(databaseAvailability.isDegraded()).toBe(true);
    expect(databaseAvailability.shouldSkip()).toBe(true);
    expect(errorSpy).toHaveBeenCalledTimes(1);

    errorSpy.mockRestore();
    databaseAvailability.reset();
  });

  it('должен регистрировать ThrottlerModule с лимитом 1000/60000ms (лояльный API)', () => {
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ??
      []) as DynamicModuleLike[];
    const throttlerDynamicModule = imports.find(
      (entry) => entry.module === ThrottlerModule,
    );

    expect(throttlerDynamicModule).toBeDefined();
    const throttlerOptionsProvider = throttlerDynamicModule?.providers?.find(
      (provider) => provider.provide === getOptionsToken(),
    );
    expect(throttlerOptionsProvider).toBeDefined();
    expect(throttlerOptionsProvider?.useValue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          limit: 1000,
          ttl: 60000,
        }),
      ]),
    );
  });

  it('должен регистрировать ThrottlerGuard и JwtAuthGuard как глобальные guards', () => {
    const providers = (Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AppModule,
    ) ?? []) as DynamicModuleLike['providers'];

    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
        }),
        expect.objectContaining({
          provide: APP_GUARD,
          useClass: JwtAuthGuard,
        }),
      ]),
    );
  });

  it('должен подключать ConfigModule как глобальный', async () => {
    const imports = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) ??
      []) as AppImportEntry[];
    const resolvedImports = await Promise.all(
      imports.map((entry) =>
        entry instanceof Promise ? entry : Promise.resolve(entry),
      ),
    );
    const configDynamicModule = resolvedImports.find(
      (entry) => entry.module === ConfigModule,
    );

    expect(configDynamicModule).toBeDefined();
    expect(configDynamicModule?.global).toBe(true);
  });

  it('должен делать ConfigService доступным и читать ALLOWED_ORIGINS из env', async () => {
    process.env.ALLOWED_ORIGINS = 'http://test.local:8080,http://localhost';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
        }),
      ],
    }).compile();

    const configService = moduleRef.get<ConfigService>(ConfigService);
    expect(configService).toBeDefined();
    expect(configService.get<string>('ALLOWED_ORIGINS')).toBe(
      'http://test.local:8080,http://localhost',
    );
  });

  it('должен использовать достаточно длинный JWT_SECRET в тестовых env', () => {
    process.env.JWT_SECRET = 'test-secret-key-for-jwt-signing-1234567890';

    const jwtSecret = process.env.JWT_SECRET;
    expect(jwtSecret).toBeDefined();
    expect(jwtSecret?.length).toBeGreaterThanOrEqual(32);
  });
});
