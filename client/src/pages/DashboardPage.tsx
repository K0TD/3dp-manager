import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  Autorenew,
  CheckCircle,
  CloudOff,
  ContentCopy,
  DeleteSweep,
  Error as ErrorIcon,
  ExpandMore,
  Hub,
  People,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import type { NodeRecord } from '../types/node';
import { FlagIcon } from '../utils/flags';
import { copyToClipboard } from '../utils/copyToClipboard';

export interface OperationErrorDetails {
  title: string;
  hint: string;
  code: string;
  stage: string;
  node?: string;
  inboundType?: string;
  port?: number;
  raw: string;
}

interface InboundDiagnostic {
  xuiId?: number;
  tag?: string;
  port?: number;
  protocol: string;
  configId?: string;
  name?: string;
  serverName?: string;
  certificates?: Array<{ certificateFile?: string; keyFile?: string }>;
  subscriptionName?: string;
  subscriptionId?: string;
}

interface CleanupItem {
  id: number;
  port: number;
  protocol: string;
  remark?: string;
  cleanupAttempts: number;
  lastCleanupError?: string;
  node?: { name?: string; host?: string; healthStatus?: string };
}

interface CanaryAttempt {
  host: string;
  port: number;
  stage: 'socks' | 'http';
  durationMs: number;
  failure?: string;
  signal?: string;
  httpStatusCode?: number;
  socksReply?: number;
}

interface CanaryProbeResult {
  success: boolean;
  engine: string;
  targetAddress: string;
  targetPort: number;
  profileKind?: string;
  httpStatusCode?: number;
  latencyMs: number;
  fallbackReason?: string;
  failure?: string;
  tcpDurationMs?: number;
  xrayStartupMs?: number;
  attempts?: CanaryAttempt[];
  error?: string;
}

interface OperationResult {
  subscriptionId?: string;
  subscriptionName?: string;
  nodeName: string;
  panelVersion?: string;
  xrayVersion?: string;
  status: 'succeeded' | 'partial' | 'preserved' | 'failed';
  inboundResults?: Array<{
    configId?: string;
    type?: string;
    name?: string;
    port?: number;
    xuiId?: number;
    cleanupQueued?: boolean;
    status: 'activated' | 'unchanged' | 'preserved' | 'failed';
    error?: OperationErrorDetails;
    conflict?: { xuiId?: number; listen?: string; subscriptionId?: string };
    canary?: CanaryProbeResult & { stage?: string; tcpReachable?: boolean; sni?: string; host?: string; path?: string; mode?: string };
  }>;
  created?: number;
  preserved?: number;
  rolledBack?: boolean;
  canaryResults?: CanaryProbeResult[];
  message?: string;
  errorDetails?: OperationErrorDetails | null;
  details?: {
    phase: string;
    inbounds: InboundDiagnostic[];
    blockingInbound?: InboundDiagnostic;
  };
}

interface Operation {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
  createdAt: string;
  error?: string;
  errorDetails?: OperationErrorDetails | null;
  results?: OperationResult[];
}

const statusLabel: Record<Operation['status'], string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  succeeded: 'Готово',
  partial: 'Частично',
  failed: 'Ошибка',
};

function ErrorDetailsBlock({
  errorDetails,
  titlePrefix,
}: {
  errorDetails: OperationErrorDetails;
  titlePrefix?: string;
}) {
  return (
    <Box
      sx={{
        mt: 1,
        p: 1.5,
        border: 1,
        borderColor: 'error.light',
        borderRadius: 1.5,
        bgcolor: 'action.hover',
      }}
    >
      <Typography variant="subtitle2" color="error.main" fontWeight={700}>
        {titlePrefix ? `${titlePrefix} · ` : ''}
        {errorDetails.title}
      </Typography>
      <Stack
        direction="row"
        spacing={0.5}
        sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}
      >
        {errorDetails.node && (
          <Chip
            size="small"
            variant="outlined"
            label={`Нода: ${errorDetails.node}`}
          />
        )}
        {errorDetails.inboundType && (
          <Chip
            size="small"
            variant="outlined"
            label={`Тип: ${errorDetails.inboundType}`}
          />
        )}
        {errorDetails.port && (
          <Chip
            size="small"
            variant="outlined"
            label={`Порт: ${errorDetails.port}`}
          />
        )}
        {errorDetails.stage && (
          <Chip
            size="small"
            variant="outlined"
            label={`Этап: ${errorDetails.stage}`}
          />
        )}
      </Stack>
      {errorDetails.hint && (
        <Alert
          severity="info"
          sx={{ mt: 1, py: 0.25, '& .MuiAlert-message': { fontSize: 13 } }}
        >
          {errorDetails.hint}
        </Alert>
      )}
      {errorDetails.raw && (
        <Accordion
          disableGutters
          elevation={0}
          sx={{
            mt: 1,
            border: 1,
            borderColor: 'divider',
            '&:before': { display: 'none' },
            bgcolor: 'background.paper',
            borderRadius: 1,
          }}
        >
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="body2" fontWeight={600}>
              Технические детали
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1,
                bgcolor: 'action.hover',
                borderRadius: 1,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                fontSize: 12,
                fontFamily: 'monospace',
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {errorDetails.raw}
            </Box>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ContentCopy />}
              sx={{ mt: 1 }}
              onClick={() => void copyToClipboard(errorDetails.raw)}
            >
              Копировать детали
            </Button>
          </AccordionDetails>
        </Accordion>
      )}
    </Box>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [subscriptionsCount, setSubscriptionsCount] = useState(0);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [cleanupItems, setCleanupItems] = useState<CleanupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedOperation, setSelectedOperation] = useState<Operation | null>(
    null,
  );
  const [retryingInbound, setRetryingInbound] = useState<string>();
  const [retryMessage, setRetryMessage] = useState<{ ok: boolean; text: string }>();

  async function retryInbound(operationId: string, subscriptionId: string, configId: string) {
    setRetryingInbound(configId);
    setRetryMessage(undefined);
    try {
      const { data } = await api.post<{ id: string }>(`/rotation/operations/${operationId}/retry`, {
        subscriptionId, configId,
      });
      setRetryMessage({ ok: true, text: `Повтор поставлен в очередь · ${data.id}` });
    } catch {
      setRetryMessage({ ok: false, text: 'Не удалось запустить повтор' });
    } finally {
      setRetryingInbound(undefined);
    }
  }


  const copyDiagnostics = async (id: string) => {
    setRetryMessage(undefined);
    try {
      const { data } = await api.get(`/rotation/operations/${id}/diagnostics`);
      await copyToClipboard(JSON.stringify(data, null, 2));
      setRetryMessage({ ok: true, text: 'Диагностика скопирована' });
    } catch {
      setRetryMessage({ ok: false, text: 'Не удалось скопировать диагностику' });
    }
  };

  const load = useCallback(async () => {
    try {
      const [
        nodesResponse,
        subscriptionsResponse,
        operationsResponse,
        cleanupResponse,
      ] = await Promise.all([
        api.get<NodeRecord[]>('/nodes'),
        api
          .get<{ count: number }>('/subscriptions/count')
          .catch(() => api.get<unknown[]>('/subscriptions')),
        api.get<Operation[]>('/rotation/operations'),
        api.get<CleanupItem[]>('/rotation/cleanup'),
      ]);
      setNodes(nodesResponse.data);
      const subData = subscriptionsResponse.data;
      const count =
        typeof subData === 'object' && subData !== null && 'count' in subData
          ? (subData as { count: number }).count
          : Array.isArray(subData)
            ? subData.length
            : 0;
      setSubscriptionsCount(count);
      setOperations(operationsResponse.data);
      setCleanupItems(cleanupResponse.data || []);
      setError('');
    } catch {
      setError('Не удалось загрузить состояние инфраструктуры');
    } finally {
      setLoading(false);
    }
  }, []);

  const hasActiveOperation = operations.some((op) =>
    ['queued', 'running'].includes(op.status),
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const poll = async () => {
      if (document.hidden) return;
      if (hasActiveOperation) {
        try {
          const opsRes = await api.get<Operation[]>('/rotation/operations');
          setOperations(opsRes.data);
        } catch {
          // ignore background poll errors
        }
      } else {
        await load();
      }
    };

    const intervalMs = hasActiveOperation ? 4000 : 30000;
    const timer = window.setInterval(() => {
      void poll();
    }, intervalMs);

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [hasActiveOperation, load]);

  const handleDeleteCleanup = async (id: number) => {
    try {
      await api.delete(`/rotation/cleanup/${id}`);
      await load();
    } catch {
      setError('Не удалось удалить инбаунд из очереди очистки');
    }
  };

  const handlePurgeFailed = async () => {
    try {
      await api.post('/rotation/cleanup/purge-failed');
      await load();
    } catch {
      setError('Не удалось очистить зависшие задачи');
    }
  };

  const online = nodes.filter((node) => node.healthStatus === 'online').length;
  const unavailable = nodes.filter((node) =>
    ['offline', 'auth_error', 'degraded'].includes(node.healthStatus || ''),
  ).length;
  const activeOperation = operations.find((item) =>
    ['queued', 'running'].includes(item.status),
  );
  const recent = useMemo(() => operations.slice(0, 5), [operations]);

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 360 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Stack spacing={3}>
      <Box className="page-heading">
        <Box>
          <Typography variant="overline" color="primary">
            CONTROL PLANE
          </Typography>
          <Typography variant="h3">Обзор сети</Typography>
          <Typography color="text.secondary">
            Состояние нод, поколений и фоновых операций
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Autorenew />}
          onClick={() => navigate('/subscriptions')}
        >
          Управлять подписками
        </Button>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      {unavailable > 0 && (
        <Alert severity="warning" icon={<CloudOff />}>
          {unavailable} нод недоступны или требуют авторизации. Активные
          поколения сохранены.
        </Alert>
      )}

      <Grid container spacing={2}>
        {[
          {
            label: 'Ноды онлайн',
            value: `${online}/${nodes.length}`,
            icon: <Hub />,
            tone: 'primary',
          },
          {
            label: 'Подписки',
            value: subscriptionsCount,
            icon: <People />,
            tone: 'success',
          },
          {
            label: 'Ожидают очистки',
            value: cleanupItems.length,
            icon: <DeleteSweep />,
            tone: cleanupItems.length ? 'warning' : 'default',
          },
          {
            label: 'Текущая операция',
            value: activeOperation
              ? statusLabel[activeOperation.status]
              : 'Нет',
            icon: <Autorenew />,
            tone: activeOperation ? 'info' : 'default',
          },
        ].map((item) => (
          <Grid key={item.label} size={{ xs: 12, sm: 6, xl: 3 }}>
            <Paper className="metric-card">
              <Box className={`metric-icon metric-${item.tone}`}>
                {item.icon}
              </Box>
              <Typography color="text.secondary" variant="body2">
                {item.label}
              </Typography>
              <Typography variant="h4">{item.value}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {cleanupItems.length > 0 && (
        <Paper className="console-panel" sx={{ p: 2.5 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            mb={2}
          >
            <Box>
              <Typography variant="overline" color="warning.main">
                CLEANUP QUEUE
              </Typography>
              <Typography variant="h5">
                Очередь очистки инбаундов ({cleanupItems.length})
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Инбаунды старых поколений, ожидающие удаления на нодах
              </Typography>
            </Box>
            <Button
              variant="outlined"
              color="warning"
              size="small"
              startIcon={<DeleteSweep />}
              onClick={handlePurgeFailed}
            >
              Очистить зависшие
            </Button>
          </Stack>
          <Stack spacing={1.25}>
            {cleanupItems.map((item) => (
              <Box
                key={item.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  p: 1.5,
                  borderRadius: 1.5,
                  bgcolor: 'action.hover',
                  gap: 1.5,
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" fontWeight={700}>
                    {item.port ? `Порт ${item.port}` : `ID ${item.id}`} •{' '}
                    {(item.protocol || 'TCP').toUpperCase()}{' '}
                    {item.remark ? `(${item.remark})` : ''}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                  >
                    Нода: {item.node?.name || 'Не назначена'} • Попыток:{' '}
                    {item.cleanupAttempts}
                    {item.lastCleanupError
                      ? ` • Ошибка: ${item.lastCleanupError}`
                      : ''}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  color="error"
                  variant="text"
                  onClick={() => handleDeleteCleanup(item.id)}
                >
                  Удалить из очереди
                </Button>
              </Box>
            ))}
          </Stack>
        </Paper>
      )}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Paper className="console-panel">
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              mb={2}
            >
              <Box>
                <Typography variant="overline">NODE RAIL</Typography>
                <Typography variant="h5">Ноды</Typography>
              </Box>
              <Button size="small" onClick={() => navigate('/nodes')}>
                Открыть список
              </Button>
            </Stack>
            <Stack spacing={1.25}>
              {nodes.map((node) => (
                <Box className="node-rail" key={node.id}>
                  <span
                    className={`health-dot health-${node.healthStatus || 'unknown'}`}
                  />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{ minWidth: 0 }}
                    >
                      {node.flag && <FlagIcon flag={node.flag} size={20} />}
                      <Typography fontWeight={700} noWrap sx={{ minWidth: 0 }}>
                        {node.name}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {node.url}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {node.responseTimeMs ? `${node.responseTimeMs} ms` : '—'}
                  </Typography>
                  <Chip
                    size="small"
                    label={node.healthStatus || 'unknown'}
                    variant="outlined"
                  />
                </Box>
              ))}
              {!nodes.length && (
                <Typography color="text.secondary">
                  Ноды ещё не добавлены
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Paper className="console-panel">
            <Typography variant="overline">OPERATION TIMELINE</Typography>
            <Typography variant="h5" mb={2}>
              Последние операции
            </Typography>
            <Stack spacing={2}>
              {recent.map((operation) => (
                <Box key={operation.id} className="operation-row">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {operation.status === 'succeeded' ? (
                      <CheckCircle color="success" fontSize="small" />
                    ) : operation.status === 'failed' ? (
                      <ErrorIcon color="error" fontSize="small" />
                    ) : (
                      <Autorenew color="action" fontSize="small" />
                    )}
                    <Typography
                      fontWeight={700}
                      color={
                        operation.status === 'failed' ? 'error.main' : undefined
                      }
                    >
                      {statusLabel[operation.status]}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(operation.createdAt).toLocaleString('ru-RU')}
                  </Typography>
                  {operation.status === 'running' && (
                    <LinearProgress sx={{ mt: 1 }} />
                  )}
                  {operation.errorDetails ? (
                    <Box sx={{ mt: 0.5 }}>
                      <Typography
                        variant="caption"
                        color="error.main"
                        fontWeight={700}
                        display="block"
                      >
                        {operation.errorDetails.title}
                      </Typography>
                      {(operation.errorDetails.node ||
                        operation.errorDetails.inboundType ||
                        operation.errorDetails.port) && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                        >
                          {[
                            operation.errorDetails.node &&
                              `Нода: ${operation.errorDetails.node}`,
                            operation.errorDetails.inboundType &&
                              `Тип: ${operation.errorDetails.inboundType}`,
                            operation.errorDetails.port &&
                              `Порт: ${operation.errorDetails.port}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </Typography>
                      )}
                      {operation.errorDetails.hint && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                        >
                          Подсказка: {operation.errorDetails.hint}
                        </Typography>
                      )}
                    </Box>
                  ) : operation.error ? (
                    <Typography
                      variant="caption"
                      color="error.main"
                      display="block"
                      mt={0.5}
                    >
                      Ошибка: {operation.error}
                    </Typography>
                  ) : null}
                  {operation.results?.some(
                    (item) => item.status !== 'succeeded',
                  ) && (
                    <Box sx={{ mt: 0.5 }}>
                      {operation.results
                        .filter((item) => item.status !== 'succeeded')
                        .map((item, idx) => (
                          <Box key={idx} sx={{ mt: 0.5 }}>
                            {item.errorDetails ? (
                              <>
                                <Typography
                                  variant="caption"
                                  color="warning.main"
                                  fontWeight={700}
                                  display="block"
                                >
                                  {item.subscriptionName
                                    ? `${item.subscriptionName} · `
                                    : ''}
                                  {item.errorDetails.title}
                                </Typography>
                                {(item.errorDetails.node ||
                                  item.errorDetails.inboundType ||
                                  item.errorDetails.port) && (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    display="block"
                                  >
                                    {[
                                      item.errorDetails.node &&
                                        `Нода: ${item.errorDetails.node}`,
                                      item.errorDetails.inboundType &&
                                        `Тип: ${item.errorDetails.inboundType}`,
                                      item.errorDetails.port &&
                                        `Порт: ${item.errorDetails.port}`,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </Typography>
                                )}
                                {item.errorDetails.hint && (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    display="block"
                                  >
                                    Подсказка: {item.errorDetails.hint}
                                  </Typography>
                                )}
                              </>
                            ) : (
                              <Typography
                                variant="caption"
                                color="warning.main"
                                display="block"
                                sx={{
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  overflowWrap: 'anywhere',
                                }}
                              >
                                {item.subscriptionName
                                  ? `${item.subscriptionName} · `
                                  : ''}
                                {item.nodeName}:{' '}
                                {item.message || 'Старые подключения сохранены'}
                              </Typography>
                            )}
                          </Box>
                        ))}
                    </Box>
                  )}
                  <Button
                    size="small"
                    onClick={() => { setRetryMessage(undefined); setSelectedOperation(operation); }}
                  >
                    Подробности операции
                  </Button>
                </Box>
              ))}
              {!recent.length && (
                <Typography color="text.secondary">
                  Операций пока нет
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
      <Dialog
        open={Boolean(selectedOperation)}
        onClose={() => { setSelectedOperation(null); setRetryMessage(undefined); }}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle>Подробности операции</DialogTitle>
        <DialogContent dividers>
          {selectedOperation && (
            <Stack spacing={2}>
              <Typography variant="caption" color="text.secondary">
                {selectedOperation.id} ·{' '}
                {new Date(selectedOperation.createdAt).toLocaleString('ru-RU')}{' '}
                · {statusLabel[selectedOperation.status]}
              </Typography>
              {retryMessage && <Alert severity={retryMessage.ok ? 'success' : 'error'}>{retryMessage.text}</Alert>}
              {!selectedOperation.results?.some(result => result.inboundResults?.length) && (selectedOperation.errorDetails ? (
                <ErrorDetailsBlock
                  errorDetails={selectedOperation.errorDetails}
                />
              ) : selectedOperation.error ? (
                <Alert severity="error" sx={{ overflowWrap: 'anywhere' }}>
                  {selectedOperation.error}
                </Alert>
              ) : null)}
              {selectedOperation.results?.map((result, index) => (
                <Paper
                  variant="outlined"
                  key={index}
                  sx={{ p: 2, minWidth: 0 }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    flexWrap="wrap"
                    useFlexGap
                  >
                    <Typography fontWeight={700}>
                      {result.subscriptionName || 'Подписка не указана'} ·{' '}
                      {result.nodeName}
                    </Typography>
                    {(result.panelVersion || result.xrayVersion) && (
                      <Typography variant="caption" color="text.secondary">
                        {result.panelVersion && `3x-ui ${result.panelVersion}`}
                        {result.panelVersion && result.xrayVersion && ' · '}
                        {result.xrayVersion && `Xray ${result.xrayVersion}`}
                      </Typography>
                    )}
                    {result.rolledBack && !result.inboundResults?.length && (
                      <Chip
                        size="small"
                        color="warning"
                        label="Автооткат · рабочее поколение сохранено"
                      />
                    )}
                    {typeof result.preserved === 'number' &&
                      result.preserved > 0 && (
                        <Chip
                          size="small"
                          color="info"
                          variant="outlined"
                          label={`Сохранено постоянных: ${result.preserved}`}
                        />
                      )}
                  </Stack>
                  {result.inboundResults?.length ? (
                    <Stack spacing={1} sx={{ mt: 1 }}>
                      {result.inboundResults.map((item, row) => (
                        <Stack key={item.configId || row} spacing={0.5} sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}>
                          <Typography variant="body2" fontWeight={600}>
                            {item.name || item.type}{item.port ? ` · ${item.port}` : ''} · {{
                              activated: 'Обновлён', unchanged: 'Оставлен без изменений',
                              preserved: 'Старое подключение сохранено', failed: 'Создание не удалось',
                            }[item.status]}
                          </Typography>
                          {(item.xuiId || item.cleanupQueued) && (
                            <Typography variant="caption" color="text.secondary">
                              {item.xuiId ? `3x-ui #${item.xuiId}` : ''}
                              {item.cleanupQueued ? ' · Ожидает очистки' : ''}
                            </Typography>
                          )}
                          {item.error && <ErrorDetailsBlock errorDetails={item.error} />}
                          {item.conflict?.xuiId && (
                            <Typography variant="body2">
                              Инбаунд 3x-ui #{item.conflict.xuiId}
                              {item.conflict.listen ? ` · ${item.conflict.listen}` : ''}
                              {item.conflict.subscriptionId ? ` · подписка ${item.conflict.subscriptionId}` : ''}
                            </Typography>
                          )}
                          {item.canary && (
                            <Typography variant="caption">
                              {item.canary.engine} · {item.canary.success ? 'Проверка пройдена' : item.canary.stage || 'Проверка не пройдена'}
                              {item.canary.failure ? ` · ${item.canary.failure}` : ''}
                              {item.canary.tcpReachable === true ? ' · TCP доступен' : item.canary.tcpReachable === false ? ' · TCP недоступен' : ''}
                              {item.canary.sni ? ` · SNI ${item.canary.sni}` : ''}
                              {item.canary.host ? ` · Host ${item.canary.host}` : ''}
                              {item.canary.path ? ` · Path ${item.canary.path}` : ''}
                              {item.canary.mode ? ` · ${item.canary.mode}` : ''}
                            </Typography>
                          )}
                          {item.canary && (item.canary.attempts?.length || item.canary.tcpDurationMs !== undefined) ? (
                            <Box component="details">
                              <summary>Клиентская проверка{item.canary.attempts?.length ? ` (${item.canary.attempts.length} попыток)` : ''}</summary>
                              <Typography variant="caption" display="block">
                                {item.canary.tcpDurationMs !== undefined && `TCP ${item.canary.tcpDurationMs} мс · `}
                                {item.canary.xrayStartupMs !== undefined && `Запуск Xray ${item.canary.xrayStartupMs} мс · `}
                                Всего {item.canary.latencyMs} мс
                              </Typography>
                              {item.canary.attempts?.map((attempt, index) => (
                                <Typography key={index} variant="body2">
                                  {attempt.host}:{attempt.port} · {attempt.stage.toUpperCase()} · {attempt.durationMs} мс
                                  {attempt.httpStatusCode ? ` · HTTP ${attempt.httpStatusCode}` : ''}
                                  {attempt.socksReply !== undefined ? ` · SOCKS5 0x${attempt.socksReply.toString(16)}` : ''}
                                  {attempt.failure ? ` · ${attempt.failure}` : ''}
                                  {attempt.signal ? ` · ${attempt.signal}` : ''}
                                </Typography>
                              ))}
                            </Box>
                          ) : null}
                          {item.error && item.configId && result.subscriptionId && (
                            <Button size="small" sx={{ alignSelf: 'flex-start' }} disabled={Boolean(retryingInbound)}
                              onClick={() => void retryInbound(selectedOperation.id, result.subscriptionId!, item.configId!)}>
                              Повторить инбаунд
                            </Button>
                          )}
                        </Stack>
                      ))}
                    </Stack>
                  ) : <>
                  {result.subscriptionId && (
                    <Typography variant="caption" color="text.secondary">
                      ID подписки: {result.subscriptionId}
                    </Typography>
                  )}
                  {result.canaryResults && result.canaryResults.length > 0 && (
                    <Stack spacing={0.75} sx={{ mt: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        Canary-проверки подключения
                      </Typography>
                      {result.canaryResults.map((probe, probeIdx) => (
                        <Alert
                          key={probeIdx}
                          severity={probe.success ? 'success' : 'error'}
                          sx={{ py: 0.25 }}
                        >
                          <strong>
                            {probe.profileKind || 'profile'} ({probe.engine}):
                          </strong>{' '}
                          {probe.success
                            ? `OK · ${probe.targetAddress}:${probe.targetPort} · ${probe.latencyMs} мс${probe.httpStatusCode ? ` · HTTP ${probe.httpStatusCode}` : ''}`
                            : probe.error || 'соединение не установлено'}
                        </Alert>
                      ))}
                    </Stack>
                  )}
                  {result.details && (
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      Этап: {result.details.phase}
                    </Typography>
                  )}
                  {result.errorDetails ? (
                    <ErrorDetailsBlock errorDetails={result.errorDetails} />
                  ) : result.message ? (
                    <Box
                      component="pre"
                      sx={{
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        fontSize: 13,
                      }}
                    >
                      {result.message}
                    </Box>
                  ) : null}
                  {result.details?.blockingInbound && (
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      Запуск блокирует существующий инбаунд{' '}
                      {result.details.blockingInbound.tag ||
                        result.details.blockingInbound.xuiId}
                      . Подписка:{' '}
                      {result.details.blockingInbound.subscriptionName ||
                        'не найдена в базе менеджера'}
                      .
                    </Alert>
                  )}
                  {[
                    ...(result.details?.blockingInbound
                      ? [result.details.blockingInbound]
                      : []),
                    ...(result.details?.inbounds || []),
                  ].map((inbound, row) => (
                    <Box key={row} sx={{ mt: 2, overflowWrap: 'anywhere' }}>
                      <Typography variant="body2" fontWeight={700}>
                        {inbound.name || inbound.protocol}
                        {inbound.port ? ` · порт ${inbound.port}` : ''}
                        {inbound.xuiId ? ` · ID панели ${inbound.xuiId}` : ''}
                      </Typography>
                      {inbound.configId && (
                        <Typography variant="caption" display="block">
                          ID конфигурации: {inbound.configId}
                        </Typography>
                      )}
                      {inbound.serverName && (
                        <Typography variant="body2">
                          TLS server name: {inbound.serverName}
                        </Typography>
                      )}
                      {inbound.certificates?.map((certificate, certIndex) => (
                        <Box
                          key={certIndex}
                          sx={{ fontFamily: 'monospace', fontSize: 12 }}
                        >
                          Сертификат:{' '}
                          {certificate.certificateFile || 'не указан'}
                          <br />
                          Ключ: {certificate.keyFile || 'не указан'}
                        </Box>
                      ))}
                    </Box>
                  ))}
                  </>}
                </Paper>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => selectedOperation && void copyDiagnostics(selectedOperation.id)}
          >
            Копировать диагностику
          </Button>
          <Button onClick={() => setSelectedOperation(null)}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
