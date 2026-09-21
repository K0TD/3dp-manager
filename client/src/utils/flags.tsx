import { Box, Stack, Typography } from '@mui/material';

const SPECIAL_CODES: Record<string, string> = {
  ENGLAND: 'gb-eng',
  SCOTLAND: 'gb-sct',
  WALES: 'gb-wls',
};

const decodeFlag = (flag?: string) => {
  if (!flag) return '';
  try {
    return decodeURIComponent(flag);
  } catch {
    return flag;
  }
};

const countryCodeFromFlag = (flag?: string) => {
  const decoded = decodeFlag(flag);
  const points = Array.from(decoded).map((char) => char.codePointAt(0) || 0);

  if (points.length < 2) return undefined;
  if (points[0] < 0x1f1e6 || points[0] > 0x1f1ff) return undefined;
  if (points[1] < 0x1f1e6 || points[1] > 0x1f1ff) return undefined;

  return String.fromCharCode(points[0] - 0x1f1e6 + 65, points[1] - 0x1f1e6 + 65);
};

const normalizeCode = (code?: string) => {
  if (!code) return undefined;
  return SPECIAL_CODES[code.toUpperCase()] || code.toLowerCase();
};

export function FlagIcon({
  flag,
  code,
  size = 22,
}: {
  flag?: string;
  code?: string;
  size?: number;
}) {
  const normalizedCode = normalizeCode(code || countryCodeFromFlag(flag));

  if (!normalizedCode) {
    return (
      <Box
        component="span"
        sx={{
          width: size,
          height: Math.round(size * 0.72),
          borderRadius: 0.5,
          border: 1,
          borderColor: 'divider',
          display: 'inline-block',
          bgcolor: 'action.hover',
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <Box
      component="img"
      src={`https://flagcdn.com/w40/${normalizedCode}.png`}
      srcSet={`https://flagcdn.com/w80/${normalizedCode}.png 2x`}
      alt=""
      loading="lazy"
      sx={{
        width: size,
        height: Math.round(size * 0.72),
        borderRadius: 0.5,
        objectFit: 'cover',
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
        flexShrink: 0,
      }}
    />
  );
}

export function FlagOptionLabel({
  flag,
  code,
  label,
}: {
  flag?: string;
  code?: string;
  label: string;
}) {
  return (
    <Stack component="span" direction="row" spacing={1} alignItems="center">
      <FlagIcon flag={flag} code={code} size={22} />
      <Typography component="span" variant="body2">
        {label}
      </Typography>
    </Stack>
  );
}
