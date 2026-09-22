import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, Stack, Switch, Typography,
} from '@mui/material';
import { nodesApi } from './api';
import type { NodeRecord, RoutingPresetView } from '../../types/node';
import { getApiErrorMessage } from '../../utils/errorHandlers';

interface Props { node: NodeRecord; onClose: () => void }

export function RoutingPresetsDialog({ node, onClose }: Props) {
  const [view, setView] = useState<RoutingPresetView | null>(null);
  const [blockRussia, setBlockRussia] = useState(false);
  const [blockIpCheckers, setBlockIpCheckers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    try {
      const current = await nodesApi.routingPresets(node.id);
      if (request !== generation.current) return;
      setView(current);
      setBlockRussia(current.blockRussia);
      setBlockIpCheckers(current.blockIpCheckers);
    } catch (error) {
      if (request !== generation.current) return;
      setView(null);
      setFeedback({ severity: 'error', text: getApiErrorMessage(error, 'Не удалось загрузить настройки ноды') });
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [node.id]);

  useEffect(() => {
    const currentGeneration = generation;
    void load();
    return () => {
      currentGeneration.current++;
    };
  }, [load]);

  const apply = async () => {
    if (!view?.available || !view.revision) return;
    setSaving(true);
    setFeedback(null);
    try {
      const result = await nodesApi.updateRoutingPresets(node.id, { blockRussia, blockIpCheckers, revision: view.revision });
      const success = result.result === 'applied' || result.result === 'unchanged';
      setView(result);
      setFeedback({ severity: success ? 'success' : 'error', text: result.message || 'Проверьте результат применения.' });
      if (success) {
        setBlockRussia(result.blockRussia);
        setBlockIpCheckers(result.blockIpCheckers);
      }
    } catch (error) {
      setView((current) => current ? { ...current, revision: '' } : null);
      setFeedback({ severity: 'error', text: getApiErrorMessage(error, 'Не удалось применить настройки. Обновите состояние.') });
    } finally {
      setSaving(false);
    }
  };

  const disabled = loading || saving || !view?.available;
  const changed = view && (view.needsApply || blockRussia !== view.blockRussia || blockIpCheckers !== view.blockIpCheckers);

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="node-quick-settings-title">
      <DialogTitle id="node-quick-settings-title">Быстрые настройки · {node.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="h6">Маршрутизация</Typography>
          <Alert severity="info">
            Выбранные сайты перестанут открываться через эту ноду. Обход VPN на устройстве не настраивается.
            Применение может кратко прервать подключения.
          </Alert>
          {feedback && <Alert severity={feedback.severity}>{feedback.text}</Alert>}
          {loading ? <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress aria-label="Загрузка настроек маршрутизации" /></Box> : (
            <>
              <Box>
                <FormControlLabel control={<Switch checked={blockRussia} disabled={disabled}
                  onChange={(_, checked) => setBlockRussia(checked)} />}
                  label="Блокировать российские домены и IP" />
                <Typography variant="body2" color="text.secondary">
                  Зоны .ru, .su, .рф и их поддомены, российские сервисы из GeoSite и российские IPv4/IPv6 из GeoIP.
                </Typography>
              </Box>
              <Box>
                <FormControlLabel control={<Switch checked={blockIpCheckers} disabled={disabled}
                  onChange={(_, checked) => setBlockIpCheckers(checked)} />}
                  label="Блокировать сервисы определения IP" />
                <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                  2ip.ru, 2ip.io, whoer.net, browserleaks.com, dnsleaktest.com, ipinfo.io,
                  ip-api.com, ifconfig.me, icanhazip.com, whatismyipaddress.com — включая поддомены.
                </Typography>
              </Box>
              {view?.warnings.map((warning, index) => <Alert key={`${index}-${warning}`} severity="warning">{warning}</Alert>)}
              {view && !view.revision && view.available && <Alert severity="warning">Обновите состояние перед следующим применением.</Alert>}
            </>
          )}
          <Typography variant="body2" color="text.secondary">
            Для поддерживаемых подключений автоматически включается распознавание доменов.
            При отключении обоих наборов внесённые нами изменения восстанавливаются.
            Охват зависит от геобаз и видимости домена; трафик вне Xray не покрывается.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={() => void load()} disabled={loading || saving}>Обновить состояние</Button>
        <Button onClick={onClose} disabled={saving}>Закрыть</Button>
        <Button variant="contained" onClick={() => void apply()} disabled={disabled || !view?.revision || !changed}>
          {saving ? 'Применение…' : 'Применить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
