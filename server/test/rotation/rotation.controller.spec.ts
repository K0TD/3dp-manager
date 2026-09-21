/* eslint-disable @typescript-eslint/unbound-method */

import { Test, TestingModule } from '@nestjs/testing';
import { RotationController } from 'src/rotation/rotation.controller';
import { RotationService } from 'src/rotation/rotation.service';

describe('RotationController', () => {
  let controller: RotationController;
  let rotationService: RotationService;

  const mockRotationService = {
    enqueueRotation: jest.fn(),
    listOperations: jest.fn(),
    getOperation: jest.fn(),
    listCleanup: jest.fn(),
    retryCleanup: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RotationController],
      providers: [
        {
          provide: RotationService,
          useValue: mockRotationService,
        },
      ],
    }).compile();

    controller = module.get<RotationController>(RotationController);
    rotationService = module.get<RotationService>(RotationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('rotateAll', () => {
    it('должен запустить плановую ротацию', async () => {
      const mockResult = { success: true, message: 'Ротация выполнена' };

      mockRotationService.enqueueRotation.mockResolvedValue(mockResult);

      const result = await controller.rotateAll();

      expect(result).toEqual(mockResult);
      expect(rotationService.enqueueRotation).toHaveBeenCalledTimes(1);
    });

    it('должен вернуть ошибку ротации', async () => {
      const mockError = { success: false, message: 'Нет подписок' };

      mockRotationService.enqueueRotation.mockResolvedValue(mockError);

      const result = await controller.rotateAll();

      expect(result).toEqual(mockError);
    });
  });

  describe('rotateSingle', () => {
    it('должен запустить ротацию одной подписки', async () => {
      const mockResult = {
        success: true,
        message: 'Ротация подписки выполнена',
      };

      mockRotationService.enqueueRotation.mockResolvedValue(mockResult);

      const result = await controller.rotateSingle('sub-123');

      expect(result).toEqual(mockResult);
      expect(rotationService.enqueueRotation).toHaveBeenCalledWith(['sub-123']);
    });

    it('должен вернуть ошибку ротации одной подписки', async () => {
      const mockError = { success: false, message: 'Подписка не найдена' };

      mockRotationService.enqueueRotation.mockResolvedValue(mockError);

      const result = await controller.rotateSingle('non-existent');

      expect(result).toEqual(mockError);
    });
  });
});
