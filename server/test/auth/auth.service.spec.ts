/* eslint-disable @typescript-eslint/unbound-method */

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthService } from 'src/auth/auth.service';
import { Setting } from 'src/settings/entities/setting.entity';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let settingsRepo: Repository<Setting>;
  let jwtService: JwtService;
  let configService: ConfigService;

  const mockSettingsRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(Setting),
          useValue: mockSettingsRepo,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    settingsRepo = module.get<Repository<Setting>>(getRepositoryToken(Setting));
    jwtService = module.get<JwtService>(JwtService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateUser', () => {
    it('должен вернуть пользователя при верном пароле', async () => {
      const plainPassword = 'correctPassword';
      const hashedPassword = await bcrypt.hash(plainPassword, 10);

      mockSettingsRepo.findOne
        .mockResolvedValueOnce({ key: 'admin_login', value: 'admin' })
        .mockResolvedValueOnce({
          key: 'admin_password',
          value: hashedPassword,
        });

      const result = await service.validateUser('admin', plainPassword);

      expect(result).toEqual({ login: 'admin' });
    });

    it('должен вернуть null, если admin_login не найден', async () => {
      mockSettingsRepo.findOne.mockResolvedValueOnce(null);

      const result = await service.validateUser('admin', 'password');

      expect(result).toBeNull();
    });

    it('должен вернуть null, если admin_password не найден', async () => {
      mockSettingsRepo.findOne
        .mockResolvedValueOnce({ key: 'admin_login', value: 'admin' })
        .mockResolvedValueOnce(null);

      const result = await service.validateUser('admin', 'password');

      expect(result).toBeNull();
    });

    it('должен вернуть null при неверном пароле', async () => {
      const hashedPassword = await bcrypt.hash('correctPassword', 10);

      mockSettingsRepo.findOne
        .mockResolvedValueOnce({ key: 'admin_login', value: 'admin' })
        .mockResolvedValueOnce({
          key: 'admin_password',
          value: hashedPassword,
        });

      const result = await service.validateUser('admin', 'wrongPassword');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('должен вернуть access_token', () => {
      const user = { login: 'admin' };
      const mockToken = 'jwt-token-123';

      mockJwtService.sign.mockReturnValue(mockToken);

      const result = service.login(user);

      expect(result).toEqual({ access_token: mockToken });
      expect(jwtService.sign).toHaveBeenCalledWith({ username: 'admin' });
    });
  });

  describe('changePassword', () => {
    it('должен изменить пароль администратора', async () => {
      const newPassword = 'newSecurePassword';
      const existingSetting = { key: 'admin_password', value: 'oldHash' };

      mockSettingsRepo.findOne.mockResolvedValue(existingSetting);
      mockSettingsRepo.save.mockResolvedValue({
        key: 'admin_password',
        value: 'newHash',
      });

      await service.changePassword(newPassword);

      expect(settingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'admin_password',
          value: expect.any(String),
        }),
      );
    });

    it('должен создать запись пароля, если не существует', async () => {
      const newPassword = 'newPassword';

      mockSettingsRepo.findOne.mockResolvedValue(null);
      mockSettingsRepo.create.mockReturnValue({ key: 'admin_password' });
      mockSettingsRepo.save.mockResolvedValue({ key: 'admin_password' });

      await service.changePassword(newPassword);

      expect(settingsRepo.create).toHaveBeenCalledWith({
        key: 'admin_password',
      });
    });
  });

  describe('updateAdminProfile', () => {
    it('должен обновить логин и пароль', async () => {
      const newLogin = 'newAdmin';
      const newPassword = 'newPassword';

      mockSettingsRepo.findOne
        .mockResolvedValueOnce({ key: 'admin_login', value: 'oldAdmin' })
        .mockResolvedValueOnce({ key: 'admin_password', value: 'oldHash' });

      mockSettingsRepo.save.mockResolvedValue({});

      await service.updateAdminProfile(newLogin, newPassword);

      expect(settingsRepo.save).toHaveBeenCalledTimes(2);
    });

    it('должен обновить только логин, если пароль не передан', async () => {
      const newLogin = 'newAdmin';

      mockSettingsRepo.findOne.mockResolvedValue({
        key: 'admin_login',
        value: 'oldAdmin',
      });
      mockSettingsRepo.save.mockResolvedValue({});

      await service.updateAdminProfile(newLogin);

      expect(settingsRepo.save).toHaveBeenCalledTimes(1);
    });

    it('должен создать логин, если не существует', async () => {
      mockSettingsRepo.findOne.mockResolvedValue(null);
      mockSettingsRepo.create.mockReturnValue({ key: 'admin_login' });
      mockSettingsRepo.save.mockResolvedValue({});

      await service.updateAdminProfile('newAdmin', 'password');

      expect(settingsRepo.create).toHaveBeenCalledWith({ key: 'admin_login' });
    });
  });

  describe('seedAdmin', () => {
    it('должен создать администратора, если не существует', async () => {
      mockSettingsRepo.findOne.mockResolvedValue(null);
      mockConfigService.get
        .mockReturnValueOnce('admin')
        .mockReturnValueOnce('admin');

      mockSettingsRepo.create
        .mockReturnValueOnce({ key: 'admin_login' })
        .mockReturnValueOnce({ key: 'admin_password' });

      mockSettingsRepo.save.mockResolvedValue({});

      await service.seedAdmin();

      expect(settingsRepo.create).toHaveBeenCalledTimes(2);
      expect(settingsRepo.save).toHaveBeenCalledTimes(2);
    });

    it('НЕ должен создавать администратора, если уже существует', async () => {
      mockSettingsRepo.findOne.mockResolvedValue({
        key: 'admin_login',
        value: 'admin',
      });

      await service.seedAdmin();

      expect(settingsRepo.create).not.toHaveBeenCalled();
      expect(settingsRepo.save).not.toHaveBeenCalled();
    });

    it('должен использовать ENV переменные для логина/пароля', async () => {
      mockSettingsRepo.findOne.mockResolvedValue(null);
      mockConfigService.get
        .mockReturnValueOnce('customAdmin')
        .mockReturnValueOnce('customPassword');

      mockSettingsRepo.create
        .mockReturnValueOnce({ key: 'admin_login', value: 'customAdmin' })
        .mockReturnValueOnce({ key: 'admin_password' });

      mockSettingsRepo.save.mockResolvedValue({});

      await service.seedAdmin();

      expect(configService.get).toHaveBeenCalledWith('ADMIN_LOGIN');
      expect(configService.get).toHaveBeenCalledWith('ADMIN_PASSWORD');
    });
  });
});
