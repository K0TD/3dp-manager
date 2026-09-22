import { type ChangeEvent, useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Divider,
  FormControlLabel,
  Paper,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import api from '../api';
import { Logger } from '../utils/logger';
import { InboundsEditor } from '../components/InboundsEditor';
import type { NodeRecord } from '../types/node';
import type { CountryOption, Domain, InboundConfigUI, Tunnel } from '../types/inbound';
import {
  createBuiltinDefaultInbounds,
  isListedSni,
  isValidPort,
  parseDefaultInboundsSetting,
  sanitizeInboundForStorage,
} from '../utils/inboundUtils';

export default function SettingsPage() {
  const [adminProfile, setAdminProfile] = useState({
    login: '',
    password: '',
  });
  const [message, setMessage] = useState({
    open: false,
    type: 'success' as 'success' | 'error',
    text: '',
  });
  const [backupPassword, setBackupPassword] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [encryptBackup, setEncryptBackup] = useState(true);
  const [backupLoading, setBackupLoading] = useState(false);

  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [countries, setCountries] = useState<CountryOption[]>([]);
  const [defaultInbounds, setDefaultInbounds] = useState<InboundConfigUI[]>([]);
  const [defaultPortErrors, setDefaultPortErrors] = useState<Record<string, string>>({});
  const [savingDefaults, setSavingDefaults] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const { data } = await api.get<Record<string, string>>('/settings');
      if (data?.admin_login) {
        setAdminProfile((prev) => (prev.login ? prev : { ...prev, login: data.admin_login }));
      }
    } catch (error) {
      Logger.error('Failed to load profile settings', 'Settings', error);
    }
  }, []);

  const loadDefaultInboundsData = useCallback(async () => {
    try {
      const [settingsRes, nodesRes, tunnelsRes, domainsRes, countriesRes] =
        await Promise.allSettled([
          api.get<Record<string, string>>('/settings'),
          api.get<NodeRecord[]>('/nodes'),
          api.get<Tunnel[]>('/tunnels'),
          api.get<Domain[]>('/domains/all'),
          api.get<CountryOption[]>('/settings/countries'),
        ]);

      const settingsData: Record<string, string> =
        settingsRes.status === 'fulfilled' &&
        settingsRes.value?.data &&
        typeof settingsRes.value.data === 'object'
          ? settingsRes.value.data
          : {};

      const loadedNodes: NodeRecord[] =
        nodesRes.status === 'fulfilled' && Array.isArray(nodesRes.value?.data)
          ? nodesRes.value.data
          : [];
      const loadedTunnels: Tunnel[] =
        tunnelsRes.status === 'fulfilled' && Array.isArray(tunnelsRes.value?.data)
          ? tunnelsRes.value.data.filter((t) => t.isInstalled)
          : [];
      const loadedDomains: Domain[] =
        domainsRes.status === 'fulfilled' && Array.isArray(domainsRes.value?.data)
          ? domainsRes.value.data.filter((d) => d.isEnabled !== false)
          : [];
      const loadedCountries: CountryOption[] =
        countriesRes.status === 'fulfilled' && Array.isArray(countriesRes.value?.data)
          ? countriesRes.value.data
          : [];

      setNodes(loadedNodes);
      setTunnels(loadedTunnels);
      setDomains(loadedDomains);
      setCountries(loadedCountries);

      const parsedDefaults = parseDefaultInboundsSetting(
        settingsData.default_inbounds,
        loadedNodes,
        loadedDomains,
      );

      if (parsedDefaults && parsedDefaults.length > 0) {
        setDefaultInbounds(parsedDefaults);
      } else {
        setDefaultInbounds(createBuiltinDefaultInbounds(loadedNodes, loadedDomains));
      }
    } catch (error) {
      Logger.error('Failed to load default inbounds settings', 'Settings', error);
    }
  }, []);

  useEffect(() => {
    loadProfile();
    loadDefaultInboundsData();
  }, [loadProfile, loadDefaultInboundsData]);

  const handleChange =
    (field: 'login' | 'password') =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setAdminProfile((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const handleSave = async () => {
    if (!adminProfile.login.trim()) {
      setMessage({ open: true, type: 'error', text: 'Login is required' });
      return;
    }

    try {
      await api.post('/auth/update-profile', adminProfile);
      setAdminProfile((prev) => ({ ...prev, password: '' }));
      setMessage({ open: true, type: 'success', text: 'Profile updated' });
    } catch (error) {
      Logger.error('Update profile error', 'Settings', error);
      setMessage({ open: true, type: 'error', text: 'Failed to update profile' });
    }
  };

  const handleSaveDefaultInbounds = async () => {
    const nextPortErrors: Record<string, string> = {};
    for (const inbound of defaultInbounds) {
      if (inbound.type !== 'custom' && !isValidPort(inbound.port)) {
        nextPortErrors[inbound.id] = 'Порт: число 1-65535 или random';
      }
    }
    setDefaultPortErrors(nextPortErrors);
    if (Object.keys(nextPortErrors).length > 0) {
      setMessage({
        open: true,
        type: 'error',
        text: 'Пожалуйста, исправьте ошибки с портами',
      });
      return;
    }

    if (
      defaultInbounds.some(
        (inbound) =>
          inbound.type === 'mtproto-faketls' &&
          !isListedSni(inbound.sni, domains),
      )
    ) {
      setMessage({
        open: true,
        type: 'error',
        text: 'Выберите FakeTLS-домен из списка SNI',
      });
      return;
    }

    setSavingDefaults(true);
    try {
      const sanitized = defaultInbounds.map(sanitizeInboundForStorage);
      await api.post('/settings', {
        default_inbounds: JSON.stringify(sanitized),
      });
      setMessage({
        open: true,
        type: 'success',
        text: 'Стандартные инбаунды сохранены',
      });
    } catch (error) {
      Logger.error('Failed to save default inbounds', 'Settings', error);
      setMessage({
        open: true,
        type: 'error',
        text: 'Не удалось сохранить стандартные инбаунды',
      });
    } finally {
      setSavingDefaults(false);
    }
  };

  const handleResetDefaults = () => {
    setDefaultInbounds(createBuiltinDefaultInbounds(nodes, domains));
    setDefaultPortErrors({});
    setMessage({
      open: true,
      type: 'success',
      text: 'Инбаунды сброшены к значениям по умолчанию (не забудьте сохранить)',
    });
  };

  const exportBackup = async () => {
    if (!backupPassword) {
      setMessage({ open: true, type: 'error', text: 'Введите текущий пароль администратора' });
      return;
    }
    if (encryptBackup && !backupPassphrase.trim()) {
      setMessage({ open: true, type: 'error', text: 'Введите парольную фразу архива' });
      return;
    }
    setBackupLoading(true);
    try {
      const response = await api.post(
        '/backups/export',
        {
          currentPassword: backupPassword,
          passphrase: encryptBackup ? backupPassphrase : undefined,
        },
        { responseType: 'blob' },
      );
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `3dp-manager-${new Date().toISOString().slice(0, 10)}.3dp-backup`;
      anchor.click();
      URL.revokeObjectURL(url);
      setBackupPassword('');
      setBackupPassphrase('');
      setMessage({ open: true, type: 'success', text: 'Архив создан и скачан' });
    } catch (error) {
      Logger.error('Backup export failed', 'Settings', error);
      setMessage({ open: true, type: 'error', text: 'Не удалось создать архив' });
    } finally {
      setBackupLoading(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Box className="page-heading">
        <Box>
          <Typography variant="overline" color="primary">SYSTEM SETTINGS</Typography>
          <Typography variant="h3">Настройки</Typography>
        </Box>
      </Box>

      <Paper className="console-panel" sx={{ maxWidth: 760 }}>
        <Typography variant="h6">Профиль панели 3dp-manager</Typography>
        <Divider sx={{ my: 2 }} />
        <Stack spacing={2}>
          <TextField
            label="Логин"
            value={adminProfile.login}
            onChange={handleChange('login')}
            fullWidth
          />
          <TextField
            label="Новый пароль"
            type="password"
            value={adminProfile.password}
            onChange={handleChange('password')}
            helperText="Оставьте пустым, если не хотите менять пароль"
            fullWidth
          />
          <Box>
            <Button variant="contained" onClick={handleSave}>
              Сохранить
            </Button>
          </Box>
        </Stack>
      </Paper>

      <Paper className="console-panel" sx={{ maxWidth: 1200 }}>
        <Typography variant="overline" color="primary">SUBSCRIPTION DEFAULTS</Typography>
        <Typography variant="h5" sx={{ mt: 0.5 }}>Стандартные инбаунды подписок</Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          Настройте инбаунды по умолчанию, которые будут автоматически появляться при создании новой подписки. Можно добавлять инбаунды с разных нод и настраивать их параметры.
        </Typography>
        <InboundsEditor
          inbounds={defaultInbounds}
          onChange={setDefaultInbounds}
          nodes={nodes}
          tunnels={tunnels}
          domains={domains}
          countries={countries}
          portErrors={defaultPortErrors}
          onPortErrorsChange={setDefaultPortErrors}
          onResetDefaults={handleResetDefaults}
        />
        <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
          <Button
            variant="contained"
            disabled={savingDefaults}
            onClick={handleSaveDefaultInbounds}
          >
            {savingDefaults ? 'Сохранение…' : 'Сохранить стандартные инбаунды'}
          </Button>
          <Button
            variant="outlined"
            onClick={handleResetDefaults}
          >
            Сбросить по умолчанию
          </Button>
        </Stack>
      </Paper>

      <Paper className="console-panel" sx={{ maxWidth: 760 }}>
        <Typography variant="overline" color="primary">PORTABLE BACKUP</Typography>
        <Typography variant="h5" sx={{ mt: 0.5 }}>Перенос панели</Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          Архив содержит подписки, UUID, настройки, ноды и реквизиты relay. Домен и TLS на новом сервере настраиваются заново.
        </Typography>
        <Stack spacing={2}>
          <TextField
            label="Текущий пароль администратора"
            type="password"
            value={backupPassword}
            onChange={(event) => setBackupPassword(event.target.value)}
          />
          <FormControlLabel
            control={<Switch checked={encryptBackup} onChange={(event) => setEncryptBackup(event.target.checked)} />}
            label="Зашифровать архив"
          />
          {encryptBackup ? (
            <TextField
              label="Парольная фраза архива"
              type="password"
              value={backupPassphrase}
              onChange={(event) => setBackupPassphrase(event.target.value)}
              helperText="Она потребуется при восстановлении и нигде не сохраняется"
            />
          ) : (
            <Alert severity="warning">Открытый архив содержит пароли нод и SSH-ключи.</Alert>
          )}
          <Box><Button variant="contained" disabled={backupLoading} onClick={exportBackup}>{backupLoading ? 'Создание…' : 'Скачать полный архив'}</Button></Box>
        </Stack>
      </Paper>

      <Snackbar
        open={message.open}
        autoHideDuration={5000}
        onClose={() => setMessage({ ...message, open: false })}
      >
        <Alert severity={message.type}>{message.text}</Alert>
      </Snackbar>
    </Stack>
  );
}
