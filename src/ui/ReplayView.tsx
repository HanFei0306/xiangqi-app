import { Box, Dialog, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemText, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import type { Move } from '../engine/types';
import type { ReplayAnnotation } from '../training/types';

interface ReplayViewProps {
  annotations: ReplayAnnotation[];
  history: Move[];
  onClose: () => void;
}

const TAG_COLOR: Record<string, string> = {
  checkmate: '#C0392B',
  check: '#C0392B',
  fork: '#B8860B',
  sacrifice: '#B8860B',
  blunder: '#2C3E50',
};

/** Modal replay view: lists the key annotated steps of the finished game. */
export function ReplayView({ annotations, history, onClose }: ReplayViewProps) {
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>对局复盘</span>
        <IconButton onClick={onClose} size="small" aria-label="关闭">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {annotations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            本局没有特别关键的得失步，平稳收场。
          </Typography>
        ) : (
          <List dense>
            {annotations.map((a) => {
              const move = history[a.moveIndex];
              const color = TAG_COLOR[a.tag] ?? '#2C3E50';
              return (
                <ListItem key={a.moveIndex} alignItems="flex-start" sx={{ px: 0 }}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography component="span" variant="body2" color="text.secondary">
                          {(a.moveIndex + 1)}.
                        </Typography>
                        <Typography component="span" variant="body1" sx={{ fontWeight: 700 }}>
                          {move?.notation}
                        </Typography>
                        <Box
                          component="span"
                          sx={{
                            fontSize: 12,
                            px: 0.75,
                            py: 0.1,
                            borderRadius: 1,
                            // 标签底色保留语义红/黑，文字统一暖白（对 #C0392B ≈5.4:1）。
                            color: '#FFF2E2',
                            background: color,
                          }}
                        >
                          {a.tag}
                        </Box>
                      </Box>
                    }
                    secondary={a.comment}
                  />
                </ListItem>
              );
            })}
          </List>
        )}
      </DialogContent>
    </Dialog>
  );
}
