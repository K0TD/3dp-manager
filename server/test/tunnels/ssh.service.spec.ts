import { Test, TestingModule } from '@nestjs/testing';
import { SshService } from 'src/tunnels/ssh.service';

// Мокируем ssh2 перед импортом сервиса
const mockStreamOn = jest.fn();
const mockStreamStderrOn = jest.fn();
const mockStream = {
  on: mockStreamOn,
  stderr: { on: mockStreamStderrOn },
};

const mockConnOn = jest.fn();
const mockConnExec = jest.fn();
const mockConnConnect = jest.fn();
const mockConnEnd = jest.fn();
const mockConn = {
  on: mockConnOn,
  exec: mockConnExec,
  connect: mockConnConnect,
  end: mockConnEnd,
};

jest.mock('ssh2', () => ({
  Client: jest.fn(() => mockConn),
}));

describe('SshService', () => {
  let service: SshService;
  let readyCallback: (() => void) | null = null;
  let errorCallback: ((err: Error) => void) | null = null;
  let streamCloseCallback: ((code: number, signal: unknown) => void) | null =
    null;
  let streamDataCallback: ((data: Buffer) => void) | null = null;
  let streamStderrDataCallback: ((data: Buffer) => void) | null = null;

  beforeEach(async () => {
    // Сброс всех моков
    jest.clearAllMocks();
    readyCallback = null;
    errorCallback = null;
    streamCloseCallback = null;
    streamDataCallback = null;
    streamStderrDataCallback = null;

    // Настройка mockConn.on для сохранения callback'ов
    mockConnOn.mockImplementation((event: string, cb: () => void) => {
      if (event === 'ready') readyCallback = cb;
      if (event === 'error') errorCallback = cb;
      return mockConn;
    });

    // Настройка mockConn.exec
    mockConnExec.mockImplementation(
      (_command: string, cb: (err: Error | null, stream: unknown) => void) => {
        cb(null, mockStream);
        return mockStream;
      },
    );

    // Настройка stream.on
    mockStreamOn.mockImplementation(
      (event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'close')
          streamCloseCallback = cb as (code: number, signal: unknown) => void;
        if (event === 'data') streamDataCallback = cb as (data: Buffer) => void;
        return mockStream;
      },
    );

    // Настройка stream.stderr.on
    mockStreamStderrOn.mockImplementation(
      (event: string, cb: (data: Buffer) => void) => {
        if (event === 'data') streamStderrDataCallback = cb;
        return { on: mockStreamStderrOn };
      },
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [SshService],
    }).compile();

    service = module.get<SshService>(SshService);
  });

  describe('executeCommand', () => {
    const config = {
      host: '192.168.1.100',
      port: 22,
      username: 'root',
      password: 'password123',
    };

    const command = 'echo "test"';

    it('должен выполнить команду успешно', async () => {
      const connectPromise = service.executeCommand(config, command);

      // Симулируем успешное подключение
      readyCallback();

      // Симулируем получение данных
      streamDataCallback(Buffer.from('test output\n'));

      // Симулируем завершение команды с кодом 0
      streamCloseCallback(0, null);

      const result = await connectPromise;

      expect(result).toBe('test output\n');
      expect(mockConnConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '192.168.1.100',
          port: 22,
          username: 'root',
          password: 'password123',
          readyTimeout: 20000,
        }),
      );
    });

    it('должен выполнить команду с privateKey', async () => {
      const configWithKey = {
        ...config,
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
      };

      const connectPromise = service.executeCommand(configWithKey, command);

      readyCallback();
      streamDataCallback(Buffer.from('success'));
      streamCloseCallback(0, null);

      await connectPromise;

      expect(mockConnConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
        }),
      );
    });

    it('должен обработать ошибку подключения', async () => {
      const error = new Error('Connection refused');

      const connectPromise = service.executeCommand(config, command);

      // Симулируем ошибку подключения
      errorCallback(error);

      await expect(connectPromise).rejects.toThrow('Connection refused');
    });

    it('должен обработать ошибку выполнения команды', async () => {
      const execError = new Error('Command not found');

      mockConnExec.mockImplementationOnce(
        (
          _command: string,
          cb: (err: Error | null, stream: unknown) => void,
        ) => {
          cb(execError, null);
        },
      );

      const connectPromise = service.executeCommand(config, command);

      readyCallback();

      await expect(connectPromise).rejects.toThrow('Command not found');
    });

    it('должен обработать ненулевой код выхода', async () => {
      const connectPromise = service.executeCommand(config, command);

      readyCallback();
      streamDataCallback(Buffer.from('error output'));
      streamCloseCallback(1, null);

      await expect(connectPromise).rejects.toThrow('Exit code 1');
    });

    it('должен собрать вывод из stderr', async () => {
      const connectPromise = service.executeCommand(config, command);

      readyCallback();
      streamDataCallback(Buffer.from('stdout'));
      streamStderrDataCallback(Buffer.from('stderr'));
      streamCloseCallback(0, null);

      const result = await connectPromise;

      expect(result).toContain('stdout');
      expect(result).toContain('stderr');
    });

    it('должен обработать пустой вывод', async () => {
      const connectPromise = service.executeCommand(config, command);

      readyCallback();
      streamCloseCallback(0, null);

      const result = await connectPromise;

      expect(result).toBe('');
    });

    it('должен собрать вывод из нескольких чанков', async () => {
      const connectPromise = service.executeCommand(config, command);

      readyCallback();
      streamDataCallback(Buffer.from('chunk1'));
      streamDataCallback(Buffer.from('chunk2'));
      streamDataCallback(Buffer.from('chunk3'));
      streamCloseCallback(0, null);

      const result = await connectPromise;

      expect(result).toBe('chunk1chunk2chunk3');
    });
  });
});
