import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Paper,
  TablePagination,
  useTheme,
  useMediaQuery,
  Alert,
  Stack,
  CircularProgress,
  Divider,
  Link as MuiLink,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Snackbar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Tabs,
  Tab,
  Tooltip,
} from '@mui/material';
import {
  Delete,
  Add,
  UploadFile,
  Remove,
  ExpandMore,
  Download,
  Security,
  ContentCopy,
  Info,
  Check,
  Search,
  Language,
  Settings,
  Speed,
} from '@mui/icons-material';
import api from '../api';
import { getApiErrorMessage, getApiErrorStatus } from '../utils/errorHandlers';
import { Logger } from '../utils/logger';
import { copyToClipboard } from '../utils/copyToClipboard';
import type { SniProfile, SniCatalogProfile } from '../utils/sniProfiles';
import {
  CLIENT_SNI_PROFILES_CATALOG,
  resolveClientSniProfile,
  getProfileThemeColor,
} from '../utils/sniProfiles';
import {
  pingDomainCombined,
  CombinedDomainPingResult,
} from '../utils/domainPing';

interface Domain {
  id: number;
  name: string;
  profile?: SniProfile;
}

interface ScanCapabilities {
  scannerAvailable: boolean;
  scannerPath: string | null;
  timeoutAvailable: boolean;
  timeoutPath: string | null;
}

interface ScanResponse {
  runId: string;
  addr: string;
  scanSeconds: number;
  thread: number;
  timeout: number;
  startedAt: string;
  endsAt: string;
  finishedAt: string;
  timedOut: boolean;
  exitCode: number;
  foundCount: number;
  domains: string[];
  stderrTail: string;
  stdoutTail: string;
}

interface ScanStatusResponse {
  running: boolean;
  runId: string | null;
  addr: string | null;
  scanSeconds: number | null;
  thread: number | null;
  timeout: number | null;
  startedAt: string | null;
  endsAt: string | null;
  now: string;
  remainingSeconds: number;
  foundCount: number;
  lastRunId: string | null;
  lastFinishedAt: string | null;
}

const SCAN_STORAGE_KEY = 'domains_scan_state_v1';

export default function DomainsPage() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [whitelistSearch, setWhitelistSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emptyDomainsNotified = useRef(false);
  const [totalCount, setTotalCount] = useState(0);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Active Tab: 0 = Whitelist, 1 = Masking Profiles Catalog
  const [activeTab, setActiveTab] = useState(0);

  // Catalog state
  const [catalogProfiles, setCatalogProfiles] = useState<readonly SniCatalogProfile[]>(
    CLIENT_SNI_PROFILES_CATALOG,
  );

  // Live Inspector Tester state
  const [testerInput, setTesterInput] = useState('swdist.apple.com');
  const [inspectedDomain, setInspectedDomain] = useState<{
    domain: string;
    profile: SniProfile;
  } | null>(null);

  // Pagination state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  // Ping states per domain
  const [pingStates, setPingStates] = useState<
    Record<string, { checking?: boolean; result?: CombinedDomainPingResult }>
  >({});
  const [isBatchPinging, setIsBatchPinging] = useState(false);

  // Live Inspector Ping state
  const [isInspectorPinging, setIsInspectorPinging] = useState(false);
  const [inspectorPingResult, setInspectorPingResult] =
    useState<CombinedDomainPingResult | null>(null);

  // Scanner state
  const [scanCapabilities, setScanCapabilities] = useState<ScanCapabilities | null>(null);
  const [scanAddr, setScanAddr] = useState('');
  const [scanSeconds, setScanSeconds] = useState(30);
  const [scanThread, setScanThread] = useState(2);
  const [scanTimeout, setScanTimeout] = useState(5);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [scanCandidates, setScanCandidates] = useState<string[]>([]);
  const [scanPanelExpanded, setScanPanelExpanded] = useState(false);
  const [scanStateHydrated, setScanStateHydrated] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatusResponse | null>(null);
  const [activeScanRunId, setActiveScanRunId] = useState<string | null>(null);

  // Notifications & Dialogs
  const [snackbar, setSnackbar] = useState({
    open: false,
    type: 'success' as 'success' | 'error',
    message: '',
  });
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    onConfirm: () => {},
  });
  const [copiedDomain, setCopiedDomain] = useState<string | null>(null);

  const clampInteger = (value: number, fallback: number, min: number, max: number) => {
    const num = Number.isFinite(value) ? Math.floor(value) : fallback;
    if (num < min) return min;
    if (num > max) return max;
    return num;
  };

  const isLoopbackHost = useCallback((value: string) => {
    const host = value.trim().toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }, []);

  interface Settings {
    xui_ip?: string;
    xui_host?: string;
    xui_url?: string;
  }

  const collectAddrCandidatesFromSettings = useCallback((settings: Settings) => {
    const candidates: string[] = [];
    const xuiIp = String(settings?.xui_ip || '').trim();
    const xuiHost = String(settings?.xui_host || '').trim();
    const xuiUrl = String(settings?.xui_url || '').trim();

    if (xuiIp) candidates.push(xuiIp);
    if (xuiHost) candidates.push(xuiHost);

    if (xuiUrl) {
      try {
        const parsed = new URL(xuiUrl);
        if (parsed.hostname) {
          candidates.push(parsed.hostname.trim());
        }
      } catch {
        // Ignore malformed URL from settings
      }
    }

    return candidates.filter(Boolean);
  }, []);

  const resolveSuggestedScanAddr = useCallback(
    async (opts?: { allowLoopbackFallback?: boolean }) => {
      const allowLoopbackFallback = Boolean(opts?.allowLoopbackFallback);
      let settingsCandidates: string[] = [];

      try {
        const settingsRes = await api.get('/settings');
        Logger.debug('Domains page: Settings response', 'Domains', settingsRes.data);

        settingsCandidates = collectAddrCandidatesFromSettings(settingsRes.data);
        const publicFromSettings = settingsCandidates.find((c) => !isLoopbackHost(c));

        if (publicFromSettings) {
          return publicFromSettings;
        }
      } catch (error) {
        Logger.error('Failed to collect address candidates from settings', 'Domains', error);
      }

      const runtimeHost = window.location.hostname;
      if (runtimeHost) {
        if (!isLoopbackHost(runtimeHost)) {
          return runtimeHost;
        } else if (allowLoopbackFallback) {
          return runtimeHost;
        } else if (settingsCandidates.length === 0) {
          return runtimeHost;
        }
      }

      if (allowLoopbackFallback) {
        const anyFromSettings = settingsCandidates[0];
        if (anyFromSettings) return anyFromSettings;
      }

      return '';
    },
    [collectAddrCandidatesFromSettings, isLoopbackHost],
  );

  const fetchScanStatus = useCallback(async () => {
    const { data } = await api.get('/domains/scan/status');
    setScanStatus(data);
    return data as ScanStatusResponse;
  }, []);

  const fetchLastScanResult = useCallback(async (expectedRunId?: string | null) => {
    const { data } = await api.get('/domains/scan/last-result');
    if (!data) return null;
    if (expectedRunId && data.runId !== expectedRunId) return null;

    setScanResult(data);
    setScanCandidates(data.domains || []);
    return data as ScanResponse;
  }, []);

  const loadCatalogProfiles = useCallback(async () => {
    try {
      const res = await api.get('/domains/profiles');
      if (res.data?.profiles && Array.isArray(res.data.profiles)) {
        setCatalogProfiles(res.data.profiles);
      }
    } catch {
      setCatalogProfiles(CLIENT_SNI_PROFILES_CATALOG);
    }
  }, []);

  const loadDomains = useCallback(async () => {
    try {
      Logger.debug(`Loading page ${page + 1} (limit: ${rowsPerPage})`, 'Domains');
      const { data } = await api.get(`/domains?page=${page + 1}&limit=${rowsPerPage}`);

      const enriched: Domain[] = (data.data || []).map((d: Domain) => ({
        ...d,
        profile: d.profile || resolveClientSniProfile(d.name),
      }));

      setDomains(enriched);
      setTotalCount(data.total);

      if (data.total === 0 && !emptyDomainsNotified.current) {
        emptyDomainsNotified.current = true;
        setSnackbar({ open: true, type: 'error', message: 'Создайте хотя бы один домен!' });
      }
      if (data.total > 0) {
        emptyDomainsNotified.current = false;
      }
    } catch (error) {
      Logger.error('Failed to load domains', 'Domains', error);
    }
  }, [page, rowsPerPage]);

  useEffect(() => {
    loadDomains();
  }, [loadDomains]);

  useEffect(() => {
    loadCatalogProfiles();
  }, [loadCatalogProfiles]);

  useEffect(() => {
    const loadScannerContext = async () => {
      try {
        const capRes = await api.get('/domains/scan/capabilities');
        setScanCapabilities(capRes.data);
        if (capRes.data?.scannerAvailable) {
          const status = await fetchScanStatus();
          if (status.running) {
            setIsScanning(true);
            setActiveScanRunId(status.runId);
            setScanResult(null);
            setScanCandidates([]);
            setScanError('');
          }
        }
      } catch (error) {
        Logger.error('Failed to load scanner context', 'Domains', error);
      }
    };

    loadScannerContext();
  }, [fetchScanStatus]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCAN_STORAGE_KEY);
      let restoredAddr: string | null = null;

      if (raw) {
        const parsed = JSON.parse(raw) as {
          scanAddr?: string;
          scanSeconds?: number;
          scanThread?: number;
          scanTimeout?: number;
          scanResult?: ScanResponse | null;
          scanCandidates?: string[];
          scanPanelExpanded?: boolean;
        };

        if (typeof parsed.scanAddr === 'string' && parsed.scanAddr.trim()) {
          restoredAddr = parsed.scanAddr.trim();
          setScanAddr(restoredAddr);
        }
        if (typeof parsed.scanSeconds === 'number') setScanSeconds(parsed.scanSeconds);
        if (typeof parsed.scanThread === 'number') setScanThread(parsed.scanThread);
        if (typeof parsed.scanTimeout === 'number') setScanTimeout(parsed.scanTimeout);
        if (parsed.scanResult) setScanResult(parsed.scanResult);
        if (Array.isArray(parsed.scanCandidates)) setScanCandidates(parsed.scanCandidates);
        if (typeof parsed.scanPanelExpanded === 'boolean')
          setScanPanelExpanded(parsed.scanPanelExpanded);
      }

      if (!restoredAddr) {
        resolveSuggestedScanAddr({ allowLoopbackFallback: false })
          .then((defaultAddr) => {
            if (defaultAddr) {
              setScanAddr(defaultAddr);
            } else {
              resolveSuggestedScanAddr({ allowLoopbackFallback: true }).then((fallbackAddr) => {
                if (fallbackAddr) setScanAddr(fallbackAddr);
              });
            }
          })
          .catch((error) => {
            Logger.error('Failed to resolve suggested scan address', 'Domains', error);
          });
      }
    } catch (error) {
      Logger.error('Failed to hydrate scanner state from localStorage', 'Domains', error);
    } finally {
      setScanStateHydrated(true);
    }
  }, [resolveSuggestedScanAddr]);

  useEffect(() => {
    if (!scanStateHydrated) return;

    try {
      localStorage.setItem(
        SCAN_STORAGE_KEY,
        JSON.stringify({
          scanAddr,
          scanSeconds,
          scanThread,
          scanTimeout,
          scanResult,
          scanCandidates,
          scanPanelExpanded,
        }),
      );
    } catch (error) {
      Logger.error('Failed to persist scanner state to localStorage', 'Domains', error);
    }
  }, [
    scanAddr,
    scanSeconds,
    scanThread,
    scanTimeout,
    scanResult,
    scanCandidates,
    scanPanelExpanded,
    scanStateHydrated,
  ]);

  useEffect(() => {
    if (!isScanning) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const status = await fetchScanStatus();
        if (cancelled) return;

        if (status.running) {
          if (status.runId) {
            setActiveScanRunId((prev) => prev ?? status.runId);
          }
          return;
        }

        setIsScanning(false);
        setScanError('');
        const runIdToLoad = activeScanRunId || status.lastRunId;
        await fetchLastScanResult(runIdToLoad);
        setActiveScanRunId(null);
      } catch (error) {
        if (!cancelled) {
          Logger.error('Failed to fetch scan status', 'Domains', error);
        }
      }
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isScanning, activeScanRunId, fetchScanStatus, fetchLastScanResult]);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleAdd = async () => {
    if (!newDomain.trim()) return;
    try {
      Logger.debug(`Adding domain: ${newDomain}`, 'Domains');
      await api.post('/domains', { name: newDomain.trim() });
      setNewDomain('');
      setSnackbar({ open: true, type: 'success', message: 'Домен успешно добавлен' });
      loadDomains();
    } catch (e) {
      const msg = getApiErrorMessage(e, 'Ошибка добавления домена');
      setSnackbar({ open: true, type: 'error', message: msg });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      Logger.debug(`Deleting domain ID: ${id}`, 'Domains');
      await api.delete(`/domains/${id}`);
      setSnackbar({ open: true, type: 'success', message: 'Домен удален' });
      loadDomains();
    } catch (e) {
      const msg = getApiErrorMessage(e, 'Ошибка удаления домена');
      setSnackbar({ open: true, type: 'error', message: msg });
    }
  };

  const handleDeleteAll = async () => {
    setConfirmDialog({
      open: true,
      title: 'ВНИМАНИЕ! Вы действительно хотите удалить ВСЕ домены из белого списка?',
      onConfirm: async () => {
        try {
          Logger.debug('Deleting all domains', 'Domains');
          await api.delete('/domains/all');
          loadDomains();
          setSnackbar({ open: true, type: 'success', message: 'Все домены удалены' });
        } catch {
          Logger.error('Delete all failed', 'Domains');
          setSnackbar({ open: true, type: 'error', message: 'Ошибка удаления' });
        }
      },
    });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      const lines = text.split(/\r?\n/);

      try {
        const { data } = await api.post('/domains/upload', { domains: lines });
        setSnackbar({
          open: true,
          type: 'success',
          message: `Успешно добавлено доменов: ${data.count}`,
        });
        loadDomains();
      } catch {
        setSnackbar({ open: true, type: 'error', message: 'Ошибка при загрузке списка' });
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleBatchImportDomains = async (domainsToAdd: string[]) => {
    if (!domainsToAdd || domainsToAdd.length === 0) return;
    try {
      const { data } = await api.post('/domains/upload', { domains: domainsToAdd });
      setSnackbar({
        open: true,
        type: 'success',
        message: `Добавлено ${data.count} доменов в белый список!`,
      });
      loadDomains();
    } catch (e) {
      const msg = getApiErrorMessage(e, 'Ошибка импорта доменов');
      setSnackbar({ open: true, type: 'error', message: msg });
    }
  };

  const handleStartScan = async () => {
    if (!scanAddr.trim()) {
      setSnackbar({ open: true, type: 'error', message: 'Укажите IP/домен для сканирования' });
      return;
    }

    const effectiveScanSeconds = clampInteger(scanSeconds, 120, 10, 600);
    const effectiveThread = clampInteger(scanThread, 2, 1, 20);
    const effectiveTimeout = clampInteger(scanTimeout, 5, 1, 20);
    let keepScanning = false;

    try {
      setIsScanning(true);
      setScanError('');
      setScanResult(null);
      setScanStatus(null);
      setActiveScanRunId(null);

      const { data } = await api.post('/domains/scan/start', {
        addr: scanAddr.trim(),
        scanSeconds: effectiveScanSeconds,
        thread: effectiveThread,
        timeout: effectiveTimeout,
      });

      setScanResult(data);
      setScanCandidates(data.domains || []);
      setActiveScanRunId(data.runId || null);
      await fetchScanStatus();
    } catch (e) {
      const message = getApiErrorMessage(e, 'Ошибка запуска сканера');
      setScanError(message);

      const status = getApiErrorStatus(e);
      if (status === 429) {
        try {
          const status = await fetchScanStatus();
          if (status.running) {
            keepScanning = true;
            setIsScanning(true);
            setActiveScanRunId(status.runId);
            setScanError('Скан уже выполняется. Подключились к текущему запуску.');
          }
        } catch (statusErr) {
          Logger.error('Failed to fetch scan status on 429', 'Scanner', statusErr);
        }
      }
    } finally {
      if (!keepScanning) {
        setIsScanning(false);
        setActiveScanRunId(null);
      }
    }
  };

  const handleImportScannedDomains = async () => {
    const found = scanCandidates;
    if (found.length === 0) return;

    try {
      const { data } = await api.post('/domains/upload', { domains: found });
      setSnackbar({
        open: true,
        type: 'success',
        message: `Скан завершен. Добавлено новых доменов: ${data.count}`,
      });
      loadDomains();
    } catch {
      setSnackbar({ open: true, type: 'error', message: 'Ошибка импорта найденных доменов' });
    }
  };

  const handleRemoveScannedDomain = (domain: string) => {
    setScanCandidates((prev) => prev.filter((d) => d !== domain));
  };

  const handleClearScannedDomains = async () => {
    setScanCandidates([]);
    setScanResult(null);
    setScanStatus(null);
    setActiveScanRunId(null);
    setScanAddr('');

    const suggestedAddr = await resolveSuggestedScanAddr({ allowLoopbackFallback: true });
    setScanAddr(suggestedAddr);
  };

  const downloadDomainsAsTxt = (filename: string, domainNames: string[]) => {
    const content = `${domainNames.join('\n')}\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const getExportTimestamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  const handleExportScannedDomains = () => {
    if (scanCandidates.length === 0) return;
    downloadDomainsAsTxt(`sni-scanned-${getExportTimestamp()}.txt`, scanCandidates);
  };

  const handleExportMainDomains = async () => {
    if (domains.length === 0) return;

    try {
      const { data } = await api.get('/domains/all');
      const names = (Array.isArray(data) ? data : []).map((d: Domain) => d.name).filter(Boolean);

      if (names.length === 0) return;
      downloadDomainsAsTxt(`sni-whitelist-${getExportTimestamp()}.txt`, names);
    } catch {
      setSnackbar({ open: true, type: 'error', message: 'Ошибка экспорта списка' });
    }
  };

  const handleCopy = async (text: string) => {
    await copyToClipboard(text);
    setCopiedDomain(text);
    setSnackbar({ open: true, type: 'success', message: `Скопировано: ${text}` });
    setTimeout(() => setCopiedDomain(null), 2500);
  };

  // Filtered domains for the whitelist view
  const filteredDomains = useMemo(() => {
    if (!whitelistSearch.trim()) return domains;
    const q = whitelistSearch.trim().toLowerCase();
    return domains.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.profile?.category?.toLowerCase().includes(q) ||
        d.profile?.profileName?.toLowerCase().includes(q) ||
        d.profile?.fingerprint?.toLowerCase().includes(q),
    );
  }, [domains, whitelistSearch]);

  // Live Inspector evaluation
  const liveTestedProfile = useMemo(() => {
    return resolveClientSniProfile(testerInput);
  }, [testerInput]);

  const handlePingDomain = useCallback(async (domainName: string) => {
    if (!domainName) return;
    setPingStates((prev) => ({
      ...prev,
      [domainName]: { ...prev[domainName], checking: true },
    }));

    try {
      const result = await pingDomainCombined(domainName);
      setPingStates((prev) => ({
        ...prev,
        [domainName]: { checking: false, result },
      }));
    } catch {
      setPingStates((prev) => ({
        ...prev,
        [domainName]: {
          checking: false,
          result: {
            domain: domainName,
            browser: { reachable: false, latencyMs: 0, error: 'Ошибка пинга' },
            vps: { reachable: false, latencyMs: 0, error: 'Ошибка пинга' },
          },
        },
      }));
    }
  }, []);

  const handlePingAllDomains = useCallback(async () => {
    if (domains.length === 0 || isBatchPinging) return;
    setIsBatchPinging(true);

    const domainsToPing = filteredDomains.map((d) => d.name);
    const chunkSize = 3;
    for (let i = 0; i < domainsToPing.length; i += chunkSize) {
      const chunk = domainsToPing.slice(i, i + chunkSize);
      await Promise.allSettled(chunk.map((d) => handlePingDomain(d)));
    }

    setIsBatchPinging(false);
    setSnackbar({
      open: true,
      type: 'success',
      message: 'Проверка доступности доменов завершена',
    });
  }, [domains, filteredDomains, isBatchPinging, handlePingDomain]);

  const handlePingTester = useCallback(async () => {
    if (!testerInput.trim() || isInspectorPinging) return;
    setIsInspectorPinging(true);
    setInspectorPingResult(null);

    try {
      const res = await pingDomainCombined(testerInput.trim());
      setInspectorPingResult(res);
    } catch {
      setSnackbar({
        open: true,
        type: 'error',
        message: 'Ошибка при проверке доступности',
      });
    } finally {
      setIsInspectorPinging(false);
    }
  }, [testerInput, isInspectorPinging]);

  const renderPingBadge = (domainName: string) => {
    const entry = pingStates[domainName];

    if (entry?.checking) {
      return <CircularProgress size={16} sx={{ mx: 0.5 }} />;
    }

    if (!entry?.result) {
      return (
        <Tooltip title="Проверить доступность (из РФ и с VPS)">
          <IconButton
            size="small"
            onClick={() => handlePingDomain(domainName)}
            aria-label={`Пинг ${domainName}`}
          >
            <Speed fontSize="small" sx={{ color: 'text.secondary' }} />
          </IconButton>
        </Tooltip>
      );
    }

    const { browser, vps } = entry.result;

    if (browser.reachable && vps.reachable) {
      return (
        <Tooltip
          title={`Доступен! РФ: ${browser.latencyMs} мс • VPS: ${vps.latencyMs} мс (${vps.protocol || 'TLS'}). Нажмите для повторного пинга.`}
        >
          <Chip
            size="small"
            icon={<Check sx={{ fontSize: '13px !important' }} />}
            label={`РФ: ${browser.latencyMs}мс`}
            color="success"
            variant="outlined"
            onClick={() => handlePingDomain(domainName)}
            sx={{
              height: 22,
              fontSize: '0.72rem',
              fontWeight: 600,
              cursor: 'pointer',
              borderColor: 'success.main',
            }}
          />
        </Tooltip>
      );
    }

    if (!browser.reachable && vps.reachable) {
      return (
        <Tooltip
          title={`Блокируется в вашей сети (ТСПУ). С VPS доступен (${vps.latencyMs} мс). Нажмите для повторного пинга.`}
        >
          <Chip
            size="small"
            label="Блок в РФ"
            color="error"
            variant="filled"
            onClick={() => handlePingDomain(domainName)}
            sx={{
              height: 22,
              fontSize: '0.72rem',
              fontWeight: 700,
              cursor: 'pointer',
              backgroundColor: 'error.main',
              color: '#fff',
            }}
          />
        </Tooltip>
      );
    }

    if (browser.reachable && !vps.reachable) {
      return (
        <Tooltip
          title={`Доступен в РФ (${browser.latencyMs} мс), но не отвечает с VPS (${vps.error || 'таймаут'}).`}
        >
          <Chip
            size="small"
            label="Сбой VPS"
            color="warning"
            variant="outlined"
            onClick={() => handlePingDomain(domainName)}
            sx={{
              height: 22,
              fontSize: '0.72rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          />
        </Tooltip>
      );
    }

    return (
      <Tooltip
        title={`Недоступен (${browser.error || 'Таймаут'}). Нажмите для повторного пинга.`}
      >
        <Chip
          size="small"
          label="Недоступен"
          color="error"
          variant="outlined"
          onClick={() => handlePingDomain(domainName)}
          sx={{
            height: 22,
            fontSize: '0.72rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        />
      </Tooltip>
    );
  };

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', pb: 4 }}>
      {/* Header section with overline and badges */}
      <Box sx={{ mb: 3 }}>
        <Typography
          variant="overline"
          sx={{
            color: 'primary.main',
            display: 'block',
            fontWeight: 700,
            letterSpacing: '0.12em',
            mb: 0.5,
          }}
        >
          REALITY & МАСКИРОВКА SNI
        </Typography>
        <Typography variant={isMobile ? 'h5' : 'h4'} gutterBottom sx={{ fontWeight: 650 }}>
          Белый список доменов (SNI)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 840, mb: 2 }}>
          Управление доверенными SNI для VLESS / Trojan Reality. Система автоматически
          сопоставляет домены с паспортами маскировки (Apple, Microsoft, Google, Ookla Speedtest,
          Samsung), подбирая аутентичные отпечатки uTLS, пути SpiderX и XHTTP для защиты от блокировок ТСПУ.
        </Typography>

        {/* Quick summary metric chips */}
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Chip
            size="small"
            icon={<Language sx={{ fontSize: 16 }} />}
            label={`В белом списке: ${totalCount}`}
            sx={{
              backgroundColor: 'rgba(83, 216, 255, 0.08)',
              borderColor: 'primary.main',
              borderWidth: 1,
              borderStyle: 'solid',
              fontWeight: 600,
            }}
          />
          <Chip
            size="small"
            icon={<Security sx={{ fontSize: 16 }} />}
            label="Шаблонов маскировки: 7"
            sx={{
              backgroundColor: 'rgba(86, 214, 154, 0.08)',
              borderColor: 'success.main',
              borderWidth: 1,
              borderStyle: 'solid',
              fontWeight: 600,
            }}
          />
          <Chip
            size="small"
            icon={<Settings sx={{ fontSize: 16 }} />}
            label="Эвристика: Динамический SNI-паспорт"
            variant="outlined"
            sx={{ color: 'text.secondary', fontWeight: 500 }}
          />
        </Stack>
      </Box>

      {/* Backend Scanner Accordion (kept intact for test selectors & background execution) */}
      {scanCapabilities?.scannerAvailable && (
        <Paper
          sx={{
            mb: 3,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Accordion
            expanded={scanPanelExpanded}
            onChange={(_event, expanded) => setScanPanelExpanded(expanded)}
            disableGutters
            sx={{
              boxShadow: 'none',
              backgroundColor: 'transparent',
              '&:before': { display: 'none' },
            }}
          >
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography variant="h6" sx={{ fontSize: '1.05rem', fontWeight: 600 }}>
                  Автопоиск SNI (backend scanner)
                </Typography>
                {isScanning && (
                  <Chip
                    size="small"
                    label="Сканирование..."
                    color="primary"
                    variant="outlined"
                    sx={{ height: 20 }}
                  />
                )}
              </Box>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 2, pb: 2 }}>
              {scanCapabilities &&
                (!scanCapabilities.scannerAvailable || !scanCapabilities.timeoutAvailable) && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    Сканер в контейнере недоступен. scanner:{' '}
                    {String(scanCapabilities.scannerAvailable)}, timeout:{' '}
                    {String(scanCapabilities.timeoutAvailable)}
                  </Alert>
                )}

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                <TextField
                  label="IP/домен VPS"
                  value={scanAddr}
                  onChange={(e) => setScanAddr(e.target.value)}
                  fullWidth
                  size="small"
                />
                <TextField
                  label="Секунд скана"
                  type="number"
                  value={scanSeconds}
                  onChange={(e) => setScanSeconds(Number(e.target.value))}
                  size="small"
                  sx={{ minWidth: 140 }}
                />
                <TextField
                  label="Потоков"
                  type="number"
                  value={scanThread}
                  onChange={(e) => setScanThread(Number(e.target.value))}
                  size="small"
                  sx={{ minWidth: 120 }}
                />
                <TextField
                  label="Таймаут, сек"
                  type="number"
                  value={scanTimeout}
                  onChange={(e) => setScanTimeout(Number(e.target.value))}
                  size="small"
                  sx={{ minWidth: 120 }}
                />
              </Stack>

              <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', gap: 1 }}>
                <Button variant="contained" onClick={handleStartScan} disabled={isScanning}>
                  {isScanning ? 'Сканирование...' : 'Сканировать'}
                </Button>
                <Button
                  variant="outlined"
                  onClick={handleImportScannedDomains}
                  disabled={!scanResult || scanCandidates.length === 0 || isScanning}
                >
                  Добавить найденные в список
                </Button>
                {scanCandidates.length > 0 && (
                  <Button
                    variant="outlined"
                    startIcon={<Download />}
                    onClick={handleExportScannedDomains}
                    disabled={isScanning}
                  >
                    Экспорт найденных
                  </Button>
                )}
                <Button
                  variant="text"
                  color="error"
                  onClick={handleClearScannedDomains}
                  disabled={scanCandidates.length === 0 && !scanResult}
                >
                  Очистить предварительный
                </Button>
                {isScanning && <CircularProgress size={24} sx={{ ml: 1 }} />}
              </Stack>

              {isScanning && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                  {scanStatus?.running
                    ? scanStatus.remainingSeconds > 0
                      ? `Сканирование выполняется. Осталось ${scanStatus.remainingSeconds} сек (по данным сервера). Найдено сейчас: ${scanStatus.foundCount}.`
                      : 'Сканирование завершается, ожидайте...'
                    : 'Сканирование запущено, получаем статус от сервера...'}
                </Typography>
              )}

              {scanError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {scanError}
                </Alert>
              )}

              {scanResult && (
                <Box sx={{ mt: 2 }}>
                  <Divider sx={{ mb: 2 }} />
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    Найдено доменов: <b>{scanResult.foundCount}</b>. В предварительном списке:{' '}
                    <b>{scanCandidates.length}</b>.
                  </Typography>
                  <Typography
                    variant="body2"
                    color={scanResult.timedOut ? 'info.main' : 'success.main'}
                    sx={{ mb: 1 }}
                  >
                    {scanResult.timedOut
                      ? `Скан остановлен по лимиту времени (${scanResult.scanSeconds} сек) - это нормальный режим поиска.`
                      : 'Скан завершен успешно.'}{' '}
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      (код: {scanResult.exitCode})
                    </Box>
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    Проверяйте домены кликом и удаляйте лишние перед импортом.
                  </Typography>
                  <Paper variant="outlined" sx={{ maxHeight: 220, overflow: 'auto', p: 0.5 }}>
                    <List dense>
                      {scanCandidates.map((d) => {
                        const prof = resolveClientSniProfile(d);
                        const style = getProfileThemeColor(prof.category);
                        return (
                          <ListItem
                            key={d}
                            sx={{
                              borderRadius: 1,
                              transition: 'background-color 120ms ease',
                              '&:hover': { backgroundColor: 'action.hover' },
                            }}
                            secondaryAction={
                              <IconButton
                                edge="end"
                                size="small"
                                onClick={() => handleRemoveScannedDomain(d)}
                              >
                                <Delete fontSize="small" />
                              </IconButton>
                            }
                          >
                            <ListItemText
                              primary={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <MuiLink
                                    href={`https://${d}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    underline="hover"
                                    sx={{ fontWeight: 500 }}
                                  >
                                    {d}
                                  </MuiLink>
                                  <Chip
                                    size="small"
                                    label={`${prof.category || 'Default'} (${prof.fingerprint})`}
                                    sx={{
                                      fontSize: '0.7rem',
                                      height: 20,
                                      color: style.color,
                                      backgroundColor: style.bgDark,
                                      border: `1px solid ${style.border}`,
                                    }}
                                  />
                                </Box>
                              }
                            />
                          </ListItem>
                        );
                      })}
                      {scanCandidates.length === 0 && (
                        <ListItem>
                          <ListItemText primary="Домены не найдены" />
                        </ListItem>
                      )}
                    </List>
                  </Paper>
                </Box>
              )}
            </AccordionDetails>
          </Accordion>
        </Paper>
      )}

      {/* Tabs navigation: Whitelist vs Reality Profiles Catalog */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_e, val) => setActiveTab(val)}
          textColor="primary"
          indicatorColor="primary"
        >
          <Tab
            label={`Белый список (${totalCount})`}
            icon={<Language sx={{ fontSize: 19 }} />}
            iconPosition="start"
            sx={{ fontWeight: 600, minHeight: 48 }}
          />
          <Tab
            label="Каталог профилей маскировки"
            icon={<Security sx={{ fontSize: 19 }} />}
            iconPosition="start"
            sx={{ fontWeight: 600, minHeight: 48 }}
          />
        </Tabs>
      </Box>

      {/* TAB 0: WHITELIST VIEW */}
      <Box sx={{ display: activeTab === 0 ? 'block' : 'none' }}>
        <Paper sx={{ p: 2.5, borderRadius: 2 }}>
          <Typography variant="h6" gutterBottom sx={{ fontWeight: 650, fontSize: '1.1rem' }}>
            Управление белым списком (SNI)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Добавляйте проверенные адреса вручную или файлом списком. Для каждого домена будет
            автоматически подобран подходящий профиль Reality.
          </Typography>

          {/* Add / Import Toolbar */}
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              label="Доменное имя"
              placeholder="например, swdist.apple.com"
              size="small"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
              }}
              sx={{ flex: '1 1 280px' }}
            />
            {isMobile ? (
              <>
                <IconButton edge="end" onClick={() => fileInputRef.current?.click()}>
                  <UploadFile />
                </IconButton>
                <IconButton edge="end" onClick={handleAdd}>
                  <Add />
                </IconButton>
              </>
            ) : (
              <>
                <Button
                  variant="outlined"
                  startIcon={<UploadFile />}
                  sx={{ width: '170px' }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Из файла
                </Button>
                <Button
                  variant="contained"
                  sx={{ width: '160px' }}
                  startIcon={<Add />}
                  onClick={handleAdd}
                >
                  Добавить
                </Button>
              </>
            )}
            <input
              type="file"
              accept=".txt"
              data-testid="file-input"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </Box>

          {/* Filter & Actions Bar */}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1.5,
              mt: 2.5,
              mb: 1.5,
            }}
          >
            <TextField
              size="small"
              placeholder="Поиск по доменам или профилям..."
              value={whitelistSearch}
              onChange={(e) => setWhitelistSearch(e.target.value)}
              InputProps={{
                startAdornment: <Search sx={{ fontSize: 18, color: 'text.secondary', mr: 1 }} />,
              }}
              sx={{ flex: '1 1 240px', maxWidth: 360 }}
            />

            {domains.length > 0 && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={isBatchPinging ? <CircularProgress size={16} /> : <Speed />}
                  onClick={handlePingAllDomains}
                  disabled={isBatchPinging}
                >
                  {isBatchPinging ? 'Проверка...' : 'Пинг всех'}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<Download />}
                  onClick={handleExportMainDomains}
                >
                  Экспорт списка
                </Button>
                <Button
                  variant="text"
                  color="error"
                  size="small"
                  startIcon={<Remove />}
                  onClick={handleDeleteAll}
                >
                  Удалить все
                </Button>
              </Box>
            )}
          </Box>

          {/* Whitelist Domains Table / List */}
          <Paper variant="outlined" sx={{ mt: 1, borderRadius: 1.5, overflow: 'hidden' }}>
            <List sx={{ p: 0 }}>
              {filteredDomains.map((d, index) => {
                const profile = d.profile || resolveClientSniProfile(d.name);
                const style = getProfileThemeColor(profile.category);
                const isCopied = copiedDomain === d.name;

                return (
                  <React.Fragment key={d.id}>
                    {index > 0 && <Divider />}
                    <ListItem
                      sx={{
                        py: 1.2,
                        px: 2,
                        transition: 'background-color 120ms ease',
                        '&:hover': {
                          backgroundColor: 'action.hover',
                        },
                      }}
                      secondaryAction={
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          {renderPingBadge(d.name)}
                          <Tooltip title="Инспекция параметров маскировки Reality">
                            <IconButton
                              size="small"
                              onClick={() => setInspectedDomain({ domain: d.name, profile })}
                            >
                              <Info fontSize="small" sx={{ color: 'text.secondary' }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Скопировать домен">
                            <IconButton size="small" onClick={() => handleCopy(d.name)}>
                              {isCopied ? (
                                <Check fontSize="small" color="success" />
                              ) : (
                                <ContentCopy fontSize="small" sx={{ color: 'text.secondary' }} />
                              )}
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Удалить из списка">
                            <IconButton edge="end" size="small" onClick={() => handleDelete(d.id)}>
                              <Delete fontSize="small" color="error" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      }
                    >
                      <ListItemText
                        primary={
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1.5,
                              flexWrap: 'wrap',
                              pr: 12,
                            }}
                          >
                            <MuiLink
                              href={`https://${d.name}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              underline="hover"
                              sx={{
                                fontWeight: 600,
                                fontSize: '0.95rem',
                                color: 'text.primary',
                                '&:hover': { color: 'primary.main' },
                              }}
                            >
                              {d.name}
                            </MuiLink>

                            <Chip
                              size="small"
                              label={`${profile.category || 'Fallback'} • ${profile.fingerprint}`}
                              sx={{
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                height: 22,
                                color: style.color,
                                backgroundColor: style.bgDark,
                                border: `1px solid ${style.border}`,
                              }}
                            />

                            {profile.spiderX && profile.spiderX !== '/' && (
                              <Typography
                                variant="caption"
                                sx={{
                                  color: 'text.secondary',
                                  fontFamily: 'monospace',
                                  fontSize: '0.75rem',
                                  display: { xs: 'none', sm: 'inline-block' },
                                }}
                              >
                                spx: {profile.spiderX}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                    </ListItem>
                  </React.Fragment>
                );
              })}
              {filteredDomains.length === 0 && (
                <Typography sx={{ p: 3 }} color="textSecondary" textAlign="center">
                  Нет доменов
                </Typography>
              )}
            </List>

            <TablePagination
              component="div"
              count={totalCount}
              page={page}
              onPageChange={handleChangePage}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={handleChangeRowsPerPage}
              rowsPerPageOptions={[10, 25, 50, 100]}
              labelRowsPerPage="Доменов на странице:"
              labelDisplayedRows={({ from, to, count }) =>
                `${from}–${to} из ${count !== -1 ? count : `более ${to}`}`
              }
            />
          </Paper>
        </Paper>
      </Box>

      {/* TAB 1: REALITY MASKING PROFILES CATALOG & LIVE INSPECTOR */}
      <Box sx={{ display: activeTab === 1 ? 'block' : 'none' }}>
        {/* Live SNI Inspector Card */}
        <Paper sx={{ p: 2.5, mb: 3, borderRadius: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Settings color="primary" />
            <Typography variant="h6" sx={{ fontWeight: 650 }}>
              Инспектор маскировки (Live SNI Tester)
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Введите любой домен или хост, чтобы в реальном времени проверить сопоставление с
            паспортом маскировки Reality и сгенерированные пути запросов.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2.5 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Введите SNI (например, swdist.apple.com, dl.google.com, mydomain.org)"
              value={testerInput}
              onChange={(e) => {
                setTesterInput(e.target.value);
                setInspectorPingResult(null);
              }}
            />
            <Button
              variant="outlined"
              startIcon={isInspectorPinging ? <CircularProgress size={16} /> : <Speed />}
              sx={{ whiteSpace: 'nowrap', px: 2 }}
              onClick={handlePingTester}
              disabled={isInspectorPinging || !testerInput.trim()}
            >
              {isInspectorPinging ? 'Проверка...' : 'Пинг SNI'}
            </Button>
            <Button
              variant="contained"
              startIcon={<Add />}
              sx={{ whiteSpace: 'nowrap', px: 2 }}
              onClick={() => {
                if (testerInput.trim()) {
                  api
                    .post('/domains', { name: testerInput.trim() })
                    .then(() => {
                      setSnackbar({
                        open: true,
                        type: 'success',
                        message: `Домен ${testerInput.trim()} добавлен в белый список!`,
                      });
                      loadDomains();
                    })
                    .catch((e) => {
                      setSnackbar({
                        open: true,
                        type: 'error',
                        message: getApiErrorMessage(e, 'Ошибка добавления'),
                      });
                    });
                }
              }}
            >
              Добавить в белый список
            </Button>
          </Stack>

          {/* Tester Result Box */}
          {liveTestedProfile && (
            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 1.5,
                backgroundColor: 'rgba(15, 26, 31, 0.6)',
                borderColor: getProfileThemeColor(liveTestedProfile.category).border,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 1,
                  mb: 1.5,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {liveTestedProfile.profileName || 'Профиль маскировки'}
                  </Typography>
                  <Chip
                    size="small"
                    label={liveTestedProfile.category || 'Fallback'}
                    sx={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: getProfileThemeColor(liveTestedProfile.category).color,
                      backgroundColor: getProfileThemeColor(liveTestedProfile.category).bgDark,
                      border: `1px solid ${getProfileThemeColor(liveTestedProfile.category).border}`,
                    }}
                  />
                </Box>
              </Box>

              {/* Grid of parameters */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' },
                  gap: 1.5,
                }}
              >
                <Box sx={{ p: 1, borderRadius: 1, backgroundColor: 'action.hover' }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    TLS Fingerprint (uTLS)
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 600, color: 'primary.main', fontFamily: 'monospace' }}
                  >
                    {liveTestedProfile.fingerprint}
                  </Typography>
                </Box>

                <Box sx={{ p: 1, borderRadius: 1, backgroundColor: 'action.hover' }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Reality SpiderX Path
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>
                    {liveTestedProfile.spiderX}
                  </Typography>
                </Box>

                <Box sx={{ p: 1, borderRadius: 1, backgroundColor: 'action.hover' }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    XHTTP Path
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>
                    {liveTestedProfile.xhttpPath || '/'}
                  </Typography>
                </Box>

                <Box sx={{ p: 1, borderRadius: 1, backgroundColor: 'action.hover' }}>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Padding Range
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>
                    {liveTestedProfile.xPaddingBytes || '100-1000'} байт
                  </Typography>
                </Box>
              </Box>

              {/* Dual Probe Ping Diagnostics */}
              {inspectorPingResult && (
                <Box
                  sx={{
                    mt: 2,
                    pt: 2,
                    borderTop: '1px dashed',
                    borderColor: 'divider',
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                      color: 'text.secondary',
                      display: 'block',
                      mb: 1,
                    }}
                  >
                    Проверка доступности (Dual-Probe)
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <Box
                      sx={{
                        flex: 1,
                        p: 1.5,
                        borderRadius: 1,
                        backgroundColor: inspectorPingResult.browser.reachable
                          ? 'rgba(46, 125, 50, 0.12)'
                          : 'rgba(211, 47, 47, 0.12)',
                        border: '1px solid',
                        borderColor: inspectorPingResult.browser.reachable
                          ? 'success.main'
                          : 'error.main',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: inspectorPingResult.browser.reachable
                              ? 'success.main'
                              : 'error.main',
                          }}
                        />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          Из вашей сети (РФ / Провайдер)
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {inspectorPingResult.browser.reachable
                          ? `Доступен (${inspectorPingResult.browser.latencyMs} мс). ТСПУ не блокирует.`
                          : `Заблокирован в РФ (${inspectorPingResult.browser.error || 'Сброс/таймаут соединения'}).`}
                      </Typography>
                    </Box>

                    <Box
                      sx={{
                        flex: 1,
                        p: 1.5,
                        borderRadius: 1,
                        backgroundColor: inspectorPingResult.vps.reachable
                          ? 'rgba(46, 125, 50, 0.12)'
                          : 'rgba(211, 47, 47, 0.12)',
                        border: '1px solid',
                        borderColor: inspectorPingResult.vps.reachable
                          ? 'success.main'
                          : 'error.main',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: inspectorPingResult.vps.reachable
                              ? 'success.main'
                              : 'error.main',
                          }}
                        />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          С сервера VPS (Handshake)
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {inspectorPingResult.vps.reachable
                          ? `Доступен (${inspectorPingResult.vps.latencyMs} мс, ${inspectorPingResult.vps.protocol || 'TLS'}).`
                          : `Не отвечает (${inspectorPingResult.vps.error || 'Ошибка TLS'}).`}
                      </Typography>
                    </Box>
                  </Stack>
                </Box>
              )}
            </Paper>
          )}
        </Paper>

        {/* Profiles Catalog Grid */}
        <Typography variant="h6" sx={{ fontWeight: 650, mb: 1.5 }}>
          Готовые паспорта маскировки (Reality Profiles)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          Каждый паспорт содержит точный браузерный отпечаток и пути запросов, типичные для
          крупных CDN-инфраструктур. Нажмите на домен или кнопку для добавления в белый список.
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
            gap: 2,
          }}
        >
          {catalogProfiles.map((cp) => {
            const style = getProfileThemeColor(cp.category);
            return (
              <Paper
                key={cp.id}
                sx={{
                  p: 2.5,
                  borderRadius: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  border: '1px solid',
                  borderColor: 'divider',
                  transition: 'border-color 150ms ease, box-shadow 150ms ease',
                  '&:hover': {
                    borderColor: style.border,
                    boxShadow: `0 4px 20px ${style.bgDark}`,
                  },
                }}
              >
                <Box>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      mb: 1,
                    }}
                  >
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, fontSize: '1rem' }}>
                      {cp.name}
                    </Typography>
                    <Chip
                      size="small"
                      label={cp.profile.fingerprint}
                      sx={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        color: style.color,
                        backgroundColor: style.bgDark,
                        border: `1px solid ${style.border}`,
                      }}
                    />
                  </Box>

                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontSize: '0.85rem', mb: 2, minHeight: 40 }}
                  >
                    {cp.description}
                  </Typography>

                  <Box
                    sx={{
                      p: 1.2,
                      mb: 2,
                      borderRadius: 1,
                      backgroundColor: 'action.hover',
                      fontSize: '0.78rem',
                      fontFamily: 'monospace',
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <span style={{ color: '#95aab2' }}>SpiderX:</span>
                      <b>{cp.profile.spiderX}</b>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <span style={{ color: '#95aab2' }}>XHTTP:</span>
                      <b>{cp.profile.xhttpPath || '/'}</b>
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#95aab2' }}>Padding:</span>
                      <b>{cp.profile.xPaddingBytes || '100-1000'} B</b>
                    </Box>
                  </Box>

                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 1, fontWeight: 600 }}
                  >
                    Рекомендуемые SNI:
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.8, mb: 2 }}>
                    {cp.recommendedDomains.map((domain) => (
                      <Chip
                        key={domain}
                        size="small"
                        label={domain}
                        clickable
                        onClick={() => handleCopy(domain)}
                        sx={{
                          fontSize: '0.75rem',
                          fontFamily: 'monospace',
                          height: 24,
                          '&:hover': { borderColor: 'primary.main' },
                        }}
                      />
                    ))}
                  </Box>
                </Box>

                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<Add />}
                  fullWidth
                  onClick={() => handleBatchImportDomains(cp.recommendedDomains)}
                  sx={{ mt: 1 }}
                >
                  Добавить проверенные домены
                </Button>
              </Paper>
            );
          })}
        </Box>
      </Box>

      {/* Domain Reality Inspection Dialog */}
      <Dialog
        open={Boolean(inspectedDomain)}
        onClose={() => setInspectedDomain(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          Паспорт маскировки Reality
          <Typography variant="body2" color="text.secondary">
            {inspectedDomain?.domain}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          {inspectedDomain && (
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Профиль экосистемы:
                </Typography>
                <Chip
                  size="small"
                  label={inspectedDomain.profile.profileName || inspectedDomain.profile.category}
                  sx={{
                    color: getProfileThemeColor(inspectedDomain.profile.category).color,
                    backgroundColor: getProfileThemeColor(inspectedDomain.profile.category).bgDark,
                    border: `1px solid ${getProfileThemeColor(inspectedDomain.profile.category).border}`,
                    fontWeight: 600,
                  }}
                />
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  TLS Fingerprint (uTLS):
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  {inspectedDomain.profile.fingerprint}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Путь маскировки SpiderX:
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  {inspectedDomain.profile.spiderX}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Путь протокола XHTTP:
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  {inspectedDomain.profile.xhttpPath || '/'}
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  Диапазон динамического padding:
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                  {inspectedDomain.profile.xPaddingBytes || '100-1000'} байт
                </Typography>
              </Box>

              {inspectedDomain.profile.serverNames &&
                inspectedDomain.profile.serverNames.length > 0 && (
                  <Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      Допустимые ServerNames:
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {inspectedDomain.profile.serverNames.map((s) => (
                        <Chip
                          key={s}
                          size="small"
                          label={s}
                          sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}
                        />
                      ))}
                    </Box>
                  </Box>
                )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectedDomain(null)}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmDialog.open}
        onClose={() => setConfirmDialog({ ...confirmDialog, open: false })}
      >
        <DialogTitle>Подтверждение действия</DialogTitle>
        <DialogContent>
          <Typography>{confirmDialog.title}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              setConfirmDialog({ ...confirmDialog, open: false });
              confirmDialog.onConfirm();
            }}
            variant="contained"
            color="error"
          >
            Удалить
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar feedback */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar({ ...snackbar, open: false })}
          severity={snackbar.type}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
