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
  Typography,
} from '@mui/material';
import {
  Add,
  CheckCircle,
  Delete,
  Edit,
  Settings,
  Star,
  StarBorder,
} from '@mui/icons-material';
import api from '../api';
import { nodesApi } from '../features/nodes/api';
import { RoutingPresetsDialog } from '../features/nodes/RoutingPresetsDialog';
import type { NodeAuthType, NodePayload, NodeRecord } from '../types/node';
import { getApiErrorMessage } from '../utils/errorHandlers';
import { FlagIcon, FlagOptionLabel } from '../utils/flags';

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

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NodeRecord | null>(null);
  const [settingsNode, setSettingsNode] = useState<NodeRecord | null>(null);
  const [form, setForm] = useState<NodePayload>(emptyForm);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<NodeRecord | null>(null);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof NodePayload, string>>>({});
  const [message, setMessage] = useState({
    open: false,
    type: 'success' as 'success' | 'error',
    text: '',
  });

  const loadNodes = useCallback(async () => {
    const data = await nodesApi.list();
    setNodes(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    loadNodes();
    api.get<CountryOption[]>('/settings/countries').then((res) => setCountries(Array.isArray(res.data) ? res.data : []));
  }, [loadNodes]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormErrors({});
    setOpen(true);
  };

  const openEdit = (node: NodeRecord) => {
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
    setFormErrors({});
    setOpen(true);
  };

  const updateField = <K extends keyof NodePayload>(key: K, value: NodePayload[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const handleUrlChange = (value: string) => {
    const prevAutoDomain = extractDomainFromUrl(form.url);
    const nextAutoDomain = extractDomainFromUrl(value);
    setForm((prev) => {
      const shouldUpdateDomain = !prev.domain || prev.domain === prevAutoDomain;
      return {
        ...prev,
        url: value,
        domain: shouldUpdateDomain && nextAutoDomain ? nextAutoDomain : prev.domain,
      };
    });
    setFormErrors((prev) => ({ ...prev, url: undefined }));
  };

  const validateForm = (requireSecrets = !editing) => {
    const errors: Partial<Record<keyof NodePayload, string>> = {};

    if (!form.name.trim()) errors.name = 'Введите название ноды';
    if (!form.url.trim()) errors.url = 'Введите URL панели 3x-ui';
    if (!isValidIp(form.ip)) errors.ip = 'Введите корректный IP ноды';
    if (!form.flag) errors.flag = 'Выберите флаг ноды';

    if (form.authType === 'password') {
      if (!form.login?.trim()) errors.login = 'Введите логин';
      if (requireSecrets && !form.password?.trim()) errors.password = 'Введите пароль';
    }

    if (form.authType === 'token' && requireSecrets && !form.token?.trim()) {
      errors.token = 'Введите токен';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const detectNodeLocation = async () => {
    const url = form.url.trim();
    if (!url) return;

    const autoDomain = extractDomainFromUrl(url);
    setDetectingLocation(true);
    try {
      const result = await nodesApi.detectLocation(url.replace(/\/+$/, ''));
      setForm((prev) => ({
        ...prev,
        ip: result.ip || prev.ip,
        flag: result.flag || prev.flag,
        domain: prev.domain || result.domain || autoDomain || '',
      }));
      if (result.country || result.ip) {
        setMessage({
          open: true,
          type: 'success',
          text: `Определено: ${result.country || 'страна неизвестна'}${result.ip ? `, IP ${result.ip}` : ''}`,
        });
      }
    } catch {
      setMessage({ open: true, type: 'error', text: 'Не удалось определить страну ноды' });
    } finally {
      setDetectingLocation(false);
    }
  };

  const saveNode = async () => {
    if (!validateForm(!editing)) {
      setMessage({ open: true, type: 'error', text: 'Заполните обязательные поля' });
      return;
    }

    const autoDomain = extractDomainFromUrl(form.url);
    const payload: NodePayload = {
      ...form,
      url: form.url.replace(/\/+$/, ''),
      domain: form.domain?.trim() || autoDomain || undefined,
      ip: form.ip || undefined,
      flag: form.flag || undefined,
      login: form.authType === 'password' ? form.login : undefined,
      password: form.authType === 'password' && form.password ? form.password : undefined,
      token: form.authType === 'token' && form.token ? form.token : undefined,
    };

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
      const text =
        (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Не удалось сохранить ноду';
      setMessage({ open: true, type: 'error', text });
    }
  };

  const checkFormConnection = async () => {
    if (!validateForm(true)) {
      setMessage({ open: true, type: 'error', text: 'Заполните обязательные поля для проверки подключения' });
      return;
    }

    const result = await nodesApi.checkPayload({
      ...form,
      url: form.url.replace(/\/+$/, ''),
      login: form.authType === 'password' ? form.login : undefined,
      password: form.authType === 'password' ? form.password : undefined,
      token: form.authType === 'token' ? form.token : undefined,
    });

    setMessage({
      open: true,
      type: result.success ? 'success' : 'error',
      text: result.success
        ? `Подключение успешно · 3x-ui ${result.version || '?'} · Xray ${result.xrayVersion || '?'}`
        : result.message || 'Не удалось подключиться',
    });
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

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3, gap: 2 }}>
        <Box>
          <Typography variant="h4">Ноды</Typography>
        </Box>
        <Box>
          <Stack direction="row" spacing={1}>
            <Button startIcon={<Add />} variant="contained" onClick={openCreate}>
              Добавить
            </Button>
          </Stack>
        </Box>
      </Box>

      <Paper sx={{ overflowX: 'auto' }}>
        <Table>
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
            {nodes.map((node) => (
              <TableRow key={node.id}>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <IconButton size="small" onClick={() => nodesApi.setMain(node.id).then(loadNodes)} title={node.isMain ? '' : 'Сделать основной'}>
                      {node.isMain ? <Star color="warning" /> : <StarBorder />}
                    </IconButton>
                    <Typography fontWeight={700}>{node.name}</Typography>
                  </Stack>
                </TableCell>
                <TableCell>
                  <FlagIcon flag={node.flag} />
                </TableCell>
                <TableCell>{node.ip || '-'}</TableCell>
                <TableCell>{node.url}</TableCell>
                <TableCell>{node.authType}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap">
                    {node.isMain && <Chip icon={<CheckCircle />} label="Основная" color="success" size="small" />}
                    <Chip
                      size="small"
                      variant="outlined"
                      label={node.healthStatus || 'unknown'}
                      color={
                        node.healthStatus === 'online'
                          ? 'success'
                          : node.healthStatus === 'offline' || node.healthStatus === 'auth_error'
                            ? 'error'
                            : node.healthStatus === 'degraded'
                              ? 'warning'
                              : 'default'
                      }
                    />
                    {node.responseTimeMs !== undefined && <Chip size="small" label={`${node.responseTimeMs} ms`} />}
                    <Chip size="small" variant="outlined" label={`3x-ui ${node.version || '?'}`} />
                    <Chip size="small" variant="outlined" label={`Xray ${node.xrayVersion || '?'}`} />
                    {node.capabilities && (
                      <Chip
                        size="small"
                        variant="outlined"
                        color={node.capabilities.autoTlsCertificate ? 'success' : 'warning'}
                        label={node.capabilities.autoTlsCertificate ? 'TLS панели' : 'TLS вручную'}
                      />
                    )}
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <IconButton onClick={() => setSettingsNode(node)} title="Быстрые настройки"
                    aria-label={`Быстрые настройки ${node.name}`} disabled={node.healthStatus === 'deleting'}>
                    <Settings />
                  </IconButton>
                  <IconButton onClick={() => openEdit(node)}>
                    <Edit />
                  </IconButton>
                  <IconButton color="error" onClick={() => setDeleteTarget(node)}>
                    <Delete />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
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

      {settingsNode && <RoutingPresetsDialog key={settingsNode.id} node={settingsNode} onClose={() => setSettingsNode(null)} />}

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
            <TextField
              label="URL панели 3x-ui"
              required
              helperText={formErrors.url || 'Например: https://85.198.84.27:35366/2vIsDA5HanQ3R7JyIH'}
              value={form.url}
              onChange={(e) => handleUrlChange(e.target.value)}
              onBlur={detectNodeLocation}
              error={!!formErrors.url}
              InputProps={{ endAdornment: detectingLocation ? <CircularProgress size={18} /> : undefined }}
            />
            <TextField
              label="Домен ноды"
              helperText="Определяется автоматически из ссылки (при необходимости можно изменить)"
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
                    <FlagOptionLabel flag={value} label={countries.find((country) => country.emoji === value)?.name || 'Флаг'} />
                  )}
                >
                  <MenuItem value="">Без флага</MenuItem>
                  {countries.map((country) => (
                    <MenuItem key={country.code} value={country.emoji}>
                      <FlagOptionLabel flag={country.emoji} code={country.code} label={country.name} />
                    </MenuItem>
                  ))}
                </Select>
                {formErrors.flag && <FormHelperText>{formErrors.flag}</FormHelperText>}
              </FormControl>
            </Stack>
            <FormControl fullWidth required>
              <InputLabel>Тип авторизации</InputLabel>
              <Select
                value={form.authType}
                label="Тип авторизации"
                onChange={(e) => updateField('authType', e.target.value as NodeAuthType)}
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
                  label={editing ? 'Новый пароль' : 'Пароль'}
                  type="password"
                  required={!editing}
                  fullWidth
                  value={form.password || ''}
                  onChange={(e) => updateField('password', e.target.value)}
                  error={!!formErrors.password}
                  helperText={formErrors.password || (editing ? 'Оставьте пустым, чтобы не менять пароль' : undefined)}
                />
              </Stack>
            ) : (
              <TextField
                label={editing ? 'Новый токен' : 'Токен'}
                type="password"
                required={!editing}
                value={form.token || ''}
                onChange={(e) => updateField('token', e.target.value)}
                error={!!formErrors.token}
                helperText={formErrors.token || (editing ? 'Оставьте пустым, чтобы не менять токен' : undefined)}
              />
            )}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch checked={!!form.isMain} onChange={(e) => updateField('isMain', e.target.checked)} />
              <Typography>Сделать основной нодой</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Switch
                checked={!!form.allowInvalidTls}
                onChange={(e) => updateField('allowInvalidTls', e.target.checked)}
              />
              <Box>
                <Typography>Разрешить недоверенный TLS-сертификат</Typography>
                <Typography variant="caption" color="warning.main">Используйте только для self-signed нод</Typography>
              </Box>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={checkFormConnection}>Проверить подключение</Button>
          <Button onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={saveNode}>Сохранить</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Удалить ноду {deleteTarget?.name}?</DialogTitle>
        <DialogContent>
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
          <Button color="secondary" onClick={() => removeNode('deferred')}>В фоне</Button>
          <Button color="warning" onClick={() => removeNode('force')}>Удалить принудительно</Button>
          <Button color="error" variant="contained" onClick={() => removeNode('safe')}>Удалить безопасно</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={message.open} autoHideDuration={5000} onClose={() => setMessage({ ...message, open: false })}>
        <Alert severity={message.type}>{message.text}</Alert>
      </Snackbar>
    </Box>
  );
}
