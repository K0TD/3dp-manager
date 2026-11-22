import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add,
  Delete,
  Edit,
  FactCheck,
  NetworkCheck,
  OpenInNew,
  PlaylistAdd,
  Refresh,
  Restore,
  Terminal,
  Tune,
} from '@mui/icons-material';
import api from '../api';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { ProfilePreviewDialog } from '../components/ProfilePreviewDialog';
import { CLIENT_SNI_PROFILES_CATALOG } from '../utils/sniProfiles';
import type { NodeRecord } from '../types/node';
import {
  FINGERPRINT_OPTIONS,
  ROUTING_INBOUND_TYPES,
  XHTTP_MODE_OPTIONS,
  type ClientFingerprint,
  type ManagedProfileKind,
  type ManagedProfileSettings,
  type ProfileCompatibilityReport,
  type ProfileRotationPolicy,
  type ReverseProxyEngine,
  type XhttpMode,
} from '../types/inbound';

interface ProfileCatalogEntry {
  kind: ManagedProfileKind;
  stage: number;
  status: 'ready' | 'planned';
  title: string;
  transportSummary: string;
  description: string;
  minXrayVersion: string;
  defaults: ManagedProfileSettings;
}

interface ConnectionProfileSnapshot {
  revision: number;
  savedAt: string;
  name: string;
  kind: ManagedProfileKind;
  nodeId?: string | null;
  port?: number | null;
  sni?: string | null;
  rotationPolicy: ProfileRotationPolicy;
  spec: ManagedProfileSettings;
}

interface ConnectionProfileRecord {
  id: string;
  name: string;
  kind: ManagedProfileKind;
  enabled: boolean;
  nodeId?: string | null;
  port?: number | null;
  sni?: string | null;
  rotationPolicy: ProfileRotationPolicy;
  spec: ManagedProfileSettings;
  lastCheckStatus: 'unknown' | 'passed' | 'warning' | 'failed';
  lastCheckResult?: ProfileCompatibilityReport | null;
  lastCheckedAt?: string | null;
  activeRevision: number;
  previousSnapshot?: ConnectionProfileSnapshot | null;
  updatedAt?: string;
  deployed?: boolean;
  activeInbound?: {
    id: number;
    port: number;
    remark?: string | null;
    subscriptionId?: string | null;
  } | null;
}

interface DomainItem {
  id: number;
  name: string;
  isEnabled?: boolean;
}

interface SniProfileRule {
  id: string;
  name: string;
  category: string;
  description: string;
  recommendedDomains: string[];
  exact?: string[];
  suffix?: string[];
  profile: {
    fingerprint: ClientFingerprint;
    spiderX: string;
    xhttpPath?: string;
  };
}

interface SubscriptionBrief {
  id: string;
  name: string;
  note?: string;
  supportUrl?: string;
  websiteUrl?: string;
  inboundsConfig?: Array<Record<string, unknown>>;
  isAutoRotationEnabled?: boolean;
  nodeId?: string;
  relayServerId?: number;
}

interface ClientProbeResponse {
  id: string;
  source: 'active_inbound' | 'preview';
  deployed?: boolean;
  checkedAt: string;
  probe: {
    success: boolean;
    engine: 'xray-core' | 'tcp-tls-fallback';
    targetAddress: string;
    targetPort: number;
    httpStatusCode?: number;
    latencyMs: number;
    fallbackReason?: string;
    error?: string;
  };
}

interface ProfileFormState {
  name: string;
  kind: ManagedProfileKind;
  nodeId: string;
  port: string;
  sni: string;
  rotationPolicy: ProfileRotationPolicy;
  spec: ManagedProfileSettings;
}

const DEFAULT_FORM: ProfileFormState = {
  name: '',
  kind: 'xhttp-stable',
  nodeId: '',
  port: '443',
  sni: 'random',
  rotationPolicy: 'fixed_domain',
  spec: {
    mode: 'auto',
    path: '/',
    fingerprint: 'chrome',
    spiderX: '/',
    rotationPolicy: 'fixed_domain',
    xmux: { enabled: false },
  },
};

function defaultFormForKind(kind: ManagedProfileKind): ProfileFormState {
  if (kind === 'self-sni') {
    return {
      name: '',
      kind,
      nodeId: '',
      port: '443',
      sni: '',
      rotationPolicy: 'fixed_domain',
      spec: {
        domain: '',
        webServer: 'nginx',
        localHttpsPort: 8443,
        destPort: 443,
        fingerprint: 'chrome',
        spiderX: '/',
        xver: 0,
        rotationPolicy: 'fixed_domain',
      },
    };
  }
  if (kind === 'https-fallback') {
    return {
      name: '',
      kind,
      nodeId: '',
      port: '20443',
      sni: '',
      rotationPolicy: 'fixed_domain',
      spec: {
        domain: '',
        path: '/api/v2/stream',
        mode: 'auto',
        reverseProxy: 'nginx',
        publicPort: 443,
        fingerprint: 'chrome',
        rotationPolicy: 'fixed_domain',
      },
    };
  }
  return { ...DEFAULT_FORM, spec: { ...DEFAULT_FORM.spec } };
}

function resolveNodeHostname(node?: NodeRecord): string {
  if (!node) return '';
  if (node.domain?.trim()) return node.domain.trim();
  if (node.url) {
    try {
      const host = new URL(node.url).hostname;
      if (host && /[a-z]/i.test(host)) return host;
    } catch {
      // Ignore malformed URL
    }
  }
  return '';
}

function findMatchingSniRule(
  sni: string,
  rules: SniProfileRule[],
): SniProfileRule | null {
  const clean = sni.trim().toLowerCase();
  if (!clean || clean === 'random') return null;
  for (const rule of rules) {
    if (rule.exact?.some((item) => item.toLowerCase() === clean)) return rule;
    if (rule.recommendedDomains?.some((item) => item.toLowerCase() === clean)) {
      return rule;
    }
    if (rule.suffix?.some((suf) => clean.endsWith(suf.toLowerCase()))) {
      return rule;
    }
  }
  return null;
}

function checkStatusColor(
  status: ConnectionProfileRecord['lastCheckStatus'],
): 'success' | 'warning' | 'error' | 'default' {
  if (status === 'passed') return 'success';
  if (status === 'warning') return 'warning';
  if (status === 'failed') return 'error';
  return 'default';
}

function checkStatusLabel(
  status: ConnectionProfileRecord['lastCheckStatus'],
): string {
  if (status === 'passed') return 'Проверка пройдена';
  if (status === 'warning') return 'Есть предупреждения';
  if (status === 'failed') return 'Ошибка проверки';
  return 'Не проверялся';
}

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<ConnectionProfileRecord[]>([]);
  const [catalog, setCatalog] = useState<ProfileCatalogEntry[]>([]);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionBrief[]>([]);
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [sniRules, setSniRules] = useState<SniProfileRule[]>(
    () => CLIENT_SNI_PROFILES_CATALOG as unknown as SniProfileRule[],
  );
  const [appliedSniRuleName, setAppliedSniRuleName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<
    Record<string, ClientProbeResponse>
  >({});
  const [previewTarget, setPreviewTarget] = useState<{
    kind: ManagedProfileKind;
    name?: string;
    nodeId?: string;
    port?: string;
    sni?: string;
    spec?: ManagedProfileSettings;
    initialTab?: number;
  } | null>(null);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [deployTargets, setDeployTargets] = useState<ConnectionProfileRecord[]>(
    [],
  );
  const [targetSubIds, setTargetSubIds] = useState<string[]>([]);
  const [subSearch, setSubSearch] = useState('');
  const [skipExistingInSub, setSkipExistingInSub] = useState(true);
  const [useRandomPortOnMultiSub, setUseRandomPortOnMultiSub] = useState(false);
  const [rotateAfterAttach, setRotateAfterAttach] = useState(true);
  const [attaching, setAttaching] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    severity: 'success' | 'error' | 'info' | 'warning';
    message: string;
  }>({ open: false, severity: 'info', message: '' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [
        profilesRes,
        catalogRes,
        nodesRes,
        subsRes,
        domainsRes,
        sniProfilesRes,
      ] = await Promise.all([
        api.get<ConnectionProfileRecord[]>('/profiles'),
        api.get<ProfileCatalogEntry[]>('/profiles/catalog'),
        api.get<NodeRecord[]>('/nodes'),
        api
          .get<SubscriptionBrief[]>('/subscriptions')
          .catch(() => ({ data: [] as SubscriptionBrief[] })),
        api
          .get<DomainItem[]>('/domains/all')
          .catch(() => ({ data: [] as DomainItem[] })),
        api
          .get<{ profiles?: SniProfileRule[] }>('/domains/profiles')
          .catch(() => ({ data: { profiles: [] as SniProfileRule[] } })),
      ]);
      setProfiles(Array.isArray(profilesRes.data) ? profilesRes.data : []);
      setCatalog(Array.isArray(catalogRes.data) ? catalogRes.data : []);
      setNodes(Array.isArray(nodesRes.data) ? nodesRes.data : []);
      setSubscriptions(Array.isArray(subsRes.data) ? subsRes.data : []);
      setDomains(
        Array.isArray(domainsRes.data)
          ? domainsRes.data.filter((d) => d.isEnabled !== false)
          : [],
      );
      if (
        Array.isArray(sniProfilesRes.data?.profiles) &&
        sniProfilesRes.data.profiles.length > 0
      ) {
        setSniRules(sniProfilesRes.data.profiles);
      }
    } catch {
      setSnackbar({
        open: true,
        severity: 'error',
        message: 'Не удалось загрузить профили подключения',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const applyNodeDefaults = (
    base: ProfileFormState,
    nextNodeId: string,
    previousNodeId?: string,
  ): ProfileFormState => {
    const nextNode = nodes.find((n) => n.id === nextNodeId);
    const prevNode = nodes.find((n) => n.id === previousNodeId);
    const nextHost = resolveNodeHostname(nextNode);
    const prevHost = resolveNodeHostname(prevNode);
    if (base.kind === 'self-sni' || base.kind === 'https-fallback') {
      const currentDomain = base.spec.domain?.trim() || '';
      const shouldReplaceDomain =
        !currentDomain || (prevHost && currentDomain === prevHost);
      const nextDomain =
        shouldReplaceDomain && nextHost ? nextHost : currentDomain;
      const shouldReplaceCert =
        !base.spec.certificateFile?.trim() ||
        (prevNode?.webCertificateFile &&
          base.spec.certificateFile === prevNode.webCertificateFile);
      const shouldReplaceKey =
        !base.spec.keyFile?.trim() ||
        (prevNode?.webKeyFile && base.spec.keyFile === prevNode.webKeyFile);
      return {
        ...base,
        nodeId: nextNodeId,
        sni: nextDomain,
        spec: {
          ...base.spec,
          domain: nextDomain,
          ...(shouldReplaceCert && nextNode?.webCertificateFile
            ? { certificateFile: nextNode.webCertificateFile }
            : {}),
          ...(shouldReplaceKey && nextNode?.webKeyFile
            ? { keyFile: nextNode.webKeyFile }
            : {}),
        },
      };
    }
    return { ...base, nodeId: nextNodeId };
  };

  const handleXhttpSniSelect = (value: string) => {
    const clean = value.trim();
    const matched = findMatchingSniRule(clean, sniRules);
    if (matched) {
      setAppliedSniRuleName(matched.name);
      setForm((prev) => ({
        ...prev,
        sni: clean,
        spec: {
          ...prev.spec,
          fingerprint: matched.profile.fingerprint,
          spiderX: matched.profile.spiderX || '/',
          path: matched.profile.xhttpPath || prev.spec.path || '/',
        },
      }));
      return;
    }
    setAppliedSniRuleName('');
    setForm((prev) => ({ ...prev, sni: clean }));
  };

  const openCreate = (kind: ManagedProfileKind = 'xhttp-stable') => {
    setEditingId(null);
    setAppliedSniRuleName('');
    const defaultNodeId = nodes.find((n) => n.isMain)?.id || nodes[0]?.id || '';
    const next = applyNodeDefaults(defaultFormForKind(kind), defaultNodeId);
    setForm(next);
    setDialogOpen(true);
  };

  const openEdit = (profile: ConnectionProfileRecord) => {
    setEditingId(profile.id);
    const matched =
      profile.kind === 'xhttp-stable' && profile.sni
        ? findMatchingSniRule(profile.sni, sniRules)
        : null;
    setAppliedSniRuleName(matched?.name || '');
    setForm({
      name: profile.name,
      kind: profile.kind,
      nodeId: profile.nodeId || '',
      port: profile.port ? String(profile.port) : '',
      sni: profile.sni || '',
      rotationPolicy: profile.rotationPolicy || 'fixed_domain',
      spec: { ...profile.spec },
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setSnackbar({
        open: true,
        severity: 'error',
        message: 'Укажите название профиля',
      });
      return;
    }
    setSaving(true);
    try {
      const numericPort =
        form.port.trim() && /^\d+$/.test(form.port.trim())
          ? Number(form.port.trim())
          : undefined;
      const payload = {
        name: form.name.trim(),
        ...(editingId ? {} : { kind: form.kind }),
        nodeId: form.nodeId || undefined,
        port: numericPort,
        sni:
          form.kind === 'self-sni' || form.kind === 'https-fallback'
            ? form.spec.domain?.trim() || form.sni.trim() || undefined
            : form.sni.trim() || undefined,
        rotationPolicy: form.rotationPolicy,
        spec: {
          ...form.spec,
          rotationPolicy: form.rotationPolicy,
        },
      };
      if (editingId) {
        await api.put(`/profiles/${editingId}`, payload);
      } else {
        await api.post('/profiles', payload);
      }
      setDialogOpen(false);
      setSnackbar({
        open: true,
        severity: 'success',
        message: editingId ? 'Профиль обновлён' : 'Профиль создан',
      });
      await loadData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message || 'Ошибка сохранения профиля';
      setSnackbar({
        open: true,
        severity: 'error',
        message: Array.isArray(msg) ? msg.join('; ') : String(msg),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCheck = async (profile: ConnectionProfileRecord) => {
    setBusyId(profile.id);
    try {
      const res = await api.post<{ status: string }>(
        `/profiles/${profile.id}/check`,
      );
      setSnackbar({
        open: true,
        severity: res.data.status === 'failed' ? 'error' : 'success',
        message: `Preflight-проверка «${profile.name}»: ${res.data.status}`,
      });
      await loadData();
    } catch {
      setSnackbar({
        open: true,
        severity: 'error',
        message: 'Не удалось выполнить preflight-проверку профиля',
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleProbe = async (profile: ConnectionProfileRecord) => {
    setBusyId(profile.id);
    try {
      const res = await api.post<ClientProbeResponse>(
        `/profiles/${profile.id}/probe`,
      );
      setProbeResults((prev) => ({ ...prev, [profile.id]: res.data }));
      setSnackbar({
        open: true,
        severity: res.data.probe.success
          ? 'success'
          : res.data.deployed === false
            ? 'warning'
            : 'error',
        message: res.data.probe.success
          ? `Клиентская проба «${profile.name}» пройдена (${res.data.probe.engine}, ${res.data.probe.latencyMs} мс)`
          : res.data.probe.error ||
            `Клиентская проба «${profile.name}» не пройдена`,
      });
      await loadData();
    } catch {
      setSnackbar({
        open: true,
        severity: 'error',
        message: 'Не удалось выполнить клиентскую пробу',
      });
    } finally {
      setBusyId(null);
    }
  };

  const getWebServerEngine = (
    kind: ManagedProfileKind,
    spec?: ManagedProfileSettings,
  ): 'nginx' | 'caddy' | null => {
    if (kind === 'self-sni') {
      const ws = spec?.webServer ?? 'nginx';
      return ws === 'nginx' || ws === 'caddy' ? ws : null;
    }
    if (kind === 'https-fallback') {
      const rp = spec?.reverseProxy ?? 'none';
      return rp === 'nginx' || rp === 'caddy' ? rp : null;
    }
    return null;
  };

  const openProfilePreview = (
    profile: ConnectionProfileRecord,
    initialTab = 0,
  ) => {
    setPreviewTarget({
      kind: profile.kind,
      name: profile.name,
      nodeId: profile.nodeId || undefined,
      port: profile.port ? String(profile.port) : 'random',
      sni: profile.sni || undefined,
      spec: profile.spec,
      initialTab,
    });
  };

  const openDraftWebServerPreview = () => {
    setPreviewTarget({
      kind: form.kind,
      name: form.name || form.kind,
      nodeId: form.nodeId || undefined,
      port: form.port.trim() || 'random',
      sni:
        form.kind === 'self-sni' || form.kind === 'https-fallback'
          ? form.spec.domain?.trim() || form.sni.trim() || undefined
          : form.sni.trim() || undefined,
      spec: { ...form.spec, rotationPolicy: form.rotationPolicy },
      initialTab: 3,
    });
  };

  const isProfileInSubscription = (
    profile: ConnectionProfileRecord,
    sub: SubscriptionBrief,
  ): boolean => {
    const configs = Array.isArray(sub.inboundsConfig) ? sub.inboundsConfig : [];
    return configs.some((cfg) => {
      if (cfg.profileId && String(cfg.profileId) === profile.id) return true;
      return (
        String(cfg.type || '') === profile.kind &&
        String(cfg.name || '').trim() === profile.name.trim() &&
        String(cfg.nodeId || '') === String(profile.nodeId || '')
      );
    });
  };

  const countProfileSubscriptions = (profile: ConnectionProfileRecord): number =>
    subscriptions.filter((sub) => isProfileInSubscription(profile, sub)).length;

  const buildInboundFromProfile = (
    profile: ConnectionProfileRecord,
    forceRandomPort: boolean,
  ): Record<string, unknown> => {
    const domain = profile.spec?.domain?.trim() || profile.sni?.trim() || '';
    const isDirectFallback =
      profile.kind === 'https-fallback' &&
      (profile.spec?.reverseProxy ?? 'none') === 'none';
    const newInbound: Record<string, unknown> = {
      configId: crypto.randomUUID(),
      type: profile.kind,
      port: forceRandomPort ? 'random' : (profile.port ?? 'random'),
      nodeId: profile.nodeId || undefined,
      name: profile.name,
      enabled: true,
      profileId: forceRandomPort ? undefined : profile.id,
      profileSettings: {
        ...profile.spec,
        rotationPolicy: profile.rotationPolicy,
      },
    };
    if (profile.kind === 'xhttp-stable') {
      newInbound.sni = profile.sni || 'random';
    } else if (profile.kind === 'self-sni') {
      newInbound.sni = domain || undefined;
    } else if (profile.kind === 'https-fallback') {
      newInbound.tlsServerName = domain || undefined;
      if (isDirectFallback) {
        newInbound.certificateMode =
          profile.spec?.certificateFile && profile.spec?.keyFile
            ? 'custom'
            : 'node';
        if (newInbound.certificateMode === 'custom') {
          newInbound.certificateFile = profile.spec.certificateFile;
          newInbound.keyFile = profile.spec.keyFile;
        }
      }
    }
    return newInbound;
  };

  const toggleProfileSelection = (id: string) => {
    setSelectedProfileIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const openAttachDialog = (targets: ConnectionProfileRecord[]) => {
    if (targets.length === 0) return;
    setDeployTargets(targets);
    setSubSearch('');
    setSkipExistingInSub(true);
    setUseRandomPortOnMultiSub(false);
    setRotateAfterAttach(true);
    const defaultSubs = subscriptions
      .filter((sub) =>
        targets.some((profile) => !isProfileInSubscription(profile, sub)),
      )
      .map((sub) => sub.id);
    if (defaultSubs.length > 0) {
      setTargetSubIds(
        targets.length === 1 && subscriptions.length === 1
          ? [defaultSubs[0]]
          : defaultSubs.length === 1
            ? [defaultSubs[0]]
            : [defaultSubs[0]],
      );
    } else {
      setTargetSubIds(subscriptions[0]?.id ? [subscriptions[0].id] : []);
    }
  };

  const toggleTargetSub = (subId: string) => {
    setTargetSubIds((prev) =>
      prev.includes(subId)
        ? prev.filter((id) => id !== subId)
        : [...prev, subId],
    );
  };

  const handleAttachToSubscriptions = async () => {
    if (deployTargets.length === 0 || targetSubIds.length === 0) return;
    const selectedSubs = subscriptions.filter((item) =>
      targetSubIds.includes(item.id),
    );
    if (selectedSubs.length === 0) return;

    setAttaching(true);
    try {
      const updatedSubIds: string[] = [];
      let addedCount = 0;
      let skippedDuplicates = 0;
      let skippedLimit = 0;
      const forceRandom =
        selectedSubs.length > 1 && useRandomPortOnMultiSub;

      for (const sub of selectedSubs) {
        const existingConfigs = Array.isArray(sub.inboundsConfig)
          ? sub.inboundsConfig
          : [];
        const currentConnectionCount = existingConfigs.filter(
          (cfg) => !ROUTING_INBOUND_TYPES.has(String(cfg.type || '')),
        ).length;

        const toAdd: Array<Record<string, unknown>> = [];
        for (const profile of deployTargets) {
          if (skipExistingInSub && isProfileInSubscription(profile, sub)) {
            skippedDuplicates += 1;
            continue;
          }
          if (currentConnectionCount + toAdd.length >= 20) {
            skippedLimit += 1;
            continue;
          }
          toAdd.push(buildInboundFromProfile(profile, forceRandom));
        }

        if (toAdd.length === 0) continue;

        await api.put(`/subscriptions/${sub.id}`, {
          name: sub.name,
          note: sub.note || '',
          supportUrl: sub.supportUrl || '',
          websiteUrl: sub.websiteUrl || '',
          isAutoRotationEnabled: sub.isAutoRotationEnabled ?? true,
          nodeId: sub.nodeId || undefined,
          relayServerId: sub.relayServerId || undefined,
          inboundsConfig: [...existingConfigs, ...toAdd],
        });
        updatedSubIds.push(sub.id);
        addedCount += toAdd.length;
      }

      if (rotateAfterAttach && updatedSubIds.length > 0) {
        if (updatedSubIds.length === 1) {
          await api.post(`/rotation/rotate-one/${updatedSubIds[0]}`);
        } else {
          await api.post('/rotation/operations', {
            subscriptionIds: updatedSubIds,
          });
        }
      }

      setDeployTargets([]);
      setSelectedProfileIds([]);

      if (addedCount === 0) {
        setSnackbar({
          open: true,
          severity: 'info',
          message:
            skippedLimit > 0
              ? 'Достигнут лимит 20 подключений в выбранных подписках'
              : 'Все выбранные профили уже добавлены в выбранные подписки',
        });
      } else {
        const extraParts: string[] = [];
        if (skippedDuplicates > 0) {
          extraParts.push(`пропущено дублей: ${skippedDuplicates}`);
        }
        if (skippedLimit > 0) {
          extraParts.push(`пропущено из-за лимита 20: ${skippedLimit}`);
        }
        const suffix = extraParts.length ? ` (${extraParts.join(', ')})` : '';
        setSnackbar({
          open: true,
          severity: 'success',
          message: rotateAfterAttach
            ? `Добавлено подключений: ${addedCount} в подписок: ${updatedSubIds.length}${suffix} — запущена ротация`
            : `Добавлено подключений: ${addedCount} в подписок: ${updatedSubIds.length}${suffix}`,
        });
      }
      await loadData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message ||
        'Не удалось добавить профили в подписки';
      setSnackbar({
        open: true,
        severity: 'error',
        message: Array.isArray(msg) ? msg.join('; ') : String(msg),
      });
    } finally {
      setAttaching(false);
    }
  };

  const handleRollback = async (profile: ConnectionProfileRecord) => {
    setBusyId(profile.id);
    try {
      await api.post(`/profiles/${profile.id}/rollback`);
      setSnackbar({
        open: true,
        severity: 'success',
        message: `Профиль «${profile.name}» откачен к ревизии ${profile.previousSnapshot?.revision ?? '?'}`,
      });
      await loadData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || 'Не удалось откатить профиль';
      setSnackbar({
        open: true,
        severity: 'error',
        message: String(msg),
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (profile: ConnectionProfileRecord) => {
    setBusyId(profile.id);
    try {
      await api.delete(`/profiles/${profile.id}`);
      setSnackbar({
        open: true,
        severity: 'success',
        message: `Профиль «${profile.name}» удалён`,
      });
      await loadData();
    } catch {
      setSnackbar({
        open: true,
        severity: 'error',
        message: 'Не удалось удалить профиль',
      });
    } finally {
      setBusyId(null);
    }
  };

  const nodeNameById = (nodeId?: string | null) =>
    nodes.find((n) => n.id === nodeId)?.name || 'Нода не назначена';

  const sniAutocompleteOptions: string[] = Array.from(
    new Set([
      'random',
      ...domains.map((d) => d.name),
      ...sniRules.flatMap((rule) => rule.recommendedDomains || []),
    ]),
  );

  const ownDomainOptions: string[] = Array.from(
    new Set([
      ...nodes.map((n) => resolveNodeHostname(n)).filter(Boolean),
      ...domains.map((d) => d.name),
    ]),
  );

  return (
    <Stack spacing={3}>
      <WorkspaceHeader
        eyebrow="CONNECTION PROFILES"
        title="Управляемые профили"
        subtitle="Единое управление XHTTP Stable, Self-SNI и HTTPS Fallback: preflight-проверки, реальная клиентская проба (xray-core), ревизии и ручной откат."
        actions={
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<Refresh />}
              onClick={() => void loadData()}
              disabled={loading}
            >
              Обновить
            </Button>
            <Button
              variant="contained"
              startIcon={<Add />}
              onClick={() => openCreate('xhttp-stable')}
            >
              Создать профиль
            </Button>
          </Stack>
        }
      />

      {catalog.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: {
              xs: '1fr',
              md: 'repeat(3, minmax(0, 1fr))',
            },
          }}
        >
          {catalog.map((item) => (
            <Paper
              key={item.kind}
              variant="outlined"
              sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}
            >
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                gap={1}
              >
                <Typography fontWeight={700}>{item.title}</Typography>
                <Chip
                  size="small"
                  color="success"
                  variant="outlined"
                  label={`Xray >= ${item.minXrayVersion}`}
                />
              </Stack>
              <Typography variant="caption" color="primary">
                {item.transportSummary}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                {item.description}
              </Typography>
              <Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Add />}
                  onClick={() => openCreate(item.kind)}
                >
                  Создать {item.title}
                </Button>
              </Box>
            </Paper>
          ))}
        </Box>
      )}

      {loading ? (
        <Stack alignItems="center" py={6}>
          <CircularProgress />
        </Stack>
      ) : profiles.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="subtitle1" fontWeight={600}>
            Сохранённых профилей пока нет
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Создайте профиль XHTTP Stable, Self-SNI или HTTPS Fallback для
            централизованных preflight-проверок, клиентских проб и версионирования
            с откатом.
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          <Paper
            variant="outlined"
            sx={{
              px: 2,
              py: 1.25,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 1.5,
            }}
          >
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <FormControlLabel
                sx={{ mr: 0.5 }}
                control={
                  <Checkbox
                    size="small"
                    checked={
                      profiles.length > 0 &&
                      selectedProfileIds.length === profiles.length
                    }
                    indeterminate={
                      selectedProfileIds.length > 0 &&
                      selectedProfileIds.length < profiles.length
                    }
                    onChange={(e) =>
                      setSelectedProfileIds(
                        e.target.checked ? profiles.map((p) => p.id) : [],
                      )
                    }
                  />
                }
                label={
                  <Typography variant="body2">
                    Выбрать все ({selectedProfileIds.length}/{profiles.length})
                  </Typography>
                }
              />
              {profiles.some((p) => !p.deployed) && (
                <Button
                  size="small"
                  variant="text"
                  onClick={() =>
                    setSelectedProfileIds(
                      profiles.filter((p) => !p.deployed).map((p) => p.id),
                    )
                  }
                >
                  Выбрать черновики
                </Button>
              )}
            </Stack>
            <Button
              size="small"
              variant="contained"
              startIcon={<PlaylistAdd />}
              disabled={
                selectedProfileIds.length === 0 || subscriptions.length === 0
              }
              onClick={() =>
                openAttachDialog(
                  profiles.filter((p) => selectedProfileIds.includes(p.id)),
                )
              }
            >
              В подписки ({selectedProfileIds.length})
            </Button>
          </Paper>

          {profiles.map((profile) => {
            const isBusy = busyId === profile.id;
            const latestProbe = probeResults[profile.id];
            const isSelected = selectedProfileIds.includes(profile.id);
            const usedInSubsCount = countProfileSubscriptions(profile);
            const webServerEngine = getWebServerEngine(
              profile.kind,
              profile.spec,
            );
            const webServerChipLabel =
              webServerEngine && profile.kind === 'self-sni'
                ? `${webServerEngine === 'caddy' ? 'Caddy' : 'Nginx'} · 127.0.0.1:${profile.spec?.localHttpsPort ?? 8443}`
                : webServerEngine && profile.kind === 'https-fallback'
                  ? `${webServerEngine === 'caddy' ? 'Caddy' : 'Nginx'} :${profile.spec?.publicPort ?? 443} → :${profile.port ?? 20443}`
                  : null;
            return (
              <Paper
                key={profile.id}
                variant="outlined"
                sx={{
                  p: 2.5,
                  borderColor: isSelected ? 'primary.main' : undefined,
                }}
              >
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                  gap={1.5}
                >
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <Checkbox
                      size="small"
                      checked={isSelected}
                      onChange={() => toggleProfileSelection(profile.id)}
                      inputProps={{
                        'aria-label': `Выбрать профиль ${profile.name}`,
                      }}
                      sx={{ mt: -0.25, ml: -1 }}
                    />
                    <Stack spacing={0.5}>
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        flexWrap="wrap"
                        useFlexGap
                      >
                        <Typography variant="h6" fontWeight={700}>
                          {profile.name}
                        </Typography>
                        <Chip size="small" label={profile.kind} />
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`rev.${profile.activeRevision}`}
                        />
                        <Chip
                          size="small"
                          color={checkStatusColor(profile.lastCheckStatus)}
                          label={checkStatusLabel(profile.lastCheckStatus)}
                        />
                        <Chip
                          size="small"
                          variant="outlined"
                          color={profile.deployed ? 'success' : 'default'}
                          label={
                            profile.deployed
                              ? `Развёрнут · порт ${profile.activeInbound?.port ?? profile.port ?? '?'}`
                              : 'Черновик (не в подписке)'
                          }
                        />
                        {usedInSubsCount > 0 && (
                          <Chip
                            size="small"
                            color="info"
                            variant="outlined"
                            label={`Подписок: ${usedInSubsCount}`}
                          />
                        )}
                        {webServerChipLabel && (
                          <Chip
                            size="small"
                            color="secondary"
                            variant="outlined"
                            label={webServerChipLabel}
                          />
                        )}
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        Нода: {nodeNameById(profile.nodeId)} · Порт:{' '}
                        {profile.port ?? 'random'} · Домен/SNI:{' '}
                        {profile.spec?.domain || profile.sni || 'random'} ·
                        Ротация: {profile.rotationPolicy}
                      </Typography>
                    </Stack>
                  </Stack>

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button
                      size="small"
                      variant={profile.deployed ? 'outlined' : 'contained'}
                      startIcon={<PlaylistAdd />}
                      disabled={isBusy || subscriptions.length === 0}
                      onClick={() => openAttachDialog([profile])}
                    >
                      В подписки
                    </Button>
                    {webServerEngine && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="secondary"
                        startIcon={<Terminal />}
                        onClick={() => openProfilePreview(profile, 3)}
                      >
                        {webServerEngine === 'caddy'
                          ? 'Caddy и инструкция'
                          : 'Nginx и инструкция'}
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<FactCheck />}
                      disabled={isBusy}
                      onClick={() => void handleCheck(profile)}
                    >
                      Preflight
                    </Button>
                    <Tooltip
                      title={
                        profile.deployed
                          ? 'Запустить реальную клиентскую проверку через xray-core'
                          : 'Сначала добавьте профиль в подписку и выполните ротацию, чтобы создать inbound в 3x-ui'
                      }
                    >
                      <span>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<NetworkCheck />}
                          disabled={isBusy}
                          onClick={() => void handleProbe(profile)}
                        >
                          Клиентская проба
                        </Button>
                      </span>
                    </Tooltip>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<OpenInNew />}
                      onClick={() => openProfilePreview(profile, 0)}
                    >
                      Предпросмотр
                    </Button>
                    <Tooltip
                      title={
                        profile.previousSnapshot
                          ? `Откатить к ревизии ${profile.previousSnapshot.revision} («${profile.previousSnapshot.name}»)`
                          : 'Нет предыдущей ревизии для отката'
                      }
                    >
                      <span>
                        <Button
                          size="small"
                          variant="outlined"
                          color="warning"
                          startIcon={<Restore />}
                          disabled={isBusy || !profile.previousSnapshot}
                          onClick={() => void handleRollback(profile)}
                        >
                          Откатить
                        </Button>
                      </span>
                    </Tooltip>
                    <IconButton
                      size="small"
                      aria-label={`Редактировать профиль ${profile.name}`}
                      disabled={isBusy}
                      onClick={() => openEdit(profile)}
                    >
                      <Edit fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={`Удалить профиль ${profile.name}`}
                      disabled={isBusy}
                      onClick={() => void handleDelete(profile)}
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  </Stack>
                </Stack>

                {latestProbe && (
                  <Alert
                    severity={
                      latestProbe.probe.success
                        ? 'success'
                        : latestProbe.deployed === false
                          ? 'warning'
                          : 'error'
                    }
                    sx={{ mt: 1.5, py: 0.25 }}
                  >
                    <strong>
                      Клиентская проба ({latestProbe.probe.engine}):
                    </strong>{' '}
                    {latestProbe.probe.success
                      ? `OK · ${latestProbe.probe.targetAddress}:${latestProbe.probe.targetPort} · ${latestProbe.probe.latencyMs} мс${latestProbe.probe.httpStatusCode ? ` · HTTP ${latestProbe.probe.httpStatusCode}` : ''}`
                      : latestProbe.probe.error || 'Соединение не установлено'}
                    {latestProbe.probe.fallbackReason
                      ? ` (${latestProbe.probe.fallbackReason})`
                      : ''}
                  </Alert>
                )}

                {profile.lastCheckResult?.checks?.length ? (
                  <Stack spacing={0.75} sx={{ mt: 1.5 }}>
                    {profile.lastCheckResult.checks
                      .filter((c) => c.severity !== 'ok')
                      .map((check) => (
                        <Alert
                          key={check.code}
                          severity={
                            check.severity === 'error' ? 'error' : 'warning'
                          }
                          sx={{ py: 0.25 }}
                        >
                          <strong>{check.title}:</strong> {check.message}
                        </Alert>
                      ))}
                  </Stack>
                ) : null}
              </Paper>
            );
          })}
        </Stack>
      )}

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {editingId ? 'Редактировать профиль' : 'Новый профиль подключения'}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              size="small"
              label="Название профиля"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth
            />
            <FormControl size="small" fullWidth disabled={Boolean(editingId)}>
              <InputLabel>Тип профиля</InputLabel>
              <Select
                value={form.kind}
                label="Тип профиля"
                onChange={(e) => {
                  const nextKind = e.target.value as ManagedProfileKind;
                  setAppliedSniRuleName('');
                  const next = applyNodeDefaults(
                    defaultFormForKind(nextKind),
                    form.nodeId,
                  );
                  next.name = form.name;
                  setForm(next);
                }}
              >
                <MenuItem value="xhttp-stable">
                  XHTTP Stable (VLESS + XHTTP + REALITY)
                </MenuItem>
                <MenuItem value="self-sni">
                  Self-SNI (VLESS + RAW + REALITY + Vision)
                </MenuItem>
                <MenuItem value="https-fallback">
                  HTTPS Fallback (VLESS + XHTTP + TLS)
                </MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth>
              <InputLabel>Нода</InputLabel>
              <Select
                value={form.nodeId}
                label="Нода"
                onChange={(e) =>
                  setForm((prev) =>
                    applyNodeDefaults(prev, e.target.value, prev.nodeId),
                  )
                }
              >
                <MenuItem value="">Не выбрана</MenuItem>
                {nodes.map((node) => (
                  <MenuItem key={node.id} value={node.id}>
                    {node.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Stack direction="row" spacing={1.5}>
              <TextField
                size="small"
                label="Порт (или пусто для random)"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
                fullWidth
              />
              <FormControl size="small" fullWidth>
                <InputLabel>Политика ротации</InputLabel>
                <Select
                  value={form.rotationPolicy}
                  label="Политика ротации"
                  onChange={(e) =>
                    setForm({
                      ...form,
                      rotationPolicy: e.target.value as ProfileRotationPolicy,
                    })
                  }
                >
                  <MenuItem value="fixed_domain">Фиксированный домен</MenuItem>
                  <MenuItem value="preserve_all">
                    Сохранять домен, порт и ключи
                  </MenuItem>
                  {form.kind === 'xhttp-stable' && (
                    <MenuItem value="standard">Обычная ротация</MenuItem>
                  )}
                </Select>
              </FormControl>
            </Stack>

            {form.kind === 'xhttp-stable' ? (
              <>
                <Autocomplete
                  freeSolo
                  size="small"
                  options={sniAutocompleteOptions}
                  value={form.sni}
                  onInputChange={(_, newValue, reason) => {
                    if (reason === 'input' || reason === 'clear') {
                      setForm((prev) => ({ ...prev, sni: newValue }));
                      if (reason === 'clear' || !newValue.trim()) {
                        setAppliedSniRuleName('');
                      }
                    }
                  }}
                  onChange={(_, newValue) =>
                    handleXhttpSniSelect(
                      typeof newValue === 'string' ? newValue : '',
                    )
                  }
                  renderOption={(props, option) => {
                    const rule = findMatchingSniRule(option, sniRules);
                    const inWhitelist = domains.some((d) => d.name === option);
                    return (
                      <li {...props} key={option}>
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          alignItems="center"
                          width="100%"
                          gap={1}
                        >
                          <Typography variant="body2">
                            {option === 'random'
                              ? 'random (из раздела «Домены»)'
                              : option}
                          </Typography>
                          <Stack direction="row" spacing={0.5}>
                            {inWhitelist && (
                              <Chip
                                size="small"
                                variant="outlined"
                                label="Домены"
                              />
                            )}
                            {rule && (
                              <Chip
                                size="small"
                                color="primary"
                                variant="outlined"
                                label={rule.category}
                              />
                            )}
                          </Stack>
                        </Stack>
                      </li>
                    );
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="SNI (выбор из «Доменов» / SNI-профилей или свой)"
                      placeholder="random или домен"
                      helperText={
                        appliedSniRuleName
                          ? `Применён SNI-профиль: ${appliedSniRuleName} (fingerprint, path, spiderX — можно изменить вручную)`
                          : 'Выберите домен из раздела «Домены» для автоподбора fingerprint/path/spiderX'
                      }
                    />
                  )}
                />
                {(() => {
                  const matchedManual = findMatchingSniRule(form.sni, sniRules);
                  if (
                    !matchedManual ||
                    matchedManual.name === appliedSniRuleName
                  ) {
                    return null;
                  }
                  return (
                    <Box>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<Tune />}
                        onClick={() => handleXhttpSniSelect(form.sni)}
                      >
                        Применить SNI-профиль «{matchedManual.name}»
                      </Button>
                    </Box>
                  );
                })()}
                <Stack direction="row" spacing={1.5}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Режим XHTTP</InputLabel>
                    <Select
                      value={form.spec.mode || 'auto'}
                      label="Режим XHTTP"
                      onChange={(e) =>
                        setForm({
                          ...form,
                          spec: {
                            ...form.spec,
                            mode: e.target.value as XhttpMode,
                          },
                        })
                      }
                    >
                      {XHTTP_MODE_OPTIONS.map((m) => (
                        <MenuItem key={m} value={m}>
                          {m}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    size="small"
                    label="XHTTP Path"
                    value={form.spec.path ?? '/'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        spec: { ...form.spec, path: e.target.value },
                      })
                    }
                    fullWidth
                  />
                </Stack>
                <Stack direction="row" spacing={1.5}>
                  <TextField
                    size="small"
                    label="SpiderX"
                    placeholder="/"
                    value={form.spec.spiderX ?? '/'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        spec: { ...form.spec, spiderX: e.target.value },
                      })
                    }
                    fullWidth
                  />
                  <TextField
                    size="small"
                    label="XHTTP Host (опц.)"
                    placeholder="По умолчанию = SNI"
                    value={form.spec.host || ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        spec: { ...form.spec, host: e.target.value },
                      })
                    }
                    fullWidth
                  />
                </Stack>
              </>
            ) : form.kind === 'self-sni' ? (
              <>
                <Autocomplete
                  freeSolo
                  size="small"
                  options={ownDomainOptions}
                  value={form.spec.domain || ''}
                  onInputChange={(_, newValue, reason) => {
                    if (reason === 'input' || reason === 'clear') {
                      setForm((prev) => ({
                        ...prev,
                        sni: newValue,
                        spec: { ...prev.spec, domain: newValue },
                      }));
                    }
                  }}
                  onChange={(_, newValue) => {
                    const val = typeof newValue === 'string' ? newValue : '';
                    setForm((prev) => ({
                      ...prev,
                      sni: val,
                      spec: { ...prev.spec, domain: val },
                    }));
                  }}
                  renderOption={(props, option) => {
                    const matchedNode = nodes.find(
                      (n) => resolveNodeHostname(n) === option,
                    );
                    const inDomains = domains.some((d) => d.name === option);
                    return (
                      <li {...props} key={option}>
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          alignItems="center"
                          width="100%"
                          gap={1}
                        >
                          <Typography variant="body2">{option}</Typography>
                          <Stack direction="row" spacing={0.5}>
                            {matchedNode && (
                              <Chip
                                size="small"
                                color="primary"
                                variant="outlined"
                                label={`Нода: ${matchedNode.name}`}
                              />
                            )}
                            {inDomains && (
                              <Chip
                                size="small"
                                variant="outlined"
                                label="Домены"
                              />
                            )}
                          </Stack>
                        </Stack>
                      </li>
                    );
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Собственный домен (ноды или свой)"
                      placeholder="site.example.com"
                    />
                  )}
                />
                <Stack direction="row" spacing={1.5}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Веб-сервер</InputLabel>
                    <Select
                      value={form.spec.webServer ?? 'nginx'}
                      label="Веб-сервер"
                      onChange={(e) =>
                        setForm({
                          ...form,
                          spec: {
                            ...form.spec,
                            webServer: e.target.value as ReverseProxyEngine,
                          },
                        })
                      }
                    >
                      <MenuItem value="nginx">Nginx (127.0.0.1)</MenuItem>
                      <MenuItem value="caddy">Caddy (127.0.0.1)</MenuItem>
                      <MenuItem value="none">Внешний / ручной</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    size="small"
                    type="number"
                    label={
                      form.spec.webServer === 'none'
                        ? 'Целевой HTTPS-порт'
                        : 'Локальный HTTPS-порт'
                    }
                    value={
                      form.spec.webServer === 'none'
                        ? (form.spec.destPort ?? 443)
                        : (form.spec.localHttpsPort ?? 8443)
                    }
                    onChange={(e) =>
                      setForm({
                        ...form,
                        spec:
                          form.spec.webServer === 'none'
                            ? {
                                ...form.spec,
                                destPort: Number(e.target.value) || 443,
                              }
                            : {
                                ...form.spec,
                                localHttpsPort: Number(e.target.value) || 8443,
                              },
                      })
                    }
                    fullWidth
                  />
                </Stack>
                {form.spec.webServer !== 'none' && (
                  <Stack direction="row" spacing={1.5}>
                    <TextField
                      size="small"
                      label="Сертификат (для шаблона)"
                      placeholder="/root/cert/.../fullchain.pem"
                      value={form.spec.certificateFile || ''}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          spec: {
                            ...form.spec,
                            certificateFile: e.target.value,
                          },
                        })
                      }
                      fullWidth
                    />
                    <TextField
                      size="small"
                      label="Приватный ключ (для шаблона)"
                      placeholder="/root/cert/.../privkey.pem"
                      value={form.spec.keyFile || ''}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          spec: { ...form.spec, keyFile: e.target.value },
                        })
                      }
                      fullWidth
                    />
                  </Stack>
                )}
              </>
            ) : (
              <>
                <Autocomplete
                  freeSolo
                  size="small"
                  options={ownDomainOptions}
                  value={form.spec.domain || ''}
                  onInputChange={(_, newValue, reason) => {
                    if (reason === 'input' || reason === 'clear') {
                      setForm((prev) => ({
                        ...prev,
                        sni: newValue,
                        spec: { ...prev.spec, domain: newValue },
                      }));
                    }
                  }}
                  onChange={(_, newValue) => {
                    const val = typeof newValue === 'string' ? newValue : '';
                    setForm((prev) => ({
                      ...prev,
                      sni: val,
                      spec: { ...prev.spec, domain: val },
                    }));
                  }}
                  renderOption={(props, option) => {
                    const matchedNode = nodes.find(
                      (n) => resolveNodeHostname(n) === option,
                    );
                    const inDomains = domains.some((d) => d.name === option);
                    return (
                      <li {...props} key={option}>
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          alignItems="center"
                          width="100%"
                          gap={1}
                        >
                          <Typography variant="body2">{option}</Typography>
                          <Stack direction="row" spacing={0.5}>
                            {matchedNode && (
                              <Chip
                                size="small"
                                color="primary"
                                variant="outlined"
                                label={`Нода: ${matchedNode.name}`}
                              />
                            )}
                            {inDomains && (
                              <Chip
                                size="small"
                                variant="outlined"
                                label="Домены"
                              />
                            )}
                          </Stack>
                        </Stack>
                      </li>
                    );
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Домен сертификата (ноды или свой)"
                      placeholder="fallback.example.com"
                    />
                  )}
                />
                <Stack direction="row" spacing={1.5}>
                  <FormControl size="small" fullWidth>
                    <InputLabel>Reverse Proxy</InputLabel>
                    <Select
                      value={form.spec.reverseProxy ?? 'none'}
                      label="Reverse Proxy"
                      onChange={(e) =>
                        setForm({
                          ...form,
                          spec: {
                            ...form.spec,
                            reverseProxy: e.target.value as ReverseProxyEngine,
                          },
                        })
                      }
                    >
                      <MenuItem value="none">Прямой TLS в Xray</MenuItem>
                      <MenuItem value="nginx">За Nginx reverse proxy</MenuItem>
                      <MenuItem value="caddy">За Caddy reverse proxy</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField
                    size="small"
                    label="Endpoint Path"
                    value={form.spec.path ?? '/api/v2/stream'}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        spec: { ...form.spec, path: e.target.value },
                      })
                    }
                    fullWidth
                  />
                </Stack>
                {form.spec.reverseProxy !== 'none' && (
                  <TextField
                    size="small"
                    type="number"
                    label="Публичный HTTPS-порт proxy"
                    value={form.spec.publicPort ?? 443}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        spec: {
                          ...form.spec,
                          publicPort: Number(e.target.value) || 443,
                        },
                      })
                    }
                    fullWidth
                  />
                )}
                <Stack direction="row" spacing={1.5}>
                  <TextField
                    size="small"
                    label="Сертификат (опц., по умолчанию с ноды)"
                    placeholder="/root/cert/.../fullchain.pem"
                    value={form.spec.certificateFile || ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        spec: {
                          ...form.spec,
                          certificateFile: e.target.value,
                        },
                      })
                    }
                    fullWidth
                  />
                  <TextField
                    size="small"
                    label="Приватный ключ (опц., по умолчанию с ноды)"
                    placeholder="/root/cert/.../privkey.pem"
                    value={form.spec.keyFile || ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        spec: { ...form.spec, keyFile: e.target.value },
                      })
                    }
                    fullWidth
                  />
                </Stack>
              </>
            )}

            <FormControl size="small" fullWidth>
              <InputLabel>Fingerprint</InputLabel>
              <Select
                value={form.spec.fingerprint || 'chrome'}
                label="Fingerprint"
                onChange={(e) =>
                  setForm({
                    ...form,
                    spec: {
                      ...form.spec,
                      fingerprint: e.target.value as ClientFingerprint,
                    },
                  })
                }
              >
                {FINGERPRINT_OPTIONS.map((fp) => (
                  <MenuItem key={fp} value={fp}>
                    {fp}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {(() => {
              const draftEngine = getWebServerEngine(form.kind, form.spec);
              if (!draftEngine) return null;
              const engineName = draftEngine === 'caddy' ? 'Caddy' : 'Nginx';
              return (
                <Alert
                  severity="info"
                  action={
                    <Button
                      size="small"
                      color="inherit"
                      startIcon={<Terminal />}
                      disabled={!form.spec.domain?.trim()}
                      onClick={openDraftWebServerPreview}
                    >
                      Шаблон {engineName}
                    </Button>
                  }
                >
                  Для этого профиля нужен {engineName} на ноде. Укажите домен и
                  откройте готовый конфиг с пошаговыми командами установки.
                </Alert>
              );
            })()}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Отмена</Button>
          <Button
            variant="contained"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>

      {deployTargets.length > 0 && (() => {
        const filteredSubs = subscriptions.filter((sub) =>
          sub.name.toLowerCase().includes(subSearch.trim().toLowerCase()),
        );
        const fixedPortTargets = deployTargets.filter((p) => p.port != null);
        const hasFixedPortMultiSubWarning =
          targetSubIds.length > 1 && fixedPortTargets.length > 0;
        const plannedAdditions = subscriptions
          .filter((sub) => targetSubIds.includes(sub.id))
          .reduce((acc, sub) => {
            const count = deployTargets.filter(
              (profile) =>
                !skipExistingInSub || !isProfileInSubscription(profile, sub),
            ).length;
            return acc + count;
          }, 0);

        return (
          <Dialog
            open={deployTargets.length > 0}
            onClose={() => !attaching && setDeployTargets([])}
            maxWidth="sm"
            fullWidth
          >
            <DialogTitle>
              {deployTargets.length === 1
                ? 'Добавить профиль в подписки'
                : `Массовое добавление профилей (${deployTargets.length})`}
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2} sx={{ mt: 0.5 }}>
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  {deployTargets.map((profile) => (
                    <Chip
                      key={profile.id}
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={`${profile.name} (${profile.kind}${profile.port ? ` :${profile.port}` : ''})`}
                    />
                  ))}
                </Stack>

                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  flexWrap="wrap"
                  gap={1}
                >
                  <Typography variant="body2" color="text.secondary">
                    Выберите подписки ({targetSubIds.length} из{' '}
                    {subscriptions.length}):
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      onClick={() =>
                        setTargetSubIds(filteredSubs.map((s) => s.id))
                      }
                    >
                      Выбрать все
                    </Button>
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => setTargetSubIds([])}
                    >
                      Снять выбор
                    </Button>
                  </Stack>
                </Stack>

                {subscriptions.length > 5 && (
                  <TextField
                    size="small"
                    placeholder="Поиск подписки по названию…"
                    value={subSearch}
                    onChange={(e) => setSubSearch(e.target.value)}
                    fullWidth
                  />
                )}

                <Paper
                  variant="outlined"
                  sx={{ maxHeight: 260, overflowY: 'auto' }}
                >
                  <List dense disablePadding>
                    {filteredSubs.map((sub) => {
                      const checked = targetSubIds.includes(sub.id);
                      const alreadyCount = deployTargets.filter((p) =>
                        isProfileInSubscription(p, sub),
                      ).length;
                      const existingConns = (
                        Array.isArray(sub.inboundsConfig)
                          ? sub.inboundsConfig
                          : []
                      ).filter(
                        (cfg) =>
                          !ROUTING_INBOUND_TYPES.has(String(cfg.type || '')),
                      ).length;
                      return (
                        <ListItemButton
                          key={sub.id}
                          onClick={() => toggleTargetSub(sub.id)}
                          dense
                        >
                          <ListItemIcon sx={{ minWidth: 34 }}>
                            <Checkbox
                              edge="start"
                              size="small"
                              checked={checked}
                              tabIndex={-1}
                              disableRipple
                            />
                          </ListItemIcon>
                          <ListItemText
                            primary={sub.name}
                            secondary={`Подключений: ${existingConns}/20${
                              alreadyCount > 0
                                ? ` · уже добавлено: ${alreadyCount}/${deployTargets.length}`
                                : ''
                            }`}
                          />
                        </ListItemButton>
                      );
                    })}
                  </List>
                </Paper>

                {targetSubIds.length > 1 && (
                  <Alert severity="info" sx={{ py: 0.5 }}>
                    При добавлении профиля в несколько подписок на одной ноде
                    автоматически используется <strong>один общий inbound</strong>{' '}
                    в 3x-ui с отдельным клиентом (UUID) для каждой подписки —
                    конфликта портов не будет.
                  </Alert>
                )}

                {hasFixedPortMultiSubWarning && (
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={useRandomPortOnMultiSub}
                        onChange={(e) =>
                          setUseRandomPortOnMultiSub(e.target.checked)
                        }
                      />
                    }
                    label="Создавать отдельные инбаунды на случайных портах (random) вместо одного общего"
                  />
                )}

                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={skipExistingInSub}
                      onChange={(e) => setSkipExistingInSub(e.target.checked)}
                    />
                  }
                  label="Пропускать уже добавленные в подписку профили (без дублей)"
                />

                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={rotateAfterAttach}
                      onChange={(e) => setRotateAfterAttach(e.target.checked)}
                    />
                  }
                  label="Сразу развернуть на нодах 3x-ui (запустить ротацию выбранных подписок)"
                />
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button
                onClick={() => setDeployTargets([])}
                disabled={attaching}
              >
                Отмена
              </Button>
              <Button
                variant="contained"
                disabled={attaching || targetSubIds.length === 0}
                onClick={() => void handleAttachToSubscriptions()}
              >
                {attaching
                  ? 'Применение…'
                  : `Добавить (${plannedAdditions})`}
              </Button>
            </DialogActions>
          </Dialog>
        );
      })()}

      {previewTarget && (
        <ProfilePreviewDialog
          open={Boolean(previewTarget)}
          onClose={() => setPreviewTarget(null)}
          kind={previewTarget.kind}
          name={previewTarget.name}
          nodeId={previewTarget.nodeId}
          port={previewTarget.port}
          sni={previewTarget.sni}
          settings={previewTarget.spec}
          initialTab={previewTarget.initialTab}
        />
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar((prev) => ({ ...prev, open: false }))}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
