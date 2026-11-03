/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { TunnelsController } from 'src/tunnels/tunnels.controller';
import { TunnelsService } from 'src/tunnels/tunnels.service';

describe('TunnelsController', () => {
  let controller: TunnelsController;
  let tunnelsService: TunnelsService;

  const mockTunnelsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    remove: jest.fn(),
    installScript: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TunnelsController],
      providers: [
        {
          provide: TunnelsService,
          useValue: mockTunnelsService,
        },
      ],
    }).compile();

    controller = module.get<TunnelsController>(TunnelsController);
    tunnelsService = module.get<TunnelsService>(TunnelsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('должен создать туннель', async () => {
      const dto = {
        name: 'Relay',
        ip: '192.168.1.1',
        sshPort: 22,
        username: 'root',
      };
      const mockTunnel = { id: 1, ...dto };

      mockTunnelsService.create.mockResolvedValue(mockTunnel);

      const result = await controller.create(dto);

      expect(result).toEqual(mockTunnel);
      expect(tunnelsService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('findAll', () => {
    it('должен вернуть все туннели', async () => {
      const mockTunnels = [
        { id: 1, ip: '192.168.1.1' },
        { id: 2, ip: '192.168.1.2' },
      ];

      mockTunnelsService.findAll.mockResolvedValue(mockTunnels);

      const result = await controller.findAll();

      expect(result).toEqual(mockTunnels);
      expect(tunnelsService.findAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('install', () => {
    it('должен установить скрипт', async () => {
      const mockResult = { success: true, output: 'done' };

      mockTunnelsService.installScript.mockResolvedValue(mockResult);

      const result = await controller.install('1');

      expect(result).toEqual(mockResult);
      expect(tunnelsService.installScript).toHaveBeenCalledWith(1);
    });
  });

  describe('remove', () => {
    it('должен удалить туннель', async () => {
      mockTunnelsService.remove.mockResolvedValue(undefined);

      await controller.remove('1');

      expect(tunnelsService.remove).toHaveBeenCalledWith(1, false);
    });
  });
});
