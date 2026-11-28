import { useCallback, useEffect, useRef, useState } from 'react';
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
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
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
  ArrowDownward,
  ArrowUpward,
  ContentCopy,
  Delete,
  Edit,
  Link as LinkIcon,
  MoreVert,
  OpenInNew,
  PauseCircleFilled,
  PlayCircleFilled,
  PlaylistAdd,
  Refresh,
} from '@mui/icons-material';
import api from '../api';
import { copyToClipboard } from '../utils/copyToClipboard';
import { Logger } from '../utils/logger';
import type { NodeRecord } from '../types/node';
import { InboundsEditor } from '../components/InboundsEditor';
import { WorkspaceHeader } from '../components/WorkspaceHeader';
import {
  createDefaultHttpsFallbackSettings,
  createDefaultSelfSniSettings,
  createDefaultXhttpStableSettings,
  hasSni,
  isInboundSupported,
  parseDefaultInboundsSetting,
  requiresPanelTlsCertificate,
  validateHttpsFallbackSettings,
  validateRoutingProfile,
  validateSelfSniSettings,
  validateSubscriptionMetadata,
  validateXhttpStableSettings,
} from '../utils/inboundUtils';
import {
  CERTIFICATE_TYPES,
  MANAGED_PROFILE_TYPES,
  PERSISTENT_INBOUND_TYPES,
  ROUTING_INBOUND_TYPES,
  type InboundConfigUI,
  type ManagedProfileKind,
  type ManagedProfileSettings,
  type ProfileRotationPolicy,
} from '../types/inbound';

interface Subscription {
  id: string;
  name: string;
  uuid: string;
  clientId?: string | null;
  clientAutoCreate?: boolean;
  clientUsage?: {
    upload: number;
    download: number;
    total: number;
    expire: number;
  } | null;
  note?: string;
  supportUrl?: string;
  websiteUrl?: string;
  nodeId?: string | null;
  inbounds: Array<{
    protocol?: string;
    configId?: string;
    nodeId?: string;
    relayServerId?: number;
    link?: string;
    connection?: {
      type: string;
      host: string;
      port: number;
      username: string;
      password: string;
    };
    wireguardConfig?: string;
  }>;
  inboundsConfig?: InboundConfigUI[];
  isAutoRotationEnabled?: boolean;
  isEnabled?: boolean;
}

interface Tunnel {
  id: number;
  name: string;
  ip: string;
  domain: string;
  isInstalled: boolean;
  nodeId?: string;
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

interface SavedProfileOption {
  id: string;
  name: string;
  kind: ManagedProfileKind;
  flag?: string | null;
  configId?: string | null;
  subscriptionId?: string | null;
  nodeId?: string | null;
  port?: number | null;
  sni?: string | null;
  rotationPolicy?: ProfileRotationPolicy;
  spec?: ManagedProfileSettings;
}

const getSubscriptionUrl = (uuid: string) => {
  const path = `/bus/${uuid}`;
  return typeof window !== 'undefined'
    ? `${window.location.origin}${path}`
    : path;
};

export default function SubscriptionsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);
  const listRevision = useRef(0);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [savedProfiles, setSavedProfiles] = useState<SavedProfileOption[]>([]);
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);
  const [pickedProfileIds, setPickedProfileIds] = useState<string[]>([]);
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [activeSub, setActiveSub] = useState<Subscription | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientAutoCreate, setClientAutoCreate] = useState(false);
  const [note, setNote] = useState('');
  const [supportUrl, setSupportUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [metadataErrors, setMetadataErrors] = useState<{
    note?: string;
    supportUrl?: string;
    websiteUrl?: string;
  }>({});
  const [inbounds, setInbounds] = useState<InboundConfigUI[]>([]);
  const [portErrors, setPortErrors] = useState<Record<string, string>>({});
  const [linksOpen, setLinksOpen] = useState(false);
  const [linksSubUuid, setLinksSubUuid] = useState<string | null>(null);
  const [currentLinks, setCurrentLinks] = useState<string[]>([]);
  const [createdSubscriptionId, setCreatedSubscriptionId] = useState<
    string | null
  >(null);
  const [rotationLoading, setRotationLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [rotationSettings, setRotationSettings] = useState({
    rotation_interval: '30',
    rotation_status: 'active',
    last_rotation_timestamp: '',
  });
  const [defaultInboundsSetting, setDefaultInboundsSetting] = useState<
    string | undefined
  >();
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
  const [deleteFailure, setDeleteFailure] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const openActionMenu = Boolean(menuAnchorEl);

  const loadSubs = useCallback(async () => {
    const revision = ++listRevision.current;
    try {
      const [
        subsRes,
        tunnelsRes,
        nodesRes,
        domainsRes,
        countriesRes,
        settingsRes,
        profilesRes,
      ] = await Promise.all([
        api.get('/subscriptions'),
        api.get('/tunnels'),
        api.get<NodeRecord[]>('/nodes'),
        api.get('/domains/all'),
        api.get<CountryOption[]>('/settings/countries'),
        api.get('/settings'),
        api
          .get<SavedProfileOption[]>('/profiles')
          .catch(() => ({ data: [] as SavedProfileOption[] })),
      ]);

      if (revision === listRevision.current) {
        const loadedSubs: Subscription[] = Array.isArray(subsRes.data)
          ? subsRes.data
          : [];
        setSubs(loadedSubs);
        const selectable = new Set(
          loadedSubs.filter((sub) => sub.isEnabled !== false).map((sub) => sub.id),
        );
        setSelectedIds((ids) => ids.filter((id) => selectable.has(id)));
      }
      setTunnels(
        Array.isArray(tunnelsRes.data)
          ? tunnelsRes.data.filter((tunnel: Tunnel) => tunnel.isInstalled)
          : [],
      );
      setNodes(Array.isArray(nodesRes.data) ? nodesRes.data : []);
      setDomains(
        Array.isArray(domainsRes.data)
          ? domainsRes.data.filter(
              (domain: Domain) => domain.isEnabled !== false,
            )
          : [],
      );
      setCountries(Array.isArray(countriesRes.data) ? countriesRes.data : []);
      setRotationSettings((prev) => ({ ...prev, ...settingsRes.data }));
      setDefaultInboundsSetting(settingsRes.data?.default_inbounds);
      setSavedProfiles(Array.isArray(profilesRes.data) ? profilesRes.data : []);
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
    const node = nodes.find(
      (item) => item.id === (nodeId || getDefaultNodeId()),
    );
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
    nodes.find((node) => node.id === (nodeId || getDefaultNodeId()))?.flag ||
    '';

  const getLinkedProfile = (inbound: InboundConfigUI) => {
    if (inbound.profileId) {
      return savedProfiles.find(
        (profile) => profile.id === inbound.profileId && profile.kind === inbound.type,
      );
    }
    if (!inbound.configId) return undefined;
    return savedProfiles
      .filter((profile) =>
        profile.configId === inbound.configId &&
        profile.kind === inbound.type &&
        (!profile.subscriptionId || profile.subscriptionId === editingId),
      )
      .sort((left, right) =>
        Number(Boolean(right.subscriptionId)) - Number(Boolean(left.subscriptionId)) ||
        left.id.localeCompare(right.id),
      )[0];
  };

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

  const isValidPort = (value: string) =>
    value === 'random' ||
    (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535);

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
      flag: MANAGED_PROFILE_TYPES.has(type) ? '' : getNodeFlag(nodeId),
      name: '',
      certificateMode: CERTIFICATE_TYPES.has(type) ? 'node' : undefined,
      tlsServerName: CERTIFICATE_TYPES.has(type)
        ? getNodeAddress(nodeId)
        : undefined,
      certificateFile: '',
      keyFile: '',
    };
  };

  const handleOpenCreate = () => {
    setEditingId(null);
    setName('');
    setClientId('');
    setClientAutoCreate(false);
    setNote('');
    setSupportUrl('');
    setWebsiteUrl('');
    setMetadataErrors({});
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
    setClientId(sub.clientId || '');
    setClientAutoCreate(Boolean(sub.clientAutoCreate));
    setNote(sub.note || '');
    setSupportUrl(sub.supportUrl || '');
    setWebsiteUrl(sub.websiteUrl || '');
    setMetadataErrors({});
    setInbounds(
      (sub.inboundsConfig || []).map((item) => {
        const activePersistent = sub.inbounds?.find(
          (inbound) =>
            PERSISTENT_INBOUND_TYPES.has(inbound.protocol || '') &&
            inbound.configId === item.configId,
        );
        const persistentNodeExists = activePersistent?.nodeId
          ? nodes.some((n) => n.id === activePersistent.nodeId)
          : false;
        const persistentLocked = Boolean(
          activePersistent && persistentNodeExists,
        );

        let nodeId = '';
        let flag = item.flag || '';
        let name = item.name || '';
        let relayServerId = item.relayServerId
          ? item.relayServerId.toString()
          : '';

        if (item.nodeId) {
          const itemNodeExists = nodes.some((n) => n.id === item.nodeId);
          if (itemNodeExists) {
            nodeId = item.nodeId;
            if (!flag && !MANAGED_PROFILE_TYPES.has(item.type)) {
              flag = getNodeFlag(nodeId);
            }
          } else {
            nodeId = '';
            flag = '';
            name = '';
            relayServerId = '';
          }
        } else if (persistentLocked && activePersistent?.nodeId) {
          nodeId = activePersistent.nodeId;
          if (!flag) {
            flag = getNodeFlag(nodeId);
          }
        } else {
          nodeId = '';
        }

        const certificateMode =
          item.certificateMode === 'custom' ? 'custom' : 'node';
        const configId = item.configId || crypto.randomUUID();
        return {
          id: configId,
          configId,
          persistentLocked,
          type: item.type || 'vless-tcp-reality',
          port: item.port ? item.port.toString() : 'random',
          sni: inboundSni(item.type || '', item.sni),
          link: item.link || '',
          routingProfile: item.routingProfile || '',
          nodeId,
          relayServerId,
          flag,
          name,
          enabled: item.enabled,
          disabledReason: item.disabledReason,
          certificateMode: CERTIFICATE_TYPES.has(item.type)
            ? certificateMode
            : undefined,
          tlsServerName: CERTIFICATE_TYPES.has(item.type)
            ? item.tlsServerName ||
              (item.sni && item.sni !== 'random'
                ? item.sni
                : getNodeAddress(nodeId))
            : undefined,
          certificateFile:
            CERTIFICATE_TYPES.has(item.type) && certificateMode === 'custom'
              ? item.certificateFile || ''
              : '',
          keyFile:
            CERTIFICATE_TYPES.has(item.type) && certificateMode === 'custom'
              ? item.keyFile || ''
              : '',
          profileId: item.profileId,
          profileSettings:
            item.type === 'xhttp-stable'
              ? { ...createDefaultXhttpStableSettings(), ...item.profileSettings }
              : item.type === 'self-sni'
                ? {
                    ...createDefaultSelfSniSettings(
                      item.profileSettings?.domain ||
                        (item.sni && item.sni !== 'random' ? item.sni : ''),
                    ),
                    ...item.profileSettings,
                  }
                : item.type === 'https-fallback'
                  ? {
                      ...createDefaultHttpsFallbackSettings(
                        item.profileSettings?.domain ||
                          item.tlsServerName ||
                          '',
                      ),
                      ...item.profileSettings,
                    }
                  : item.profileSettings,
        };
      }),
    );
    setPortErrors({});
    setOpen(true);
  };

  const handleSave = async () => {
    if (saving) return;
    const nextPortErrors = inbounds.reduce<Record<string, string>>(
      (acc, inbound) => {
        if (
          inbound.type !== 'custom' &&
          !ROUTING_INBOUND_TYPES.has(inbound.type) &&
          !isValidPort(inbound.port)
        ) {
          acc[inbound.id] = 'Порт: число 1-65535 или random';
        }
        return acc;
      },
      {},
    );
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
      setSnackbar({
        open: true,
        type: 'error',
        message: 'Введите имя подписки',
      });
      return;
    }
    const metaErrors = validateSubscriptionMetadata({
      note,
      supportUrl,
      websiteUrl,
    });
    if (Object.keys(metaErrors).length > 0) {
      setMetadataErrors(metaErrors);
      setSnackbar({
        open: true,
        type: 'error',
        message: Object.values(metaErrors)[0],
      });
      return;
    }
    const invalidRouting = inbounds.find(
      (inbound) =>
        ROUTING_INBOUND_TYPES.has(inbound.type) &&
        validateRoutingProfile(inbound.type, inbound.routingProfile),
    );
    if (invalidRouting) {
      setSnackbar({
        open: true,
        type: 'error',
        message:
          validateRoutingProfile(
            invalidRouting.type,
            invalidRouting.routingProfile,
          ) || 'Неверный профиль маршрутизации',
      });
      return;
    }
    const connectionCount = inbounds.filter(
      (inbound) => !ROUTING_INBOUND_TYPES.has(inbound.type),
    ).length;
    if (connectionCount > 20) {
      setSnackbar({
        open: true,
        type: 'error',
        message: 'Подписка может содержать не более 20 подключений',
      });
      return;
    }
    const needsNode = inbounds.some(
      (inbound) => inbound.type !== 'custom' && !ROUTING_INBOUND_TYPES.has(inbound.type),
    );
    if (needsNode && nodes.length === 0) {
      setSnackbar({ open: true, type: 'error', message: 'Создайте хотя бы одну ноду!' });
      return;
    }
    const needsDomain = inbounds.some(
      (inbound) => hasSni(inbound.type) &&
        (inbound.type === 'mtproto-faketls' || inbound.sni.trim() === 'random'),
    );
    if (needsDomain && domains.length === 0) {
      setSnackbar({ open: true, type: 'error', message: 'Создайте хотя бы один домен!' });
      return;
    }
    if (
      inbounds.some(
        (inbound) =>
          inbound.type === 'mtproto-faketls' && !isListedSni(inbound.sni),
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
        requiresPanelTlsCertificate(inbound) &&
        (inbound.certificateMode === 'custom'
          ? !inbound.tlsServerName?.trim() ||
            !inbound.certificateFile?.trim() ||
            !inbound.keyFile?.trim()
          : getSelectedNode(inbound.nodeId)?.capabilities
              ?.autoTlsCertificate === false),
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
    const invalidXhttpProfile = inbounds.find(
      (inbound) =>
        inbound.type === 'xhttp-stable' &&
        validateXhttpStableSettings(inbound.profileSettings),
    );
    if (invalidXhttpProfile) {
      setSnackbar({
        open: true,
        type: 'error',
        message:
          validateXhttpStableSettings(invalidXhttpProfile.profileSettings) ||
          'Некорректные параметры XHTTP Stable',
      });
      return;
    }
    const invalidSelfSniProfile = inbounds.find(
      (inbound) =>
        inbound.type === 'self-sni' &&
        validateSelfSniSettings(inbound.profileSettings, inbound.port),
    );
    if (invalidSelfSniProfile) {
      setSnackbar({
        open: true,
        type: 'error',
        message:
          validateSelfSniSettings(
            invalidSelfSniProfile.profileSettings,
            invalidSelfSniProfile.port,
          ) || 'Некорректные параметры Self-SNI',
      });
      return;
    }
    const invalidFallbackProfile = inbounds.find(
      (inbound) =>
        inbound.type === 'https-fallback' &&
        validateHttpsFallbackSettings(
          inbound.profileSettings,
          inbound.port,
          inbound.tlsServerName,
        ),
    );
    if (invalidFallbackProfile) {
      setSnackbar({
        open: true,
        type: 'error',
        message:
          validateHttpsFallbackSettings(
            invalidFallbackProfile.profileSettings,
            invalidFallbackProfile.port,
            invalidFallbackProfile.tlsServerName,
          ) || 'Некорректные параметры HTTPS Fallback',
      });
      return;
    }
    const incompatibleInbound = inbounds.find(
      (inbound) => !isInboundSupported(inbound.type, inbound.nodeId, nodes),
    );
    if (incompatibleInbound) {
      setSnackbar({
        open: true,
        type: 'error',
        message: `${incompatibleInbound.type} не поддерживается выбранной нодой`,
      });
      return;
    }

    const editingSub = editingId
      ? subs.find((item) => item.id === editingId)
      : undefined;
    const trimmedClientId = clientId.trim();
    const shouldSendClient =
      Boolean(trimmedClientId) ||
      clientAutoCreate ||
      Boolean(editingSub?.clientId) ||
      Boolean(editingSub?.clientAutoCreate);

    const payload = {
      name,
      ...(shouldSendClient
        ? {
            clientId: trimmedClientId,
            clientAutoCreate,
          }
        : {}),
      note: note.trim(),
      supportUrl: supportUrl.trim(),
      websiteUrl: websiteUrl.trim(),
      inboundsConfig: inbounds.map((inbound) => {
        if (inbound.type === 'custom') {
          return {
            configId: inbound.configId,
            type: inbound.type,
            link: inbound.link,
            enabled: true,
          };
        }
        if (ROUTING_INBOUND_TYPES.has(inbound.type)) {
          return {
            configId: inbound.configId,
            type: inbound.type,
            routingProfile: inbound.routingProfile || '',
            enabled: true,
          };
        }
        return {
          configId: inbound.configId,
          type: inbound.type,
          port:
            inbound.port === 'random'
              ? 'random'
              : parseInt(inbound.port, 10),
          sni:
            inbound.type === 'self-sni'
              ? inbound.profileSettings?.domain?.trim() || undefined
              : hasSni(inbound.type)
                ? inbound.sni
                : undefined,
          nodeId: inbound.nodeId || undefined,
          relayServerId: inbound.relayServerId
            ? parseInt(inbound.relayServerId, 10)
            : undefined,
          flag: inbound.flag || (MANAGED_PROFILE_TYPES.has(inbound.type)
            ? undefined
            : getNodeFlag(inbound.nodeId) || undefined),
          name: inbound.name?.trim() || undefined,
          enabled: true,
          certificateMode: requiresPanelTlsCertificate(inbound)
            ? inbound.certificateMode || 'node'
            : undefined,
          tlsServerName:
            inbound.type === 'https-fallback'
              ? inbound.profileSettings?.domain?.trim() ||
                inbound.tlsServerName?.trim() ||
                undefined
              : CERTIFICATE_TYPES.has(inbound.type)
                ? inbound.tlsServerName?.trim() || undefined
                : undefined,
          certificateFile:
            requiresPanelTlsCertificate(inbound) &&
            inbound.certificateMode === 'custom'
              ? inbound.certificateFile?.trim() || undefined
              : undefined,
          keyFile:
            requiresPanelTlsCertificate(inbound) &&
            inbound.certificateMode === 'custom'
              ? inbound.keyFile?.trim() || undefined
              : undefined,
          profileId: MANAGED_PROFILE_TYPES.has(inbound.type)
            ? inbound.profileId
            : undefined,
          profileSettings:
            inbound.type === 'xhttp-stable'
              ? inbound.profileSettings || createDefaultXhttpStableSettings()
              : inbound.type === 'self-sni'
                ? inbound.profileSettings || createDefaultSelfSniSettings()
                : inbound.type === 'https-fallback'
                  ? inbound.profileSettings ||
                    createDefaultHttpsFallbackSettings()
                  : undefined,
        };
      }),
    };

    setSaving(true);
    try {
      let awgProvisioning: { status: string; message?: string } | undefined;
      if (editingId) {
        const res = await api.put(`/subscriptions/${editingId}`, payload);
        awgProvisioning =
          res.data?.inboundProvisioning || res.data?.awgProvisioning;
      } else {
        const res = await api.post<{
          id?: string;
          inboundProvisioning?: { status: string; message?: string };
          awgProvisioning?: { status: string; message?: string };
        }>('/subscriptions', payload);
        setCreatedSubscriptionId(
          inbounds.some(
            (inbound) => !PERSISTENT_INBOUND_TYPES.has(inbound.type) && !ROUTING_INBOUND_TYPES.has(inbound.type),
          )
            ? res.data?.id || null
            : null,
        );
        awgProvisioning =
          res.data?.inboundProvisioning || res.data?.awgProvisioning;
      }
      setOpen(false);
      loadSubs();
      setSnackbar({
        open: true,
        type: awgProvisioning?.status === 'failed' ? 'error' : 'success',
        message:
          awgProvisioning?.status === 'failed'
            ? `Настройки сохранены, но создание подключений не завершено: ${awgProvisioning.message || ''} Повторите сохранение подписки.`
            : editingId
              ? 'Подписка обновлена'
              : 'Подписка создана',
      });
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message || 'Произошла ошибка при сохранении';
      setSnackbar({ open: true, type: 'error', message });
    } finally {
      setSaving(false);
    }
  };

  const deleteSubscription = async (id: string, force = false) => {
    setDeleting(true);
    try {
      if (force) {
        await api.delete(`/subscriptions/${id}`, { params: { force: true } });
      } else {
        await api.delete(`/subscriptions/${id}`);
      }
      setDeleteFailure(null);
      loadSubs();
      setSnackbar({
        open: true,
        type: 'success',
        message: 'Подписка удалена',
      });
    } catch (error: unknown) {
      const data = (
        error as {
          response?: { data?: { code?: string; message?: string } };
        }
      )?.response?.data;
      const message = data?.message || 'Не удалось удалить подписку';
      setSnackbar({ open: true, type: 'error', message });
      if (!force && data?.code === 'INBOUND_DELETE_FAILED') {
        setDeleteFailure({ id, message });
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleDelete = (id: string) => {
    setConfirmDialog({
      open: true,
      title: 'Удалить подписку и все соединения?',
      confirmText: 'Удалить',
      confirmColor: 'error',
      onConfirm: () => {
        void deleteSubscription(id);
      },
    });
  };

  const handleToggleAutoRotation = async (
    subscriptionId: string,
    enabled: boolean,
  ) => {
    try {
      await api.put('/subscriptions/bulk-auto-rotation', {
        subscriptionIds: [subscriptionId],
        enabled,
      });
      setSubs((prev) =>
        prev.map((sub) =>
          sub.id === subscriptionId
            ? { ...sub, isAutoRotationEnabled: enabled }
            : sub,
        ),
      );
      setSnackbar({
        open: true,
        type: 'success',
        message: enabled ? 'Авторотация включена' : 'Авторотация выключена',
      });
    } catch (error: unknown) {
      const message =
        (error as { response?: { data?: { message?: string } } })?.response
          ?.data?.message || 'Ошибка обновления';
      setSnackbar({ open: true, type: 'error', message });
      loadSubs();
    }
  };

  const selectableIds = subs.filter((sub) => sub.isEnabled !== false).map((sub) => sub.id);
  const selected = new Set(selectedIds);
  const selectedSubscriptionIds = selectableIds.filter((id) => selected.has(id));
  const allSelected = selectableIds.length > 0 &&
    selectedSubscriptionIds.length === selectableIds.length;
  const someSelected = selectedSubscriptionIds.length > 0 && !allSelected;

  const moveSubscription = async (position: number, direction: 'up' | 'down') => {
    const subscription = subs[position];
    const neighbor = subs[position + (direction === 'up' ? -1 : 1)];
    if (savingOrder || dataLoading || !subscription || !neighbor) return;

    setSavingOrder(true);
    try {
      const { data } = await api.put<{ subscriptionIds: string[] }>(
        '/subscriptions/order',
        { subscriptionId: subscription.id, neighborId: neighbor.id, direction },
      );
      listRevision.current += 1;
      const positions = new Map(data.subscriptionIds.map((id, index) => [id, index]));
      setSubs((current) => [...current].sort(
        (left, right) => (positions.get(left.id) ?? -1) - (positions.get(right.id) ?? -1),
      ));
    } catch (error) {
      const conflict = (error as { response?: { status?: number } }).response?.status === 409;
      if (conflict) await loadSubs();
      setSnackbar({
        open: true,
        type: 'error',
        message: conflict ? 'Порядок подписок изменился. Повторите перемещение.' : 'Не удалось сохранить порядок подписок',
      });
    } finally {
      setSavingOrder(false);
    }
  };

  const rotateSelected = async () => {
    if (rotationLoading || !selectedSubscriptionIds.length) return;

    setRotationLoading(true);
    try {
      const { data } = await api.post('/rotation/operations', {
        subscriptionIds: selectedSubscriptionIds,
      });
      setSelectedIds([]);
      setSnackbar({
        open: true,
        type: 'success',
        message: `Ротация выбранных подписок поставлена в очередь · ${String(data?.id || '').slice(0, 8)}`,
      });
    } catch {
      setSnackbar({
        open: true,
        type: 'error',
        message: 'Не удалось запустить ротацию выбранных подписок',
      });
    } finally {
      setRotationLoading(false);
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
    const nextStatus =
      rotationSettings.rotation_status === 'stopped' ? 'active' : 'stopped';
    const nextSettings = { ...rotationSettings, rotation_status: nextStatus };
    await saveRotationSettings(nextSettings);
    setSnackbar({
      open: true,
      type: 'success',
      message:
        nextStatus === 'active' ? 'Ротация включена' : 'Ротация остановлена',
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
    setSnackbar({
      open: true,
      type: 'success',
      message: 'Интервал ротации сохранен',
    });
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
    return new Date(
      Number(rotationSettings.last_rotation_timestamp) + interval * 60000,
    ).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const showLinks = (sub: Subscription) => {
    const links =
      sub.inbounds
        ?.map((item) => {
          if (item.wireguardConfig) return item.wireguardConfig;
          if (item.connection) {
            const connection = item.connection;
            return `${connection.type.toUpperCase()}\nСервер: ${connection.host}\nПорт: ${connection.port}\nЛогин: ${connection.username}\nПароль: ${connection.password}`;
          }
          return item.link;
        })
        .filter((link): link is string => Boolean(link)) || [];
    setCurrentLinks(
      links.length ? links : ['Нет активных ссылок (ждите ротации)'],
    );
    setLinksSubUuid(sub.uuid);
    setLinksOpen(true);
  };

  const handleCopyLink = async (uuid: string) => {
    await copyToClipboard(getSubscriptionUrl(uuid));
    setSnackbar({
      open: true,
      type: 'success',
      message: 'Ссылка на подписку скопирована',
    });
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

  const openActionMenuFor = (
    event: React.MouseEvent<HTMLButtonElement>,
    sub: Subscription,
  ) => {
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
        meta={
          <Chip
            size="small"
            variant="outlined"
            label={`Подписок: ${subs.length}`}
          />
        }
        action={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={handleOpenCreate}
            disabled={dataLoading}
          >
            {dataLoading ? 'Загрузка…' : 'Создать'}
          </Button>
        }
      />

      <Paper className="workspace-panel workspace-toolbar" sx={{ mb: 3 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', md: 'center' }}
        >
          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Статус ротации
            </Typography>
            <Chip
              icon={
                rotationSettings.rotation_status === 'stopped' ? (
                  <PauseCircleFilled />
                ) : (
                  <PlayCircleFilled />
                )
              }
              label={
                rotationSettings.rotation_status === 'stopped'
                  ? 'Остановлена'
                  : 'Активна'
              }
              color={
                rotationSettings.rotation_status === 'stopped'
                  ? 'warning'
                  : 'success'
              }
              size="small"
              variant="outlined"
              sx={{ mt: 1 }}
            />
          </Box>
          <Tooltip
            title={
              rotationSettings.rotation_status === 'stopped'
                ? 'Возобновить ротацию'
                : 'Поставить на паузу'
            }
          >
            <IconButton
              onClick={toggleRotationService}
              size="small"
              aria-label={
                rotationSettings.rotation_status === 'stopped'
                  ? 'Возобновить ротацию'
                  : 'Поставить ротацию на паузу'
              }
            >
              {rotationSettings.rotation_status === 'stopped' ? (
                <PlayCircleFilled fontSize="large" />
              ) : (
                <PauseCircleFilled fontSize="large" />
              )}
            </IconButton>
          </Tooltip>
          <Divider
            flexItem
            orientation={isMobile ? 'horizontal' : 'vertical'}
          />
          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Последняя генерация
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {formatRotationDate(rotationSettings.last_rotation_timestamp)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              Следующая генерация
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {getNextRotationDate()}
            </Typography>
          </Box>
          <TextField
            label="Интервал, мин"
            type="number"
            size="small"
            value={rotationSettings.rotation_interval}
            onChange={(e) =>
              setRotationSettings((prev) => ({
                ...prev,
                rotation_interval: e.target.value,
              }))
            }
            sx={{ width: { xs: '100%', md: 150 } }}
          />
          <Box sx={{ flexGrow: 1 }} />
          <Button variant="outlined" onClick={saveRotationInterval}>
            Сохранить интервал
          </Button>
          <Button
            variant="contained"
            disabled={rotationLoading}
            onClick={rotateAllNow}
          >
            Обновить все
          </Button>
        </Stack>
      </Paper>

      <Paper
        className="workspace-panel workspace-table"
        sx={{ overflowX: 'auto' }}
      >
        {subs.length > 0 && (
          <Stack direction="row" justifyContent="flex-end" sx={{ p: 1 }}>
            <Button
              variant="outlined"
              disabled={rotationLoading || !selectedSubscriptionIds.length}
              onClick={() => void rotateSelected()}
            >
              Ротация выбранных{selectedSubscriptionIds.length ? ` (${selectedSubscriptionIds.length})` : ''}
            </Button>
          </Stack>
        )}
        <Table sx={{ minWidth: 760 }}>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  disabled={rotationLoading || !selectableIds.length}
                  inputProps={{
                    'aria-label': 'Выбрать все активные подписки',
                    'aria-checked': someSelected ? 'mixed' : undefined,
                  }}
                  onChange={(event) => setSelectedIds(event.target.checked ? selectableIds : [])}
                />
              </TableCell>
              <TableCell>Порядок</TableCell>
              <TableCell>Имя</TableCell>
              <TableCell>UUID</TableCell>
              <TableCell>Инбаунды</TableCell>
              <TableCell>Авторотация</TableCell>
              <TableCell align="right">Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {subs.map((sub, position) => (
              <TableRow key={sub.id} selected={selected.has(sub.id)}>
                <TableCell padding="checkbox">
                  <Checkbox
                    inputProps={{ 'aria-label': `Выбрать подписку ${sub.name}` }}
                    checked={selected.has(sub.id)}
                    disabled={rotationLoading || sub.isEnabled === false}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelectedIds((current) => checked
                        ? [...current, sub.id]
                        : current.filter((id) => id !== sub.id));
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Stack direction="row">
                    <IconButton
                      size="small"
                      aria-label={`Поднять подписку ${sub.name}`}
                      disabled={savingOrder || dataLoading || position === 0}
                      onClick={() => void moveSubscription(position, 'up')}
                    >
                      <ArrowUpward fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Опустить подписку ${sub.name}`}
                      disabled={savingOrder || dataLoading || position === subs.length - 1}
                      onClick={() => void moveSubscription(position, 'down')}
                    >
                      <ArrowDownward fontSize="small" />
                    </IconButton>
                  </Stack>
                </TableCell>
                <TableCell sx={{ fontWeight: 700 }}>
                  {sub.name}
                  {sub.clientId && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      display="block"
                      noWrap
                      title={sub.clientId}
                      sx={{
                        fontFamily: 'monospace',
                        fontWeight: 400,
                        maxWidth: 260,
                      }}
                    >
                      Клиент: {sub.clientId}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>
                  <Typography
                    variant="body2"
                    noWrap
                    title={sub.uuid}
                    sx={{ fontFamily: 'monospace', maxWidth: 260 }}
                  >
                    {sub.uuid}
                  </Typography>
                </TableCell>
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
                    onChange={(e) =>
                      handleToggleAutoRotation(sub.id, e.target.checked)
                    }
                    color="primary"
                  />
                </TableCell>
                <TableCell align="right">
                  {!isMobile && (
                    <>
                      <IconButton
                        color="primary"
                        onClick={() => handleCopyLink(sub.uuid)}
                        title="Копировать ссылку"
                        aria-label={`Копировать ссылку ${sub.name}`}
                      >
                        <ContentCopy />
                      </IconButton>
                      <IconButton
                        color="primary"
                        onClick={() =>
                          window.open(getSubscriptionUrl(sub.uuid), '_blank')
                        }
                        title="Открыть подписку"
                        aria-label={`Открыть подписку ${sub.name}`}
                      >
                        <OpenInNew />
                      </IconButton>
                    </>
                  )}
                  <IconButton
                    aria-label={`Действия с подпиской ${sub.name}`}
                    onClick={(e) => openActionMenuFor(e, sub)}
                  >
                    <MoreVert />
                  </IconButton>
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

      <Menu
        anchorEl={menuAnchorEl}
        open={openActionMenu}
        onClose={closeActionMenu}
      >
        {isMobile && activeSub && (
          <MenuItem onClick={() => handleCopyLink(activeSub.uuid)}>
            <ListItemIcon>
              <ContentCopy fontSize="small" color="primary" />
            </ListItemIcon>
            <ListItemText>Копировать ссылку</ListItemText>
          </MenuItem>
        )}
        {isMobile && activeSub && (
          <MenuItem
            onClick={() =>
              window.open(getSubscriptionUrl(activeSub.uuid), '_blank')
            }
          >
            <ListItemIcon>
              <OpenInNew fontSize="small" color="primary" />
            </ListItemIcon>
            <ListItemText>Открыть подписку</ListItemText>
          </MenuItem>
        )}
        {activeSub && (
          <MenuItem onClick={() => showLinks(activeSub)}>
            <ListItemIcon>
              <LinkIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Показать конфиги</ListItemText>
          </MenuItem>
        )}
        {activeSub && (
          <MenuItem onClick={() => handleManualRotate(activeSub)}>
            <ListItemIcon>
              <Refresh fontSize="small" color="primary" />
            </ListItemIcon>
            <ListItemText>Обновить сейчас</ListItemText>
          </MenuItem>
        )}
        {activeSub && (
          <MenuItem onClick={() => handleOpenEdit(activeSub)}>
            <ListItemIcon>
              <Edit fontSize="small" />
            </ListItemIcon>
            <ListItemText>Редактировать</ListItemText>
          </MenuItem>
        )}
        {activeSub && (
          <MenuItem onClick={() => handleDelete(activeSub.id)}>
            <ListItemIcon>
              <Delete fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText sx={{ color: 'error.main' }}>Удалить</ListItemText>
          </MenuItem>
        )}
      </Menu>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        maxWidth={false}
        fullWidth
        disableRestoreFocus
        slotProps={{
          paper: {
            sx: {
              width: { xs: 'calc(100% - 16px)', sm: 'calc(100% - 48px)' },
              maxWidth: 1800,
              maxHeight: 'calc(100dvh - 32px)',
              m: { xs: 1, sm: 3 },
            },
          },
        }}
      >
        <DialogTitle variant="h5">
          {editingId ? 'Редактировать подписку' : 'Новая подписка'}
        </DialogTitle>
        <DialogContent dividers sx={{ minHeight: 0, p: { xs: 2, sm: 3 } }}>
          <TextField
            autoFocus
            margin="dense"
            label="Имя подписки"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            sx={{ mb: 1.5 }}
          />
          <TextField
            margin="dense"
            label="ID клиента 3x-ui (необязательно)"
            fullWidth
            value={clientId}
            onChange={(e) => {
              const value = e.target.value;
              setClientId(value);
              if (value.trim()) setClientAutoCreate(false);
            }}
            helperText="ID или email клиента из раздела Clients (3x-ui 3.x) для переиспользования и выдачи статистики трафика/срока в подписке."
            sx={{ mb: 0.5 }}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={clientAutoCreate}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setClientAutoCreate(checked);
                  if (checked) {
                    setClientId('');
                  } else {
                    const editingSub = editingId
                      ? subs.find((item) => item.id === editingId)
                      : undefined;
                    if (
                      editingSub?.clientAutoCreate &&
                      clientId === (editingSub.clientId || '')
                    ) {
                      setClientId('');
                    }
                  }
                }}
              />
            }
            label="Создать единого клиента 3x-ui автоматически"
            sx={{ mb: 1.5 }}
          />
          <TextField
            margin="dense"
            label="Примечание"
            placeholder="Краткое описание или объявление"
            fullWidth
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              if (metadataErrors.note) {
                setMetadataErrors((prev) => ({ ...prev, note: undefined }));
              }
            }}
            error={!!metadataErrors.note}
            helperText={metadataErrors.note || `${[...note].length}/200`}
            sx={{ mb: 2 }}
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              gap: 2,
              mb: 2,
            }}
          >
            <TextField
              margin="dense"
              label="Ссылка на поддержку"
              placeholder="https://t.me/... или tg://..."
              fullWidth
              value={supportUrl}
              onChange={(e) => {
                setSupportUrl(e.target.value);
                if (metadataErrors.supportUrl) {
                  setMetadataErrors((prev) => ({
                    ...prev,
                    supportUrl: undefined,
                  }));
                }
              }}
              error={!!metadataErrors.supportUrl}
              helperText={metadataErrors.supportUrl || ''}
            />
            <TextField
              margin="dense"
              label="Веб-сайт"
              placeholder="https://example.com"
              fullWidth
              value={websiteUrl}
              onChange={(e) => {
                setWebsiteUrl(e.target.value);
                if (metadataErrors.websiteUrl) {
                  setMetadataErrors((prev) => ({
                    ...prev,
                    websiteUrl: undefined,
                  }));
                }
              }}
              error={!!metadataErrors.websiteUrl}
              helperText={metadataErrors.websiteUrl || ''}
            />
          </Box>
          {inbounds.some((i) => i.enabled === false || i.disabledReason) && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Внимание: некоторые конфигурации были отключены (удалена нода).
              При сохранении подписки они будут автоматически активированы на
              выбранных нодах.
            </Alert>
          )}
          <InboundsEditor
            compact
            activeConfigIds={new Set(subs.find(sub => sub.id === editingId)?.inbounds
              ?.map(inbound => inbound.configId).filter((id): id is string => Boolean(id)))}
            inbounds={inbounds}
            onChange={setInbounds}
            nodes={nodes}
            tunnels={tunnels}
            domains={domains}
            countries={countries}
            getLinkedProfile={getLinkedProfile}
            subscriptionNodeId={subs.find((sub) => sub.id === editingId)?.nodeId || undefined}
            portErrors={portErrors}
            onPortErrorsChange={setPortErrors}
            extraActions={
              savedProfiles.length > 0 ? (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<PlaylistAdd />}
                  onClick={() => {
                    setPickedProfileIds([]);
                    setProfilePickerOpen(true);
                  }}
                >
                  Из профилей ({savedProfiles.length})
                </Button>
              ) : undefined
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Отмена</Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            variant="contained"
            color="primary"
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={profilePickerOpen}
        onClose={() => setProfilePickerOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Добавить управляемые профили</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="body2" color="text.secondary">
                Отметьте профили для массового добавления в подписку (выбрано:{' '}
                {pickedProfileIds.length})
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  onClick={() =>
                    setPickedProfileIds(savedProfiles.map((p) => p.id))
                  }
                >
                  Выбрать все
                </Button>
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => setPickedProfileIds([])}
                >
                  Снять
                </Button>
              </Stack>
            </Stack>
            <Paper variant="outlined" sx={{ maxHeight: 300, overflowY: 'auto' }}>
              <List dense disablePadding>
                {savedProfiles.map((profile) => {
                  const checked = pickedProfileIds.includes(profile.id);
                  const alreadyAdded = inbounds.some(
                    (inb) =>
                      inb.profileId === profile.id ||
                      (inb.type === profile.kind &&
                        (inb.name || '').trim() === profile.name.trim() &&
                        (inb.nodeId || '') === (profile.nodeId || '')),
                  );
                  const nodeName =
                    nodes.find((n) => n.id === profile.nodeId)?.name ||
                    'Основная нода';
                  return (
                    <ListItemButton
                      key={profile.id}
                      dense
                      onClick={() =>
                        setPickedProfileIds((prev) =>
                          prev.includes(profile.id)
                            ? prev.filter((id) => id !== profile.id)
                            : [...prev, profile.id],
                        )
                      }
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
                        primary={`${profile.name} (${profile.kind})`}
                        secondary={`${nodeName} · порт ${profile.port ?? 'random'} · ${profile.spec?.domain || profile.sni || 'random'}${alreadyAdded ? ' · уже в подписке' : ''}`}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProfilePickerOpen(false)}>Отмена</Button>
          <Button
            variant="contained"
            disabled={pickedProfileIds.length === 0}
            onClick={() => {
              const chosen = savedProfiles.filter((p) =>
                pickedProfileIds.includes(p.id),
              );
              const existingConnCount = inbounds.filter(
                (i) => !ROUTING_INBOUND_TYPES.has(i.type),
              ).length;
              const appended: InboundConfigUI[] = [];
              let skippedDup = 0;
              for (const profile of chosen) {
                const isDup = [...inbounds, ...appended].some(
                  (inb) =>
                    inb.profileId === profile.id ||
                    (inb.type === profile.kind &&
                      (inb.name || '').trim() === profile.name.trim() &&
                      (inb.nodeId || '') === (profile.nodeId || '')),
                );
                if (isDup) {
                  skippedDup += 1;
                  continue;
                }
                if (existingConnCount + appended.length >= 20) break;
                const configId = crypto.randomUUID();
                const targetNodeId = profile.nodeId || getDefaultNodeId();
                const domain =
                  profile.spec?.domain?.trim() || profile.sni?.trim() || '';
                const isDirectFallback =
                  profile.kind === 'https-fallback' &&
                  (profile.spec?.reverseProxy ?? 'none') === 'none';
                const hasCustomCert = Boolean(
                  profile.spec?.certificateFile && profile.spec?.keyFile,
                );
                appended.push({
                  id: configId,
                  configId,
                  type: profile.kind,
                  port: profile.port ? String(profile.port) : 'random',
                  sni:
                    profile.kind === 'xhttp-stable'
                      ? profile.sni || 'random'
                      : profile.kind === 'self-sni'
                        ? domain
                        : '',
                  nodeId: targetNodeId,
                  relayServerId: '',
                  flag: '',
                  name: profile.name,
                  enabled: true,
                  profileId: profile.id,
                  tlsServerName:
                    profile.kind === 'https-fallback' ? domain : undefined,
                  certificateMode: isDirectFallback
                    ? hasCustomCert
                      ? 'custom'
                      : 'node'
                    : undefined,
                  certificateFile:
                    isDirectFallback && hasCustomCert
                      ? profile.spec?.certificateFile || ''
                      : '',
                  keyFile:
                    isDirectFallback && hasCustomCert
                      ? profile.spec?.keyFile || ''
                      : '',
                  profileSettings:
                    profile.kind === 'xhttp-stable'
                      ? {
                          ...createDefaultXhttpStableSettings(),
                          ...profile.spec,
                          rotationPolicy:
                            profile.rotationPolicy ||
                            profile.spec?.rotationPolicy ||
                            'fixed_domain',
                        }
                      : profile.kind === 'self-sni'
                        ? {
                            ...createDefaultSelfSniSettings(domain),
                            ...profile.spec,
                            domain,
                            rotationPolicy:
                              profile.rotationPolicy ||
                              profile.spec?.rotationPolicy ||
                              'fixed_domain',
                          }
                        : {
                            ...createDefaultHttpsFallbackSettings(domain),
                            ...profile.spec,
                            domain,
                            rotationPolicy:
                              profile.rotationPolicy ||
                              profile.spec?.rotationPolicy ||
                              'fixed_domain',
                          },
                });
              }
              if (appended.length > 0) {
                setInbounds((prev) => [...prev, ...appended]);
                setSnackbar({
                  open: true,
                  type: 'success',
                  message: `Добавлено профилей в форму: ${appended.length}${skippedDup > 0 ? ` (пропущено дублей: ${skippedDup})` : ''}`,
                });
              } else {
                setSnackbar({
                  open: true,
                  type: 'error',
                  message:
                    skippedDup > 0
                      ? 'Выбранные профили уже добавлены в подписку'
                      : 'Достигнут лимит 20 подключений',
                });
              }
              setProfilePickerOpen(false);
            }}
          >
            Добавить ({pickedProfileIds.length})
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={linksOpen}
        onClose={() => setLinksOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Активные ссылки</DialogTitle>
        <DialogContent>
          <TextField
            multiline
            fullWidth
            rows={10}
            value={currentLinks.join('\n\n')}
            slotProps={{
              input: {
                readOnly: true,
                sx: { fontFamily: 'monospace', fontSize: 12 },
              },
            }}
          />
        </DialogContent>
        <DialogActions>
          {linksSubUuid && (
            <Button
              component="a"
              href={`/bus/${linksSubUuid}?format=xray-json`}
              target="_blank"
              rel="noopener noreferrer"
              startIcon={<OpenInNew />}
            >
              Скачать Xray JSON
            </Button>
          )}
          <Button onClick={() => copyToClipboard(currentLinks.join('\n'))}>
            Копировать все
          </Button>
          <Button onClick={() => setLinksOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog({ ...confirmDialog, open: false })}
      >
        <DialogTitle>Подтверждение</DialogTitle>
        <DialogContent>
          <Typography>{confirmDialog.title}</Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}
          >
            Отмена
          </Button>
          <Button
            onClick={() => {
              confirmDialog.onConfirm();
              setConfirmDialog({ ...confirmDialog, open: false });
            }}
            variant="contained"
            color={confirmDialog.confirmColor}
          >
            {confirmDialog.confirmText}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteFailure !== null}
        onClose={() => {
          if (!deleting) setDeleteFailure(null);
        }}
      >
        <DialogTitle>Удалить принудительно?</DialogTitle>
        <DialogContent>
          {deleteFailure?.message && (
            <Typography sx={{ mb: 1 }}>{deleteFailure.message}</Typography>
          )}
          <Typography>
            Подписка удалится, даже если часть инбаундов осталась в 3x-ui; их нужно удалить в панели вручную.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button disabled={deleting} onClick={() => setDeleteFailure(null)}>
            Отмена
          </Button>
          <Button
            disabled={deleting}
            color="error"
            variant="contained"
            onClick={() => {
              if (deleteFailure) void deleteSubscription(deleteFailure.id, true);
            }}
          >
            Удалить принудительно
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={createdSubscriptionId !== null}
        onClose={() => setCreatedSubscriptionId(null)}
      >
        <DialogTitle>Подписка создана</DialogTitle>
        <DialogContent>
          <Typography>Сгенерировать подключения сейчас?</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreatedSubscriptionId(null)}>Нет</Button>
          <Button
            onClick={handleGenerateCreatedSubscription}
            variant="contained"
          >
            Да
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.type}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
