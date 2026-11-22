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
  initialTab?: number;
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
  initialTab = 0,
}) => {
  const [tab, setTab] = useState(initialTab);
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
    setTab(initialTab);
    void fetchPreview(false);
  }, [open, initialTab, fetchPreview]);

  useEffect(() => {
    if (!preview) return;
    if (tab === 3 && !preview.webServerConfig) {
      setTab(0);
    }
  }, [preview, tab]);

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

            <Tabs
              value={tab === 3 && !hasWebServerConfig ? 0 : tab}
              onChange={(_, value: number) => setTab(value)}
            >
              <Tab label="VLESS-ссылка" />
              <Tab label="Xray JSON (клиент)" />
              <Tab label="Серверный inbound (3x-ui)" />
              {hasWebServerConfig && (
                <Tab
                  label={`${preview.webServerConfig?.engine === 'caddy' ? 'Caddy' : 'Nginx'} шаблон и инструкция`}
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

            {tab === 3 && preview.webServerConfig && (() => {
              const ws = preview.webServerConfig;
              const engineTitle = ws.engine === 'caddy' ? 'Caddy' : 'Nginx';
              const writeConfigCommand = [
                `sudo mkdir -p "$(dirname "${ws.filename}")"`,
                `sudo tee "${ws.filename}" > /dev/null <<'EOF'`,
                ws.config.trimEnd(),
                'EOF',
              ].join('\n');
              const staticSiteCommand =
                ws.staticSitePath && ws.staticSiteHtml
                  ? [
                      `sudo mkdir -p "$(dirname "${ws.staticSitePath}")"`,
                      `sudo tee "${ws.staticSitePath}" > /dev/null <<'EOF'`,
                      ws.staticSiteHtml.trimEnd(),
                      'EOF',
                    ].join('\n')
                  : '';
              const applyCommands = [
                '# 1. Бэкап существующего конфига',
                ws.backupCommand,
                '# 2. Проверка синтаксиса',
                ws.validateCommand,
                '# 3. Применение (reload)',
                ws.reloadCommand,
                '# 4. Откат при проблеме',
                ws.rollbackCommand,
              ].join('\n');

              return (
                <Stack spacing={1.5}>
                  <Alert severity="info" sx={{ py: 0.5 }}>
                    <strong>Пошаговая установка {engineTitle} на ноде:</strong>{' '}
                    целевой файл <code>{ws.filename}</code>. Выполняйте команды
                    на VPS самой ноды с предварительным бэкапом и проверкой
                    синтаксиса (без автоматического SSH-вмешательства).
                  </Alert>

                  {ws.notes.length > 0 && (
                    <Stack spacing={0.5}>
                      {ws.notes.map((note, idx) => (
                        <Alert key={idx} severity="warning" sx={{ py: 0.25 }}>
                          {note}
                        </Alert>
                      ))}
                    </Stack>
                  )}

                  {staticSiteCommand && (
                    <Box>
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                        sx={{ mb: 0.5 }}
                      >
                        <Typography variant="subtitle2">
                          Шаг 1. Создать статическую страницу сайта-маскировки (
                          <code>{ws.staticSitePath}</code>)
                        </Typography>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<ContentCopy />}
                          onClick={() =>
                            void handleCopy(
                              staticSiteCommand,
                              'Команда создания index.html',
                            )
                          }
                        >
                          Копировать команду
                        </Button>
                      </Stack>
                      <TextField
                        multiline
                        fullWidth
                        minRows={4}
                        maxRows={8}
                        value={staticSiteCommand}
                        slotProps={{
                          input: {
                            readOnly: true,
                            sx: { fontFamily: 'monospace', fontSize: 11.5 },
                          },
                        }}
                      />
                    </Box>
                  )}

                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                      {staticSiteCommand ? 'Шаг 2.' : 'Шаг 1.'} Конфигурация{' '}
                      {engineTitle} (<code>{ws.filename}</code>)
                    </Typography>
                    <TextField
                      multiline
                      fullWidth
                      minRows={12}
                      value={ws.config}
                      slotProps={{
                        input: {
                          readOnly: true,
                          sx: { fontFamily: 'monospace', fontSize: 12 },
                        },
                      }}
                    />
                  </Box>

                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<ContentCopy />}
                      onClick={() =>
                        void handleCopy(
                          writeConfigCommand,
                          `Команда записи конфига ${engineTitle}`,
                        )
                      }
                    >
                      Копировать команду установки конфига
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<ContentCopy />}
                      onClick={() =>
                        void handleCopy(ws.config, `Конфиг ${engineTitle}`)
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
                          ws.config,
                          `${ws.purpose}-${ws.domain}.${ws.engine === 'caddy' ? 'caddy' : 'conf'}`,
                        )
                      }
                    >
                      Скачать конфиг
                    </Button>
                    {ws.staticSiteHtml && (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ContentCopy />}
                        onClick={() =>
                          void handleCopy(
                            ws.staticSiteHtml!,
                            'index.html локального сайта',
                          )
                        }
                      >
                        Копировать index.html
                      </Button>
                    )}
                  </Stack>

                  <Box>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      sx={{ mb: 0.5 }}
                    >
                      <Typography variant="subtitle2">
                        {staticSiteCommand ? 'Шаг 3.' : 'Шаг 2.'} Бэкап,
                        проверка синтаксиса, reload и откат
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ContentCopy />}
                        onClick={() =>
                          void handleCopy(
                            applyCommands,
                            'Команды применения и отката',
                          )
                        }
                      >
                        Копировать команды
                      </Button>
                    </Stack>
                    <TextField
                      multiline
                      fullWidth
                      minRows={6}
                      value={applyCommands}
                      slotProps={{
                        input: {
                          readOnly: true,
                          sx: { fontFamily: 'monospace', fontSize: 11.5 },
                        },
                      }}
                    />
                  </Box>
                </Stack>
              );
            })()}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
};
