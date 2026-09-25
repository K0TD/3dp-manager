/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-unsafe-argument */

/* eslint-disable @typescript-eslint/await-thenable */

import { Test, TestingModule } from '@nestjs/testing';
import { DomainsController } from 'src/domains/domains.controller';
import { DomainsService } from 'src/domains/domains.service';
import { DomainScannerService } from 'src/domains/domain-scanner.service';

describe('DomainsController', () => {
  let controller: DomainsController;
  let domainsService: DomainsService;
  let domainScannerService: DomainScannerService;

  const mockDomainsService = {
    create: jest.fn(),
    createMany: jest.fn(),
    findAll: jest.fn(),
    findAllUnpaginated: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    removeAll: jest.fn(),
    getCatalogProfiles: jest.fn(),
    resolveProfile: jest.fn(),
  };

  const mockDomainScannerService = {
    getCapabilities: jest.fn(),
    getScanStatus: jest.fn(),
    getLastScanResult: jest.fn(),
    startScan: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DomainsController],
      providers: [
        {
          provide: DomainsService,
          useValue: mockDomainsService,
        },
        {
          provide: DomainScannerService,
          useValue: mockDomainScannerService,
        },
      ],
    }).compile();

    controller = module.get<DomainsController>(DomainsController);
    domainsService = module.get<DomainsService>(DomainsService);
    domainScannerService =
      module.get<DomainScannerService>(DomainScannerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('должен создать домен', async () => {
      const body = { name: 'example.com' };
      const mockDomain = { id: 1, name: 'example.com' };

      mockDomainsService.create.mockResolvedValue(mockDomain);

      const result = await controller.create(body);

      expect(result).toEqual(mockDomain);
      expect(domainsService.create).toHaveBeenCalledWith(body);
    });
  });

  describe('uploadMany', () => {
    it('должен загрузить несколько доменов', async () => {
      const body = { domains: ['ya.ru', 'vk.com'] };
      const mockResult = { count: 2 };

      mockDomainsService.createMany.mockResolvedValue(mockResult);

      const result = await controller.uploadMany(body);

      expect(result).toEqual(mockResult);
      expect(domainsService.createMany).toHaveBeenCalledWith(body.domains);
    });
  });

  describe('getProfiles', () => {
    it('должен вернуть каталог профилей маскировки', () => {
      const mockCatalog = {
        profiles: [{ id: 'apple', name: 'Apple CDN' }],
        defaultProfile: { fingerprint: 'chrome' },
      };
      mockDomainsService.getCatalogProfiles.mockReturnValue(mockCatalog);

      const result = controller.getProfiles();

      expect(result).toEqual(mockCatalog);
      expect(domainsService.getCatalogProfiles).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveProfile', () => {
    it('должен вернуть разрешенный профиль для заданного SNI', () => {
      const mockProfile = { sni: 'swdist.apple.com', fingerprint: 'safari' };
      mockDomainsService.resolveProfile.mockReturnValue(mockProfile);

      const result = controller.resolveProfile('swdist.apple.com');

      expect(result).toEqual(mockProfile);
      expect(domainsService.resolveProfile).toHaveBeenCalledWith(
        'swdist.apple.com',
      );
    });

    it('должен безопасно обрабатывать пустой или undefined SNI', () => {
      const mockProfile = { sni: '', fingerprint: 'chrome' };
      mockDomainsService.resolveProfile.mockReturnValue(mockProfile);

      const result = controller.resolveProfile(undefined);

      expect(result).toEqual(mockProfile);
      expect(domainsService.resolveProfile).toHaveBeenCalledWith('');
    });
  });

  describe('scanCapabilities', () => {
    it('должен вернуть возможности сканера', async () => {
      const mockCapabilities = {
        scannerAvailable: true,
        scannerPath: '/usr/bin/scanner',
        timeoutAvailable: true,
        timeoutPath: '/usr/bin/timeout',
      };

      mockDomainScannerService.getCapabilities.mockReturnValue(
        mockCapabilities,
      );

      const result = await controller.scanCapabilities();

      expect(result).toEqual(mockCapabilities);
      expect(domainScannerService.getCapabilities).toHaveBeenCalledTimes(1);
    });
  });

  describe('scanStatus', () => {
    it('должен вернуть статус сканирования', async () => {
      const mockStatus = {
        running: false,
        runId: null,
        lastRunId: 'scan-123',
      };

      mockDomainScannerService.getScanStatus.mockReturnValue(mockStatus);

      const result = await controller.scanStatus();

      expect(result).toEqual(mockStatus);
      expect(domainScannerService.getScanStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('lastScanResult', () => {
    it('должен вернуть последний результат сканирования', async () => {
      const mockResult = {
        runId: 'scan-123',
        foundCount: 10,
        domains: ['ya.ru', 'vk.com'],
      };

      mockDomainScannerService.getLastScanResult.mockReturnValue(mockResult);

      const result = await controller.lastScanResult();

      expect(result).toEqual(mockResult);
      expect(domainScannerService.getLastScanResult).toHaveBeenCalledTimes(1);
    });
  });

  describe('startScan', () => {
    it('должен запустить сканирование', async () => {
      const body = {
        addr: '192.168.1.1',
        scanSeconds: 60,
        thread: 100,
        timeout: 30,
      };
      const mockResult = { success: true, runId: 'scan-456' };

      mockDomainScannerService.startScan.mockReturnValue(mockResult);

      const result = await controller.startScan(body);

      expect(result).toEqual(mockResult);
      expect(domainScannerService.startScan).toHaveBeenCalledWith(body);
    });
  });

  describe('findAllWithoutPagination', () => {
    it('должен вернуть все домены без пагинации', async () => {
      const mockDomains = [
        { id: 1, name: 'ya.ru' },
        { id: 2, name: 'vk.com' },
      ];

      mockDomainsService.findAllUnpaginated.mockResolvedValue(mockDomains);

      const result = await controller.findAllWithoutPagination();

      expect(result).toEqual(mockDomains);
      expect(domainsService.findAllUnpaginated).toHaveBeenCalledTimes(1);
    });
  });

  describe('findAll', () => {
    it('должен вернуть домены с пагинацией', async () => {
      const mockResult = {
        data: [{ id: 1, name: 'ya.ru' }],
        total: 100,
      };

      mockDomainsService.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll(1, 10);

      expect(result).toEqual(mockResult);
      expect(domainsService.findAll).toHaveBeenCalledWith(1, 10);
    });

    it('должен использовать значения по умолчанию для пагинации', async () => {
      mockDomainsService.findAll.mockResolvedValue({ data: [], total: 0 });

      await controller.findAll(undefined as any, undefined as any);

      expect(domainsService.findAll).toHaveBeenCalledWith(1, 10);
    });
  });

  describe('findOne', () => {
    it('должен вернуть домен по ID', async () => {
      const mockDomain = { id: 1, name: 'ya.ru' };

      mockDomainsService.findOne.mockResolvedValue(mockDomain);

      const result = await controller.findOne('1');

      expect(result).toEqual(mockDomain);
      expect(domainsService.findOne).toHaveBeenCalledWith(1);
    });
  });

  describe('removeAll', () => {
    it('должен удалить все домены', async () => {
      const mockResult = { success: true };

      mockDomainsService.removeAll.mockResolvedValue(mockResult);

      const result = await controller.removeAll();

      expect(result).toEqual(mockResult);
      expect(domainsService.removeAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('remove', () => {
    it('должен удалить домен по ID', async () => {
      mockDomainsService.remove.mockResolvedValue(undefined);

      await controller.remove('1');

      expect(domainsService.remove).toHaveBeenCalledWith(1);
    });
  });
});
