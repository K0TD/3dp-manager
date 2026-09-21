import { useState } from 'react';
import {
  AppBar, Toolbar, Typography, IconButton, Tooltip, Box,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, List, ListItem, ListItemText
} from '@mui/material';
import {
  Brightness7, Brightness4, BrightnessAuto,
  Logout, HelpOutline
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useThemeContext } from '../ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { Menu as MenuIcon } from '@mui/icons-material';
import { APP_VERSION } from '../utils/version';
import { Logger } from '../utils/logger';

interface HeaderProps {
  onMenuClick?: () => void;
  isMobile?: boolean;
}

export default function Header({ onMenuClick, isMobile }: HeaderProps) {
  const { mode, toggleColorMode } = useThemeContext();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ open: false, title: '', onConfirm: () => {} });

  const handleLogout = () => {
    Logger.debug('Opening logout confirmation dialog', 'Header');
    setConfirmDialog({
      open: true,
      title: 'Вы действительно хотите выйти?',
      onConfirm: async () => {
        Logger.debug('Logout confirmed by user', 'Header');
        await logout();
        Logger.debug('logout() resolved in Header', 'Header');
        navigate('/login');
      }
    });
  };

  const getThemeIcon = () => {
    switch (mode) {
      case 'light': return <Brightness7 />;
      case 'dark': return <Brightness4 />;
      case 'system': return <BrightnessAuto />;
    }
  };

  const getThemeLabel = () => {
    switch (mode) {
      case 'light': return 'Светлая тема';
      case 'dark': return 'Темная тема';
      case 'system': return 'Системная тема';
    }
  };

  return (
    <>
      <AppBar
        position="fixed"
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
      >
        <Toolbar>
          {isMobile && (
            <IconButton color="inherit" edge="start" onClick={onMenuClick} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <img src="/img/logo.png" alt="Logo" width={32} height={32} style={{ marginRight: 14 }} />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant={isMobile ? 'body2' : 'h6'} noWrap component="div" color="primary">
              3DP / CONTROL
            </Typography>
            {!isMobile && <Typography variant="caption" color="text.secondary">multi-node manager</Typography>}
          </Box>

          <Box sx={{ display: 'flex', gap: isMobile ? 0.25 : 1 }}>

            <Tooltip title="Справка о программе">
              <IconButton color="inherit" onClick={() => setHelpOpen(true)}>
                <HelpOutline />
              </IconButton>
            </Tooltip>

            <Tooltip title={`Режим: ${getThemeLabel()}`}>
              <IconButton color="inherit" onClick={toggleColorMode}>
                {getThemeIcon()}
              </IconButton>
            </Tooltip>

            <Tooltip title="Выйти из системы">
              <IconButton color="inherit" onClick={handleLogout}>
                <Logout />
              </IconButton>
            </Tooltip>

          </Box>
        </Toolbar>
      </AppBar>

      <Dialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Об утилите 3DP-MANAGER</DialogTitle>
        <DialogContent dividers>
          <DialogContentText paragraph>
            Утилита для автогенерации инбаундов к панели 3x-ui, формирования единой подписки и настройки перенаправления трафика с промежуточного сервера на основной.
          </DialogContentText>

          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
            Основные возможности:
          </Typography>

          <List dense>
            <ListItem>
              <ListItemText
                primary="Автоматическая генерация"
                secondary="Система создает новые инбаунды в заданном интервале."
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Управление подписками"
                secondary="Создание пользователей с уникальными UUID. Одна подписка генерирует множество подключений."
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Белый список доменов"
                secondary="Для работы инбаундов необходим список доменов, под которые маскируется трафик."
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Перенаправление"
                secondary="Если вы используете Каскадную схему подключения, то вы сможете добавить свои промежуточные сервера."
              />
            </ListItem>
          </List>

          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Версия: {APP_VERSION}<br />
            Форк: K0TD · исходный проект: DenPiligrim · лицензия GPL-3.0
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHelpOpen(false)}>Понятно</Button>
        </DialogActions>
      </Dialog>

      {/* Confirmation Dialog for logout */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog({ ...confirmDialog, open: false })}>
        <DialogTitle>Подтверждение</DialogTitle>
        <DialogContent>
          <Typography>{confirmDialog.title}</Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              Logger.debug('Logout canceled by user', 'Header');
              setConfirmDialog({ ...confirmDialog, open: false });
            }}
          >
            Отмена
          </Button>
          <Button
            onClick={async () => {
              try {
                await confirmDialog.onConfirm();
              } catch (error) {
                Logger.error('Logout confirmation action failed', 'Header', {
                  message: error instanceof Error ? error.message : 'unknown error',
                });
              } finally {
                setConfirmDialog({ ...confirmDialog, open: false });
              }
            }}
            variant="contained"
            color="error"
          >
            Выйти
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
