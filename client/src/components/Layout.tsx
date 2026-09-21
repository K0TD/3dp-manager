import {
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Dashboard, Dns, Hub, People, Settings, SwapHoriz } from '@mui/icons-material';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';

import Header from './Header';
import Footer from './Footer';
import SecurityWarning from './SecurityWarning';
import { useSecureConnection } from '../utils/useSecureConnection';

const drawerWidth = 240;

const menuItems = [
  { text: 'Обзор', icon: <Dashboard />, path: '/' },
  { text: 'Подписки', icon: <People />, path: '/subscriptions' },
  { text: 'Ноды', icon: <Hub />, path: '/nodes' },
  { text: 'Relay серверы', icon: <SwapHoriz />, path: '/tunnels' },
  { text: 'Домены', icon: <Dns />, path: '/domains' },
  { text: 'Настройки', icon: <Settings />, path: '/settings' },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isSecure } = useSecureConnection();

  const handleDrawerToggle = () => {
    setMobileOpen((prev) => !prev);
  };

  const drawerContent = (
    <Box sx={{ overflow: 'auto', px: 1.25 }}>
      <Toolbar />
      <Box sx={{ px: 1.5, pt: 2, pb: 1 }}>
        <Typography variant="overline" color="primary">NAVIGATION</Typography>
      </Box>
      <List>
        {menuItems.map((item) => (
            <ListItem key={item.text} disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              selected={location.pathname === item.path}
              onClick={() => {
                navigate(item.path);
                if (isMobile) setMobileOpen(false);
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
      <Header onMenuClick={handleDrawerToggle} isMobile={isMobile} />

      <Drawer
        variant={isMobile ? 'temporary' : 'permanent'}
        open={isMobile ? mobileOpen : true}
        onClose={handleDrawerToggle}
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: {
            width: drawerWidth,
            boxSizing: 'border-box',
            borderRight: '1px solid',
            borderColor: 'divider',
          },
        }}
      >
        {drawerContent}
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          width: '100%',
          overflowX: 'hidden',
        }}
      >
        <Toolbar />
        {!isSecure && <SecurityWarning />}
        <Box sx={{ flexGrow: 1, p: { xs: 2, md: 3, xl: 4 }, maxWidth: 1680, width: '100%', mx: 'auto' }}>
          <Outlet />
        </Box>
        <Footer isMobile={isMobile} />
      </Box>
    </Box>
  );
}
