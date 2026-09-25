import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as tls from 'tls';
import { Domain } from './entities/domain.entity';
import {
  resolveSniProfile,
  SNI_PROFILE_RULES,
  DEFAULT_SNI_PROFILE,
  SniProfile,
  SniProfileRule,
} from '../inbounds/sni-profiles';

@Injectable()
export class DomainsService implements OnModuleInit {
  constructor(
    @InjectRepository(Domain)
    private repo: Repository<Domain>,
  ) {}

  async onModuleInit() {
    await this.seedDefaultDomains();
  }

  private async seedDefaultDomains() {
    const count = await this.repo.count();

    if (count === 0) {
      const defaultDomains = [
        'ya.ru',
        'vk.com',
        'ok.ru',
        'gosuslugi.ru',
        'ozon.ru',
        'max.ru',
        'vkvideo.ru',
        'rutube.ru',
        'kinopoisk.ru',
        'avito.ru',
      ];

      const entities = defaultDomains.map((name) => this.repo.create({ name }));
      await this.repo.save(entities);
    }
  }

  async create(createDomainDto: { name: string }) {
    const normalized = this.normalizeImportedDomain(createDomainDto.name);
    if (!normalized) {
      throw new BadRequestException('Некорректное доменное имя');
    }

    const exists = await this.repo
      .createQueryBuilder('domain')
      .where('LOWER(domain.name) = LOWER(:name)', { name: normalized })
      .getOne();
    if (exists) return exists;

    const domain = this.repo.create({ name: normalized });
    return this.repo.save(domain);
  }

  async findAll(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [result, total] = await this.repo.findAndCount({
      take: limit,
      skip: skip,
      order: { id: 'DESC' },
    });

    const enriched = result.map((d) => ({
      ...d,
      profile: resolveSniProfile(d.name),
    }));

    return {
      data: enriched,
      total: total,
    };
  }

  getCatalogProfiles(): {
    profiles: readonly SniProfileRule[];
    defaultProfile: typeof DEFAULT_SNI_PROFILE;
  } {
    return {
      profiles: SNI_PROFILE_RULES,
      defaultProfile: DEFAULT_SNI_PROFILE,
    };
  }

  resolveProfile(sni: string): SniProfile {
    return resolveSniProfile(sni);
  }

  async pingDomain(
    domain: string,
    timeoutMs = 3500,
  ): Promise<{
    domain: string;
    reachable: boolean;
    latencyMs: number;
    protocol?: string;
    error?: string;
  }> {
    const clean = (domain || '')
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//i, '')
      .split('/')[0]
      .split(':')[0];

    if (!clean) {
      return {
        domain: '',
        reachable: false,
        latencyMs: 0,
        error: 'Некорректный домен',
      };
    }

    const start = Date.now();

    return new Promise((resolve) => {
      let settled = false;

      const finish = (result: {
        reachable: boolean;
        latencyMs?: number;
        protocol?: string;
        error?: string;
      }) => {
        if (settled) return;
        settled = true;
        resolve({
          domain: clean,
          reachable: result.reachable,
          latencyMs: result.latencyMs ?? Date.now() - start,
          protocol: result.protocol,
          error: result.error,
        });
      };

      try {
        const socket = tls.connect(
          {
            host: clean,
            port: 443,
            servername: clean,
            timeout: timeoutMs,
            rejectUnauthorized: false,
          },
          () => {
            const latency = Date.now() - start;
            const protocol = socket.getProtocol() || undefined;
            socket.end();
            finish({ reachable: true, latencyMs: latency, protocol });
          },
        );

        socket.on('error', (err: Error) => {
          socket.destroy();
          const errorMsg =
            err && typeof err.message === 'string'
              ? err.message
              : 'Ошибка соединения';
          finish({
            reachable: false,
            error: errorMsg,
          });
        });

        socket.on('timeout', () => {
          socket.destroy();
          finish({ reachable: false, error: 'Превышен таймаут ответа' });
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Ошибка подключения';
        finish({ reachable: false, error: msg });
      }
    });
  }

  async pingDomains(
    domains: string[],
    timeoutMs = 3500,
  ): Promise<
    Array<{
      domain: string;
      reachable: boolean;
      latencyMs: number;
      protocol?: string;
      error?: string;
    }>
  > {
    if (!domains || !Array.isArray(domains)) return [];
    const limited = domains.slice(0, 30);
    return Promise.all(limited.map((d) => this.pingDomain(d, timeoutMs)));
  }

  async findAllUnpaginated(): Promise<Domain[]> {
    return this.repo.find({ order: { name: 'ASC' } });
  }

  findOne(id: number) {
    return this.repo.findOneBy({ id });
  }

  remove(id: number) {
    return this.repo.delete(id);
  }

  async removeAll() {
    await this.repo.clear();
    return { success: true };
  }

  async createMany(names: string[]) {
    if (!names || names.length === 0) return { count: 0 };

    const cleanNames = names
      .map((name) => this.normalizeImportedDomain(name))
      .filter((name): name is string => Boolean(name));

    const existing = await this.repo.find();
    const existingSet = new Set(existing.map((d) => d.name.toLowerCase()));

    const uniqueNewNames = [...new Set(cleanNames)].filter(
      (name) => !existingSet.has(name.toLowerCase()),
    );

    if (uniqueNewNames.length === 0) return { count: 0 };

    const entities = uniqueNewNames.map((name) => this.repo.create({ name }));
    await this.repo.save(entities);

    return { count: entities.length };
  }

  private normalizeImportedDomain(input: string) {
    let value = (input || '').replace(/^\uFEFF/, '').trim();
    if (!value) return null;

    // Skip full-line comments often used in shared lists.
    if (/^(#|;|\/\/)/.test(value)) {
      return null;
    }

    // Remove inline comments while keeping the domain token itself.
    value = value.replace(/\s+(#|;|\/\/).*$/, '').trim();
    if (!value) return null;

    value = value
      .replace(/^['"`]+|['"`]+$/g, '')
      .replace(/^[a-z]+:\/\//i, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0]
      .trim()
      .toLowerCase();

    const hostPortMatch = value.match(/^(.+):(\d{1,5})$/);
    if (hostPortMatch) {
      value = hostPortMatch[1];
    }

    // Wildcard entries are valid for input UX, but in whitelist storage we keep root form.
    value = value
      .replace(/^\*+\./, '')
      .replace(/^\.+/, '')
      .replace(/\.+$/, '');
    if (!value) return null;

    return this.isValidDomain(value) ? value : null;
  }

  private isValidDomain(domain: string) {
    if (domain.length > 253) return false;
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(domain)) return false;

    const parts = domain.split('.');
    if (parts.length < 2) return false;

    return parts.every(
      (part) =>
        /^[a-z0-9-]{1,63}$/.test(part) &&
        !part.startsWith('-') &&
        !part.endsWith('-'),
    );
  }
}
