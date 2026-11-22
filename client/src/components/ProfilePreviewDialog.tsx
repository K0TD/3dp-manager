import React, { useEffect, useState } from 'react';
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
import { ContentCopy, OpenInNew } from '@mui/icons-material';
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
  const [error, setError] = useState('');
  const [copiedMessage, setCopiedMessage] = useState('');
  const [preview, setPreview] = useState<ProfilePreviewResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setCopiedMessage('');

    api
      .post<ProfilePreviewResponse>('/profiles/preview', {
        kind,
        name: name?.trim() || undefined,
        nodeId: nodeId || undefined,
        port: port || 'random',
        sni: sni || undefined,
        settings,
      })
      .then((res) => {
        if (!cancelled) setPreview(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg =
            (err as { response?: { data?: { message?: string } } })?.response
              ?.data?.message || 'Не удалось сформировать предпросмотр профиля';
          setError(Array.isArray(msg) ? msg.join('; ') : String(msg));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, kind, name, nodeId, port, sni, settings]);

  const handleCopy = async (text: string, label: string) => {
    await copyToClipboard(text);
    setCopiedMessage(`${label} скопирован`);
  };

  const handleDownloadJson = () => {
    if (!preview) return;
    const content = JSON.stringify(preview.clientPreview.xrayClientJson, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(name || kind).replace(/[^a-zA-Z0-9._-]+/g, '-')}-xray.json`;
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

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Typography variant="h6" component="span">
            Предпросмотр и проверки · {kind}
          </Typography>
          {preview && (
            <Chip size="small" color={statusColor} label={statusLabel} />
          )}
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

            <Tabs value={tab} onChange={(_, value: number) => setTab(value)}>
              <Tab label="VLESS-ссылка" />
              <Tab label="Xray JSON (клиент)" />
              <Tab label="Серверный inbound (3x-ui)" />
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
                    onClick={handleDownloadJson}
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
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
};
