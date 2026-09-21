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
  const [subscriptions, setSubscriptions] = useState<unknown[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [cleanupCount, setCleanupCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [nodesResponse, subscriptionsResponse, operationsResponse, cleanupResponse] =
        await Promise.all([
          api.get<NodeRecord[]>('/nodes'),
          api.get<unknown[]>('/subscriptions'),
          api.get<Operation[]>('/rotation/operations'),
          api.get<unknown[]>('/rotation/cleanup'),
        ]);
      setNodes(nodesResponse.data);
      setSubscriptions(subscriptionsResponse.data);
      setOperations(operationsResponse.data);
      setCleanupCount(cleanupResponse.data.length);
      setError('');
    } catch {
      setError('Не удалось загрузить состояние инфраструктуры');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

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
          { label: 'Подписки', value: subscriptions.length, icon: <People />, tone: 'success' },
          { label: 'Ожидают очистки', value: cleanupCount, icon: <DeleteSweep />, tone: cleanupCount ? 'warning' : 'default' },
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
