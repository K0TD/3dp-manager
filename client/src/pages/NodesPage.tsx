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
  FormHelperText,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add,
  CheckCircle,
  Delete,
  Edit,
  NetworkCheck,
  Settings,
  Star,
  StarBorder,
  SwapHoriz,
} from '@mui/icons-material';
import api from '../api';
import { nodesApi } from '../features/nodes/api';
import { RoutingPresetsDialog } from '../features/nodes/RoutingPresetsDialog';
import type {
  NodeAuthType,
  NodeCheckResult,
  NodePayload,
  NodeRecord,
} from '../types/node';
import { getApiErrorMessage } from '../utils/errorHandlers';
import { FlagIcon, FlagOptionLabel } from '../utils/flags';
import { WorkspaceHeader } from '../components/WorkspaceHeader';

const MASKED_SECRET = '••••••••••••••••';

const emptyForm: NodePayload = {
  name: '',
  url: '',
  domain: '',
  ip: '',
  flag: '',
  authType: 'token',
  login: '',
  password: '',
  token: '',
  isMain: false,
  allowInvalidTls: false,
};

interface MigrateFormState {
  url: string;
  domain: string;
  ip: string;
  flag: string;
  allowInvalidTls: boolean;
  syncSubscriptionLinks: boolean;
  preferDirectIp: boolean;
}

const emptyMigrateForm: MigrateFormState = {
  url: '',
  domain: '',
  ip: '',
  flag: '',
  allowInvalidTls: false,
  syncSubscriptionLinks: true,
  preferDirectIp: false,
};

interface CountryOption {
  name: string;
  code: string;
  emoji: string;
}

const isValidIp = (value?: string) =>
  !!value &&
  (/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(value.trim()) ||
    /^([0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}$/i.test(value.trim()));

const extractDomainFromUrl = (value?: string) => {
  if (!value) return '';
  try {
    const raw = value.trim();
    const url = raw.includes('://') ? raw : `https://${raw}`;
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    return host && !isValidIp(host) ? host : '';
  } catch {
    return '';
  }
};

const extractIpFromUrl = (value?: string) => {
  if (!value) return '';
  try {
    const raw = value.trim();
    const url = raw.includes('://') ? raw : `https://${raw}`;
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    return host && isValidIp(host) ? host : '';
  } catch {
    return '';
  }
};

const replaceUrlHostWithIp = (rawUrl: string, rawIp: string) => {
  const ip = rawIp.trim().replace(/^\[|\]$/g, '');
  const formattedHost = ip.includes(':') ? `[${ip}]` : ip;
  try {
    const withScheme = rawUrl.trim().includes('://')
      ? rawUrl.trim()
      : `https://${rawUrl.trim()}`;
    const parsed = new URL(withScheme);
    parsed.hostname = formattedHost;
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return `https://${formattedHost}`;
  }
};

const renderDiagnosticsAlert = (result: NodeCheckResult | null) => {
  if (!result) return null;
  const diag = result.diagnostics;
  return (
    <Alert severity={result.success ? 'success' : 'error'}>
      <Typography variant="body2" fontWeight={600}>
        {result.success
          ? `Подключение подтверждено${result.responseTimeMs !== undefined ? ` (${result.responseTimeMs} ms)` : ''} · 3x-ui ${result.version || '?'} · Xray ${result.xrayVersion || '?'}`
          : result.message || 'Не удалось подключиться к панели'}
      </Typography>
      {diag?.resolvedIps && diag.resolvedIps.length > 0 && (
        <Typography variant="caption" display="block">
          DNS: {diag.resolvedIps.join(', ')}
          {diag.configuredIp ? ` · IP ноды: ${diag.configuredIp}` : ''}
          {diag.usedDirectIp ? ' · через прямой IP' : ''}
        </Typography>
      )}
      {diag?.errorCode && !result.success && (
        <Typography variant="caption" display="block">
          Код: {diag.errorCode}
        </Typography>
      )}
      {diag?.hint && (
        <Typography variant="caption" display="block" sx={{ mt: 0.25 }}>
          {diag.hint}
        </Typography>
      )}
    </Alert>
  );
};

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NodeRecord | null>(null);
  const [settingsNode, setSettingsNode] = useState<NodeRecord | null>(null);
  const [form, setForm] = useState<NodePayload>(emptyForm);
  const [secretDirty, setSecretDirty] = useState(true);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [savingNode, setSavingNode] = useState(false);
  const [rowCheckingId, setRowCheckingId] = useState<string | null>(null);
  const [checkFeedback, setCheckFeedback] = useState<NodeCheckResult | null>(null);

  const [migrateTarget, setMigrateTarget] = useState<NodeRecord | null>(null);
  const [migrateForm, setMigrateForm] = useState<MigrateFormState>(emptyMigrateForm);
  const [migrateErrors, setMigrateErrors] = useState<
    Partial<Record<keyof MigrateFormState, string>>
  >({});
  const [migrateDetecting, setMigrateDetecting] = useState(false);
  const [migrateChecking, setMigrateChecking] = useState(false);
  const [migrateSaving, setMigrateSaving] = useState(false);
  const [migrateFeedback, setMigrateFeedback] = useState<NodeCheckResult | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<NodeRecord | null>(null);
  const [formErrors, setFormErrors] = useState<
    Partial<Record<keyof NodePayload, string>>
  >({});
  const [message, setMessage] = useState({
    open: false,
    type: 'success' as 'success' | 'error',
    text: '',
  });

  const hasSavedPassword = Boolean(
    editing && (editing.hasPassword ?? editing.authType === 'password'),
  );
  const hasSavedToken = Boolean(
    editing && (editing.hasToken ?? editing.authType === 'token'),
  );
  const hasSavedCurrentSecret =
    form.authType === 'password' ? hasSavedPassword : hasSavedToken;

  const loadNodes = useCallback(async () => {
    const data = await nodesApi.list();
    setNodes(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    loadNodes();
    api
      .get<CountryOption[]>('/settings/countries')
      .then((res) => setCountries(Array.isArray(res.data) ? res.data : []));
  }, [loadNodes]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setSecretDirty(true);
    setFormErrors({});
    setCheckFeedback(null);
    setOpen(true);
  };

  const openEdit = (node: NodeRecord) => {
    const saved =
      node.authType === 'password'
        ? Boolean(node.hasPassword ?? true)
        : Boolean(node.hasToken ?? true);
    setEditing(node);
    setForm({
      name: node.name,
      url: node.url || '',
      domain: node.domain || '',
      ip: node.ip || '',
      flag: node.flag || '',
      authType: node.authType,
      login: node.login || '',
      password: '',
      token: '',
      isMain: node.isMain,
      allowInvalidTls: node.allowInvalidTls || false,
    });
    setSecretDirty(!saved);
    setFormErrors({});
    setCheckFeedback(null);
    setOpen(true);
  };

  const openMigrate = (node: NodeRecord) => {
    setMigrateTarget(node);
    setMigrateForm({
      url: node.url || '',
      domain: node.domain || '',
      ip: node.ip || '',
      flag: node.flag || '',
      allowInvalidTls: node.allowInvalidTls || false,
      syncSubscriptionLinks: true,
      preferDirectIp: false,
    });
    setMigrateErrors({});
    setMigrateFeedback(null);
  };

  const updateField = <K extends keyof NodePayload>(
    key: K,
    value: NodePayload[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormErrors((prev) => ({ ...prev, [key]: undefined }));
    if (key === 'allowInvalidTls' || key === 'ip' || key === 'login') {
      setCheckFeedback(null);
    }
  };

  const handleAuthTypeChange = (nextAuthType: NodeAuthType) => {
    setForm((prev) => ({
      ...prev,
      authType: nextAuthType,
      password: '',
      token: '',
    }));
    setFormErrors((prev) => ({ ...prev, password: undefined, token: undefined }));
    setCheckFeedback(null);
    if (editing) {
      const savedForNext =
        nextAuthType === 'password' ? hasSavedPassword : hasSavedToken;
      setSecretDirty(!savedForNext);
    } else {
      setSecretDirty(true);
    }
  };

  const handleMaskedSecretChange = (
    secretKey: 'password' | 'token',
    rawValue: string,
  ) => {
    let nextValue = rawValue;
    if (editing && hasSavedCurrentSecret && !secretDirty) {
      if (rawValue.startsWith(MASKED_SECRET)) {
        nextValue = rawValue.slice(MASKED_SECRET.length);
      } else if (MASKED_SECRET.includes(rawValue)) {
        nextValue = '';
      } else {
        nextValue = rawValue.replace(/•/g, '');
      }
      setSecretDirty(true);
    }
    updateField(secretKey, nextValue);
  };

  const handleUrlChange = (value: string) => {
    const prevAutoDomain = extractDomainFromUrl(form.url);
    const nextAutoDomain = extractDomainFromUrl(value);
    const prevUrlIp = extractIpFromUrl(form.url);
    const nextUrlIp = extractIpFromUrl(value);
    setForm((prev) => {
      const domainWasAuto = !prev.domain || prev.domain === prevAutoDomain;
      const nextDomain = domainWasAuto ? nextAutoDomain : prev.domain;
      const shouldUpdateIp = Boolean(
        nextUrlIp && (!prev.ip || prev.ip === prevUrlIp || prevAutoDomain !== ''),
      );
      return {
        ...prev,
        url: value,
        domain: nextDomain,
        ip: shouldUpdateIp ? nextUrlIp : prev.ip,
      };
    });
    setFormErrors((prev) => ({ ...prev, url: undefined, ip: undefined }));
    setCheckFeedback(null);
  };

  const validateForm = (requireSecrets = !editing) => {
    const errors: Partial<Record<keyof NodePayload, string>> = {};
    const usingSavedSecret = Boolean(editing && hasSavedCurrentSecret && !secretDirty);
    const mustProvideSecret = requireSecrets && !usingSavedSecret;

    if (!form.name.trim()) errors.name = 'Введите название ноды';
    if (!form.url.trim()) errors.url = 'Введите URL панели 3x-ui';
    if (!isValidIp(form.ip)) errors.ip = 'Введите корректный IP ноды';
    if (!form.flag) errors.flag = 'Выберите флаг ноды';

    if (form.authType === 'password') {
      if (!form.login?.trim()) errors.login = 'Введите логин';
      if (mustProvideSecret && !form.password?.trim()) {
        errors.password = 'Введите пароль';
      }
    }

    if (
      form.authType === 'token' &&
      mustProvideSecret &&
      !form.token?.trim()
    ) {
      errors.token = 'Введите токен';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const detectNodeLocation = async () => {
    const url = form.url.trim();
    if (!url) return;

    const prevAutoDomain = extractDomainFromUrl(url);
    setDetectingLocation(true);
    try {
      const result = await nodesApi.detectLocation(url.replace(/\/+$/, ''));
      setForm((prev) => {
        const nextDomain =
          !prev.domain || prev.domain === prevAutoDomain
            ? result.domain || prevAutoDomain || ''
            : prev.domain;
        return {
          ...prev,
          ip: result.ip || prev.ip,
          flag: result.flag || prev.flag,
          domain: nextDomain,
        };
      });
      if (result.country || result.ip) {
        setMessage({
          open: true,
          type: 'success',
          text: `Определено: ${result.country || 'страна неизвестна'}${result.ip ? `, IP ${result.ip}` : ''}`,
        });
      }
    } catch {
      setMessage({
        open: true,
        type: 'error',
        text: 'Не удалось определить страну ноды',
      });
    } finally {
      setDetectingLocation(false);
    }
  };

  const saveNode = async () => {
    if (!validateForm(!editing)) {
      setMessage({
        open: true,
        type: 'error',
        text: 'Заполните обязательные поля',
      });
      return;
    }

    const autoDomain = extractDomainFromUrl(form.url);
    const shouldSendSecret = !editing || secretDirty;
    const trimmedPassword = form.password?.trim();
    const trimmedToken = form.token?.trim();

    const payload: NodePayload = {
      name: form.name,
      url: form.url.replace(/\/+$/, ''),
      domain: form.domain !== undefined ? form.domain.trim() : autoDomain,
      ip: form.ip?.trim() || undefined,
      flag: form.flag || undefined,
      authType: form.authType,
      login: form.authType === 'password' ? form.login : undefined,
      password:
        form.authType === 'password' && shouldSendSecret && trimmedPassword
          ? trimmedPassword
          : undefined,
      token:
        form.authType === 'token' && shouldSendSecret && trimmedToken
          ? trimmedToken
          : undefined,
      isMain: form.isMain,
      allowInvalidTls: form.allowInvalidTls,
      ...(editing ? { syncSubscriptionLinks: true } : {}),
    };

    setSavingNode(true);
    try {
      if (editing) {
        await nodesApi.update(editing.id, payload);
      } else {
        await nodesApi.create(payload);
      }

      setOpen(false);
      setMessage({
        open: true,
        type: 'success',
        text: editing ? 'Нода обновлена' : 'Нода добавлена',
      });
      loadNodes();
    } catch (error: unknown) {
      setMessage({
        open: true,
        type: 'error',
        text: getApiErrorMessage(error, 'Не удалось сохранить ноду'),
      });
    } finally {
      setSavingNode(false);
    }
  };

  const checkFormConnection = async () => {
    if (!validateForm(true)) {
      setMessage({
        open: true,
        type: 'error',
        text: 'Заполните обязательные поля для проверки подключения',
      });
      return;
    }

    const shouldSendSecret = !editing || secretDirty;
    const trimmedPassword = form.password?.trim();
    const trimmedToken = form.token?.trim();

    setCheckingConnection(true);
    try {
      const result = await nodesApi.checkPayload({
        ...(editing ? { nodeId: editing.id } : {}),
        name: form.name,
        url: form.url.replace(/\/+$/, ''),
        domain: form.domain?.trim() || undefined,
        ip: form.ip?.trim() || undefined,
        flag: form.flag || undefined,
        authType: form.authType,
        login: form.authType === 'password' ? form.login : undefined,
        password:
          form.authType === 'password' && shouldSendSecret && trimmedPassword
            ? trimmedPassword
            : undefined,
        token:
          form.authType === 'token' && shouldSendSecret && trimmedToken
            ? trimmedToken
            : undefined,
        isMain: form.isMain,
        allowInvalidTls: form.allowInvalidTls,
      });

      setCheckFeedback(result);
      setMessage({
        open: true,
        type: result.success ? 'success' : 'error',
        text: result.success
          ? `Подключение успешно · 3x-ui ${result.version || '?'} · Xray ${result.xrayVersion || '?'}`
          : result.message || 'Не удалось подключиться',
      });
    } catch (error: unknown) {
      const text = getApiErrorMessage(error, 'Ошибка проверки подключения');
      setCheckFeedback({ success: false, message: text });
      setMessage({ open: true, type: 'error', text });
    } finally {
      setCheckingConnection(false);
    }
  };

  const handleRowCheck = async (node: NodeRecord) => {
    setRowCheckingId(node.id);
    try {
      const result = await nodesApi.check(node.id);
      setMessage({
        open: true,
        type: result.success ? 'success' : 'error',
        text: result.success
          ? `${node.name}: подключено${result.responseTimeMs !== undefined ? ` (${result.responseTimeMs} ms)` : ''} · 3x-ui ${result.version || '?'}`
          : `${node.name}: ${result.message || 'нет подключения'}${result.diagnostics?.hint ? ` — ${result.diagnostics.hint}` : ''}`,
      });
      loadNodes();
    } catch (error) {
      setMessage({
        open: true,
        type: 'error',
        text: getApiErrorMessage(error, 'Ошибка проверки ноды'),
      });
    } finally {
      setRowCheckingId(null);
    }
  };

  const handleMigrateUrlChange = (value: string) => {
    const prevAutoDomain = extractDomainFromUrl(migrateForm.url);
    const nextAutoDomain = extractDomainFromUrl(value);
    const prevUrlIp = extractIpFromUrl(migrateForm.url);
    const nextUrlIp = extractIpFromUrl(value);
    setMigrateForm((prev) => {
      const domainWasAuto = !prev.domain || prev.domain === prevAutoDomain;
      const shouldUpdateIp = Boolean(
        nextUrlIp && (!prev.ip || prev.ip === prevUrlIp || prevAutoDomain !== ''),
      );
      return {
        ...prev,
        url: value,
        domain: domainWasAuto ? nextAutoDomain : prev.domain,
        ip: shouldUpdateIp ? nextUrlIp : prev.ip,
      };
    });
    setMigrateErrors((prev) => ({ ...prev, url: undefined, ip: undefined }));
    setMigrateFeedback(null);
  };

  const detectMigrateLocation = async () => {
    const url = migrateForm.url.trim();
    if (!url) return;
    const prevAutoDomain = extractDomainFromUrl(url);
    setMigrateDetecting(true);
    try {
      const result = await nodesApi.detectLocation(url.replace(/\/+$/, ''));
      setMigrateForm((prev) => ({
        ...prev,
        ip: result.ip || prev.ip,
        flag: result.flag || prev.flag,
        domain:
          !prev.domain || prev.domain === prevAutoDomain
            ? result.domain || prevAutoDomain || ''
            : prev.domain,
      }));
      setMessage({
        open: true,
        type: 'success',
        text: result.resolvedIps?.length
          ? `DNS: ${result.resolvedIps.join(', ')}${result.flag ? ` ${result.flag}` : ''}`
          : result.ip
            ? `Определён IP ${result.ip}`
            : 'Параметры URL обновлены',
      });
    } catch {
      setMessage({
        open: true,
        type: 'error',
        text: 'Не удалось определить IP/страну по новому URL',
      });
    } finally {
      setMigrateDetecting(false);
    }
  };

  const switchMigrateToDirectIp = () => {
    const ip = migrateForm.ip.trim();
    if (!isValidIp(ip)) {
      setMigrateErrors((prev) => ({
        ...prev,
        ip: 'Сначала укажите корректный IP ноды',
      }));
      return;
    }
    const nextUrl = replaceUrlHostWithIp(migrateForm.url, ip);
    setMigrateForm((prev) => ({
      ...prev,
      url: nextUrl,
      domain: '',
      allowInvalidTls: nextUrl.startsWith('https://') ? true : prev.allowInvalidTls,
    }));
    setMigrateErrors((prev) => ({ ...prev, url: undefined, ip: undefined }));
    setMigrateFeedback(null);
  };

  const validateMigrateForm = () => {
    const errors: Partial<Record<keyof MigrateFormState, string>> = {};
    if (!migrateForm.url.trim()) errors.url = 'Введите новый URL панели';
    if (migrateForm.ip && !isValidIp(migrateForm.ip)) {
      errors.ip = 'Введите корректный IP ноды';
    }
    setMigrateErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const checkMigrateConnection = async () => {
    if (!migrateTarget || !validateMigrateForm()) return;
    setMigrateChecking(true);
    try {
      const result = await nodesApi.checkPayload({
        nodeId: migrateTarget.id,
        name: migrateTarget.name,
        url: migrateForm.url.replace(/\/+$/, ''),
        domain: migrateForm.domain.trim() || undefined,
        ip: migrateForm.ip.trim() || undefined,
        flag: migrateForm.flag || undefined,
        authType: migrateTarget.authType,
        login: migrateTarget.login,
        allowInvalidTls: migrateForm.allowInvalidTls,
        preferDirectIp: migrateForm.preferDirectIp,
      });
      setMigrateFeedback(result);
    } catch (error) {
      setMigrateFeedback({
        success: false,
        message: getApiErrorMessage(error, 'Не удалось проверить новый адрес'),
      });
    } finally {
      setMigrateChecking(false);
    }
  };

  const applyMigrateAddress = async () => {
    if (!migrateTarget || !validateMigrateForm()) return;
    setMigrateSaving(true);
    try {
      const result = await nodesApi.migrateAddress(migrateTarget.id, {
        url: migrateForm.url.replace(/\/+$/, ''),
        domain: migrateForm.domain.trim(),
        ip: migrateForm.ip.trim() || undefined,
        flag: migrateForm.flag || undefined,
        allowInvalidTls: migrateForm.allowInvalidTls,
        syncSubscriptionLinks: migrateForm.syncSubscriptionLinks,
        preferDirectIp: migrateForm.preferDirectIp,
      });
      setMigrateTarget(null);
      const tunnelWarning =
        result.affectedTunnels > 0
          ? ` · Реле/туннелей на ноде: ${result.affectedTunnels} (перепроверьте проброс)`
          : '';
      const inboundInfo = `Обновлено ссылок подписок: ${result.updatedInbounds}`;
      setMessage({
        open: true,
        type: result.connection.success ? 'success' : 'error',
        text: result.connection.success
          ? `Адрес обновлён и подключён · ${inboundInfo}${tunnelWarning}`
          : `Адрес сохранён, но панель не отвечает: ${result.connection.message || 'ошибка связи'} · ${inboundInfo}${tunnelWarning}`,
      });
      loadNodes();
    } catch (error) {
      setMessage({
        open: true,
        type: 'error',
        text: getApiErrorMessage(error, 'Не удалось применить новый адрес ноды'),
      });
    } finally {
      setMigrateSaving(false);
    }
  };

  const removeNode = async (mode: 'safe' | 'deferred' | 'force' = 'safe') => {
    if (!deleteTarget) return;
    try {
      const result = await nodesApi.remove(deleteTarget.id, mode);
      setDeleteTarget(null);
      setMessage({
        open: true,
        type: 'success',
        text: result.forced
          ? 'Нода и её инбаунды принудительно удалены из базы данных'
          : result.deferred
            ? 'Нода скрыта, удаление inbound продолжится в фоне'
            : 'Нода удалена',
      });
      loadNodes();
    } catch (error) {
      setMessage({
        open: true,
        type: 'error',
        text: getApiErrorMessage(error, 'Ошибка удаления ноды'),
      });
    }
  };

  const activeSecretKey = form.authType === 'password' ? 'password' : 'token';
  const showMaskedSecret = Boolean(editing && hasSavedCurrentSecret && !secretDirty);

  return (
    <Box className="workspace-page">
      <WorkspaceHeader
        eyebrow="ИНФРАСТРУКТУРА"
        title="Ноды"
        description="Доступность серверов, версии панелей и параметры подключений."
        meta={<Chip size="small" variant="outlined" label={`Нод: ${nodes.length}`} />}
        action={
          <Button startIcon={<Add />} variant="contained" onClick={openCreate}>
            Добавить
          </Button>
        }
      />

      <Paper className="workspace-panel workspace-table" sx={{ overflowX: 'auto' }}>
        <Table sx={{ minWidth: 1150 }}>
          <TableHead>
            <TableRow>
              <TableCell>Название</TableCell>
              <TableCell>Флаг</TableCell>
              <TableCell>IP</TableCell>
              <TableCell>URL панели</TableCell>
              <TableCell>Авторизация</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell align="right">Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {nodes.map((node) => {
              const statusChip = (
                <Chip
                  size="small"
                  variant="outlined"
                  label={node.healthStatus || 'unknown'}
                  color={
                    node.healthStatus === 'online'
                      ? 'success'
                      : node.healthStatus === 'offline' ||
                          node.healthStatus === 'auth_error'
                        ? 'error'
                        : node.healthStatus === 'degraded'
                          ? 'warning'
                          : 'default'
                  }
                />
              );

              return (
                <TableRow key={node.id}>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <IconButton
                        size="small"
                        onClick={() => nodesApi.setMain(node.id).then(loadNodes)}
                        title={node.isMain ? 'Основная нода' : 'Сделать основной'}
                        aria-label={
                          node.isMain
                            ? `${node.name} — основная нода`
                            : `Сделать ${node.name} основной нодой`
                        }
                      >
                        {node.isMain ? <Star color="warning" /> : <StarBorder />}
                      </IconButton>
                      <Typography fontWeight={700}>{node.name}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <FlagIcon flag={node.flag} />
                  </TableCell>
                  <TableCell>{node.ip || '-'}</TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      noWrap
                      title={node.url}
                      sx={{ maxWidth: 260 }}
                    >
                      {node.url}
                    </Typography>
                  </TableCell>
                  <TableCell>{node.authType}</TableCell>
                  <TableCell>
                    <Stack spacing={0.5}>
                      <Stack direction="row" spacing={0.75} flexWrap="wrap">
                        {node.isMain && (
                          <Chip
                            icon={<CheckCircle />}
                            label="Основная"
                            color="success"
                            size="small"
                          />
                        )}
                        {node.lastError ? (
                          <Tooltip title={node.lastError}>{statusChip}</Tooltip>
                        ) : (
                          statusChip
                        )}
                        {node.responseTimeMs !== undefined && (
                          <Chip size="small" label={`${node.responseTimeMs} ms`} />
                        )}
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`3x-ui ${node.version || '?'}`}
                        />
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`Xray ${node.xrayVersion || '?'}`}
                        />
                        {node.capabilities && (
                          <Chip
                            size="small"
                            variant="outlined"
                            color={
                              node.capabilities.autoTlsCertificate
                                ? 'success'
                                : 'warning'
                            }
                            label={
                              node.capabilities.autoTlsCertificate
                                ? 'TLS панели'
                                : 'TLS вручную'
                            }
                          />
                        )}
                      </Stack>
                      {node.lastError && node.healthStatus !== 'online' && (
                        <Typography
                          variant="caption"
                          color="error.main"
                          noWrap
                          title={node.lastError}
                          sx={{ maxWidth: 340 }}
                        >
                          {node.lastError}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      onClick={() => handleRowCheck(node)}
                      title="Проверить подключение"
                      aria-label={`Проверить подключение ${node.name}`}
                      disabled={rowCheckingId === node.id}
                    >
                      {rowCheckingId === node.id ? (
                        <CircularProgress size={18} />
                      ) : (
                        <NetworkCheck />
                      )}
                    </IconButton>
                    <IconButton
                      onClick={() => openMigrate(node)}
                      title="Быстрая смена адреса (IP / DNS)"
                      aria-label={`Быстрая смена адреса ${node.name}`}
                      disabled={node.healthStatus === 'deleting'}
                    >
                      <SwapHoriz />
                    </IconButton>
                    <IconButton
                      onClick={() => setSettingsNode(node)}
                      title="Быстрые настройки"
                      aria-label={`Быстрые настройки ${node.name}`}
                      disabled={node.healthStatus === 'deleting'}
                    >
                      <Settings />
                    </IconButton>
                    <IconButton
                      onClick={() => openEdit(node)}
                      aria-label={`Редактировать ${node.name}`}
                    >
                      <Edit />
                    </IconButton>
                    <IconButton
                      color="error"
                      onClick={() => setDeleteTarget(node)}
                      aria-label={`Удалить ${node.name}`}
                    >
                      <Delete />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
            {nodes.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ color: 'text.secondary' }}>
                  Ноды не добавлены
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      {settingsNode && (
        <RoutingPresetsDialog
          key={settingsNode.id}
          node={settingsNode}
          onClose={() => setSettingsNode(null)}
        />
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Редактировать ноду' : 'Новая нода'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Название"
              required
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              error={!!formErrors.name}
              helperText={formErrors.name}
            />
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextField
                label="URL панели 3x-ui"
                required
                fullWidth
                helperText={
                  formErrors.url ||
                  'Например: https://85.198.84.27:35366/2vIsDA5HanQ3R7JyIH'
                }
                value={form.url}
                onChange={(e) => handleUrlChange(e.target.value)}
                onBlur={detectNodeLocation}
                error={!!formErrors.url}
                InputProps={{
                  endAdornment: detectingLocation ? (
                    <CircularProgress size={18} />
                  ) : undefined,
                }}
              />
              <Button
                variant="outlined"
                onClick={detectNodeLocation}
                disabled={detectingLocation || !form.url.trim()}
                sx={{ mt: 0.5, whiteSpace: 'nowrap', minHeight: 40 }}
              >
                Определить по URL
              </Button>
            </Stack>
            <TextField
              label="Домен ноды"
              helperText="Определяется автоматически из ссылки (при переходе на прямой IP оставьте пустым)"
              value={form.domain || ''}
              onChange={(e) => updateField('domain', e.target.value)}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="IP ноды"
                required
                fullWidth
                value={form.ip || ''}
                onChange={(e) => updateField('ip', e.target.value)}
                error={!!formErrors.ip}
                helperText={formErrors.ip}
              />
              <FormControl fullWidth required error={!!formErrors.flag}>
                <InputLabel>Флаг</InputLabel>
                <Select
                  value={form.flag || ''}
                  label="Флаг"
                  onChange={(e) => updateField('flag', e.target.value)}
                  renderValue={(value) => (
                    <FlagOptionLabel
                      flag={value}
                      label={
                        countries.find((country) => country.emoji === value)
                          ?.name || 'Флаг'
                      }
                    />
                  )}
                >
                  <MenuItem value="">Без флага</MenuItem>
                  {countries.map((country) => (
                    <MenuItem key={country.code} value={country.emoji}>
                      <FlagOptionLabel
                        flag={country.emoji}
                        code={country.code}
                        label={country.name}
                      />
                    </MenuItem>
                  ))}
                </Select>
                {formErrors.flag && (
                  <FormHelperText>{formErrors.flag}</FormHelperText>
                )}
              </FormControl>
            </Stack>
            <FormControl fullWidth required>
              <InputLabel>Тип авторизации</InputLabel>
              <Select
                value={form.authType}
                label="Тип авторизации"
                onChange={(e) =>
                  handleAuthTypeChange(e.target.value as NodeAuthType)
                }
              >
                <MenuItem value="password">Логин и пароль</MenuItem>
                <MenuItem value="token">Токен</MenuItem>
              </Select>
            </FormControl>
            {form.authType === 'password' ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Логин"
                  required
                  fullWidth
                  value={form.login || ''}
                  onChange={(e) => updateField('login', e.target.value)}
                  error={!!formErrors.login}
                  helperText={formErrors.login}
                />
                <TextField
                  label={
                    editing && hasSavedPassword
                      ? showMaskedSecret
                        ? 'Пароль'
                        : 'Новый пароль'
                      : 'Пароль'
                  }
                  type="password"
                  required={!editing || !hasSavedPassword}
                  fullWidth
                  value={
                    showMaskedSecret ? MASKED_SECRET : form.password || ''
                  }
                  onChange={(e) =>
                    handleMaskedSecretChange('password', e.target.value)
                  }
                  error={!!formErrors.password}
                  helperText={
                    formErrors.password ||
                    (editing && hasSavedPassword
                      ? showMaskedSecret
                        ? 'Сохранён на сервере (просмотр скрыт). Оставьте без изменений или нажмите «Заменить».'
                        : 'Введите новый пароль или верните прежний'
                      : undefined)
                  }
                  InputProps={{
                    endAdornment:
                      editing && hasSavedPassword ? (
                        <InputAdornment position="end">
                          {showMaskedSecret ? (
                            <Stack
                              direction="row"
                              spacing={0.5}
                              alignItems="center"
                            >
                              <Chip
                                size="small"
                                label="Сохранён"
                                color="success"
                                variant="outlined"
                              />
                              <Button
                                size="small"
                                onClick={() => {
                                  setSecretDirty(true);
                                  updateField('password', '');
                                }}
                              >
                                Заменить
                              </Button>
                            </Stack>
                          ) : (
                            <Button
                              size="small"
                              onClick={() => {
                                setSecretDirty(false);
                                updateField('password', '');
                              }}
                            >
                              Оставить прежний
                            </Button>
                          )}
                        </InputAdornment>
                      ) : undefined,
                  }}
                />
              </Stack>
            ) : (
              <TextField
                label={
                  editing && hasSavedToken
                    ? showMaskedSecret
                      ? 'Токен'
                      : 'Новый токен'
                    : 'Токен'
                }
                type="password"
                required={!editing || !hasSavedToken}
                value={showMaskedSecret ? MASKED_SECRET : form.token || ''}
                onChange={(e) =>
                  handleMaskedSecretChange('token', e.target.value)
                }
                error={!!formErrors.token}
                helperText={
                  formErrors.token ||
                  (editing && hasSavedToken
                    ? showMaskedSecret
                      ? 'Сохранён на сервере (просмотр скрыт). Оставьте без изменений или нажмите «Заменить».'
                      : 'Введите новый токен или верните прежний'
                    : undefined)
                }
                InputProps={{
                  endAdornment:
                    editing && hasSavedToken ? (
                      <InputAdornment position="end">
                        {showMaskedSecret ? (
                          <Stack
                            direction="row"
                            spacing={0.5}
                            alignItems="center"
                          >
                            <Chip
                              size="small"
                              label="Сохранён"
                              color="success"
                              variant="outlined"
                            />
                            <Button
                              size="small"
                              onClick={() => {
                                setSecretDirty(true);
                                updateField('token', '');
                              }}
                            >
                              Заменить
                            </Button>
                          </Stack>
                        ) : (
                          <Button
                            size="small"
                            onClick={() => {
                              setSecretDirty(false);
                              updateField(activeSecretKey, '');
                            }}
                          >
                            Оставить прежний
                          </Button>
                        )}
                      </InputAdornment>
                    ) : undefined,
                }}
              />
            )}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch
                checked={!!form.isMain}
                onChange={(e) => updateField('isMain', e.target.checked)}
              />
              <Typography>Сделать основной нодой</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch
                checked={!!form.allowInvalidTls}
                onChange={(e) =>
                  updateField('allowInvalidTls', e.target.checked)
                }
              />
              <Box>
                <Typography>Разрешить недоверенный TLS-сертификат</Typography>
                <Typography variant="caption" color="warning.main">
                  Используйте для self-signed или при временном переходе на прямой IP
                </Typography>
              </Box>
            </Stack>
            {renderDiagnosticsAlert(checkFeedback)}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={checkFormConnection} disabled={checkingConnection}>
            {checkingConnection ? 'Проверка...' : 'Проверить подключение'}
          </Button>
          <Button onClick={() => setOpen(false)}>Отмена</Button>
          <Button
            variant="contained"
            onClick={saveNode}
            disabled={savingNode}
          >
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!migrateTarget}
        onClose={() => setMigrateTarget(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Быстрая смена адреса — {migrateTarget?.name}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              Токен/пароль панели сохраняются автоматически — перевыпускать API не нужно.
            </Alert>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button
                size="small"
                variant="outlined"
                onClick={detectMigrateLocation}
                disabled={migrateDetecting || !migrateForm.url.trim()}
              >
                {migrateDetecting ? 'Определение...' : 'Обновить IP по DNS'}
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="warning"
                onClick={switchMigrateToDirectIp}
              >
                Перейти на прямой IP
              </Button>
            </Stack>
            <TextField
              label="Новый URL панели 3x-ui"
              required
              value={migrateForm.url}
              onChange={(e) => handleMigrateUrlChange(e.target.value)}
              error={!!migrateErrors.url}
              helperText={
                migrateErrors.url ||
                'Измените домен, IP или порт панели — секрет авторизации не сбрасывается'
              }
            />
            <TextField
              label="Домен ноды (пусто = подключение по IP)"
              value={migrateForm.domain}
              onChange={(e) => {
                setMigrateForm((prev) => ({ ...prev, domain: e.target.value }));
                setMigrateFeedback(null);
              }}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="IP ноды"
                fullWidth
                value={migrateForm.ip}
                onChange={(e) => {
                  setMigrateForm((prev) => ({ ...prev, ip: e.target.value }));
                  setMigrateErrors((prev) => ({ ...prev, ip: undefined }));
                  setMigrateFeedback(null);
                }}
                error={!!migrateErrors.ip}
                helperText={migrateErrors.ip}
              />
              <FormControl fullWidth>
                <InputLabel>Флаг</InputLabel>
                <Select
                  value={migrateForm.flag}
                  label="Флаг"
                  onChange={(e) =>
                    setMigrateForm((prev) => ({ ...prev, flag: e.target.value }))
                  }
                  renderValue={(value) => (
                    <FlagOptionLabel
                      flag={value}
                      label={
                        countries.find((country) => country.emoji === value)
                          ?.name || 'Флаг'
                      }
                    />
                  )}
                >
                  <MenuItem value="">Без флага</MenuItem>
                  {countries.map((country) => (
                    <MenuItem key={country.code} value={country.emoji}>
                      <FlagOptionLabel
                        flag={country.emoji}
                        code={country.code}
                        label={country.name}
                      />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch
                checked={migrateForm.allowInvalidTls}
                onChange={(e) => {
                  setMigrateForm((prev) => ({
                    ...prev,
                    allowInvalidTls: e.target.checked,
                  }));
                  setMigrateFeedback(null);
                }}
              />
              <Typography>Разрешить недоверенный TLS-сертификат</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch
                checked={migrateForm.preferDirectIp}
                onChange={(e) => {
                  setMigrateForm((prev) => ({
                    ...prev,
                    preferDirectIp: e.target.checked,
                  }));
                  setMigrateFeedback(null);
                }}
              />
              <Box>
                <Typography>Подключаться напрямую по IP (в обход кэша DNS)</Typography>
                <Typography variant="caption" color="text.secondary">
                  Сохраняет TLS SNI домена при смене DNS
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch
                checked={migrateForm.syncSubscriptionLinks}
                onChange={(e) =>
                  setMigrateForm((prev) => ({
                    ...prev,
                    syncSubscriptionLinks: e.target.checked,
                  }))
                }
              />
              <Typography>
                Обновить адрес в активных ссылках подписок (без пересоздания инбаундов)
              </Typography>
            </Stack>
            {renderDiagnosticsAlert(migrateFeedback)}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={checkMigrateConnection} disabled={migrateChecking}>
            {migrateChecking ? 'Проверка...' : 'Проверить новый адрес'}
          </Button>
          <Button onClick={() => setMigrateTarget(null)}>Отмена</Button>
          <Button
            variant="contained"
            onClick={applyMigrateAddress}
            disabled={migrateSaving}
          >
            {migrateSaving ? 'Применение...' : 'Применить и адаптировать'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Удалить ноду {deleteTarget?.name}?</DialogTitle>
        <DialogContent>
          {nodes.length === 1 && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Это последняя нода. Подписки сохранятся, но их подключения останутся без рабочей ноды. При принудительном или отложенном удалении подключения будут отключены — после добавления новой ноды откройте подписку и сохраните её, чтобы активировать их заново.
            </Alert>
          )}
          <Typography>
            Выберите способ удаления в зависимости от доступности сервера:
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            • <b>Удалить безопасно</b>: удалит инбаунды на панели 3x-ui, затем удалит ноду из системы.<br />
            • <b>Удалить принудительно</b>: немедленно удалит ноду и её инбаунды из базы данных без обращений к 3x-ui (используйте, если сервер выключен или недоступен навсегда).<br />
            • <b>В фоне</b>: скроет ноду сейчас и продолжит попытки очистки инбаундов в фоне.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1, flexWrap: 'wrap' }}>
          <Button onClick={() => setDeleteTarget(null)}>Отмена</Button>
          <Button color="secondary" onClick={() => removeNode('deferred')}>
            В фоне
          </Button>
          <Button color="warning" onClick={() => removeNode('force')}>
            Удалить принудительно
          </Button>
          <Button color="error" variant="contained" onClick={() => removeNode('safe')}>
            Удалить безопасно
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={message.open}
        autoHideDuration={5000}
        onClose={() => setMessage({ ...message, open: false })}
      >
        <Alert severity={message.type}>{message.text}</Alert>
      </Snackbar>
    </Box>
  );
}
