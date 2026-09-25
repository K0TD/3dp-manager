import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

interface WorkspaceHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  meta?: ReactNode;
  action?: ReactNode;
}

export function WorkspaceHeader({ eyebrow, title, description, meta, action }: WorkspaceHeaderProps) {
  return (
    <Box component="header" className="workspace-header">
      <Stack spacing={1} sx={{ minWidth: 0 }}>
        <Typography variant="overline" color="primary">{eyebrow}</Typography>
        <Typography component="h1" variant="h4">{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 630 }}>
          {description}
        </Typography>
      </Stack>
      {(meta || action) && (
        <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap flexWrap="wrap" className="workspace-header-actions">
          {meta}
          {action}
        </Stack>
      )}
    </Box>
  );
}
