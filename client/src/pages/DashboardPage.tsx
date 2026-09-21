import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
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
  DeleteSweep,
  Hub,
  People,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import type { NodeRecord } from '../types/node';

interface CleanupItem {
  id: number;
  port: number;
  protocol: string;
  remark?: string;
  cleanupAttempts: number;
  lastCleanupError?: string;
  node?: { name?: string; host?: string; healthStatus?: string };
}

interface OperationResult {
  nodeName: string;
  status: 'succeeded' | 'preserved' | 'failed';
  message?: string;
}

interface Operation {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
  createdAt: string;
  results?: OperationResult[];
}

const statusLabel: Record<Operation['status'], string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  succeeded: 'Готово',
  partial: 'Частично',
  failed: 'Ошибка',
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [subscriptionsCount, setSubscriptionsCount] = useState(0);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [cleanupItems, setCleanupItems] = useState<CleanupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [nodesResponse, subscriptionsResponse, operationsResponse, cleanupResponse] =
        await Promise.all([
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
    return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 360 }}><CircularProgress /></Box>;
  }

  return (
    <Stack spacing={3}>
      <Box className="page-heading">
        <Box>
          <Typography variant="overline" color="primary">CONTROL PLANE</Typography>
          <Typography variant="h3">Обзор сети</Typography>
          <Typography color="text.secondary">Состояние нод, поколений и фоновых операций</Typography>
        </Box>
        <Button variant="contained" startIcon={<Autorenew />} onClick={() => navigate('/subscriptions')}>
          Управлять подписками
        </Button>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}
      {unavailable > 0 && (
        <Alert severity="warning" icon={<CloudOff />}>
          {unavailable} нод недоступны или требуют авторизации. Активные поколения сохранены.
        </Alert>
      )}

      <Grid container spacing={2}>
        {[
          { label: 'Ноды онлайн', value: `${online}/${nodes.length}`, icon: <Hub />, tone: 'primary' },
          { label: 'Подписки', value: subscriptionsCount, icon: <People />, tone: 'success' },
          { label: 'Ожидают очистки', value: cleanupItems.length, icon: <DeleteSweep />, tone: cleanupItems.length ? 'warning' : 'default' },
          { label: 'Текущая операция', value: activeOperation ? statusLabel[activeOperation.status] : 'Нет', icon: <Autorenew />, tone: activeOperation ? 'info' : 'default' },
        ].map((item) => (
          <Grid key={item.label} size={{ xs: 12, sm: 6, xl: 3 }}>
            <Paper className="metric-card">
              <Box className={`metric-icon metric-${item.tone}`}>{item.icon}</Box>
              <Typography color="text.secondary" variant="body2">{item.label}</Typography>
              <Typography variant="h4">{item.value}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {cleanupItems.length > 0 && (
        <Paper className="console-panel" sx={{ p: 2.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
            <Box>
              <Typography variant="overline" color="warning.main">CLEANUP QUEUE</Typography>
              <Typography variant="h5">Очередь очистки инбаундов ({cleanupItems.length})</Typography>
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
                    {item.port ? `Порт ${item.port}` : `ID ${item.id}`} • {(item.protocol || 'TCP').toUpperCase()} {item.remark ? `(${item.remark})` : ''}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Нода: {item.node?.name || 'Не назначена'} • Попыток: {item.cleanupAttempts}
                    {item.lastCleanupError ? ` • Ошибка: ${item.lastCleanupError}` : ''}
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
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
              <Box>
                <Typography variant="overline">NODE RAIL</Typography>
                <Typography variant="h5">Ноды</Typography>
              </Box>
              <Button size="small" onClick={() => navigate('/nodes')}>Открыть список</Button>
            </Stack>
            <Stack spacing={1.25}>
              {nodes.map((node) => (
                <Box className="node-rail" key={node.id}>
                  <span className={`health-dot health-${node.healthStatus || 'unknown'}`} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography fontWeight={700} noWrap>{node.flag} {node.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>{node.url}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {node.responseTimeMs ? `${node.responseTimeMs} ms` : '—'}
                  </Typography>
                  <Chip size="small" label={node.healthStatus || 'unknown'} variant="outlined" />
                </Box>
              ))}
              {!nodes.length && <Typography color="text.secondary">Ноды ещё не добавлены</Typography>}
            </Stack>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Paper className="console-panel">
            <Typography variant="overline">OPERATION TIMELINE</Typography>
            <Typography variant="h5" mb={2}>Последние операции</Typography>
            <Stack spacing={2}>
              {recent.map((operation) => (
                <Box key={operation.id} className="operation-row">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {operation.status === 'succeeded' ? <CheckCircle color="success" fontSize="small" /> : <Autorenew color="action" fontSize="small" />}
                    <Typography fontWeight={700}>{statusLabel[operation.status]}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {new Date(operation.createdAt).toLocaleString('ru-RU')}
                  </Typography>
                  {operation.status === 'running' && <LinearProgress sx={{ mt: 1 }} />}
                  {operation.results?.some((item) => item.status !== 'succeeded') && (
                    <Typography variant="caption" color="warning.main" display="block" mt={0.5}>
                      Старые подключения сохранены для недоступных нод
                    </Typography>
                  )}
                </Box>
              ))}
              {!recent.length && <Typography color="text.secondary">Операций пока нет</Typography>}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Stack>
  );
}
