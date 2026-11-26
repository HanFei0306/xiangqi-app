import type { JSX } from 'react';
import { Box, Paper, Tab, Tabs } from '@mui/material';
import type { GameState } from '../engine/types';
import { AncientPracticePage } from './AncientPracticePage';
import { SHIQINGYAQU } from '../data/shiqingyaqu';
import { SKIN, SKIN_RADIUS } from './theme';

interface PracticePageProps {
  /** 透传给《适情雅趣》练习页的「推演」回调；不传时推演按钮置灰。 */
  onSimulate?: (state: GameState) => void;
}

/**
 * Practice page.
 *
 * The built-in 残局 / 开局 puzzle tabs have been removed; the practice screen
 * now opens directly into the 《适情雅趣》 collection (548 endgames). The
 * remaining single tab keeps the collection label visible and preserves the
 * existing tab-based entry point used by the practice tests.
 *
 * v推演: 透传 onSimulate，把残局练习页的「推演」请求交给推演沙盘。
 *
 * v2026.11.25.1: 页头 tab SKIN 化——SKIN.surface 底 + SKIN.border 描边，
 * 选中态金字 + 金色指示条，与深绿底全局成套。
 */
export function PracticePage({ onSimulate }: PracticePageProps = {}): JSX.Element {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'stretch' }}>
      <Paper
        elevation={1}
        sx={{
          p: 0.5,
          alignSelf: 'flex-start',
          background: SKIN.surface,
          border: `1px solid ${SKIN.border}`,
          borderRadius: SKIN_RADIUS,
          boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        <Tabs
          value="ancient"
          sx={{ minHeight: 36, '& .MuiTabs-indicator': { backgroundColor: SKIN.gold } }}
        >
          <Tab
            label={`适情雅趣 (${SHIQINGYAQU.length})`}
            value="ancient"
            sx={{
              minHeight: 36,
              fontSize: 13,
              fontWeight: 700,
              color: SKIN.textMuted,
              '&.Mui-selected': { color: SKIN.gold },
            }}
          />
        </Tabs>
      </Paper>
      <AncientPracticePage onSimulate={onSimulate} />
    </Box>
  );
}
