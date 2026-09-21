import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { Subscription } from '../subscriptions/entities/subscription.entity';
import { Inbound, InboundStatus } from '../inbounds/entities/inbound.entity';
import { Domain } from '../domains/entities/domain.entity';
import { Setting } from '../settings/entities/setting.entity';
import { Node, NodeHealthStatus } from '../nodes/entities/node.entity';
import { Tunnel } from '../tunnels/entities/tunnel.entity';
import { XuiService } from '../xui/xui.service';
import { InboundBuilderService } from '../inbounds/inbound-builder.service';
import { XuiInboundRaw } from '../inbounds/xui-inbound.types';
import {
  RotationNodeResult,
  RotationOperation,
  RotationOperationStatus,
} from './entities/rotation-operation.entity';

type InboundConfig = NonNullable<Subscription['inboundsConfig']>[number];

@Injectable()
export class RotationService implements OnModuleInit {
  private processingOperation = false;

  constructor(
    @InjectRepository(Subscription) private subRepo: Repository<Subscription>,
    @InjectRepository(Inbound) private inboundRepo: Repository<Inbound>,
    @InjectRepository(Domain) private domainRepo: Repository<Domain>,
    @InjectRepository(Setting) private settingRepo: Repository<Setting>,
    @InjectRepository(Node) private nodeRepo: Repository<Node>,
    @InjectRepository(Tunnel) private tunnelRepo: Repository<Tunnel>,
    @InjectRepository(RotationOperation)
    private operationRepo: Repository<RotationOperation>,
    private xuiService: XuiService,
    private inboundBuilder: InboundBuilderService,
  ) {}

  async onModuleInit() {
    await this.initDefaultSettings();
    await this.inboundRepo.update(
      { status: InboundStatus.Staged },
      {
        status: InboundStatus.PendingCleanup,
        nextCleanupAt: new Date(),
        lastCleanupError: 'Незавершённое поколение после перезапуска backend',
      },
    );
    await this.operationRepo.update(
      { status: RotationOperationStatus.Running },
      {
        status: RotationOperationStatus.Queued,
        error: 'Backend restarted; operation was queued again',
      },
    );
  }

  private async initDefaultSettings() {
    const defaults: Record<string, string> = {
      rotation_status: 'active',
      rotation_interval: '30',
      last_rotation_timestamp: Date.now().toString(),
    };
    for (const [key, value] of Object.entries(defaults)) {
      const existing = await this.settingRepo.findOne({ where: { key } });
      if (!existing) await this.settingRepo.save(this.settingRepo.create({ key, value }));
    }
  }

  async enqueueRotation(subscriptionIds?: string[]) {
    return this.operationRepo.save(
      this.operationRepo.create({
        status: RotationOperationStatus.Queued,
        subscriptionIds: subscriptionIds?.length
          ? [...new Set(subscriptionIds)]
          : undefined,
        results: [],
      }),
    );
  }

  async getOperation(id: string) {
    const operation = await this.operationRepo.findOne({ where: { id } });
    if (!operation) throw new NotFoundException('Operation not found');
    return operation;
  }

  listOperations() {
    return this.operationRepo.find({ order: { createdAt: 'DESC' }, take: 50 });
  }

  @Cron('*/5 * * * * *')
  async processQueuedOperation() {
    if (this.processingOperation) return;
    const operation = await this.operationRepo.findOne({
      where: { status: RotationOperationStatus.Queued },
      order: { createdAt: 'ASC' },
    });
    if (!operation) return;

    this.processingOperation = true;
    operation.status = RotationOperationStatus.Running;
    operation.startedAt = new Date();
    operation.error = undefined;
    await this.operationRepo.save(operation);

    try {
      const result = await this.performRotation(operation.subscriptionIds);
      operation.results = result.results;
      operation.status = result.success
        ? RotationOperationStatus.Succeeded
        : result.results.some((item) => item.status === 'succeeded')
          ? RotationOperationStatus.Partial
          : RotationOperationStatus.Failed;
      operation.error = result.success ? undefined : result.message;
    } catch (error) {
      operation.status = RotationOperationStatus.Failed;
      operation.error = this.safeMessage(error);
    } finally {
      operation.finishedAt = new Date();
      await this.operationRepo.save(operation);
      this.processingOperation = false;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleTicker() {
    const [intervalSetting, lastRunSetting, statusSetting] = await Promise.all([
      this.settingRepo.findOne({ where: { key: 'rotation_interval' } }),
      this.settingRepo.findOne({ where: { key: 'last_rotation_timestamp' } }),
      this.settingRepo.findOne({ where: { key: 'rotation_status' } }),
    ]);
    const intervalMinutes = Number.parseInt(intervalSetting?.value || '30', 10);
    const lastRun = Number.parseInt(lastRunSetting?.value || '0', 10);
    if (statusSetting?.value === 'stopped') return;
    if ((Date.now() - lastRun) / 60000 < intervalMinutes) return;

    const activeOperation = await this.operationRepo.findOne({
      where: {
        status: In([
          RotationOperationStatus.Queued,
          RotationOperationStatus.Running,
        ]),
      },
    });
    if (!activeOperation) await this.enqueueRotation();
    await this.saveSetting('last_rotation_timestamp', Date.now().toString());
  }

  async performRotation(subscriptionIds?: string[]) {
    const where = subscriptionIds?.length
      ? { id: In(subscriptionIds), isEnabled: true }
      : { isEnabled: true, isAutoRotationEnabled: true };
    const subscriptions = await this.subRepo.find({
      where,
      relations: ['inbounds', 'inbounds.node', 'node', 'relayServer'],
    });
    if (!subscriptions.length) {
      return {
        success: false,
        message: 'Нет активных подписок для ротации',
        results: [] as RotationNodeResult[],
      };
    }

    const domains = await this.domainRepo.find({ where: { isEnabled: true } });
    const defaultNode = await this.getDefaultNode();
    const results: RotationNodeResult[] = [];
    for (const subscription of subscriptions) {
      results.push(...(await this.rotateSubscription(subscription, domains, defaultNode)));
    }
    const success =
      results.length > 0 && results.every((item) => item.status === 'succeeded');
    return {
      success,
      message: success ? 'Ротация успешно выполнена' : 'Ротация завершена частично',
      results,
    };
  }

  async rotateSingleSubscription(subscriptionId: string) {
    return this.performRotation([subscriptionId]);
  }

  private async rotateSubscription(
    subscription: Subscription,
    domains: Domain[],
    defaultNode: Node | null,
  ) {
    const groups = new Map<string, { node?: Node; configs: InboundConfig[] }>();
    for (const config of (subscription.inboundsConfig || []).filter(
      (item) => item.enabled !== false,
    )) {
      const node =
        config.type === 'custom'
          ? undefined
          : await this.resolveNode(config.nodeId, subscription.node, defaultNode);
      const key = config.type === 'custom' ? '__custom' : node?.id || '__missing';
      const group = groups.get(key) || { node, configs: [] };
      group.configs.push(config);
      groups.set(key, group);
    }

    const results: RotationNodeResult[] = [];
    const desiredKeys = new Set(groups.keys());
    for (const [key, group] of groups) {
      results.push(await this.rotateNodeGroup(subscription, key, group, domains));
    }

    const obsolete = (subscription.inbounds || []).filter((inbound) => {
      if (inbound.status !== InboundStatus.Active) return false;
      const key = inbound.protocol === 'custom' ? '__custom' : inbound.nodeId || '__missing';
      return !desiredKeys.has(key);
    });
    await this.queueCleanup(obsolete);
    return results;
  }

  private async rotateNodeGroup(
    subscription: Subscription,
    key: string,
    group: { node?: Node; configs: InboundConfig[] },
    domains: Domain[],
  ): Promise<RotationNodeResult> {
    const generationId = uuidv4();
    const created: Inbound[] = [];
    const usedPorts = new Set<number>();
    let realityKeys: Awaited<ReturnType<XuiService['getNewX25519Cert']>> | undefined;

    try {
      if (key === '__missing') throw new Error('Для конфигурации не назначена нода');
      if (
        group.node &&
        group.node.consecutiveFailures >= 3 &&
        [NodeHealthStatus.Offline, NodeHealthStatus.AuthError].includes(
          group.node.healthStatus,
        ) &&
        group.node.lastCheckedAt &&
        Date.now() - new Date(group.node.lastCheckedAt).getTime() < 120_000
      ) {
        throw new Error(`Нода ${group.node.name} временно недоступна`);
      }
      for (const config of group.configs) {
        if (config.type?.includes('reality') && !realityKeys) {
          realityKeys = await this.xuiService.getNewX25519Cert(group.node);
          if (!realityKeys) throw new Error('Нода не выдала Reality-ключи');
        }
        const inbound = await this.createInbound(
          subscription,
          config,
          group.node,
          domains,
          usedPorts,
          generationId,
          realityKeys,
        );
        if (!inbound) {
          throw new Error(`3x-ui отклонил inbound «${config.name || config.type}»`);
        }
        created.push(inbound);
      }

      const old = (subscription.inbounds || []).filter((inbound) => {
        if (inbound.status !== InboundStatus.Active) return false;
        return key === '__custom'
          ? inbound.protocol === 'custom'
          : inbound.nodeId === group.node?.id;
      });
      await this.inboundRepo.manager.transaction(async (manager) => {
        if (old.length) {
          await manager.update(
            Inbound,
            { id: In(old.map((item) => item.id)) },
            { status: InboundStatus.PendingCleanup, nextCleanupAt: new Date() },
          );
        }
        if (created.length) {
          await manager.update(
            Inbound,
            { id: In(created.map((item) => item.id)) },
            { status: InboundStatus.Active },
          );
        }
      });
      return {
        subscriptionId: subscription.id,
        subscriptionName: subscription.name,
        nodeId: group.node?.id,
        nodeName: group.node?.name || 'Локальные ссылки',
        status: 'succeeded',
        created: created.length,
        pendingCleanup: old.length,
      };
    } catch (error) {
      await this.queueCleanup(created);
      return {
        subscriptionId: subscription.id,
        subscriptionName: subscription.name,
        nodeId: group.node?.id,
        nodeName:
          group.node?.name || (key === '__custom' ? 'Локальные ссылки' : 'Без ноды'),
        status: 'preserved',
        created: 0,
        pendingCleanup: created.length,
        message: this.safeMessage(error),
      };
    }
  }

  private async createInbound(
    subscription: Subscription,
    config: InboundConfig,
    node: Node | undefined,
    domains: Domain[],
    usedPorts: Set<number>,
    generationId: string,
    realityKeys?: { privateKey: string; publicKey: string } | null,
  ) {
    if (config.type === 'custom') {
      return this.inboundRepo.save(
        this.inboundRepo.create({
          xuiId: 0,
          port: 0,
          protocol: 'custom',
          remark: config.name?.trim() || 'custom-link',
          link: config.link || '',
          subscription,
          status: InboundStatus.Staged,
          generationId,
        }),
      );
    }
    if (!node) return null;
    const relay = await this.resolveRelay(
      config.relayServerId,
      subscription.relayServer,
    );
    const relayServer =
      relay && this.isRelayAvailableForNode(relay, node) ? relay : undefined;
    const hostSetting = await this.settingRepo.findOne({ where: { key: 'xui_host' } });
    const targetAddress =
      relayServer?.domain ||
      relayServer?.ip ||
      this.getNodeAddress(node) ||
      hostSetting?.value ||
      'localhost';
    const flagSetting = await this.settingRepo.findOne({
      where: { key: 'xui_geo_flag' },
    });
    const flag = config.flag || node.flag || flagSetting?.value || '%F0%9F%92%AF';
    const port =
      config.port === 'random' || !config.port
        ? await this.getFreePort(usedPorts)
        : Number(config.port);
    usedPorts.add(port);
    const uuid = uuidv4();
    const sni = config.sni === 'random' ? this.pickDomain(domains) : config.sni || '';

    if (config.type === 'hysteria2-udp') {
      const built = this.inboundBuilder.buildHysteria2Inbound({
        port,
        uuid,
        sni: this.getNodeAddress(node) || targetAddress,
        certificateFile: config.certificateFile,
        keyFile: config.keyFile,
      });
      if (config.name?.trim()) built.remark = config.name.trim();
      const xuiId = await this.xuiService.addInbound(built, node);
      if (!xuiId) return null;
      return this.saveStagedInbound(
        subscription,
        node,
        relayServer,
        generationId,
        xuiId,
        port,
        'hysteria2',
        built.remark,
        this.inboundBuilder.buildInboundLink(built, targetAddress, uuid, flag),
      );
    }

    let built: XuiInboundRaw | null = null;
    switch (config.type) {
      case 'vless-tcp-reality':
        built = realityKeys
          ? this.inboundBuilder.buildVlessRealityTcp({ port, uuid, sni, ...realityKeys })
          : null;
        break;
      case 'vless-xhttp-reality':
        built = realityKeys
          ? this.inboundBuilder.buildVlessRealityXhttp({ port, uuid, sni, ...realityKeys })
          : null;
        break;
      case 'vless-grpc-reality':
        built = realityKeys
          ? this.inboundBuilder.buildVlessRealityGrpc({ port, uuid, sni, ...realityKeys })
          : null;
        break;
      case 'vless-ws':
        built = this.inboundBuilder.buildVlessWs({ port, uuid, sni });
        break;
      case 'vmess-tcp':
        built = this.inboundBuilder.buildVmessTcp({ port, uuid });
        break;
      case 'shadowsocks-tcp':
        built = this.inboundBuilder.buildShadowsocksTcp({ port, uuid });
        break;
      case 'trojan-tcp-reality':
        built = realityKeys
          ? this.inboundBuilder.buildTrojanRealityTcp({ port, uuid, sni, ...realityKeys })
          : null;
        break;
    }
    if (!built) throw new Error(`Неизвестный тип inbound: ${config.type}`);
    if (config.name?.trim()) built.remark = config.name.trim();
    const xuiId = await this.xuiService.addInbound(built, node);
    if (!xuiId) return null;
    const settings = JSON.parse(built.settings) as {
      clients?: Array<{ id?: string; password?: string }>;
    };
    const credential =
      settings.clients?.[0]?.id || settings.clients?.[0]?.password || '';
    return this.saveStagedInbound(
      subscription,
      node,
      relayServer,
      generationId,
      xuiId,
      port,
      built.protocol,
      built.remark,
      this.inboundBuilder.buildInboundLink(
        built,
        targetAddress,
        credential,
        flag,
      ),
    );
  }

  private saveStagedInbound(
    subscription: Subscription,
    node: Node,
    relayServer: Tunnel | undefined,
    generationId: string,
    xuiId: number,
    port: number,
    protocol: string,
    remark: string | undefined,
    link: string,
  ) {
    return this.inboundRepo.save(
      this.inboundRepo.create({
        xuiId,
        port,
        protocol,
        remark,
        link,
        subscription,
        node,
        relayServer,
        status: InboundStatus.Staged,
        generationId,
      }),
    );
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processCleanupQueue() {
    const items = await this.inboundRepo
      .createQueryBuilder('inbound')
      .leftJoinAndSelect('inbound.node', 'node')
      .where('inbound.status = :status', { status: InboundStatus.PendingCleanup })
      .andWhere('(inbound.nextCleanupAt IS NULL OR inbound.nextCleanupAt <= :now)', {
        now: new Date(),
      })
      .orderBy('inbound.createdAt', 'ASC')
      .take(50)
      .getMany();
    for (const inbound of items) {
      const node = await this.resolveInboundNode(inbound);
      const deleted =
        !inbound.xuiId || inbound.xuiId <= 0
          ? true
          : await this.xuiService.deleteInbound(inbound.xuiId, node);
      if (deleted) {
        await this.inboundRepo.delete(inbound.id);
        continue;
      }
      inbound.cleanupAttempts = (inbound.cleanupAttempts || 0) + 1;
      inbound.lastCleanupError = 'Нода недоступна или отклонила удаление';
      inbound.nextCleanupAt = new Date(
        Date.now() + this.cleanupDelay(inbound.cleanupAttempts),
      );
      await this.inboundRepo.save(inbound);
    }
    await this.finalizeDeletedNodes();
  }

  async retryCleanup(id: number) {
    const inbound = await this.inboundRepo.findOne({ where: { id } });
    if (!inbound || inbound.status !== InboundStatus.PendingCleanup) {
      throw new NotFoundException('Cleanup task not found');
    }
    inbound.nextCleanupAt = new Date();
    await this.inboundRepo.save(inbound);
    return { success: true };
  }

  listCleanup() {
    return this.inboundRepo.find({
      where: { status: InboundStatus.PendingCleanup },
      relations: ['node', 'subscription'],
      order: { nextCleanupAt: 'ASC' },
      take: 200,
    });
  }

  private cleanupDelay(attempt: number) {
    const minutes = [1, 5, 15, 60, 360];
    return minutes[Math.min(attempt - 1, minutes.length - 1)] * 60000;
  }

  private async finalizeDeletedNodes() {
    const nodes = await this.nodeRepo
      .createQueryBuilder('node')
      .addSelect('node.password')
      .addSelect('node.token')
      .where('node.deletedAt IS NOT NULL')
      .getMany();
    for (const node of nodes) {
      const remaining = await this.inboundRepo.count({ where: { nodeId: node.id } });
      if (remaining === 0) await this.nodeRepo.remove(node);
    }
  }

  private async queueCleanup(inbounds: Inbound[]) {
    if (!inbounds.length) return;
    const now = new Date();
    for (const inbound of inbounds) {
      inbound.status = InboundStatus.PendingCleanup;
      inbound.nextCleanupAt = now;
    }
    await this.inboundRepo.save(inbounds);
  }

  private pickDomain(domains: Domain[]) {
    if (!domains.length) throw new Error('Список доменов пуст');
    return domains[Math.floor(Math.random() * domains.length)].name;
  }

  private async getFreePort(currentBatch: Set<number>) {
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const port = Math.floor(Math.random() * 50001) + 10000;
      if (currentBatch.has(port)) continue;
      const exists = await this.inboundRepo.findOne({ where: { port } });
      if (!exists) return port;
    }
    throw new Error('Не удалось подобрать свободный порт');
  }

  private async saveSetting(key: string, value: string) {
    const setting =
      (await this.settingRepo.findOne({ where: { key } })) ||
      this.settingRepo.create({ key });
    setting.value = value;
    await this.settingRepo.save(setting);
  }

  private async getDefaultNode() {
    return this.nodeRepo
      .createQueryBuilder('node')
      .addSelect('node.password')
      .addSelect('node.token')
      .where('node.isMain = true')
      .andWhere('node.deletedAt IS NULL')
      .getOne();
  }

  private async resolveNode(
    nodeId?: string,
    subscriptionNode?: Node,
    defaultNode?: Node | null,
  ) {
    if (!nodeId) return subscriptionNode ?? defaultNode ?? undefined;
    return (
      (await this.nodeRepo
        .createQueryBuilder('node')
        .addSelect('node.password')
        .addSelect('node.token')
        .where('node.id = :nodeId', { nodeId })
        .andWhere('node.deletedAt IS NULL')
        .getOne()) || undefined
    );
  }

  private async resolveInboundNode(inbound: Inbound) {
    if (!inbound.nodeId) return inbound.node;
    return (
      (await this.nodeRepo
        .createQueryBuilder('node')
        .addSelect('node.password')
        .addSelect('node.token')
        .where('node.id = :nodeId', { nodeId: inbound.nodeId })
        .getOne()) || inbound.node
    );
  }

  private async resolveRelay(relayServerId?: number, subscriptionRelay?: Tunnel) {
    if (!relayServerId) return subscriptionRelay ?? undefined;
    return (
      (await this.tunnelRepo.findOne({ where: { id: relayServerId } })) || undefined
    );
  }

  private isRelayAvailableForNode(relay: Tunnel, node?: Node) {
    return !relay.nodeId || Boolean(node?.id && relay.nodeId === node.id);
  }

  private getNodeAddress(node?: Node) {
    if (!node) return undefined;
    if (node.domain) return node.domain;
    if (node.ip) return node.ip;
    if (node.host) return node.host;
    try {
      return node.url ? new URL(node.url).hostname : undefined;
    } catch {
      return node.url;
    }
  }

  private safeMessage(error: unknown) {
    const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
    return message.replace(/https?:\/\/[^\s]+/g, '[node]').slice(0, 300);
  }
}
