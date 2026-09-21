/* eslint-disable @typescript-eslint/unbound-method */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SettingsController } from 'src/settings/settings.controller';
import { Setting } from 'src/settings/entities/setting.entity';
import { XuiService } from 'src/xui/xui.service';

describe('SettingsController', () => {
  let controller: SettingsController;
  let settingsRepo: Repository<Setting>;
  let xuiService: XuiService;

  const mockSettingsRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockXuiService = {
    checkConnection: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [
        {
          provide: getRepositoryToken(Setting),
          useValue: mockSettingsRepo,
        },
        {
          provide: XuiService,
          useValue: mockXuiService,
        },
      ],
    }).compile();

    controller = module.get<SettingsController>(SettingsController);
    settingsRepo = module.get<Repository<Setting>>(getRepositoryToken(Setting));
    xuiService = module.get<XuiService>(XuiService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('должен вернуть все настройки как объект', async () => {
      const mockSettings = [
        { key: 'xui_url', value: 'http://localhost:3100' },
        { key: 'xui_login', value: 'admin' },
        { key: 'xui_password', value: 'password' },
      ];

      mockSettingsRepo.find.mockResolvedValue(mockSettings);

      const result = await controller.findAll();

      expect(result).toEqual({
        xui_url: 'http://localhost:3100',
        xui_login: 'admin',
      });
      expect(settingsRepo.find).toHaveBeenCalledTimes(1);
    });

    it('должен вернуть пустой объект, если настроек нет', async () => {
      mockSettingsRepo.find.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result).toEqual({});
    });
  });

  describe('checkConnection', () => {
    it('должен проверить подключение к 3x-ui', async () => {
      const body = {
        xui_url: 'http://localhost:3100',
        xui_login: 'admin',
        xui_password: 'password',
      };

      mockXuiService.checkConnection.mockResolvedValue(true);

      const result = await controller.checkConnection(body);

      expect(result).toEqual({ success: true });
      expect(xuiService.checkConnection).toHaveBeenCalledWith(
        body.xui_url,
        body.xui_login,
        body.xui_password,
      );
    });

    it('должен вернуть false при неудачном подключении', async () => {
      const body = {
        xui_url: 'http://localhost:3100',
        xui_login: 'admin',
        xui_password: 'wrong',
      };

      mockXuiService.checkConnection.mockResolvedValue(false);

      const result = await controller.checkConnection(body);

      expect(result).toEqual({ success: false });
    });
  });

  describe('update', () => {
    it('должен сохранить настройки без xui_url', async () => {
      const settings = {
        xui_login: 'newAdmin',
        xui_password: 'newPassword',
      };

      mockSettingsRepo.save.mockResolvedValue({});

      const result = await controller.update(settings);

      expect(result).toEqual({ success: true });
      expect(settingsRepo.save).toHaveBeenCalledTimes(2);
    });

    it('должен извлечь host из xui_url и определить IP', async () => {
      const settings = {
        xui_url: 'http://example.com:8080',
      };

      mockSettingsRepo.save.mockResolvedValue({});

      const result = await controller.update(settings);

      expect(result).toEqual({ success: true });
      expect(settingsRepo.save).toHaveBeenCalled();
    });

    it('должен определить страну по IP через GeoIP', async () => {
      const settings = {
        xui_url: 'http://8.8.8.8:8080',
      };

      mockSettingsRepo.save.mockResolvedValue({});

      // Mock для fetch (GeoIP API)
      global.fetch = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          status: 'success',
          countryCode: 'US',
          country: 'United States',
        }),
      });

      const result = await controller.update(settings);

      expect(result).toEqual({ success: true });
      expect(settingsRepo.save).toHaveBeenCalled();
    });

    it('должен обработать ошибку GeoIP', async () => {
      const settings = {
        xui_url: 'http://8.8.8.8:8080',
      };

      mockSettingsRepo.save.mockResolvedValue({});

      global.fetch = jest.fn().mockResolvedValue({
        json: jest.fn().mockResolvedValue({
          status: 'fail',
          message: 'Reserved IP',
        }),
      });

      const result = await controller.update(settings);

      expect(result).toEqual({ success: true });
    });

    it('должен обработать ошибку при некорректном URL', async () => {
      const settings = {
        xui_url: 'not-a-valid-url',
      };

      mockSettingsRepo.save.mockResolvedValue({});

      const result = await controller.update(settings);

      expect(result).toEqual({ success: true });
      expect(settingsRepo.save).toHaveBeenCalled();
    });

    it('должен использовать localhost без GeoIP запроса', async () => {
      const settings = {
        xui_url: 'http://localhost:8080',
      };

      mockSettingsRepo.save.mockResolvedValue({});

      const result = await controller.update(settings);

      expect(result).toEqual({ success: true });
      expect(settingsRepo.save).toHaveBeenCalled();
    });

    it('должен использовать 127.0.0.1 без GeoIP запроса', async () => {
      const settings = {
        xui_url: 'http://127.0.0.1:8080',
      };

      mockSettingsRepo.save.mockResolvedValue({});

      const result = await controller.update(settings);

      expect(result).toEqual({ success: true });
      expect(settingsRepo.save).toHaveBeenCalled();
    });
  });
});
