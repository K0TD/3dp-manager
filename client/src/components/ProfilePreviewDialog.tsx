import React, { useCallback, useEffect, useState } from 'react';
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
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { ContentCopy, OpenInNew, Refresh } from '@mui/icons-material';
import api from '../api';
import { copyToClipboard } from '../utils/copyToClipboard';
import type {
  ManagedProfileKind,
  ManagedProfileSettings,
  ProfilePreviewResponse,
} from '../types/inbound';

export interface ProfilePreviewDialogProps {
  open: boolean;
  onClose: () => void;
  kind: ManagedProfileKind;
  name?: string;
  nodeId?: string;
  port?: string;
  sni?: string;
  settings?: ManagedProfileSettings;
}

export const ProfilePreviewDialog: React.FC<ProfilePreviewDialogProps> = ({
  open,
  onClose,
  kind,
  name,
  nodeId,
  port,
  sni,
  settings,
}) => {
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [liveChecking, setLiveChecking] = useState(false);
  const [error, setError] = useState('');
  const [copiedMessage, setCopiedMessage] = useState('');
  const [preview, setPreview] = useState<ProfilePreviewResponse | null>(null);

  const fetchPreview = useCallback(
    async (liveCheck: boolean) => {
      if (liveCheck) {
        setLiveChecking(true);
      } else {
        setLoading(true);
      }
      setError('');
      setCopiedMessage('');

      try {
        const res = await api.post<ProfilePreviewResponse>('/profiles/preview', {
          kind,
          name: name?.trim() || undefined,
          nodeId: nodeId || undefined,
          port: port || 'random',
          sni: sni || undefined,
          settings,
          liveCheck,
        });
        setPreview(res.data);
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { message?: string } } })?.response
            ?.data?.message || 'Не удалось сформировать предпросмотр профиля';
        setError(Array.isArray(msg) ? msg.join('; ') : String(msg));
      } finally {
        setLoading(false);
        setLiveChecking(false);
      }
    },
    [kind, name, nodeId, port, sni, settings],
  );

  useEffect(() => {
    if (!open) return;
    setTab(0);
    void fetchPreview(false);
  }, [open, fetchPreview]);

  const handleCopy = async (text: string, label: string) => {
    await copyToClipboard(text);
    setCopiedMessage(`${label} скопирован`);
  };

  const handleDownloadText = (
    content: string,
    filename: string,
    mimeType = 'text/plain;charset=utf-8',
  ) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const statusColor =
    preview?.compatibility.status === 'passed'
      ? 'success'
      : preview?.compatibility.status === 'warning'
        ? 'warning'
        : 'error';

  const statusLabel =
    preview?.compatibility.status === 'passed'
      ? 'Совместимо'
      : preview?.compatibility.status === 'warning'
        ? 'Есть предупреждения'
        : 'Заблокировано проверками';

  const hasWebServerConfig = Boolean(preview?.webServerConfig);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          justifyContent="space-between"
          flexWrap="wrap"
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="h6" component="span">
              Предпросмотр и проверки · {kind}
            </Typography>
            {preview && (
              <Chip size="small" color={statusColor} label={statusLabel} />
            )}
          </Stack>
          <Button
            size="small"
            variant="outlined"
            startIcon={<Refresh />}
            disabled={loading || liveChecking}
            onClick={() => void fetchPreview(true)}
          >
            {liveChecking
              ? 'Проверка DNS / TLS…'
              : 'Проверить домен и сертификат (live)'}
          </Button>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Stack alignItems="center" py={4} spacing={1.5}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">
              Проверка совместимости и генерация конфигураций…
            </Typography>
          </Stack>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {copiedMessage && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {copiedMessage}
          </Alert>
        )}

        {!loading && preview && (
          <Stack spacing={2}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Результаты проверок совместимости
              </Typography>
              <Stack spacing={1}>
                {preview.compatibility.checks.map((item) => (
                  <Alert
                    key={item.code}
                    severity={
                      item.severity === 'ok'
                        ? 'success'
                        : item.severity === 'warning'
                          ? 'warning'
                          : 'error'
                    }
                    sx={{ py: 0.25 }}
                  >
                    <strong>{item.title}:</strong> {item.message}
                  </Alert>
                ))}
              </Stack>
            </Box>

            {preview.tlsProbe && (
              <Alert
                severity={preview.tlsProbe.reachable ? 'info' : 'warning'}
                sx={{ py: 0.5 }}
              >
                <strong>
                  Live-проверка {preview.tlsProbe.domain}:{preview.tlsProbe.port}
                </strong>{' '}
                ({preview.tlsProbe.durationMs} мс) — DNS:{' '}
                {preview.tlsProbe.dnsResolvedIps.length
                  ? preview.tlsProbe.dnsResolvedIps.join(', ')
                  : 'нет'}
                {preview.tlsProbe.tlsProtocol
                  ? ` · TLS: ${preview.tlsProbe.tlsProtocol}`
                  : ''}
                {preview.tlsProbe.alpnProtocol
                  ? ` · ALPN: ${preview.tlsProbe.alpnProtocol}`
                  : ''}
                {typeof preview.tlsProbe.httpStatusCode === 'number'
                  ? ` · HTTP: ${preview.tlsProbe.httpStatusCode}`
                  : ''}
              </Alert>
            )}

            <Tabs value={tab} onChange={(_, value: number) => setTab(value)}>
              <Tab label="VLESS-ссылка" />
              <Tab label="Xray JSON (клиент)" />
              <Tab label="Серверный inbound (3x-ui)" />
              {hasWebServerConfig && (
                <Tab
                  label={`${preview.webServerConfig?.engine === 'caddy' ? 'Caddy' : 'Nginx'} конфиг`}
                />
              )}
            </Tabs>

            {tab === 0 && (
              <Stack spacing={1}>
                <TextField
                  multiline
                  fullWidth
                  minRows={4}
                  value={preview.clientPreview.vlessLink}
                  slotProps={{
                    input: {
                      readOnly: true,
                      sx: { fontFamily: 'monospace', fontSize: 12 },
                    },
                  }}
                />
                <Box>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ContentCopy />}
                    onClick={() =>
                      void handleCopy(
                        preview.clientPreview.vlessLink,
                        'VLESS-профиль',
                      )
                    }
                  >
                    Копировать VLESS-ссылку
                  </Button>
                </Box>
              </Stack>
            )}

            {tab === 1 && (
              <Stack spacing={1}>
                <TextField
                  multiline
                  fullWidth
                  minRows={12}
                  value={JSON.stringify(
                    preview.clientPreview.xrayClientJson,
                    null,
                    2,
                  )}
                  slotProps={{
                    input: {
                      readOnly: true,
                      sx: { fontFamily: 'monospace', fontSize: 12 },
                    },
                  }}
                />
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ContentCopy />}
                    onClick={() =>
                      void handleCopy(
                        JSON.stringify(
                          preview.clientPreview.xrayClientJson,
                          null,
                          2,
                        ),
                        'Xray JSON',
                      )
                    }
                  >
                    Копировать JSON
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<OpenInNew />}
                    onClick={() =>
                      handleDownloadText(
                        JSON.stringify(
                          preview.clientPreview.xrayClientJson,
                          null,
                          2,
                        ),
                        `${(name || kind).replace(/[^a-zA-Z0-9._-]+/g, '-')}-xray.json`,
                        'application/json',
                      )
                    }
                  >
                    Скачать .json
                  </Button>
                </Stack>
              </Stack>
            )}

            {tab === 2 && (
              <Stack spacing={1}>
                <Alert severity="info" sx={{ py: 0.25 }}>
                  Приватный ключ REALITY генерируется непосредственно на ноде и
                  никогда не передаётся в API, логах или клиентских конфигах.
                </Alert>
                <TextField
                  multiline
                  fullWidth
                  minRows={12}
                  value={JSON.stringify(preview.serverPreview, null, 2)}
                  slotProps={{
                    input: {
                      readOnly: true,
                      sx: { fontFamily: 'monospace', fontSize: 12 },
                    },
                  }}
                />
              </Stack>
            )}

            {tab === 3 && preview.webServerConfig && (
              <Stack spacing={1.5}>
                <Alert severity="info" sx={{ py: 0.5 }}>
                  Целевой файл на ноде:{' '}
                  <code>{preview.webServerConfig.filename}</code>. Применяйте
                  вручную с предварительным бэкапом и проверкой синтаксиса (без
                  автоматических изменений production-узла).
                </Alert>

                <TextField
                  multiline
                  fullWidth
                  minRows={12}
                  label={`Конфигурация ${preview.webServerConfig.engine.toUpperCase()}`}
                  value={preview.webServerConfig.config}
                  slotProps={{
                    input: {
                      readOnly: true,
                      sx: { fontFamily: 'monospace', fontSize: 12 },
                    },
                  }}
                />

                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<ContentCopy />}
                    onClick={() =>
                      void handleCopy(
                        preview.webServerConfig!.config,
                        `Конфиг ${preview.webServerConfig!.engine.toUpperCase()}`,
                      )
                    }
                  >
                    Копировать конфиг
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<OpenInNew />}
                    onClick={() =>
                      handleDownloadText(
                        preview.webServerConfig!.config,
                        `${preview.webServerConfig!.purpose}-${preview.webServerConfig!.domain}.${preview.webServerConfig!.engine === 'caddy' ? 'caddy' : 'conf'}`,
                      )
                    }
                  >
                    Скачать конфиг
                  </Button>
                  {preview.webServerConfig.staticSiteHtml && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<ContentCopy />}
                      onClick={() =>
                        void handleCopy(
                          preview.webServerConfig!.staticSiteHtml!,
                          'index.html локального сайта',
                        )
                      }
                    >
                      Копировать index.html
                    </Button>
                  )}
                </Stack>

                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    Безопасное применение и откат на ноде
                  </Typography>
                  <TextField
                    multiline
                    fullWidth
                    minRows={5}
                    value={[
                      `# 1. Бэкап существующего конфига`,
                      preview.webServerConfig.backupCommand,
                      `# 2. Проверка синтаксиса`,
                      preview.webServerConfig.validateCommand,
                      `# 3. Применение (reload)`,
                      preview.webServerConfig.reloadCommand,
                      `# 4. Откат при проблеме`,
                      preview.webServerConfig.rollbackCommand,
                    ].join('\n')}
                    slotProps={{
                      input: {
                        readOnly: true,
                        sx: { fontFamily: 'monospace', fontSize: 11.5 },
                      },
                    }}
                  />
                </Box>

                {preview.webServerConfig.notes.length > 0 && (
                  <Stack spacing={0.5}>
                    {preview.webServerConfig.notes.map((note, idx) => (
                      <Alert key={idx} severity="warning" sx={{ py: 0.25 }}>
                        {note}
                      </Alert>
                    ))}
                  </Stack>
                )}
              </Stack>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
};
