import { Box, Paper, Typography } from '@mui/material';
import LightbulbIcon from '@mui/icons-material/Lightbulb';
import type { HintResult } from '../training/types';
import { SKIN } from './theme';

interface HintBoxProps {
  hint: HintResult | null;
}

/** Shows the latest hint: recommended move notation + short explanation. */
export function HintBox({ hint }: HintBoxProps) {
  if (!hint) return null;
  return (
    <Paper elevation={1} sx={{ p: 1.5, borderLeft: `4px solid ${SKIN.goldDeep}`, borderRadius: '14px' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <LightbulbIcon fontSize="small" sx={{ color: SKIN.goldDeep }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          提示
        </Typography>
        {hint.move && (
          <Typography variant="body1" sx={{ fontWeight: 700, color: SKIN.goldDeep }}>
            {hint.move.notation}
          </Typography>
        )}
      </Box>
      <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
        {hint.explanation}
      </Typography>
    </Paper>
  );
}
