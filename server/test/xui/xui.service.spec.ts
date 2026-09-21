import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { XuiService } from 'src/xui/xui.service';
import { Setting } from 'src/settings/entities/setting.entity';
import { SessionService } from 'src/session/session.service';
import axios from 'axios';
import { NodeAuthType, NodeProtocol } from 'src/nodes/entities/node.entity';

jest.mock('axios');

describe('XuiService', () => {
  let service: XuiService;

  const mockSettingsRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockSessionService = {
    getCookie: jest.fn(),
    setFromHeaders: jest.fn(),
  };

  const mockAxiosInstance = {
    get: jest.fn(),
    post: jest.fn(),
    defaults: { baseURL: '', headers: { common: {} as Record<string, string> } },
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };

  beforeEach(async () => {
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XuiService,
        {
          provide: getRepositoryToken(Setting),
          useValue: mockSettingsRepo,
        },
        {
          provide: SessionService,
          useValue: mockSessionService,
        },
      ],
    }).compile();

    service = module.get<XuiService>(XuiService);
    settingsRepo = module.get<Repository<Setting>>(getRepositoryToken(Setting));
    sessionService = module.get<SessionService>(SessionService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('login', () => {
    it('должен вернуть false, если настройки не заполнены', async () => {
      mockSettingsRepo.find.mockResolvedValue([]);

      const result = await service.login();

      expect(result).toBe(false);
    });

    it('должен вернуть true при успешном логине', async () => {
      mockSettingsRepo.find.mockResolvedValue([
        { key: 'xui_url', value: 'http://localhost:3100' },
        { key: 'xui_login', value: 'admin' },
        { key: 'xui_password', value: 'password' },
      ]);

      mockAxiosInstance.post.mockResolvedValue({
        headers: {
          'set-cookie': ['session=abc123'],
        },
      });

      const result = await service.login();

      expect(result).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/login', {
        username: 'admin',
        password: 'password',
      });
    });

    it('должен вернуть false при ошибке логина', async () => {
      mockSettingsRepo.find.mockResolvedValue([
        { key: 'xui_url', value: 'http://localhost:3100' },
        { key: 'xui_login', value: 'admin' },
        { key: 'xui_password', value: 'password' },
      ]);

      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      const result = await service.login();

      expect(result).toBe(false);
    });

    it('должен вернуть false, если нет cookie в ответе', async () => {
      mockSettingsRepo.find.mockResolvedValue([
        { key: 'xui_url', value: 'http://localhost:3100' },
        { key: 'xui_login', value: 'admin' },
        { key: 'xui_password', value: 'password' },
      ]);

      mockAxiosInstance.post.mockResolvedValue({
        headers: {},
      });

      const result = await service.login();

      expect(result).toBe(false);
    });
  });

  describe('checkConnection', () => {
    it('должен вернуть false при ошибке подключения', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Connection failed'));

      const result = await service.checkConnection(
        'http://localhost:3100',
        'admin',
        'password',
      );

      expect(result).toBe(false);
    });
  });

  describe('addInbound', () => {
    it('должен вернуть null при ошибке', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('API error'));

      const result = await service.addInbound(
        {} as unknown as { port: number },
      );

      expect(result).toBeNull();
    });

    it('добавляет CSRF заголовок для cookie-auth в 3x-ui 3.x', async () => {
      const node = {
        id: 'node-1',
        name: 'modern-node',
        url: 'https://node.example.com:2053',
        protocol: NodeProtocol.Https,
        authType: NodeAuthType.Password,
        login: 'admin',
        password: 'password',
        allowInvalidTls: false,
      } as never;
      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { success: true }, headers: { 'set-cookie': ['session=abc'] } })
        .mockResolvedValueOnce({ data: { success: true, obj: { id: 42 } } });
      mockAxiosInstance.get.mockResolvedValueOnce({ data: { success: true, obj: 'csrf-value' } });

      const result = await service.addInbound({ port: 443 }, node);

      expect(result).toBe(42);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/csrf-token');
      expect(mockAxiosInstance.defaults.headers.common.Cookie).toBe('session=abc');
      expect(mockAxiosInstance.defaults.headers.common['X-CSRF-Token']).toBe('csrf-value');
    });
  });

  describe('deleteInbound', () => {
    it('должен удалить инбаунд', async () => {
      mockSettingsRepo.find.mockResolvedValue([
        { key: 'xui_url', value: 'http://localhost:3100' },
        { key: 'xui_login', value: 'admin' },
        { key: 'xui_password', value: 'password' },
      ]);
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          headers: { 'set-cookie': ['session=abc123'] },
        })
        .mockResolvedValueOnce({ data: { success: true } });

      await service.deleteInbound(101);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/panel/api/inbounds/del/101',
      );
    });

    it('должен обработать ошибку удаления', async () => {
      mockSettingsRepo.find.mockResolvedValue([
        { key: 'xui_url', value: 'http://localhost:3100' },
        { key: 'xui_login', value: 'admin' },
        { key: 'xui_password', value: 'password' },
      ]);
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          headers: { 'set-cookie': ['session=abc123'] },
        })
        .mockRejectedValueOnce(new Error('Not found'));

      await service.deleteInbound(999);

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/panel/api/inbounds/del/999',
      );
    });

    it('считает отсутствующий inbound успешно очищенным', async () => {
      mockSettingsRepo.find.mockResolvedValue([
        { key: 'xui_url', value: 'http://localhost:3100' },
        { key: 'xui_login', value: 'admin' },
        { key: 'xui_password', value: 'password' },
      ]);
      mockAxiosInstance.post
        .mockResolvedValueOnce({ headers: { 'set-cookie': ['session=abc123'] } })
        .mockRejectedValueOnce({ response: { status: 404 }, message: 'Not found' });

      await expect(service.deleteInbound(999)).resolves.toBe(true);
    });
  });

  describe('getNewX25519Cert', () => {
    it('должен получить Reality ключи', async () => {
      mockSettingsRepo.find.mockResolvedValue([
        { key: 'xui_url', value: 'http://localhost:3100' },
        { key: 'xui_login', value: 'admin' },
        { key: 'xui_password', value: 'password' },
      ]);
      mockAxiosInstance.post.mockResolvedValueOnce({
        headers: { 'set-cookie': ['session=abc123'] },
      });
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          success: true,
          obj: {
            publicKey: 'pub-key',
            privateKey: 'priv-key',
          },
        },
      });

      const result = await service.getNewX25519Cert();

      expect(result).toEqual({
        publicKey: 'pub-key',
        privateKey: 'priv-key',
      });
    });

    it('должен вернуть null при ошибке', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('API error'));

      const result = await service.getNewX25519Cert();

      expect(result).toBeNull();
    });
  });
});
