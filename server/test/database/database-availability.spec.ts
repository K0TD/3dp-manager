import {
  classifyDatabaseError,
  DatabaseAvailabilityTracker,
  type DatabaseLogger,
} from 'src/database/database-availability';

describe('database-availability', () => {
  const createLogger = (): DatabaseLogger & {
    error: jest.Mock;
    warn: jest.Mock;
    log: jest.Mock;
  } => ({
    error: jest.fn(),
    warn: jest.fn(),
    log: jest.fn(),
  });

  describe('classifyDatabaseError', () => {
    it('classifies PostgreSQL 57P03 recovery and startup errors', () => {
      const err = Object.assign(
        new Error('the database system is not yet accepting connections'),
        {
          code: '57P03',
          detail: 'Consistent recovery state has not been yet reached.',
          severity: 'FATAL',
          routine: 'BackendInitialize',
        },
      );

      expect(classifyDatabaseError(err)).toEqual({
        kind: 'recovery',
        code: '57P03',
        message: 'the database system is not yet accepting connections',
        detail: 'Consistent recovery state has not been yet reached.',
      });
    });

    it('classifies PostgreSQL 53100 disk_full errors', () => {
      const err = Object.assign(
        new Error('could not write init file: No space left on device'),
        {
          code: '53100',
          severity: 'FATAL',
          file: 'relcache.c',
          routine: 'write_item',
        },
      );

      expect(classifyDatabaseError(err)).toEqual({
        kind: 'disk_full',
        code: '53100',
        message: 'could not write init file: No space left on device',
        detail: undefined,
      });
    });

    it('unwraps TypeORM QueryFailedError driverError', () => {
      const driverError = Object.assign(
        new Error('the database system is in recovery mode'),
        { code: '57P03' },
      );
      const queryError = Object.assign(new Error('QueryFailedError'), {
        name: 'QueryFailedError',
        driverError,
      });

      expect(classifyDatabaseError(queryError, { strict: true })).toEqual({
        kind: 'recovery',
        code: '57P03',
        message: 'the database system is in recovery mode',
        detail: undefined,
      });
    });

    it('classifies socket ECONNRESET in default mode and rejects Axios errors', () => {
      const socketErr = Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
      });
      expect(classifyDatabaseError(socketErr)).toEqual({
        kind: 'connection',
        code: 'ECONNRESET',
        message: 'read ECONNRESET',
      });
      expect(classifyDatabaseError(socketErr, { strict: true })).toBeNull();
      expect(
        classifyDatabaseError(socketErr, {
          strict: true,
          allowSocketErrors: true,
        }),
      ).toEqual({
        kind: 'connection',
        code: 'ECONNRESET',
        message: 'read ECONNRESET',
      });

      const axiosErr = Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
        isAxiosError: true,
      });
      expect(classifyDatabaseError(axiosErr)).toBeNull();
      expect(
        classifyDatabaseError(axiosErr, {
          strict: true,
          allowSocketErrors: true,
        }),
      ).toBeNull();
    });

    it('unwraps AggregateError containing ECONNREFUSED', () => {
      const nested = Object.assign(new Error('connect ECONNREFUSED'), {
        code: 'ECONNREFUSED',
      });
      const agg = new AggregateError([nested], 'connect failed');
      expect(classifyDatabaseError(agg)).toEqual({
        kind: 'connection',
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED',
      });
    });
  });

  describe('DatabaseAvailabilityTracker', () => {
    it('backs off exponentially, throttles identical logs, and logs immediately on error type change', () => {
      let now = 1_000_000;
      const tracker = new DatabaseAvailabilityTracker({
        baseBackoffMs: 5_000,
        diskFullBackoffMs: 30_000,
        maxBackoffMs: 60_000,
        logIntervalMs: 60_000,
        now: () => now,
      });
      const logger = createLogger();

      const recoveryErr = Object.assign(
        new Error('the database system is not yet accepting connections'),
        {
          code: '57P03',
          detail: 'Consistent recovery state has not been yet reached.',
        },
      );

      // 1st failure: 5s backoff, logged immediately
      expect(
        tracker.recordFailure(recoveryErr, logger, 'processQueuedOperation'),
      ).not.toBeNull();
      expect(tracker.shouldSkip()).toBe(true);
      expect(tracker.isDegraded()).toBe(true);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenLastCalledWith(
        expect.stringContaining('[57P03]'),
      );

      // Still inside 5s window
      now += 4_999;
      expect(tracker.shouldSkip()).toBe(true);

      // Past 5s window -> next probe fails -> 10s backoff, duplicate log suppressed
      now += 1;
      expect(tracker.shouldSkip()).toBe(false);
      tracker.recordFailure(recoveryErr, logger, 'processQueuedOperation');
      expect(logger.error).toHaveBeenCalledTimes(1);
      now += 9_999;
      expect(tracker.shouldSkip()).toBe(true);
      now += 1;
      expect(tracker.shouldSkip()).toBe(false);

      // Error changes to 53100 disk_full -> logged IMMEDIATELY with suppressed count and 60s cap
      const diskFullErr = Object.assign(
        new Error('could not write init file: No space left on device'),
        { code: '53100' },
      );
      tracker.recordFailure(diskFullErr, logger, 'processQueuedOperation');
      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenLastCalledWith(
        expect.stringContaining('out of disk space'),
      );
      expect(logger.error).toHaveBeenLastCalledWith(
        expect.stringContaining('+1 similar errors suppressed'),
      );

      // Disk full caps backoff at maxBackoffMs (60s)
      now += 59_999;
      expect(tracker.shouldSkip()).toBe(true);
      now += 1;
      expect(tracker.shouldSkip()).toBe(false);

      // Recovery resets state and emits a single log message
      tracker.recordSuccess(logger, 'RotationService');
      expect(tracker.isDegraded()).toBe(false);
      expect(tracker.shouldSkip()).toBe(false);
      expect(logger.log).toHaveBeenCalledTimes(1);
      expect(logger.log).toHaveBeenLastCalledWith(
        expect.stringContaining('PostgreSQL connection restored'),
      );

      // Subsequent success is silent
      tracker.recordSuccess(logger, 'RotationService');
      expect(logger.log).toHaveBeenCalledTimes(1);
    });
  });
});
