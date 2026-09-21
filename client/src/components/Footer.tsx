import { Box, Container, Grid, IconButton, Link, Stack, Typography } from '@mui/material';
import { GitHub, YouTube, Telegram } from '@mui/icons-material';

interface FooterProps {
  isMobile?: boolean;
}

export default function Footer({ isMobile }: FooterProps) {
  return (
    <Box
      component="footer"
      sx={{
        py: 3,
        px: 2,
        mt: 'auto',
        borderTop: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Container maxWidth={false}>
        <Grid container spacing={4} justifyContent="space-between" alignItems="center">

          <Grid size={{ xs: 12, sm: 4 }}>
            <Stack direction="row" alignItems="center" spacing={1} justifyContent={isMobile ? 'center' : 'start'}>
              <img src="/img/logo.png" alt="Logo" width={32} height={32} style={{ marginRight: isMobile ? 0 : 14 }} />
              <Typography variant="caption" color="text.secondary">K0TD fork · GPL-3.0</Typography>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12, sm: 4 }} sx={{ textAlign: 'center' }}>
            <Link
              href="https://3dp-manager.com/docs/intro"
              target="_blank"
              rel="noopener"
              color="text.primary"
              underline="hover"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, fontWeight: 500 }}
            >
              Документация
            </Link>
          </Grid>

          <Grid size={{ xs: 12, sm: 4 }} sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
            <Stack direction="row" spacing={1} justifyContent={{ xs: 'center', sm: 'flex-end' }}>

              <IconButton
                component="a"
                href="https://github.com/K0TD/3dp-manager"
                target="_blank"
                aria-label="GitHub"
                color="inherit"
              >
                <GitHub />
              </IconButton>

              <IconButton
                component="a"
                href="https://youtube.com/@denpiligrim"
                target="_blank"
                aria-label="YouTube"
                color="inherit"
              >
                <YouTube />
              </IconButton>

              <IconButton
                component="a"
                href="https://t.me/denpiligrim_web"
                target="_blank"
                aria-label="Telegram"
                color="inherit"
              >
                <Telegram />
              </IconButton>

            </Stack>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}
