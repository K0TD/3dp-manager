import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
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
} from '@mui/icons-material';
import api from '../api';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { ProfilePreviewDialog } from '../components/ProfilePreviewDialog';
import type { NodeRecord } from '../types/node';
import {
  FINGERPRINT_OPTIONS,
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
  sni: 'www.microsoft.com',
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
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<
    Record<string, ClientProbeResponse>
  >({});
  const [previewTarget, setPreviewTarget] =
    useState<ConnectionProfileRecord | null>(null);
  const [deployTarget, setDeployTarget] =
    useState<ConnectionProfileRecord | null>(null);
  const [targetSubId, setTargetSubId] = useState('');
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
      const [profilesRes, catalogRes, nodesRes, subsRes] = await Promise.all([
        api.get<ConnectionProfileRecord[]>('/profiles'),
        api.get<ProfileCatalogEntry[]>('/profiles/catalog'),
        api.get<NodeRecord[]>('/nodes'),
        api
          .get<SubscriptionBrief[]>('/subscriptions')
          .catch(() => ({ data: [] as SubscriptionBrief[] })),
      ]);
      setProfiles(Array.isArray(profilesRes.data) ? profilesRes.data : []);
      setCatalog(Array.isArray(catalogRes.data) ? catalogRes.data : []);
      setNodes(Array.isArray(nodesRes.data) ? nodesRes.data : []);
      setSubscriptions(Array.isArray(subsRes.data) ? subsRes.data : []);
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

  const openCreate = (kind: ManagedProfileKind = 'xhttp-stable') => {
    setEditingId(null);
    const defaultNodeId = nodes.find((n) => n.isMain)?.id || nodes[0]?.id || '';
    const next = defaultFormForKind(kind);
    next.nodeId = defaultNodeId;
    setForm(next);
    setDialogOpen(true);
  };

  const openEdit = (profile: ConnectionProfileRecord) => {
    setEditingId(profile.id);
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

  const openAttachDialog = (profile: ConnectionProfileRecord) => {
    setDeployTarget(profile);
    setTargetSubId(subscriptions[0]?.id || '');
    setRotateAfterAttach(true);
  };

  const handleAttachToSubscription = async () => {
    if (!deployTarget || !targetSubId) return;
    const sub = subscriptions.find((item) => item.id === targetSubId);
    if (!sub) return;

    setAttaching(true);
    try {
      const existingConfigs = Array.isArray(sub.inboundsConfig)
        ? sub.inboundsConfig
        : [];
      const domain =
        deployTarget.spec?.domain?.trim() || deployTarget.sni?.trim() || '';
      const isDirectFallback =
        deployTarget.kind === 'https-fallback' &&
        (deployTarget.spec?.reverseProxy ?? 'none') === 'none';
      const newInbound: Record<string, unknown> = {
        configId: crypto.randomUUID(),
        type: deployTarget.kind,
        port: deployTarget.port ?? 'random',
        nodeId: deployTarget.nodeId || undefined,
        name: deployTarget.name,
        enabled: true,
        profileId: deployTarget.id,
        profileSettings: {
          ...deployTarget.spec,
          rotationPolicy: deployTarget.rotationPolicy,
        },
      };
      if (deployTarget.kind === 'xhttp-stable') {
        newInbound.sni = deployTarget.sni || 'random';
      } else if (deployTarget.kind === 'self-sni') {
        newInbound.sni = domain || undefined;
      } else if (deployTarget.kind === 'https-fallback') {
        newInbound.tlsServerName = domain || undefined;
        if (isDirectFallback) {
          newInbound.certificateMode =
            deployTarget.spec?.certificateFile && deployTarget.spec?.keyFile
              ? 'custom'
              : 'node';
          if (newInbound.certificateMode === 'custom') {
            newInbound.certificateFile = deployTarget.spec.certificateFile;
            newInbound.keyFile = deployTarget.spec.keyFile;
          }
        }
      }

      await api.put(`/subscriptions/${sub.id}`, {
        name: sub.name,
        note: sub.note || '',
        supportUrl: sub.supportUrl || '',
        websiteUrl: sub.websiteUrl || '',
        isAutoRotationEnabled: sub.isAutoRotationEnabled ?? true,
        nodeId: sub.nodeId || undefined,
        relayServerId: sub.relayServerId || undefined,
        inboundsConfig: [...existingConfigs, newInbound],
      });

      if (rotateAfterAttach) {
        await api.post(`/rotation/rotate-one/${sub.id}`);
      }

      setDeployTarget(null);
      setSnackbar({
        open: true,
        severity: 'success',
        message: rotateAfterAttach
          ? `Профиль «${deployTarget.name}» добавлен в подписку «${sub.name}» и отправлен на развёртывание`
          : `Профиль «${deployTarget.name}» добавлен в подписку «${sub.name}»`,
      });
      await loadData();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string | string[] } } })
          ?.response?.data?.message ||
        'Не удалось добавить профиль в подписку';
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
          {profiles.map((profile) => {
            const isBusy = busyId === profile.id;
            const latestProbe = probeResults[profile.id];
            return (
              <Paper key={profile.id} variant="outlined" sx={{ p: 2.5 }}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                  gap={1.5}
                >
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
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      Нода: {nodeNameById(profile.nodeId)} · Порт:{' '}
                      {profile.port ?? 'random'} · Домен/SNI:{' '}
                      {profile.spec?.domain || profile.sni || 'random'} ·
                      Ротация: {profile.rotationPolicy}
                    </Typography>
                  </Stack>

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {!profile.deployed && (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<PlaylistAdd />}
                        disabled={isBusy || subscriptions.length === 0}
                        onClick={() => openAttachDialog(profile)}
                      >
                        В подписку
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
                      onClick={() => setPreviewTarget(profile)}
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
                  const next = defaultFormForKind(nextKind);
                  next.name = form.name;
                  next.nodeId = form.nodeId;
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
                onChange={(e) => setForm({ ...form, nodeId: e.target.value })}
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
                <TextField
                  size="small"
                  label="SNI (домен или random)"
                  value={form.sni}
                  onChange={(e) => setForm({ ...form, sni: e.target.value })}
                  fullWidth
                />
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
              </>
            ) : form.kind === 'self-sni' ? (
              <>
                <TextField
                  size="small"
                  label="Собственный домен"
                  placeholder="site.example.com"
                  value={form.spec.domain || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      sni: e.target.value,
                      spec: { ...form.spec, domain: e.target.value },
                    })
                  }
                  fullWidth
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
                    label="Локальный HTTPS-порт"
                    value={form.spec.localHttpsPort ?? 8443}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        spec: {
                          ...form.spec,
                          localHttpsPort: Number(e.target.value) || 8443,
                        },
                      })
                    }
                    fullWidth
                  />
                </Stack>
              </>
            ) : (
              <>
                <TextField
                  size="small"
                  label="Домен сертификата"
                  placeholder="fallback.example.com"
                  value={form.spec.domain || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      sni: e.target.value,
                      spec: { ...form.spec, domain: e.target.value },
                    })
                  }
                  fullWidth
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

      {deployTarget && (
        <Dialog
          open={Boolean(deployTarget)}
          onClose={() => setDeployTarget(null)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>Добавить профиль в подписку</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2} sx={{ mt: 0.5 }}>
              <Typography variant="body2" color="text.secondary">
                Профиль <strong>{deployTarget.name}</strong> ({deployTarget.kind}
                ) будет добавлен в выбранную подписку без удаления её текущих
                подключений.
              </Typography>
              <FormControl size="small" fullWidth>
                <InputLabel>Подписка</InputLabel>
                <Select
                  value={targetSubId}
                  label="Подписка"
                  onChange={(e) => setTargetSubId(e.target.value)}
                >
                  {subscriptions.map((sub) => (
                    <MenuItem key={sub.id} value={sub.id}>
                      {sub.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={rotateAfterAttach}
                    onChange={(e) => setRotateAfterAttach(e.target.checked)}
                  />
                }
                label="Сразу развернуть на ноде 3x-ui (запустить ротацию подписки)"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeployTarget(null)}>Отмена</Button>
            <Button
              variant="contained"
              disabled={attaching || !targetSubId}
              onClick={() => void handleAttachToSubscription()}
            >
              {attaching ? 'Применение…' : 'Добавить'}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {previewTarget && (
        <ProfilePreviewDialog
          open={Boolean(previewTarget)}
          onClose={() => setPreviewTarget(null)}
          kind={previewTarget.kind}
          name={previewTarget.name}
          nodeId={previewTarget.nodeId || undefined}
          port={previewTarget.port ? String(previewTarget.port) : 'random'}
          sni={previewTarget.sni || undefined}
          settings={previewTarget.spec}
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
