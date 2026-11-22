import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { API_SCOPES, ApiScope, ApiToken } from './api-token.entity';

export const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class ApiTokenService {
  constructor(
    @InjectRepository(ApiToken) private readonly tokens: Repository<ApiToken>,
  ) {}

  list() {
    return this.tokens.find({ order: { createdAt: 'DESC' } });
  }

  async issue(body: {
    name?: unknown;
    expiresInDays?: unknown;
    scopes?: unknown;
  }) {
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const days = body?.expiresInDays ?? 30;
    const scopes = body?.scopes ?? ['diagnostics:read'];
    if (
      !name ||
      name.length > 80 ||
      typeof days !== 'number' ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > 365 ||
      !Array.isArray(scopes) ||
      scopes.length < 1 ||
      scopes.length > API_SCOPES.length ||
      scopes.some((scope) => !API_SCOPES.includes(scope as ApiScope))
    ) {
      throw new BadRequestException('Invalid token name, lifetime or scopes');
    }
    const token = '3dp_' + randomBytes(32).toString('base64url');
    const record = await this.tokens.save(
      this.tokens.create({
        name,
        scopes: [...new Set(scopes)] as ApiScope[],
        digest: sha256(token),
        expiresAt: new Date(Date.now() + days * 86400000),
      }),
    );
    return {
      token,
      id: record.id,
      name,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
    };
  }

  async revoke(id: string) {
    await this.tokens.update(
      { id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async authenticate(token: string) {
    const conditions = {
      digest: sha256(token),
      revokedAt: IsNull(),
      expiresAt: MoreThan(new Date()),
    };
    const record = await this.tokens.findOneBy(conditions);
    if (!record) return null;
    const updated = await this.tokens.update(
      { id: record.id, ...conditions },
      { lastUsedAt: new Date() },
    );
    return updated.affected === 1 ? record : null;
  }
}
