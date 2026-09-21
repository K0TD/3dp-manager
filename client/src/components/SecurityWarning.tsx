import { Alert, AlertTitle, Box, Button, Collapse, IconButton, Snackbar, useMediaQuery, useTheme } from '@mui/material';
import { Close, ContentCopy } from '@mui/icons-material';
import { useState } from 'react';

const INSTALL_COMMAND = 'bash <(curl -fsSL https://raw.githubusercontent.com/k0td/3dp-manager/main/install.sh)';

export default function SecurityWarning() {
  const [copied, setCopied] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
    } catch {
      // Fallback для старых браузеров
      const textArea = document.createElement('textarea');
      textArea.value = INSTALL_COMMAND;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
    }
  };

  return (
    <>
      <Collapse in={true}>
        <Alert
          severity="warning"
          variant="filled"
          sx={{
            borderRadius: 0,
            borderBottom: '1px solid rgba(0, 0, 0, 0.1)',
          }}
        >
          <AlertTitle sx={{ fontWeight: 'bold', mb: 1, fontSize: { xs: '1rem', sm: '1.1rem' } }}>
            3DP-MANAGER работает в небезопасном режиме (HTTP)
          </AlertTitle>
          <Box
            component="p"
            sx={{
              mb: 2,
              fontSize: { xs: '0.875rem', sm: '0.95rem' },
              lineHeight: 1.5,
            }}
          >
            <strong>Не вводите реальные пароли от 3x-ui панели и не меняйте пароль администратора в режиме работы по HTTP!</strong>{' '}
            Для безопасной работы переустановите 3DP-MANAGER с SSL-сертификатами. Все ваши настройки сохранятся.
          </Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              backgroundColor: 'rgba(0, 0, 0, 0.1)',
              p: 1,
              borderRadius: 1,
              flexWrap: { xs: 'wrap', sm: 'nowrap' },
            }}
          >
            <Box
              component="code"
              sx={{
                flexGrow: 1,
                fontSize: { xs: '0.75rem', sm: '0.85rem' },
                wordBreak: 'break-all',
                fontFamily: 'monospace',
                minWidth: 0,
              }}
            >
              {INSTALL_COMMAND}
            </Box>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={!isMobile && <ContentCopy />}
              onClick={handleCopy}
              sx={{
                color: 'inherit',
                borderColor: 'currentColor',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                },
                minWidth: { xs: 'auto', sm: '140px' },
                px: { xs: 1, sm: 2 },
              }}
            >
              {isMobile ? <ContentCopy fontSize="small" /> : 'Копировать'}
            </Button>
          </Box>
        </Alert>
      </Collapse>

      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message="Скопировано"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        action={
          <IconButton size="small" color="inherit" onClick={() => setCopied(false)}>
            <Close fontSize="small" />
          </IconButton>
        }
      />
    </>
  );
}
