import type { PaletteMode } from '@mui/material';

export const getDesignTokens = (mode: PaletteMode) => {
  const dark = mode === 'dark';
  return {
    palette: {
      mode,
      primary: { main: dark ? '#53d8ff' : '#006f91', contrastText: dark ? '#061217' : '#ffffff' },
      secondary: { main: dark ? '#f1bd5b' : '#8a5a00' },
      success: { main: dark ? '#56d69a' : '#167b50' },
      warning: { main: dark ? '#ffc45e' : '#9b5c00' },
      error: { main: dark ? '#ff7b7b' : '#b4232f' },
      background: {
        default: dark ? '#081014' : '#edf3f5',
        paper: dark ? '#0f1a1f' : '#f9fcfd',
      },
      text: {
        primary: dark ? '#eef8fa' : '#10252d',
        secondary: dark ? '#95aab2' : '#526b74',
      },
      divider: dark ? '#26373d' : '#cedcdf',
    },
    typography: {
      fontFamily: '"IBM Plex Sans", sans-serif',
      h1: { fontFamily: '"Unbounded", sans-serif', fontWeight: 650, letterSpacing: '-0.04em' },
      h2: { fontFamily: '"Unbounded", sans-serif', fontWeight: 650, letterSpacing: '-0.04em' },
      h3: { fontFamily: '"Unbounded", sans-serif', fontWeight: 650, letterSpacing: '-0.04em', fontSize: 'clamp(2rem, 4vw, 3rem)' },
      h4: { fontFamily: '"Unbounded", sans-serif', fontWeight: 620, letterSpacing: '-0.035em' },
      h5: { fontFamily: '"Unbounded", sans-serif', fontWeight: 600, letterSpacing: '-0.025em' },
      h6: { fontFamily: '"Unbounded", sans-serif', fontWeight: 600, letterSpacing: '-0.02em' },
      overline: { fontWeight: 700, letterSpacing: '0.14em', fontSize: '0.68rem' },
      button: { textTransform: 'none' as const, fontWeight: 700 },
    },
    shape: { borderRadius: 10 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundImage: dark
              ? 'radial-gradient(circle at 85% -10%, rgba(83,216,255,.1), transparent 34%)'
              : 'radial-gradient(circle at 85% -10%, rgba(0,111,145,.09), transparent 34%)',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: `1px solid ${dark ? '#26373d' : '#cedcdf'}`,
            boxShadow: dark
              ? '0 14px 34px rgba(0,0,0,.18)'
              : '0 14px 34px rgba(23,54,64,.07)',
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 7, minHeight: 40, paddingInline: 16 },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            '&.Mui-selected': {
              borderLeft: `3px solid ${dark ? '#53d8ff' : '#006f91'}`,
            },
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            background: dark ? 'rgba(8,16,20,.86)' : 'rgba(249,252,253,.86)',
            backdropFilter: 'blur(18px)',
            color: dark ? '#eef8fa' : '#10252d',
            border: 0,
            borderBottom: `1px solid ${dark ? '#26373d' : '#cedcdf'}`,
            boxShadow: 'none',
          },
        },
      },
      MuiTableHead: {
        styleOverrides: {
          root: { backgroundColor: dark ? '#132229' : '#e8f0f2' },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: { fontWeight: 700, color: dark ? '#b8cbd1' : '#36535d' },
        },
      },
      MuiDialog: {
        styleOverrides: { paper: { backgroundImage: 'none' } },
      },
    },
  };
};
