import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add, ArrowDownward, ArrowUpward, Delete, Remove, Restore } from '@mui/icons-material';
import type { NodeRecord } from '../types/node';
import {
  CERTIFICATE_TYPES,
  CONNECTION_OPTIONS,
  type CountryOption,
  type Domain,
  type InboundConfigUI,
  type Tunnel,
} from '../types/inbound';
import {
  createInboundTemplate,
  getNodeAddress,
  getNodeFlag,
  getRelayOptions,
  getSelectedNode,
  hasSni,
  isInboundSupported,
  isValidPort,
} from '../utils/inboundUtils';
import { FlagOptionLabel } from '../utils/flags';

export interface InboundsEditorProps {
  inbounds: InboundConfigUI[];
  onChange: (inbounds: InboundConfigUI[]) => void;
  nodes: NodeRecord[];
  tunnels: Tunnel[];
  domains: Domain[];
  countries: CountryOption[];
  portErrors?: Record<string, string>;
  onPortErrorsChange?: (errors: Record<string, string>) => void;
  onResetDefaults?: () => void;
  maxInbounds?: number;
  showDisabledAlert?: boolean;
}

export const InboundsEditor: React.FC<InboundsEditorProps> = ({
  inbounds,
  onChange,
  nodes,
  tunnels,
  domains,
  countries,
  portErrors = {},
  onPortErrorsChange,
  onResetDefaults,
  maxInbounds = 20,
  showDisabledAlert = false,
}) => {
  const handleInboundChange = (
    id: string,
    field: keyof InboundConfigUI,
    value: string,
  ) => {
    const updated = inbounds.map((inbound) => {
      if (inbound.id !== id) return inbound;
      const next = { ...inbound, [field]: value };

      if (field === 'nodeId') {
        next.relayServerId = '';
        next.flag = getNodeFlag(value, nodes);
        if (CERTIFICATE_TYPES.has(next.type)) {
          next.certificateMode = 'node';
          next.certificateFile = '';
          next.keyFile = '';
          next.tlsServerName = getNodeAddress(value, nodes);
        }
      }

      if (field === 'type' && value === 'custom') {
        next.nodeId = '';
        next.relayServerId = '';
        next.flag = '';
        next.name = '';
        next.certificateMode = undefined;
        next.tlsServerName = undefined;
        next.certificateFile = '';
        next.keyFile = '';
      }

      if (field === 'type' && CERTIFICATE_TYPES.has(value)) {
        next.sni = '';
        next.certificateMode = 'node';
        next.tlsServerName = getNodeAddress(next.nodeId, nodes);
        next.certificateFile = '';
        next.keyFile = '';
      }

      if (field === 'type' && value === 'amneziawg') {
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

      if (
        field === 'type' &&
        hasSni(value) &&
        value !== 'mtproto-faketls' &&
        !next.sni
      ) {
        next.sni = 'random';
      }

      if (field === 'type' && value !== 'custom' && !next.nodeId) {
        const defaultNode = nodes.find((n) => n.isMain)?.id || nodes[0]?.id || '';
        next.nodeId = defaultNode;
        next.flag = getNodeFlag(next.nodeId, nodes);
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

  const addInbound = () => {
    if (inbounds.length >= maxInbounds) return;
    onChange([...inbounds, createInboundTemplate('vless-tcp-reality', nodes, domains)]);
  };

  const removeInbound = (id?: string) => {
    if (!id) {
      onChange([createInboundTemplate('vless-tcp-reality', nodes, domains)]);
      if (onPortErrorsChange) onPortErrorsChange({});
      return;
    }
    if (inbounds.length <= 1) return;
    onChange(inbounds.filter((item) => item.id !== id));
    if (onPortErrorsChange && portErrors[id]) {
      const nextErrors = { ...portErrors };
      delete nextErrors[id];
      onPortErrorsChange(nextErrors);
    }
  };

  return (
    <Box>
      {showDisabledAlert && inbounds.some((i) => i.enabled === false || i.disabledReason) && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Внимание: некоторые конфигурации были отключены (удалена нода). При сохранении они будут автоматически активированы на выбранных нодах.
        </Alert>
      )}

      <Typography variant="h6" sx={{ mb: 2 }}>
        Инбаунды ({inbounds.length}/{maxInbounds})
      </Typography>

      <Box sx={{ maxHeight: '52vh', overflow: 'auto', pr: 1 }}>
        {inbounds.map((inbound, index) => (
          <Box
            key={inbound.id}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 2,
              mb: 2,
              p: 2,
              flexWrap: 'nowrap',
              width: 'fit-content',
              minWidth:
                inbound.type === 'custom'
                  ? 780
                  : CERTIFICATE_TYPES.has(inbound.type)
                    ? 1540
                    : 1260,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            <Stack sx={{ width: 40, flexShrink: 0 }} alignItems="center" spacing={0.25}>
              <Typography sx={{ fontWeight: 'bold' }}>#{index + 1}</Typography>
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
            </Stack>

            {inbound.disabledReason && (
              <Tooltip title={inbound.disabledReason}>
                <Chip
                  size="small"
                  color="warning"
                  label={inbound.disabledReason}
                  sx={{ alignSelf: 'center', flexShrink: 0 }}
                />
              </Tooltip>
            )}

            <FormControl size="small" sx={{ width: 185, flexShrink: 0 }}>
              <InputLabel>Тип</InputLabel>
              <Select
                value={inbound.type}
                label="Тип"
                onChange={(e) => handleInboundChange(inbound.id, 'type', e.target.value)}
              >
                {CONNECTION_OPTIONS.map((option) => {
                  const supported = isInboundSupported(option, inbound.nodeId, nodes);
                  return (
                    <MenuItem key={option} value={option} disabled={!supported}>
                      {option}
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
                onChange={(e) => handleInboundChange(inbound.id, 'link', e.target.value)}
                sx={{ width: 460, flexShrink: 0 }}
              />
            ) : (
              <>
                <FormControl size="small" sx={{ width: 170, flexShrink: 0 }}>
                  <InputLabel>Нода</InputLabel>
                  <Select
                    value={inbound.nodeId || ''}
                    label="Нода"
                    onChange={(e) => handleInboundChange(inbound.id, 'nodeId', e.target.value)}
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

                <FormControl size="small" sx={{ width: 170, flexShrink: 0 }}>
                  <InputLabel>Relay</InputLabel>
                  <Select
                    value={inbound.relayServerId || ''}
                    label="Relay"
                    onChange={(e) => handleInboundChange(inbound.id, 'relayServerId', e.target.value)}
                  >
                    <MenuItem value="">Без relay</MenuItem>
                    {getRelayOptions(inbound.nodeId, tunnels, nodes).map((tunnel) => (
                      <MenuItem key={tunnel.id} value={tunnel.id.toString()}>
                        {tunnel.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" sx={{ width: 170, flexShrink: 0 }}>
                  <InputLabel>Флаг</InputLabel>
                  <Select
                    value={inbound.flag || getNodeFlag(inbound.nodeId, nodes)}
                    label="Флаг"
                    onChange={(e) => handleInboundChange(inbound.id, 'flag', e.target.value)}
                    renderValue={(value) => (
                      <FlagOptionLabel
                        flag={value}
                        label={countries.find((country) => country.emoji === value)?.name || 'Флаг'}
                      />
                    )}
                  >
                    <MenuItem value="">Без флага</MenuItem>
                    {inbound.flag && !countries.some((c) => c.emoji === inbound.flag) && (
                      <MenuItem key={inbound.flag} value={inbound.flag} sx={{ display: 'none' }}>
                        <FlagOptionLabel flag={inbound.flag} label={inbound.flag} />
                      </MenuItem>
                    )}
                    {countries.map((country) => (
                      <MenuItem key={country.code} value={country.emoji}>
                        <FlagOptionLabel flag={country.emoji} code={country.code} label={country.name} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <TextField
                  size="small"
                  label="Название"
                  value={inbound.name || ''}
                  onChange={(e) => handleInboundChange(inbound.id, 'name', e.target.value)}
                  sx={{ width: 180, flexShrink: 0 }}
                />

                <TextField
                  size="small"
                  label="Порт"
                  placeholder="random или порт"
                  value={inbound.port}
                  onChange={(e) => handleInboundChange(inbound.id, 'port', e.target.value)}
                  error={!!portErrors[inbound.id]}
                  helperText={portErrors[inbound.id] || ''}
                  sx={{ width: 150, flexShrink: 0 }}
                />

                {CERTIFICATE_TYPES.has(inbound.type) && (
                  <>
                    <FormControl size="small" sx={{ width: 190, flexShrink: 0 }}>
                      <InputLabel>TLS-сертификат</InputLabel>
                      <Select
                        value={inbound.certificateMode || 'node'}
                        label="TLS-сертификат"
                        onChange={(e) => handleInboundChange(inbound.id, 'certificateMode', e.target.value)}
                      >
                        <MenuItem value="node">Сертификат ноды</MenuItem>
                        <MenuItem value="custom">Свой сертификат</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      size="small"
                      label="TLS server name"
                      value={
                        inbound.certificateMode === 'custom'
                          ? inbound.tlsServerName || ''
                          : getNodeAddress(inbound.nodeId, nodes)
                      }
                      disabled={inbound.certificateMode !== 'custom'}
                      onChange={(e) => handleInboundChange(inbound.id, 'tlsServerName', e.target.value)}
                      sx={{ width: 220, flexShrink: 0 }}
                    />

                    {inbound.certificateMode === 'custom' ? (
                      <>
                        <TextField
                          size="small"
                          label="Сертификат"
                          value={inbound.certificateFile || ''}
                          onChange={(e) => handleInboundChange(inbound.id, 'certificateFile', e.target.value)}
                          sx={{ width: 320, flexShrink: 0 }}
                        />
                        <TextField
                          size="small"
                          label="Приватный ключ"
                          value={inbound.keyFile || ''}
                          onChange={(e) => handleInboundChange(inbound.id, 'keyFile', e.target.value)}
                          sx={{ width: 320, flexShrink: 0 }}
                        />
                      </>
                    ) : (
                      <Tooltip
                        title={
                          getSelectedNode(inbound.nodeId, nodes)?.capabilities?.autoTlsCertificate
                            ? `Пути получены из 3x-ui: ${getSelectedNode(inbound.nodeId, nodes)?.webCertificateFile || 'сертификат панели'}`
                            : '3x-ui не вернул пути сертификата. Проверьте ноду или выберите свой сертификат.'
                        }
                      >
                        <Chip
                          size="small"
                          variant="outlined"
                          color={
                            getSelectedNode(inbound.nodeId, nodes)?.capabilities?.autoTlsCertificate === false
                              ? 'warning'
                              : 'success'
                          }
                          label="TLS панели ноды"
                          sx={{ alignSelf: 'center', flexShrink: 0 }}
                        />
                      </Tooltip>
                    )}
                  </>
                )}

                {hasSni(inbound.type) && (
                  <FormControl size="small" sx={{ width: 190, flexShrink: 0 }}>
                    <InputLabel id={`${inbound.id}-sni-label`}>
                      {inbound.type === 'mtproto-faketls' ? 'FakeTLS SNI' : 'SNI'}
                    </InputLabel>
                    <Select
                      id={`${inbound.id}-sni`}
                      labelId={`${inbound.id}-sni-label`}
                      value={inbound.sni}
                      label={inbound.type === 'mtproto-faketls' ? 'FakeTLS SNI' : 'SNI'}
                      onChange={(e) => handleInboundChange(inbound.id, 'sni', e.target.value)}
                    >
                      <MenuItem value="random">
                        {inbound.type === 'mtproto-faketls'
                          ? 'random — из списка SNI'
                          : 'random'}
                      </MenuItem>
                      {domains.map((domain) => (
                        <MenuItem key={domain.id} value={domain.name}>
                          {domain.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </>
            )}

            <IconButton
              color="primary"
              onClick={() => removeInbound(inbound.id)}
              disabled={inbounds.length <= 1}
              sx={{ mt: 0.5, flexShrink: 0 }}
            >
              <Delete />
            </IconButton>
          </Box>
        ))}
      </Box>

      <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center" flexWrap="wrap">
        <Button
          variant="outlined"
          size="small"
          startIcon={<Add />}
          onClick={addInbound}
          disabled={inbounds.length >= maxInbounds}
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
      </Stack>
    </Box>
  );
};
