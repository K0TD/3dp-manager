import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Add,
  ContentCopy,
  Delete,
  Edit,
  Link as LinkIcon,
  MoreVert,
  OpenInNew,
  PauseCircleFilled,
  PlayCircleFilled,
  Refresh,
} from '@mui/icons-material';
import api from '../api';
import { copyToClipboard } from '../utils/copyToClipboard';
import { Logger } from '../utils/logger';
import type { NodeRecord } from '../types/node';
import { InboundsEditor } from '../components/InboundsEditor';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import { parseDefaultInboundsSetting } from '../utils/inboundUtils';

interface Subscription {
  id: string;
  name: string;
  uuid: string;
  inbounds: Array<{ protocol?: string; configId?: string; nodeId?: string; relayServerId?: number }>;
  inboundsConfig?: InboundConfigUI[];
  isAutoRotationEnabled?: boolean;
}

interface Tunnel {
  id: number;
  name: string;
  ip: string;
  domain: string;
  isInstalled: boolean;
  nodeId?: string;
}

interface InboundConfigUI {
  id: string;
  configId: string;
  type: string;
  port: string;
  sni: string;
  link?: string;
  nodeId?: string;
  relayServerId?: string;
  flag?: string;
  name?: string;
  certificateMode?: 'node' | 'custom';
  tlsServerName?: string;
  certificateFile?: string;
  keyFile?: string;
  enabled?: boolean;
  disabledReason?: string;
  awgLocked?: boolean;
}

interface Domain {
  id: number;
  name: string;
  isEnabled?: boolean;
}

interface CountryOption {
  name: string;
  code: string;
  emoji: string;
}

const CERTIFICATE_TYPES = new Set([
  'hysteria2-udp',
  'vless-tcp-tls',
  'vless-ws-tls',
  'vless-xhttp-tls',
]);

const getSubscriptionUrl = (uuid: string) => {
  const path = `/bus/${uuid}`;
  return typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
};

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [activeSub, setActiveSub] = useState<Subscription | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [inbounds, setInbounds] = useState<InboundConfigUI[]>([]);
  const [portErrors, setPortErrors] = useState<Record<string, string>>({});
  const [linksOpen, setLinksOpen] = useState(false);
  const [currentLinks, setCurrentLinks] = useState<string[]>([]);
  const [createdSubscriptionId, setCreatedSubscriptionId] = useState<string | null>(null);
  const [rotationLoading, setRotationLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [rotationSettings, setRotationSettings] = useState({
    rotation_interval: '30',
    rotation_status: 'active',
    last_rotation_timestamp: '',
  });
  const [defaultInboundsSetting, setDefaultInboundsSetting] = useState<string | undefined>();
  const [snackbar, setSnackbar] = useState({
    open: false,
    type: 'success' as 'success' | 'error',
    message: '',
  });
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    confirmText: 'Удалить',
    confirmColor: 'error' as 'error' | 'primary',
    onConfirm: () => {},
  });

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const openActionMenu = Boolean(menuAnchorEl);

  const loadSubs = useCallback(async () => {
    try {
      const [subsRes, tunnelsRes, nodesRes, domainsRes, countriesRes, settingsRes] =
        await Promise.all([
          api.get('/subscriptions'),
          api.get('/tunnels'),
          api.get<NodeRecord[]>('/nodes'),
          api.get('/domains/all'),
          api.get<CountryOption[]>('/settings/countries'),
          api.get('/settings'),
        ]);

      setSubs(Array.isArray(subsRes.data) ? subsRes.data : []);
      setTunnels(
        Array.isArray(tunnelsRes.data)
          ? tunnelsRes.data.filter((tunnel: Tunnel) => tunnel.isInstalled)
          : [],
      );
      setNodes(Array.isArray(nodesRes.data) ? nodesRes.data : []);
      setDomains(
        Array.isArray(domainsRes.data)
          ? domainsRes.data.filter((domain: Domain) => domain.isEnabled !== false)
          : [],
      );
      setCountries(Array.isArray(countriesRes.data) ? countriesRes.data : []);
      setRotationSettings((prev) => ({ ...prev, ...settingsRes.data }));
      setDefaultInboundsSetting(settingsRes.data?.default_inbounds);
    } catch (error) {
      Logger.error('Failed to load subscriptions data', 'Subs', error);
      throw error;
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubs();
  }, [loadSubs]);

  const getDefaultNodeId = () =>
    nodes.find((node) => node.isMain)?.id || nodes[0]?.id || '';

  const getNodeAddress = (nodeId?: string) => {
    const node = nodes.find((item) => item.id === (nodeId || getDefaultNodeId()));
    if (!node) return '';
    if (node.domain) return node.domain;
    if (node.ip) return node.ip;
    if (node.host) return node.host;
    try {
      return new URL(node.url).hostname;
    } catch {
      return node.url;
    }
  };

  const getNodeFlag = (nodeId?: string) =>
    nodes.find((node) => node.id === (nodeId || getDefaultNodeId()))?.flag || '';

  const hasSni = (type: string) =>
    !CERTIFICATE_TYPES.has(type) && type !== 'amneziawg';

  const isListedSni = (sni: string) => {
    const normalizedSni = sni.trim().toLowerCase();
    return (
      normalizedSni === 'random' ||
      domains.some((domain) => domain.name.toLowerCase() === normalizedSni)
    );
  };

  const inboundSni = (type: string, savedSni?: string) => {
    if (!hasSni(type)) return '';
    const configuredSni = savedSni?.trim() || 'random';
    return type === 'mtproto-faketls' && !isListedSni(configuredSni)
      ? 'random'
      : configuredSni;
  };

  const getSelectedNode = (nodeId?: string) =>
    nodes.find((node) => node.id === (nodeId || getDefaultNodeId()));

  const isInboundSupported = (type: string, nodeId?: string) => {
    if (type === 'custom') return true;
    const capabilities = getSelectedNode(nodeId)?.capabilities;
    return !capabilities || capabilities.supportedInboundTypes.includes(type);
  };

  const isValidPort = (value: string) =>
    value === 'random' || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535);

  const createInbound = (type = 'vless-tcp-reality'): InboundConfigUI => {
    const nodeId = getDefaultNodeId();
    const configId = crypto.randomUUID();
    return {
      id: configId,
      configId,
      type,
      port: 'random',
      sni: inboundSni(type),
      link: '',
      nodeId,
      flag: getNodeFlag(nodeId),
      name: '',
      certificateMode: CERTIFICATE_TYPES.has(type) ? 'node' : undefined,
      tlsServerName: CERTIFICATE_TYPES.has(type) ? getNodeAddress(nodeId) : undefined,
      certificateFile: '',
      keyFile: '',
    };
  };

  const handleOpenCreate = () => {
    if (nodes.length === 0) {
      setSnackbar({ open: true, type: 'error', message: 'Создайте хотя бы одну ноду!' });
      return;
    }
    if (domains.length === 0) {
      setSnackbar({ open: true, type: 'error', message: 'Создайте хотя бы один домен!' });
      return;
    }

    setEditingId(null);
    setName('');
    const parsedDefaults = parseDefaultInboundsSetting(
      defaultInboundsSetting,
      nodes,
      domains,
    );
    if (parsedDefaults && parsedDefaults.length > 0) {
      setInbounds(parsedDefaults);
    } else {
      setInbounds([
        createInbound('hysteria2-udp'),
        createInbound('vless-xhttp-reality'),
        createInbound('vless-tcp-tls'),
        createInbound('vless-tcp-reality'),
        createInbound('vless-grpc-reality'),
      ]);
    }
    setPortErrors({});
    setOpen(true);
  };

  const handleOpenEdit = (sub: Subscription) => {
    setEditingId(sub.id);
    setName(sub.name);
    setInbounds(
      (sub.inboundsConfig || []).map((item) => {
        const activeAwg = sub.inbounds?.find((inbound) => inbound.protocol === 'amneziawg' && inbound.configId === item.configId);
        const nodeId = item.nodeId || activeAwg?.nodeId || getDefaultNodeId();
        const certificateMode =
          item.certificateMode === 'custom' ? 'custom' : 'node';
        const configId = item.configId || crypto.randomUUID();
        return {
          id: configId,
          configId,
          awgLocked: Boolean(activeAwg),
          type: item.type || 'vless-tcp-reality',
          port: item.port ? item.port.toString() : 'random',
          sni: inboundSni(item.type || '', item.sni),
          link: item.link || '',
          nodeId,
          relayServerId: item.relayServerId ? item.relayServerId.toString() : '',
          flag: item.flag || getNodeFlag(nodeId),
          name: item.name || '',
          enabled: item.enabled,
          disabledReason: item.disabledReason,
          certificateMode: CERTIFICATE_TYPES.has(item.type)
            ? certificateMode
            : undefined,
          tlsServerName: CERTIFICATE_TYPES.has(item.type)
            ? item.tlsServerName ||
              (item.sni && item.sni !== 'random' ? item.sni : getNodeAddress(nodeId))
            : undefined,
          certificateFile:
            CERTIFICATE_TYPES.has(item.type) && certificateMode === 'custom'
              ? item.certificateFile || ''
              : '',
          keyFile:
            CERTIFICATE_TYPES.has(item.type) && certificateMode === 'custom'
              ? item.keyFile || ''
              : '',
        };
      }),
    );
    setPortErrors({});
    setOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    const nextPortErrors = inbounds.reduce<Record<string, string>>((acc, inbound) => {
      if (inbound.type !== 'custom' && !isValidPort(inbound.port)) {
        acc[inbound.id] = 'Порт: число 1-65535 или random';
      }
      return acc;
    }, {});
    setPortErrors(nextPortErrors);

    if (Object.keys(nextPortErrors).length > 0) {
      setSnackbar({
        open: true,
        type: 'error',
        message: 'Пожалуйста, исправьте ошибки с портами',
      });
      return;
    }
    if (!name.trim()) {
      setSnackbar({ open: true, type: 'error', message: 'Введите имя подписки' });
      return;
    }
    if (
      inbounds.some(
        (inbound) =>
          inbound.type === 'mtproto-faketls' &&
          !isListedSni(inbound.sni),
      )
    ) {
      setSnackbar({
        open: true,
        type: 'error',
        message: 'Выберите FakeTLS-домен из списка SNI',
      });
      return;
    }
    const invalidTls = inbounds.find(
      (inbound) =>
        CERTIFICATE_TYPES.has(inbound.type) &&
        (inbound.certificateMode === 'custom'
          ? !inbound.tlsServerName?.trim() ||
            !inbound.certificateFile?.trim() ||
            !inbound.keyFile?.trim()
          : getSelectedNode(inbound.nodeId)?.capabilities?.autoTlsCertificate === false),
    );
    if (invalidTls) {
      setSnackbar({
        open: true,
        type: 'error',
        message:
          invalidTls.certificateMode === 'custom'
            ? 'Для собственного TLS укажите имя сервера, сертификат и приватный ключ'
            : 'Выбранная нода не предоставила пути сертификата панели; выберите собственный TLS',
      });
      return;
    }
    const incompatibleInbound = inbounds.find(
      (inbound) => !isInboundSupported(inbound.type, inbound.nodeId),
    );
    if (incompatibleInbound) {
      setSnackbar({
        open: true,
        type: 'error',
        message: `${incompatibleInbound.type} не поддерживается выбранной нодой`,
      });
      return;
    }

    const payload = {
      name,
      inboundsConfig: inbounds.map((inbound) =>
        inbound.type === 'custom'
          ? {
              configId: inbound.configId,
              type: inbound.type,
              link: inbound.link,
              enabled: true,
            }
          : {
              configId: inbound.configId,
              type: inbound.type,
              port: inbound.port === 'random' ? 'random' : parseInt(inbound.port, 10),
              sni: hasSni(inbound.type) ? inbound.sni : undefined,
              nodeId: inbound.nodeId || undefined,
              relayServerId: inbound.relayServerId
                ? parseInt(inbound.relayServerId, 10)
                : undefined,
              flag: inbound.flag || getNodeFlag(inbound.nodeId) || undefined,
              name: inbound.name?.trim() || undefined,
              enabled: true,
              certificateMode: CERTIFICATE_TYPES.has(inbound.type)
                ? inbound.certificateMode || 'node'
                : undefined,
              tlsServerName: CERTIFICATE_TYPES.has(inbound.type)
                ? inbound.tlsServerName?.trim() || undefined
                : undefined,
              certificateFile:
                CERTIFICATE_TYPES.has(inbound.type) && inbound.certificateMode === 'custom'
                  ? inbound.certificateFile?.trim() || undefined
                  : undefined,
              keyFile:
                CERTIFICATE_TYPES.has(inbound.type) && inbound.certificateMode === 'custom'
                  ? inbound.keyFile?.trim() || undefined
                  : undefined,
            },
      ),
    };

    setSaving(true);
    try {
      let awgProvisioning: { status: string; message?: string } | undefined;
      if (editingId) {
        const res = await api.put(`/subscriptions/${editingId}`, payload);
        awgProvisioning = res.data?.awgProvisioning;
      } else {
        const res = await api.post<{ id?: string; awgProvisioning?: { status: string; message?: string } }>('/subscriptions', payload);
        setCreatedSubscriptionId(inbounds.some((inbound) => inbound.type !== 'amneziawg') ? res.data?.id || null : null);
        awgProvisioning = res.data?.awgProvisioning;
      }
      setOpen(false);
      loadSubs();
      setSnackbar({
        open: true,
        type: awgProvisioning?.status === 'failed' ? 'error' : 'success',
        message: awgProvisioning?.status === 'failed'
          ? `Настройки сохранены, но создание AWG не завершено: ${awgProvisioning.message || ''} Повторите сохранение подписки.`
          : editingId ? 'Подписка обновлена' : 'Подписка создана',
      });
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Произошла ошибка при сохранении';
      setSnackbar({ open: true, type: 'error', message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    setConfirmDialog({
      open: true,
      title: 'Удалить подписку и все соединения?',
      confirmText: 'Удалить',
      confirmColor: 'error',
      onConfirm: async () => {
        await api.delete(`/subscriptions/${id}`);
        loadSubs();
        setSnackbar({ open: true, type: 'success', message: 'Подписка удалена' });
      },
    });
  };

  const handleToggleAutoRotation = async (subscriptionId: string, enabled: boolean) => {
    try {
      await api.put('/subscriptions/bulk-auto-rotation', {
        subscriptionIds: [subscriptionId],
        enabled,
      });
      setSubs((prev) =>
        prev.map((sub) =>
          sub.id === subscriptionId ? { ...sub, isAutoRotationEnabled: enabled } : sub,
        ),
      );
      setSnackbar({
        open: true,
        type: 'success',
        message: enabled ? 'Авторотация включена' : 'Авторотация выключена',
      });
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Ошибка обновления';
      setSnackbar({ open: true, type: 'error', message });
      loadSubs();
    }
  };

  const handleManualRotate = (sub: Subscription) => {
    setConfirmDialog({
      open: true,
      title: `Обновить подписку "${sub.name}" сейчас?`,
      confirmText: 'Обновить',
      confirmColor: 'primary',
      onConfirm: async () => {
        const res = await api.post(`/rotation/rotate-one/${sub.id}`);
        setSnackbar({
          open: true,
          type: 'success',
          message: `Обновление поставлено в очередь · ${String(res.data?.id || '').slice(0, 8)}`,
        });
        loadSubs();
      },
    });
  };

  const saveRotationSettings = async (nextSettings = rotationSettings) => {
    await api.post('/settings', nextSettings);
    setRotationSettings(nextSettings);
  };

  const toggleRotationService = async () => {
    const nextStatus = rotationSettings.rotation_status === 'stopped' ? 'active' : 'stopped';
    const nextSettings = { ...rotationSettings, rotation_status: nextStatus };
    await saveRotationSettings(nextSettings);
    setSnackbar({
      open: true,
      type: 'success',
      message: nextStatus === 'active' ? 'Ротация включена' : 'Ротация остановлена',
    });
  };

  const saveRotationInterval = async () => {
    const interval = parseInt(rotationSettings.rotation_interval, 10);
    if (Number.isNaN(interval) || interval < 10) {
      setSnackbar({
        open: true,
        type: 'error',
        message: 'Минимальный интервал ротации - 10 минут',
      });
      return;
    }
    await saveRotationSettings(rotationSettings);
    setSnackbar({ open: true, type: 'success', message: 'Интервал ротации сохранен' });
  };

  const rotateAllNow = () => {
    setConfirmDialog({
      open: true,
      title: 'Сгенерировать инбаунды сейчас для всех активных подписок?',
      confirmText: 'Сгенерировать',
      confirmColor: 'primary',
      onConfirm: async () => {
        try {
          setRotationLoading(true);
          const { data } = await api.post('/rotation/rotate-all');
          setSnackbar({
            open: true,
            type: 'success',
            message: `Обновление всех подписок поставлено в очередь · ${String(data?.id || '').slice(0, 8)}`,
          });
          loadSubs();
        } finally {
          setRotationLoading(false);
        }
      },
    });
  };

  const formatRotationDate = (value: string) => {
    if (!value) return 'Нет данных';
    return new Date(Number(value)).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getNextRotationDate = () => {
    if (rotationSettings.rotation_status === 'stopped') return 'Пауза';
    if (!rotationSettings.last_rotation_timestamp) return 'Ожидание';
    const interval = parseInt(rotationSettings.rotation_interval, 10) || 30;
    return new Date(Number(rotationSettings.last_rotation_timestamp) + interval * 60000).toLocaleString(
      'ru-RU',
      { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    );
  };

  const showLinks = (sub: Subscription) => {
    const links = sub.inbounds?.map((item) => (item as { link?: string }).link)
      .filter((link): link is string => Boolean(link)) || [];
    setCurrentLinks(links.length ? links : ['Нет активных ссылок (ждите ротации)']);
    setLinksOpen(true);
  };

  const handleCopyLink = async (uuid: string) => {
    await copyToClipboard(getSubscriptionUrl(uuid));
    setSnackbar({ open: true, type: 'success', message: 'Ссылка на подписку скопирована' });
  };

  const handleGenerateCreatedSubscription = async () => {
    if (!createdSubscriptionId) return;
    const res = await api.post(`/rotation/rotate-one/${createdSubscriptionId}`);
    setSnackbar({
      open: true,
      type: 'success',
      message: `Первая генерация поставлена в очередь · ${String(res.data?.id || '').slice(0, 8)}`,
    });
    setCreatedSubscriptionId(null);
    loadSubs();
  };

  const openActionMenuFor = (event: React.MouseEvent<HTMLButtonElement>, sub: Subscription) => {
    setMenuAnchorEl(event.currentTarget);
    setActiveSub(sub);
  };

  const closeActionMenu = () => {
    setMenuAnchorEl(null);
    setActiveSub(null);
  };

  return (
    <Box className="workspace-page">
      <WorkspaceHeader
        eyebrow="КОНТУР ПОДКЛЮЧЕНИЙ"
        title="Подписки"
        description="Подключения, ссылки и ротация в одном месте."
        meta={<Chip size="small" variant="outlined" label={`Подписок: ${subs.length}`} />}
        action={<Button variant="contained" startIcon={<Add />} onClick={handleOpenCreate} disabled={dataLoading}>{dataLoading ? 'Загрузка…' : 'Создать'}</Button>}
      />

      <Paper className="workspace-panel workspace-toolbar" sx={{ mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">Статус ротации</Typography>
            <Chip
              icon={rotationSettings.rotation_status === 'stopped' ? <PauseCircleFilled /> : <PlayCircleFilled />}
              label={rotationSettings.rotation_status === 'stopped' ? 'Остановлена' : 'Активна'}
              color={rotationSettings.rotation_status === 'stopped' ? 'warning' : 'success'}
              size="small"
              variant="outlined"
              sx={{ mt: 1 }}
            />
          </Box>
          <Tooltip title={rotationSettings.rotation_status === 'stopped' ? 'Возобновить ротацию' : 'Поставить на паузу'}>
            <IconButton onClick={toggleRotationService} size="small" aria-label={rotationSettings.rotation_status === 'stopped' ? 'Возобновить ротацию' : 'Поставить ротацию на паузу'}>
              {rotationSettings.rotation_status === 'stopped' ? <PlayCircleFilled fontSize="large" /> : <PauseCircleFilled fontSize="large" />}
            </IconButton>
          </Tooltip>
          <Divider flexItem orientation={isMobile ? 'horizontal' : 'vertical'} />
          <Box>
            <Typography variant="subtitle2" color="text.secondary">Последняя генерация</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>{formatRotationDate(rotationSettings.last_rotation_timestamp)}</Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">Следующая генерация</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>{getNextRotationDate()}</Typography>
          </Box>
          <TextField
            label="Интервал, мин"
            type="number"
            size="small"
            value={rotationSettings.rotation_interval}
            onChange={(e) => setRotationSettings((prev) => ({ ...prev, rotation_interval: e.target.value }))}
            sx={{ width: { xs: '100%', md: 150 } }}
          />
          <Box sx={{ flexGrow: 1 }} />
          <Button variant="outlined" onClick={saveRotationInterval}>Сохранить интервал</Button>
          <Button variant="contained" disabled={rotationLoading} onClick={rotateAllNow}>Обновить все</Button>
        </Stack>
      </Paper>

      <Paper className="workspace-panel workspace-table" sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 760 }}>
          <TableHead>
            <TableRow>
              <TableCell>Имя</TableCell>
              <TableCell>UUID</TableCell>
              <TableCell>Инбаунды</TableCell>
              <TableCell>Авторотация</TableCell>
              <TableCell align="right">Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {subs.map((sub) => (
              <TableRow key={sub.id}>
                <TableCell sx={{ fontWeight: 700 }}>{sub.name}</TableCell>
                <TableCell><Typography variant="body2" noWrap title={sub.uuid} sx={{ fontFamily: 'monospace', maxWidth: 260 }}>{sub.uuid}</Typography></TableCell>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <span>{sub.inbounds?.length || 0}</span>
                    {sub.inboundsConfig?.some((c) => c.enabled === false) && (
                      <Tooltip
                        title={`Отключены конфигурации: ${sub.inboundsConfig
                          .filter((c) => c.enabled === false)
                          .map((c) => c.disabledReason || 'нода удалена')
                          .join('; ')}`}
                      >
                        <Chip size="small" color="warning" label="Отключены" />
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
                <TableCell>
                  <Checkbox
                    inputProps={{ 'aria-label': `Авторотация ${sub.name}` }}
                    checked={sub.isAutoRotationEnabled ?? true}
                    onChange={(e) => handleToggleAutoRotation(sub.id, e.target.checked)}
                    color="primary"
                  />
                </TableCell>
                <TableCell align="right">
                  {!isMobile && (
                    <>
                      <IconButton color="primary" onClick={() => handleCopyLink(sub.uuid)} title="Копировать ссылку" aria-label={`Копировать ссылку ${sub.name}`}>
                        <ContentCopy />
                      </IconButton>
                      <IconButton color="primary" onClick={() => window.open(getSubscriptionUrl(sub.uuid), '_blank')} title="Открыть подписку" aria-label={`Открыть подписку ${sub.name}`}>
                        <OpenInNew />
                      </IconButton>
                    </>
                  )}
                  <IconButton aria-label={`Действия с подпиской ${sub.name}`} onClick={(e) => openActionMenuFor(e, sub)}><MoreVert /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {subs.length === 0 && (
          <Typography sx={{ p: 2 }} color="textSecondary" textAlign="center">
            Нет подписок
          </Typography>
        )}
      </Paper>

      <Menu anchorEl={menuAnchorEl} open={openActionMenu} onClose={closeActionMenu}>
        {isMobile && activeSub && <MenuItem onClick={() => handleCopyLink(activeSub.uuid)}><ListItemIcon><ContentCopy fontSize="small" color="primary" /></ListItemIcon><ListItemText>Копировать ссылку</ListItemText></MenuItem>}
        {isMobile && activeSub && <MenuItem onClick={() => window.open(getSubscriptionUrl(activeSub.uuid), '_blank')}><ListItemIcon><OpenInNew fontSize="small" color="primary" /></ListItemIcon><ListItemText>Открыть подписку</ListItemText></MenuItem>}
        {activeSub && <MenuItem onClick={() => showLinks(activeSub)}><ListItemIcon><LinkIcon fontSize="small" /></ListItemIcon><ListItemText>Показать конфиги</ListItemText></MenuItem>}
        {activeSub && <MenuItem onClick={() => handleManualRotate(activeSub)}><ListItemIcon><Refresh fontSize="small" color="primary" /></ListItemIcon><ListItemText>Обновить сейчас</ListItemText></MenuItem>}
        {activeSub && <MenuItem onClick={() => handleOpenEdit(activeSub)}><ListItemIcon><Edit fontSize="small" /></ListItemIcon><ListItemText>Редактировать</ListItemText></MenuItem>}
        {activeSub && <MenuItem onClick={() => handleDelete(activeSub.id)}><ListItemIcon><Delete fontSize="small" color="error" /></ListItemIcon><ListItemText sx={{ color: 'error.main' }}>Удалить</ListItemText></MenuItem>}
      </Menu>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth disableRestoreFocus>
        <DialogTitle variant="h5">{editingId ? 'Редактировать подписку' : 'Новая подписка'}</DialogTitle>
        <DialogContent dividers sx={{ maxHeight: '72vh' }}>
          <TextField autoFocus margin="dense" label="Имя подписки" fullWidth value={name} onChange={(e) => setName(e.target.value)} sx={{ mb: 2 }} />
          {inbounds.some((i) => i.enabled === false || i.disabledReason) && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Внимание: некоторые конфигурации были отключены (удалена нода). При сохранении подписки они будут автоматически активированы на выбранных нодах.
            </Alert>
          )}
          <InboundsEditor
            inbounds={inbounds}
            onChange={setInbounds}
            nodes={nodes}
            tunnels={tunnels}
            domains={domains}
            countries={countries}
            portErrors={portErrors}
            onPortErrorsChange={setPortErrors}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving} variant="contained" color="primary">{saving ? 'Сохранение…' : 'Сохранить'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={linksOpen} onClose={() => setLinksOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Активные ссылки</DialogTitle>
        <DialogContent>
          <TextField multiline fullWidth rows={10} value={currentLinks.join('\n\n')} slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: 12 } } }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => copyToClipboard(currentLinks.join('\n'))}>Копировать все</Button>
          <Button onClick={() => setLinksOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog({ ...confirmDialog, open: false })}>
        <DialogTitle>Подтверждение</DialogTitle>
        <DialogContent><Typography>{confirmDialog.title}</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}>Отмена</Button>
          <Button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog({ ...confirmDialog, open: false }); }} variant="contained" color={confirmDialog.confirmColor}>
            {confirmDialog.confirmText}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={createdSubscriptionId !== null} onClose={() => setCreatedSubscriptionId(null)}>
        <DialogTitle>Подписка создана</DialogTitle>
        <DialogContent><Typography>Сгенерировать подключения сейчас?</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setCreatedSubscriptionId(null)}>Нет</Button>
          <Button onClick={handleGenerateCreatedSubscription} variant="contained">Да</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={6000} onClose={() => setSnackbar({ ...snackbar, open: false })} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert onClose={() => setSnackbar({ ...snackbar, open: false })} severity={snackbar.type} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
