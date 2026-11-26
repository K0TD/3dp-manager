import React, { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add,
  ArrowDownward,
  ArrowUpward,
  Delete,
  OpenInNew,
  Remove,
  Restore,
  ExpandMore,
  ExpandLess,
} from '@mui/icons-material';
import type { NodeRecord } from '../types/node';
import { resolveClientSniProfile } from '../utils/sniProfiles';
import {
  CERTIFICATE_TYPES,
  CONNECTION_OPTIONS,
  FINGERPRINT_OPTIONS,
  MANAGED_PROFILE_TYPES,
  PERSISTENT_INBOUND_TYPES,
  ROUTING_INBOUND_TYPES,
  XHTTP_MODE_OPTIONS,
  type ClientFingerprint,
  type CountryOption,
  type Domain,
  type InboundConfigUI,
  type ManagedProfileKind,
  type ManagedProfileSettings,
  type ProfileRotationPolicy,
  type ReverseProxyEngine,
  type Tunnel,
  type XhttpMode,
} from '../types/inbound';
import {
  createDefaultHttpsFallbackSettings,
  createDefaultSelfSniSettings,
  createDefaultXhttpStableSettings,
  createInboundTemplate,
  getNodeAddress,
  getNodeFlag,
  getRelayOptions,
  getSelectedNode,
  hasSni,
  isInboundSupported,
  isValidPort,
  requiresPanelTlsCertificate,
  validateHttpsFallbackSettings,
  validateSelfSniSettings,
  validateXhttpStableSettings,
} from '../utils/inboundUtils';
import { CountryFlagSelect } from './CountryFlagSelect';
import { ProfilePreviewDialog } from './ProfilePreviewDialog';

export interface InboundsEditorProps {
  inbounds: InboundConfigUI[];
  onChange: (inbounds: InboundConfigUI[]) => void;
  nodes: NodeRecord[];
  tunnels: Tunnel[];
  domains: Domain[];
  countries: CountryOption[];
  getLinkedProfile?: (inbound: InboundConfigUI) => { flag?: string | null } | undefined;
  subscriptionNodeId?: string;
  portErrors?: Record<string, string>;
  onPortErrorsChange?: (errors: Record<string, string>) => void;
  onResetDefaults?: () => void;
  maxInbounds?: number;
  showDisabledAlert?: boolean;
  extraActions?: React.ReactNode;
  compact?: boolean;
  activeConfigIds?: ReadonlySet<string>;
}

export const InboundsEditor: React.FC<InboundsEditorProps> = ({
  inbounds,
  onChange,
  nodes,
  tunnels,
  domains,
  countries,
  getLinkedProfile,
  subscriptionNodeId,
  portErrors = {},
  onPortErrorsChange,
  onResetDefaults,
  maxInbounds = 20,
  showDisabledAlert = false,
  extraActions,
  compact = false,
  activeConfigIds,
}) => {
  const [previewTarget, setPreviewTarget] = useState<InboundConfigUI | null>(
    null,
  );
  const [expandedId, setExpandedId] = useState<string>();

  const openInboundPreview = (inbound: InboundConfigUI) => {
    setPreviewTarget(inbound);
  };

  const ownDomainOptions: string[] = Array.from(
    new Set([
      ...nodes
        .map((n) => getNodeAddress(n.id, nodes))
        .filter((addr) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(addr)),
      ...domains.map((d) => d.name),
    ]),
  );

  const renderOwnDomainOption = (
    props: React.HTMLAttributes<HTMLLIElement>,
    option: string,
  ) => {
    const matchedNode = nodes.find(
      (n) => getNodeAddress(n.id, nodes) === option,
    );
    const inDomains = domains.some((d) => d.name === option);
    return (
      <li {...props} key={option}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          width="100%"
          gap={1}
        >
          <Typography variant="body2">{option}</Typography>
          <Stack direction="row" spacing={0.5}>
            {matchedNode && (
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                label={`Нода: ${matchedNode.name}`}
              />
            )}
            {inDomains && (
              <Chip size="small" variant="outlined" label="Домены" />
            )}
          </Stack>
        </Stack>
      </li>
    );
  };

  const handleProfileSettingsChange = (
    id: string,
    patch: Partial<ManagedProfileSettings>,
  ) => {
    const updated = inbounds.map((inbound) => {
      if (inbound.id !== id) return inbound;
      const defaults =
        inbound.type === 'self-sni'
          ? createDefaultSelfSniSettings()
          : inbound.type === 'https-fallback'
            ? createDefaultHttpsFallbackSettings()
            : createDefaultXhttpStableSettings();
      const nextSettings: ManagedProfileSettings = {
        ...defaults,
        ...inbound.profileSettings,
        ...patch,
      };
      return {
        ...inbound,
        ...(inbound.type === 'self-sni' && patch.domain !== undefined
          ? { sni: patch.domain.trim() }
          : {}),
        ...(inbound.type === 'https-fallback' && patch.domain !== undefined
          ? { tlsServerName: patch.domain.trim() }
          : {}),
        profileSettings: nextSettings,
      };
    });
    onChange(updated);
  };

  const handleInboundChange = (
    id: string,
    field: keyof InboundConfigUI,
    value: string,
  ) => {
    const updated = inbounds.map((inbound) => {
      if (inbound.id !== id) return inbound;
      const next = { ...inbound, [field]: value };

      if (field === 'nodeId') {
        const prevAddr = getNodeAddress(inbound.nodeId, nodes);
        const nextAddr = getNodeAddress(value, nodes);
        const prevNode = getSelectedNode(inbound.nodeId, nodes);
        const nextNode = getSelectedNode(value, nodes);
        next.relayServerId = '';
        if (!MANAGED_PROFILE_TYPES.has(next.type)) next.flag = getNodeFlag(value, nodes);
        if (CERTIFICATE_TYPES.has(next.type)) {
          next.certificateMode = 'node';
          next.certificateFile = '';
          next.keyFile = '';
          next.tlsServerName = nextAddr;
        }
        if (next.type === 'self-sni' || next.type === 'https-fallback') {
          const currentDomain = next.profileSettings?.domain?.trim() || '';
          const shouldReplaceDomain =
            !currentDomain || (prevAddr && currentDomain === prevAddr);
          const nextDomain =
            shouldReplaceDomain && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(nextAddr)
              ? nextAddr
              : currentDomain;
          const shouldReplaceCert =
            !next.profileSettings?.certificateFile?.trim() ||
            (prevNode?.webCertificateFile &&
              next.profileSettings?.certificateFile ===
                prevNode.webCertificateFile);
          const shouldReplaceKey =
            !next.profileSettings?.keyFile?.trim() ||
            (prevNode?.webKeyFile &&
              next.profileSettings?.keyFile === prevNode.webKeyFile);
          const baseDefaults =
            next.type === 'self-sni'
              ? createDefaultSelfSniSettings(nextDomain)
              : createDefaultHttpsFallbackSettings(nextDomain);
          next.profileSettings = {
            ...baseDefaults,
            ...next.profileSettings,
            domain: nextDomain,
            ...(shouldReplaceCert && nextNode?.webCertificateFile
              ? { certificateFile: nextNode.webCertificateFile }
              : {}),
            ...(shouldReplaceKey && nextNode?.webKeyFile
              ? { keyFile: nextNode.webKeyFile }
              : {}),
          };
          if (next.type === 'self-sni') {
            next.sni = nextDomain;
          } else {
            next.tlsServerName = nextDomain;
          }
        }
      }

      if (field === 'type' && (value === 'custom' || ROUTING_INBOUND_TYPES.has(value))) {
        next.nodeId = '';
        next.relayServerId = '';
        next.flag = '';
        next.name = '';
        next.port = '';
        next.sni = '';
        next.certificateMode = undefined;
        next.tlsServerName = undefined;
        next.certificateFile = '';
        next.keyFile = '';
      }

      if (field === 'type' && value !== 'custom' && !ROUTING_INBOUND_TYPES.has(value) && !next.port) {
        next.port = 'random';
      }

      if (field === 'type' && CERTIFICATE_TYPES.has(value)) {
        next.sni = '';
        next.certificateMode = 'node';
        next.tlsServerName = getNodeAddress(next.nodeId, nodes);
        next.certificateFile = '';
        next.keyFile = '';
      }

      if (field === 'type' && PERSISTENT_INBOUND_TYPES.has(value)) {
        next.sni = '';
        next.certificateMode = undefined;
        next.tlsServerName = undefined;
        next.certificateFile = '';
        next.keyFile = '';
      }

      if (field === 'type' && value === 'mtproto-faketls') {
        next.sni = 'random';
        next.certificateMode = undefined;
        next.tlsServerName = undefined;
        next.certificateFile = '';
        next.keyFile = '';
      }

      if (field === 'type' && value === 'xhttp-stable') {
        next.profileSettings = {
          ...createDefaultXhttpStableSettings(),
          ...next.profileSettings,
        };
        if (!next.sni) next.sni = 'random';
        next.certificateMode = undefined;
        next.tlsServerName = undefined;
        next.certificateFile = '';
        next.keyFile = '';
      }

      if (field === 'type' && value === 'self-sni') {
        const selectedNode = getSelectedNode(next.nodeId, nodes);
        const nodeAddr = getNodeAddress(next.nodeId, nodes);
        const defaultDomain =
          next.profileSettings?.domain?.trim() ||
          (next.sni && next.sni !== 'random' ? next.sni.trim() : '') ||
          (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(nodeAddr) ? nodeAddr : '');
        next.profileSettings = {
          ...createDefaultSelfSniSettings(defaultDomain),
          ...next.profileSettings,
          domain: defaultDomain,
          ...(!next.profileSettings?.certificateFile &&
          selectedNode?.webCertificateFile
            ? { certificateFile: selectedNode.webCertificateFile }
            : {}),
          ...(!next.profileSettings?.keyFile && selectedNode?.webKeyFile
            ? { keyFile: selectedNode.webKeyFile }
            : {}),
        };
        next.sni = defaultDomain;
        if (!next.port || next.port === 'random') {
          next.port = '443';
        }
        next.certificateMode = undefined;
        next.tlsServerName = undefined;
        next.certificateFile = '';
        next.keyFile = '';
      }

      if (field === 'type' && value === 'https-fallback') {
        const selectedNode = getSelectedNode(next.nodeId, nodes);
        const nodeAddr = getNodeAddress(next.nodeId, nodes);
        const defaultDomain =
          next.profileSettings?.domain?.trim() ||
          next.tlsServerName?.trim() ||
          (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(nodeAddr) ? nodeAddr : '');
        next.profileSettings = {
          ...createDefaultHttpsFallbackSettings(defaultDomain),
          ...next.profileSettings,
          domain: defaultDomain,
          ...(!next.profileSettings?.certificateFile &&
          selectedNode?.webCertificateFile
            ? { certificateFile: selectedNode.webCertificateFile }
            : {}),
          ...(!next.profileSettings?.keyFile && selectedNode?.webKeyFile
            ? { keyFile: selectedNode.webKeyFile }
            : {}),
        };
        next.tlsServerName = defaultDomain;
      }

      if (field === 'type' && !MANAGED_PROFILE_TYPES.has(value)) {
        next.profileSettings = undefined;
        next.profileId = undefined;
      }

      if (
        field === 'type' &&
        hasSni(value) &&
        value !== 'mtproto-faketls' &&
        !next.sni
      ) {
        next.sni = 'random';
      }

      if (
        field === 'type' &&
        value !== 'custom' &&
        !ROUTING_INBOUND_TYPES.has(value) &&
        !next.nodeId
      ) {
        const defaultNode =
          nodes.find((n) => n.isMain)?.id || nodes[0]?.id || '';
        next.nodeId = defaultNode;
        if (!MANAGED_PROFILE_TYPES.has(next.type)) {
          next.flag = getNodeFlag(next.nodeId, nodes);
        }
      }

      if (field === 'certificateMode') {
        next.certificateFile = '';
        next.keyFile = '';
        next.tlsServerName =
          value === 'node'
            ? getNodeAddress(next.nodeId, nodes)
            : next.tlsServerName;
      }

      return next;
    });

    onChange(updated);

    if (field === 'type' && (value === 'custom' || ROUTING_INBOUND_TYPES.has(value))) {
      if (onPortErrorsChange && portErrors[id]) {
        const nextErrors = { ...portErrors };
        delete nextErrors[id];
        onPortErrorsChange(nextErrors);
      }
    }

    if (field === 'port' && onPortErrorsChange) {
      const nextErrors = { ...portErrors };
      if (isValidPort(value)) {
        delete nextErrors[id];
      } else {
        nextErrors[id] = 'Порт: число 1-65535 или random';
      }
      onPortErrorsChange(nextErrors);
    }
  };

  const moveInbound = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= inbounds.length) return;
    const reordered = [...inbounds];
    [reordered[index], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[index],
    ];
    onChange(reordered);
  };

  const connectionCount = inbounds.filter(
    (item) => !ROUTING_INBOUND_TYPES.has(item.type),
  ).length;

  const addInbound = () => {
    if (connectionCount >= maxInbounds) return;
    const inbound = createInboundTemplate('vless-tcp-reality', nodes, domains);
    setExpandedId(inbound.id);
    onChange([...inbounds, inbound]);
  };

  const removeInbound = (id?: string) => {
    if (!id) {
      onChange([]);
      if (onPortErrorsChange) onPortErrorsChange({});
      return;
    }
    onChange(inbounds.filter((item) => item.id !== id));
    if (onPortErrorsChange && portErrors[id]) {
      const nextErrors = { ...portErrors };
      delete nextErrors[id];
      onPortErrorsChange(nextErrors);
    }
  };

  return (
    <Box>
      {inbounds.some((inbound) =>
        PERSISTENT_INBOUND_TYPES.has(inbound.type),
      ) && (
        <Alert severity="info" sx={{ mb: 2 }}>
          WireGuard, AmneziaWG и HTTP/SOCKS/mixed создаются при сохранении и не
          участвуют в общей ротации. Для замены удалите инбаунд, сохраните
          подписку, затем добавьте его заново и сохраните.
        </Alert>
      )}
      {showDisabledAlert &&
        inbounds.some((i) => i.enabled === false || i.disabledReason) && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Внимание: некоторые конфигурации были отключены (удалена нода). При
            сохранении они будут автоматически активированы на выбранных нодах.
          </Alert>
        )}

      <Typography variant="h6" sx={{ mb: 2 }}>
        Инбаунды ({connectionCount}/{maxInbounds})
      </Typography>

      <Box sx={{ display: 'grid', gap: 2 }}>
        {inbounds.map((inbound, index) => {
          const managed = MANAGED_PROFILE_TYPES.has(inbound.type);
          const linkedProfile = managed ? getLinkedProfile?.(inbound) : undefined;
          const nodeFlag = getNodeFlag(inbound.nodeId || subscriptionNodeId, nodes);
          const expanded = !compact || expandedId === inbound.id || Boolean(portErrors[inbound.id]);
          return (
          <Box
            key={inbound.id}
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: 'repeat(3, minmax(0, 1fr))',
                xl: 'repeat(6, minmax(0, 1fr))',
              },
              alignItems: 'start',
              gap: 2,
              p: { xs: 1.5, sm: 2 },
              minWidth: 0,
              border: 1,
              borderColor: 'divider',
              borderRadius: '16px',
              backgroundColor: 'action.hover',
              transition: 'border-color .18s ease',
              '&:focus-within': { borderColor: 'primary.main' },
            }}
          >
            <Stack
              direction="row"
              sx={{ gridColumn: '1 / -1', minWidth: 0 }}
              alignItems="center"
              spacing={0.5}
            >
              {compact ? (
                <IconButton size="small" aria-expanded={expanded}
                  aria-label={expanded ? 'Свернуть параметры' : 'Редактировать инбаунд'}
                  onClick={() => setExpandedId(expanded ? undefined : inbound.id)}>
                  {expanded ? <ExpandLess /> : <ExpandMore />}
                </IconButton>
              ) : <Typography sx={{ fontWeight: 'bold', mr: 1 }}>#{index + 1}</Typography>}
              <Chip
                size="small"
                label={
                  inbound.name ||
                  (inbound.type === 'happ-routing'
                    ? 'Happ routing'
                    : inbound.type === 'incy-routing'
                      ? 'INCY routing'
                      : inbound.type)
                }
                sx={{ maxWidth: '60%' }}
              />
              {compact && (
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>
                  {nodes.find(node => node.id === inbound.nodeId)?.name || 'Нода подписки'}
                  {inbound.port ? ` · ${inbound.port === 'random' ? 'Случайный порт' : inbound.port}` : ''}
                  {inbound.enabled === false ? ' · Отключён' :
                    inbound.configId && activeConfigIds?.has(inbound.configId) ? ' · Активен' : ''}
                </Typography>
              )}
              <Box sx={{ flex: 1 }} />
              <Tooltip title="Переместить вверх">
                <span>
                  <IconButton
                    size="small"
                    aria-label={`Переместить строку ${index + 1} вверх`}
                    disabled={index === 0}
                    onClick={() => moveInbound(index, -1)}
                  >
                    <ArrowUpward fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Переместить вниз">
                <span>
                  <IconButton
                    size="small"
                    aria-label={`Переместить строку ${index + 1} вниз`}
                    disabled={index === inbounds.length - 1}
                    onClick={() => moveInbound(index, 1)}
                  >
                    <ArrowDownward fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <IconButton
                color="error"
                size="small"
                aria-label={`Удалить инбаунд ${index + 1}`}
                onClick={() => removeInbound(inbound.id)}
              >
                <Delete fontSize="small" />
              </IconButton>
            </Stack>

            {expanded && <>
            {inbound.disabledReason && (
              <Tooltip title={inbound.disabledReason}>
                <Chip
                  size="small"
                  color="warning"
                  label={inbound.disabledReason}
                  sx={{
                    alignSelf: 'center',
                    maxWidth: '100%',
                    gridColumn: '1 / -1',
                  }}
                />
              </Tooltip>
            )}

            <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
              <InputLabel>Тип</InputLabel>
              <Select
                value={inbound.type}
                label="Тип"
                disabled={MANAGED_PROFILE_TYPES.has(inbound.type) || inbound.awgLocked || inbound.persistentLocked}
                onChange={(e) =>
                  handleInboundChange(inbound.id, 'type', e.target.value)
                }
              >
                {CONNECTION_OPTIONS.filter(option =>
                  MANAGED_PROFILE_TYPES.has(inbound.type)
                    ? option === inbound.type
                    : !MANAGED_PROFILE_TYPES.has(option),
                ).map((option) => {
                  const supported = isInboundSupported(
                    option,
                    inbound.nodeId,
                    nodes,
                  );
                  const label =
                    option === 'happ-routing'
                      ? 'Happ routing'
                      : option === 'incy-routing'
                        ? 'INCY routing'
                        : option === 'xhttp-stable'
                          ? 'XHTTP Stable (VLESS + XHTTP + REALITY)'
                          : option === 'self-sni'
                            ? 'Self-SNI (VLESS + RAW + REALITY + Vision)'
                            : option === 'https-fallback'
                              ? 'HTTPS Fallback (VLESS + XHTTP + TLS)'
                              : option;
                  return (
                    <MenuItem key={option} value={option} disabled={!supported}>
                      {label}
                      {supported ? '' : ' · несовместимо'}
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>

            {inbound.type === 'custom' ? (
              <TextField
                size="small"
                label="Ссылка на подключение"
                placeholder="vless://..."
                value={inbound.link || ''}
                onChange={(e) =>
                  handleInboundChange(inbound.id, 'link', e.target.value)
                }
                sx={{ width: '100%', minWidth: 0, gridColumn: '1 / -1' }}
              />
            ) : ROUTING_INBOUND_TYPES.has(inbound.type) ? (
              <TextField
                size="small"
                multiline
                minRows={3}
                label={
                  inbound.type === 'happ-routing'
                    ? 'Профиль Happ routing'
                    : 'Профиль INCY routing'
                }
                placeholder={
                  inbound.type === 'happ-routing'
                    ? 'JSON-объект, base64 или happ://routing/...'
                    : 'JSON-объект, base64, URL или incy://routing/...'
                }
                value={inbound.routingProfile || ''}
                onChange={(e) =>
                  handleInboundChange(
                    inbound.id,
                    'routingProfile',
                    e.target.value,
                  )
                }
                sx={{ width: '100%', minWidth: 0, gridColumn: '1 / -1' }}
              />
            ) : (
              <>
                <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                  <InputLabel>Нода</InputLabel>
                  <Select
                    value={inbound.nodeId || ''}
                    label="Нода"
                    disabled={inbound.awgLocked || inbound.persistentLocked}
                    onChange={(e) =>
                      handleInboundChange(inbound.id, 'nodeId', e.target.value)
                    }
                  >
                    <MenuItem value="">Основная нода</MenuItem>
                    {nodes.map((node) => (
                      <MenuItem key={node.id} value={node.id}>
                        {node.name}
                        {node.isMain ? ' (основная)' : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                  <InputLabel>Relay</InputLabel>
                  <Select
                    value={inbound.relayServerId || ''}
                    label="Relay"
                    disabled={inbound.awgLocked || inbound.persistentLocked}
                    onChange={(e) =>
                      handleInboundChange(
                        inbound.id,
                        'relayServerId',
                        e.target.value,
                      )
                    }
                  >
                    <MenuItem value="">Без relay</MenuItem>
                    {getRelayOptions(inbound.nodeId, tunnels, nodes).map(
                      (tunnel) => (
                        <MenuItem key={tunnel.id} value={tunnel.id.toString()}>
                          {tunnel.name}
                        </MenuItem>
                      ),
                    )}
                  </Select>
                </FormControl>

                <CountryFlagSelect
                  countries={countries}
                  value={inbound.flag || (managed ? '' : nodeFlag)}
                  onChange={(flag) => handleInboundChange(inbound.id, 'flag', flag)}
                  inheritLabel={managed
                    ? (inbound.profileId || linkedProfile ? 'Из профиля' : 'Как у ноды')
                    : 'Без флага'}
                  inheritedFlag={managed ? linkedProfile?.flag || nodeFlag : undefined}
                />

                <TextField
                  size="small"
                  label="Название"
                  value={inbound.name || ''}
                  onChange={(e) =>
                    handleInboundChange(inbound.id, 'name', e.target.value)
                  }
                  sx={{ width: '100%', minWidth: 0 }}
                />

                <TextField
                  size="small"
                  label="Порт"
                  disabled={inbound.awgLocked || inbound.persistentLocked}
                  placeholder="random или порт"
                  value={inbound.port}
                  onChange={(e) =>
                    handleInboundChange(inbound.id, 'port', e.target.value)
                  }
                  error={!!portErrors[inbound.id]}
                  helperText={portErrors[inbound.id] || ''}
                  sx={{ width: '100%', minWidth: 0 }}
                />

                {requiresPanelTlsCertificate(inbound) && (
                  <Box
                    sx={{
                      gridColumn: '1 / -1',
                      display: 'grid',
                      gap: 2,
                      pt: 2,
                      borderTop: 1,
                      borderColor: 'divider',
                      gridTemplateColumns: {
                        xs: 'minmax(0, 1fr)',
                        sm: 'repeat(2, minmax(0, 1fr))',
                        lg: 'repeat(4, minmax(0, 1fr))',
                      },
                    }}
                  >
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ gridColumn: '1 / -1' }}
                    >
                      TLS · сертификат выбранной ноды
                    </Typography>
                    <FormControl
                      size="small"
                      sx={{ width: '100%', minWidth: 0 }}
                    >
                      <InputLabel>TLS-сертификат</InputLabel>
                      <Select
                        value={inbound.certificateMode || 'node'}
                        label="TLS-сертификат"
                        onChange={(e) =>
                          handleInboundChange(
                            inbound.id,
                            'certificateMode',
                            e.target.value,
                          )
                        }
                      >
                        <MenuItem value="node">Сертификат ноды</MenuItem>
                        <MenuItem value="custom">Свой сертификат</MenuItem>
                      </Select>
                    </FormControl>

                    <Autocomplete
                      freeSolo
                      size="small"
                      disabled={inbound.certificateMode !== 'custom'}
                      options={ownDomainOptions}
                      value={
                        inbound.certificateMode === 'custom'
                          ? inbound.tlsServerName || ''
                          : getNodeAddress(inbound.nodeId, nodes)
                      }
                      onInputChange={(_, newValue, reason) => {
                        if (reason === 'input' || reason === 'clear') {
                          handleInboundChange(
                            inbound.id,
                            'tlsServerName',
                            newValue,
                          );
                        }
                      }}
                      onChange={(_, newValue) =>
                        handleInboundChange(
                          inbound.id,
                          'tlsServerName',
                          typeof newValue === 'string' ? newValue : '',
                        )
                      }
                      renderOption={renderOwnDomainOption}
                      renderInput={(params) => (
                        <TextField {...params} label="TLS server name" />
                      )}
                      sx={{ width: '100%', minWidth: 0 }}
                    />

                    {inbound.certificateMode === 'custom' ? (
                      <>
                        <TextField
                          size="small"
                          label="Сертификат"
                          value={inbound.certificateFile || ''}
                          onChange={(e) =>
                            handleInboundChange(
                              inbound.id,
                              'certificateFile',
                              e.target.value,
                            )
                          }
                          sx={{ width: '100%', minWidth: 0 }}
                        />
                        <TextField
                          size="small"
                          label="Приватный ключ"
                          value={inbound.keyFile || ''}
                          onChange={(e) =>
                            handleInboundChange(
                              inbound.id,
                              'keyFile',
                              e.target.value,
                            )
                          }
                          sx={{ width: '100%', minWidth: 0 }}
                        />
                      </>
                    ) : (
                      <Box sx={{ gridColumn: '1 / -1', minWidth: 0 }}>
                        <Tooltip
                          title={
                            getSelectedNode(inbound.nodeId, nodes)?.capabilities
                              ?.autoTlsCertificate
                              ? `Пути получены из 3x-ui: ${getSelectedNode(inbound.nodeId, nodes)?.webCertificateFile || 'сертификат панели'}`
                              : '3x-ui не вернул пути сертификата. Проверьте ноду или выберите свой сертификат.'
                          }
                        >
                          <Chip
                            size="small"
                            variant="outlined"
                            color={
                              getSelectedNode(inbound.nodeId, nodes)
                                ?.capabilities?.autoTlsCertificate === true
                                ? 'success'
                                : 'warning'
                            }
                            label="TLS панели ноды"
                            sx={{
                              alignSelf: 'center',
                              maxWidth: '100%',
                              gridColumn: '1 / -1',
                            }}
                          />
                        </Tooltip>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          display="block"
                          sx={{ mt: 1, overflowWrap: 'anywhere' }}
                        >
                          {getSelectedNode(inbound.nodeId, nodes)
                            ?.webCertificateFile ||
                            'Путь сертификата не получен'}
                        </Typography>
                      </Box>
                    )}
                  </Box>
                )}

                {hasSni(inbound.type) && (() => {
                  const matchedSni =
                    inbound.sni && inbound.sni !== 'random'
                      ? resolveClientSniProfile(inbound.sni)
                      : null;
                  const hasCustomSniValue =
                    Boolean(inbound.sni) &&
                    inbound.sni !== 'random' &&
                    !domains.some((d) => d.name === inbound.sni);
                  return (
                    <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                      <InputLabel id={`${inbound.id}-sni-label`}>
                        {inbound.type === 'mtproto-faketls'
                          ? 'FakeTLS SNI'
                          : 'SNI'}
                      </InputLabel>
                      <Select
                        id={`${inbound.id}-sni`}
                        labelId={`${inbound.id}-sni-label`}
                        value={inbound.sni}
                        label={
                          inbound.type === 'mtproto-faketls'
                            ? 'FakeTLS SNI'
                            : 'SNI'
                        }
                        onChange={(e) =>
                          handleInboundChange(inbound.id, 'sni', e.target.value)
                        }
                      >
                        <MenuItem value="random">
                          {inbound.type === 'mtproto-faketls'
                            ? 'random — из списка SNI'
                            : 'random'}
                        </MenuItem>
                        {hasCustomSniValue && (
                          <MenuItem value={inbound.sni} disabled>{inbound.sni} · вне справочника</MenuItem>
                        )}
                        {domains.map((domain) => {
                          const sniProfile = resolveClientSniProfile(
                            domain.name,
                          );
                          return (
                            <MenuItem key={domain.id} value={domain.name}>
                              <Stack
                                direction="row"
                                justifyContent="space-between"
                                alignItems="center"
                                width="100%"
                                gap={1}
                              >
                                <span>{domain.name}</span>
                                {sniProfile.profileId &&
                                  sniProfile.profileId !== 'default' && (
                                    <Chip
                                      size="small"
                                      color="primary"
                                      variant="outlined"
                                      label={sniProfile.category}
                                    />
                                  )}
                              </Stack>
                            </MenuItem>
                          );
                        })}
                      </Select>
                      {matchedSni &&
                        matchedSni.profileId &&
                        matchedSni.profileId !== 'default' && (
                          <FormHelperText sx={{ mx: 0.5 }}>
                            Профиль: {matchedSni.category} (
                            {matchedSni.fingerprint},{' '}
                            {matchedSni.xhttpPath || matchedSni.spiderX})
                          </FormHelperText>
                        )}
                    </FormControl>
                  );
                })()}

                {inbound.type === 'xhttp-stable' && (() => {
                  const profileSettings = {
                    ...createDefaultXhttpStableSettings(),
                    ...inbound.profileSettings,
                  };
                  const xmux = profileSettings.xmux || { enabled: false };
                  const profileValidationError =
                    validateXhttpStableSettings(profileSettings);
                  return (
                    <Box
                      sx={{
                        gridColumn: '1 / -1',
                        display: 'grid',
                        gap: 2,
                        pt: 2,
                        borderTop: 1,
                        borderColor: 'divider',
                        gridTemplateColumns: {
                          xs: 'minmax(0, 1fr)',
                          sm: 'repeat(2, minmax(0, 1fr))',
                          lg: 'repeat(4, minmax(0, 1fr))',
                        },
                      }}
                    >
                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        flexWrap="wrap"
                        gap={1}
                        sx={{ gridColumn: '1 / -1' }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          Параметры XHTTP берутся из выбранного SNI.
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<OpenInNew />}
                            onClick={() => setPreviewTarget(inbound)}
                          >
                            Предпросмотр и проверка
                          </Button>
                        </Stack>
                      </Stack>

                      {profileValidationError && (
                        <Alert
                          severity="error"
                          sx={{ gridColumn: '1 / -1', py: 0.25 }}
                        >
                          {profileValidationError}
                        </Alert>
                      )}

                      <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                        <InputLabel>Режим XHTTP</InputLabel>
                        <Select
                          value={profileSettings.mode || 'auto'}
                          label="Режим XHTTP"
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              mode: e.target.value as XhttpMode,
                            })
                          }
                        >
                          {XHTTP_MODE_OPTIONS.map((mode) => (
                            <MenuItem key={mode} value={mode}>
                              {mode}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                        <InputLabel>Ротация домена</InputLabel>
                        <Select
                          value={profileSettings.rotationPolicy || 'fixed_domain'}
                          label="Ротация домена"
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              rotationPolicy: e.target
                                .value as ProfileRotationPolicy,
                            })
                          }
                        >
                          <MenuItem value="fixed_domain">
                            Сохранять домен (рекомендуется)
                          </MenuItem>
                          <MenuItem value="standard">
                            Обычная ротация SNI
                          </MenuItem>
                        </Select>
                      </FormControl>

                      <Box
                        sx={{
                          gridColumn: { xs: '1 / -1', lg: 'span 2' },
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        <FormControlLabel
                          control={
                            <Switch
                              size="small"
                              checked={Boolean(xmux.enabled)}
                              onChange={(e) =>
                                handleProfileSettingsChange(inbound.id, {
                                  xmux: {
                                    ...xmux,
                                    enabled: e.target.checked,
                                  },
                                })
                              }
                            />
                          }
                          label="Клиентский XMUX (только на клиенте, по умолчанию выкл.)"
                        />
                      </Box>

                      {xmux.enabled && (
                        <>
                          <TextField
                            size="small"
                            label="maxConcurrency"
                            placeholder="например 16-32"
                            value={xmux.maxConcurrency || ''}
                            onChange={(e) =>
                              handleProfileSettingsChange(inbound.id, {
                                xmux: { ...xmux, maxConcurrency: e.target.value },
                              })
                            }
                            sx={{ width: '100%', minWidth: 0 }}
                          />
                          <TextField
                            size="small"
                            label="maxConnections"
                            placeholder="или 4-8"
                            value={xmux.maxConnections || ''}
                            onChange={(e) =>
                              handleProfileSettingsChange(inbound.id, {
                                xmux: { ...xmux, maxConnections: e.target.value },
                              })
                            }
                            sx={{ width: '100%', minWidth: 0 }}
                          />
                          <TextField
                            size="small"
                            label="cMaxReuseTimes"
                            placeholder="0 или 16-32"
                            value={xmux.cMaxReuseTimes || ''}
                            onChange={(e) =>
                              handleProfileSettingsChange(inbound.id, {
                                xmux: { ...xmux, cMaxReuseTimes: e.target.value },
                              })
                            }
                            sx={{ width: '100%', minWidth: 0 }}
                          />
                          <TextField
                            size="small"
                            label="hMaxRequestTimes"
                            placeholder="600-900"
                            value={xmux.hMaxRequestTimes || ''}
                            onChange={(e) =>
                              handleProfileSettingsChange(inbound.id, {
                                xmux: {
                                  ...xmux,
                                  hMaxRequestTimes: e.target.value,
                                },
                              })
                            }
                            sx={{ width: '100%', minWidth: 0 }}
                          />
                          <TextField
                            size="small"
                            label="hMaxReusableSecs"
                            placeholder="1800-3000"
                            value={xmux.hMaxReusableSecs || ''}
                            onChange={(e) =>
                              handleProfileSettingsChange(inbound.id, {
                                xmux: {
                                  ...xmux,
                                  hMaxReusableSecs: e.target.value,
                                },
                              })
                            }
                            sx={{ width: '100%', minWidth: 0 }}
                          />
                        </>
                      )}
                    </Box>
                  );
                })()}

                {inbound.type === 'self-sni' && (() => {
                  const profileSettings = {
                    ...createDefaultSelfSniSettings(),
                    ...inbound.profileSettings,
                  };
                  const webServer = profileSettings.webServer ?? 'nginx';
                  const selfSniValidationError = validateSelfSniSettings(
                    profileSettings,
                    inbound.port,
                  );
                  return (
                    <Box
                      sx={{
                        gridColumn: '1 / -1',
                        display: 'grid',
                        gap: 2,
                        pt: 2,
                        borderTop: 1,
                        borderColor: 'divider',
                        gridTemplateColumns: {
                          xs: 'minmax(0, 1fr)',
                          sm: 'repeat(2, minmax(0, 1fr))',
                          lg: 'repeat(4, minmax(0, 1fr))',
                        },
                      }}
                    >
                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        flexWrap="wrap"
                        gap={1}
                        sx={{ gridColumn: '1 / -1' }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          Self-SNI · VLESS + RAW + REALITY + Vision на собственном домене и локальном HTTPS-сайте
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<OpenInNew />}
                            onClick={() => openInboundPreview(inbound)}
                          >
                            Предпросмотр
                          </Button>
                        </Stack>
                      </Stack>

                      {selfSniValidationError && (
                        <Alert
                          severity="error"
                          sx={{ gridColumn: '1 / -1', py: 0.25 }}
                        >
                          {selfSniValidationError}
                        </Alert>
                      )}

                      <Autocomplete
                        freeSolo
                        size="small"
                        options={ownDomainOptions}
                        value={profileSettings.domain || ''}
                        onInputChange={(_, newValue, reason) => {
                          if (reason === 'input' || reason === 'clear') {
                            handleProfileSettingsChange(inbound.id, {
                              domain: newValue,
                            });
                          }
                        }}
                        onChange={(_, newValue) =>
                          handleProfileSettingsChange(inbound.id, {
                            domain: typeof newValue === 'string' ? newValue : '',
                          })
                        }
                        renderOption={renderOwnDomainOption}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Собственный домен (Self-SNI)"
                            placeholder="site.example.com"
                          />
                        )}
                        sx={{ width: '100%', minWidth: 0 }}
                      />

                      <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                        <InputLabel>Веб-сервер локального сайта</InputLabel>
                        <Select
                          value={webServer}
                          label="Веб-сервер локального сайта"
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              webServer: e.target.value as ReverseProxyEngine,
                            })
                          }
                        >
                          <MenuItem value="nginx">Nginx (127.0.0.1)</MenuItem>
                          <MenuItem value="caddy">Caddy (127.0.0.1)</MenuItem>
                          <MenuItem value="none">Внешний / ручной target</MenuItem>
                        </Select>
                      </FormControl>

                      {webServer !== 'none' ? (
                        <TextField
                          size="small"
                          type="number"
                          label="Локальный HTTPS-порт"
                          value={profileSettings.localHttpsPort ?? 8443}
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              localHttpsPort: Number(e.target.value) || 8443,
                            })
                          }
                          sx={{ width: '100%', minWidth: 0 }}
                        />
                      ) : (
                        <TextField
                          size="small"
                          type="number"
                          label="Целевой HTTPS-порт (destPort)"
                          value={profileSettings.destPort ?? 443}
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              destPort: Number(e.target.value) || 443,
                            })
                          }
                          sx={{ width: '100%', minWidth: 0 }}
                        />
                      )}

                      <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                        <InputLabel>Fingerprint</InputLabel>
                        <Select
                          value={profileSettings.fingerprint || 'chrome'}
                          label="Fingerprint"
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              fingerprint: e.target.value as ClientFingerprint,
                            })
                          }
                        >
                          {FINGERPRINT_OPTIONS.map((fp) => (
                            <MenuItem key={fp} value={fp}>
                              {fp}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                        <InputLabel>PROXY protocol (xver)</InputLabel>
                        <Select
                          value={profileSettings.xver ?? 0}
                          label="PROXY protocol (xver)"
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              xver: Number(e.target.value) as 0 | 1 | 2,
                            })
                          }
                        >
                          <MenuItem value={0}>0 — выключен (рекомендуется)</MenuItem>
                          <MenuItem value={1}>1 — PROXY protocol v1</MenuItem>
                          <MenuItem value={2}>2 — PROXY protocol v2</MenuItem>
                        </Select>
                      </FormControl>

                      <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                        <InputLabel>Политика ротации</InputLabel>
                        <Select
                          value={profileSettings.rotationPolicy || 'fixed_domain'}
                          label="Политика ротации"
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              rotationPolicy: e.target
                                .value as ProfileRotationPolicy,
                            })
                          }
                        >
                          <MenuItem value="fixed_domain">
                            Фиксированный домен (рекомендуется)
                          </MenuItem>
                          <MenuItem value="preserve_all">
                            Сохранять домен и параметры
                          </MenuItem>
                        </Select>
                      </FormControl>

                      <TextField
                        size="small"
                        label="SpiderX"
                        placeholder="/"
                        value={profileSettings.spiderX || '/'}
                        onChange={(e) =>
                          handleProfileSettingsChange(inbound.id, {
                            spiderX: e.target.value,
                          })
                        }
                        sx={{ width: '100%', minWidth: 0 }}
                      />

                      {webServer !== 'none' && (
                        <>
                          <TextField
                            size="small"
                            label="Путь сертификата (для шаблона, опц.)"
                            placeholder="/etc/letsencrypt/live/.../fullchain.pem"
                            value={profileSettings.certificateFile || ''}
                            onChange={(e) =>
                              handleProfileSettingsChange(inbound.id, {
                                certificateFile: e.target.value,
                              })
                            }
                            sx={{ width: '100%', minWidth: 0 }}
                          />
                          <TextField
                            size="small"
                            label="Путь ключа (для шаблона, опц.)"
                            placeholder="/etc/letsencrypt/live/.../privkey.pem"
                            value={profileSettings.keyFile || ''}
                            onChange={(e) =>
                              handleProfileSettingsChange(inbound.id, {
                                keyFile: e.target.value,
                              })
                            }
                            sx={{ width: '100%', minWidth: 0 }}
                          />
                        </>
                      )}
                    </Box>
                  );
                })()}

                {inbound.type === 'https-fallback' && (() => {
                  const profileSettings = {
                    ...createDefaultHttpsFallbackSettings(
                      inbound.tlsServerName || '',
                    ),
                    ...inbound.profileSettings,
                  };
                  const reverseProxy = profileSettings.reverseProxy ?? 'none';
                  const fallbackValidationError = validateHttpsFallbackSettings(
                    profileSettings,
                    inbound.port,
                    inbound.tlsServerName,
                  );
                  return (
                    <Box
                      sx={{
                        gridColumn: '1 / -1',
                        display: 'grid',
                        gap: 2,
                        pt: 2,
                        borderTop: 1,
                        borderColor: 'divider',
                        gridTemplateColumns: {
                          xs: 'minmax(0, 1fr)',
                          sm: 'repeat(2, minmax(0, 1fr))',
                          lg: 'repeat(4, minmax(0, 1fr))',
                        },
                      }}
                    >
                      <Stack
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        flexWrap="wrap"
                        gap={1}
                        sx={{ gridColumn: '1 / -1' }}
                      >
                        <Typography variant="caption" color="text.secondary">
                          HTTPS Fallback · независимый VLESS + XHTTP + TLS с отдельным endpoint и поддержкой reverse proxy
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<OpenInNew />}
                            onClick={() => openInboundPreview(inbound)}
                          >
                            Предпросмотр
                          </Button>
                        </Stack>
                      </Stack>

                      {fallbackValidationError && (
                        <Alert
                          severity="error"
                          sx={{ gridColumn: '1 / -1', py: 0.25 }}
                        >
                          {fallbackValidationError}
                        </Alert>
                      )}

                      <Autocomplete
                        freeSolo
                        size="small"
                        options={ownDomainOptions}
                        value={
                          profileSettings.domain || inbound.tlsServerName || ''
                        }
                        onInputChange={(_, newValue, reason) => {
                          if (reason === 'input' || reason === 'clear') {
                            handleProfileSettingsChange(inbound.id, {
                              domain: newValue,
                            });
                          }
                        }}
                        onChange={(_, newValue) =>
                          handleProfileSettingsChange(inbound.id, {
                            domain: typeof newValue === 'string' ? newValue : '',
                          })
                        }
                        renderOption={renderOwnDomainOption}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Домен сертификата (Fallback)"
                            placeholder="fallback.example.com"
                          />
                        )}
                        sx={{ width: '100%', minWidth: 0 }}
                      />

                      <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                        <InputLabel>Режим TLS / Reverse Proxy</InputLabel>
                        <Select
                          value={reverseProxy}
                          label="Режим TLS / Reverse Proxy"
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              reverseProxy: e.target
                                .value as ReverseProxyEngine,
                            })
                          }
                        >
                          <MenuItem value="none">Прямой TLS в Xray</MenuItem>
                          <MenuItem value="nginx">
                            За Nginx reverse proxy (127.0.0.1)
                          </MenuItem>
                          <MenuItem value="caddy">
                            За Caddy reverse proxy (127.0.0.1)
                          </MenuItem>
                        </Select>
                      </FormControl>

                      <TextField
                        size="small"
                        label="Endpoint Path (выделенный)"
                        placeholder="/api/v2/stream"
                        value={profileSettings.path ?? '/api/v2/stream'}
                        onChange={(e) =>
                          handleProfileSettingsChange(inbound.id, {
                            path: e.target.value,
                          })
                        }
                        sx={{ width: '100%', minWidth: 0 }}
                      />

                      <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                        <InputLabel>Режим XHTTP</InputLabel>
                        <Select
                          value={profileSettings.mode || 'auto'}
                          label="Режим XHTTP"
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              mode: e.target.value as XhttpMode,
                            })
                          }
                        >
                          {XHTTP_MODE_OPTIONS.map((mode) => (
                            <MenuItem key={mode} value={mode}>
                              {mode}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      {reverseProxy !== 'none' && (
                        <TextField
                          size="small"
                          type="number"
                          label="Публичный HTTPS-порт proxy"
                          value={profileSettings.publicPort ?? 443}
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              publicPort: Number(e.target.value) || 443,
                            })
                          }
                          sx={{ width: '100%', minWidth: 0 }}
                        />
                      )}

                      <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                        <InputLabel>Fingerprint</InputLabel>
                        <Select
                          value={profileSettings.fingerprint || 'chrome'}
                          label="Fingerprint"
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              fingerprint: e.target.value as ClientFingerprint,
                            })
                          }
                        >
                          {FINGERPRINT_OPTIONS.map((fp) => (
                            <MenuItem key={fp} value={fp}>
                              {fp}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      <FormControl size="small" sx={{ width: '100%', minWidth: 0 }}>
                        <InputLabel>Политика ротации</InputLabel>
                        <Select
                          value={profileSettings.rotationPolicy || 'fixed_domain'}
                          label="Политика ротации"
                          onChange={(e) =>
                            handleProfileSettingsChange(inbound.id, {
                              rotationPolicy: e.target
                                .value as ProfileRotationPolicy,
                            })
                          }
                        >
                          <MenuItem value="fixed_domain">
                            Фиксированный домен и сертификат
                          </MenuItem>
                          <MenuItem value="preserve_all">
                            Сохранять домен, путь и сертификат
                          </MenuItem>
                        </Select>
                      </FormControl>

                      {reverseProxy !== 'none' && (
                        <>
                          <TextField
                            size="small"
                            label="Путь сертификата (для шаблона proxy, опц.)"
                            placeholder="/etc/letsencrypt/live/.../fullchain.pem"
                            value={profileSettings.certificateFile || ''}
                            onChange={(e) =>
                              handleProfileSettingsChange(inbound.id, {
                                certificateFile: e.target.value,
                              })
                            }
                            sx={{ width: '100%', minWidth: 0 }}
                          />
                          <TextField
                            size="small"
                            label="Путь ключа (для шаблона proxy, опц.)"
                            placeholder="/etc/letsencrypt/live/.../privkey.pem"
                            value={profileSettings.keyFile || ''}
                            onChange={(e) =>
                              handleProfileSettingsChange(inbound.id, {
                                keyFile: e.target.value,
                              })
                            }
                            sx={{ width: '100%', minWidth: 0 }}
                          />
                        </>
                      )}
                    </Box>
                  );
                })()}
              </>
            )}
            </>}
          </Box>
          );
        })}
      </Box>

      {previewTarget && (
        <ProfilePreviewDialog
          open={Boolean(previewTarget)}
          onClose={() => setPreviewTarget(null)}
          kind={previewTarget.type as ManagedProfileKind}
          name={previewTarget.name}
          flag={previewTarget.flag || getLinkedProfile?.(previewTarget)?.flag || undefined}
          nodeId={previewTarget.nodeId || subscriptionNodeId}
          port={previewTarget.port}
          sni={previewTarget.sni}
          settings={previewTarget.profileSettings}
        />
      )}

      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{ mt: 2 }}
        alignItems="center"
        flexWrap="wrap"
      >
        <Button
          variant="outlined"
          size="small"
          startIcon={<Add />}
          onClick={addInbound}
          disabled={connectionCount >= maxInbounds}
        >
          Добавить инбаунд
        </Button>
        <Button
          variant="outlined"
          color="error"
          size="small"
          startIcon={<Remove />}
          sx={{ ml: 0.5 }}
          onClick={() => removeInbound()}
        >
          Удалить все
        </Button>
        {onResetDefaults && (
          <Button
            variant="outlined"
            color="secondary"
            size="small"
            startIcon={<Restore />}
            onClick={onResetDefaults}
          >
            Сбросить по умолчанию
          </Button>
        )}
        {extraActions}
      </Stack>
    </Box>
  );
};
