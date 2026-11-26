import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { MatchPage } from './ui/MatchPage';
import { PracticePage } from './ui/PracticePage';
import { SetupPage } from './ui/SetupPage';
import { HabitCoachPage } from './ui/HabitCoachPage';
import { SimulationPage } from './ui/SimulationPage';
import { EndgameLabPage } from './ui/EndgameLabPage';
import { HomeButton } from './ui/HomeButton';
import { useGameStore } from './store/gameStore';
import { resumeMatch, useHasUnfinishedMatch } from './store/session';
import { useSettings } from './store/settings';
import { applyMusicSettings } from './audio/music';
import { primeAudioOnFirstGesture } from './audio/prime';
import { CALLIGRAPHY_FONT, SKIN } from './ui/theme';
import type { SimHintMode } from './store/simulationStore';
import type { GameState, Move } from './engine/types';

type Screen = 'setup' | 'match' | 'practice' | 'habit' | 'simulation' | 'endgame-lab';

/**
 * 推演页的来处：决定「返回」回到哪里。
 *   match    — 从对局/结算的复盘或失误讲解跳进来；
 *   setup    — 从主页「记谱」直接进来；
 *   lab      — 从「残局推演」摆好局面后交棒进来（返回要回到那张摆棋的盘）；
 *   practice — 从《适情雅趣》当前残局交棒进来（双人手动推演，返回回练习页）。
 */
type SimOrigin = 'match' | 'setup' | 'lab' | 'practice';

/** Root component: v1.13 flow — setup page first, then match / practice. */
export default function App() {
  const [screen, setScreen] = useState<Screen>('setup');
  // v21.6 推演：从对局跳出时携带当前局面；simOrigin 决定返回目标。
  const [simInitial, setSimInitial] = useState<GameState | null>(null);
  const [simOrigin, setSimOrigin] = useState<SimOrigin>('setup');
  const [simHint, setSimHint] = useState<string | null>(null);
  // v2026.11.23.2: 结算页失误讲解复用推演页，默认 mate 保持漏杀链路不变。
  const [simHintMode, setSimHintMode] = useState<SimHintMode>('mate');
  const [simHintMove, setSimHintMove] = useState<Move | null>(null);
  /**
   * v2026.11.23.8: 是否有一局下到一半的棋。订阅 gameStore，主页据此决定
   * 「开始挑战」是直接开局还是先问「继续对局 / 新的对局」。
   */
  const hasUnfinished = useHasUnfinishedMatch();

  // Restore the persisted background track on startup. WebViews may reject
  // autoplay before a gesture; music.ts silently retries on first pointerdown.
  useEffect(() => {
    const settings = useSettings.getState();
    applyMusicSettings(settings.musicTrack, settings.musicVolume);
    // First real tap activates Web Audio on strict Android WebViews.
    primeAudioOnFirstGesture();
  }, []);

  if (screen === 'setup') {
    return (
      <SetupPage
        hasUnfinished={hasUnfinished}
        onStart={() => {
          useGameStore.getState().beginGame();
          setScreen('match');
        }}
        onContinue={() => {
          // 先恢复（挂起那一刻若轮到引擎，这里会重新发起搜索），再切屏。
          resumeMatch();
          setScreen('match');
        }}
        onPractice={() => setScreen('practice')}
        onHabit={() => setScreen('habit')}
        onSimulation={() => {
          setSimInitial(null); setSimOrigin('setup'); setSimHint(null);
          setSimHintMode('mate'); setSimHintMove(null); setScreen('simulation');
        }}
        onEndgameLab={() => setScreen('endgame-lab')}
      />
    );
  }

  if (screen === 'habit') {
    return <HabitCoachPage onBack={() => setScreen('setup')} />;
  }

  if (screen === 'endgame-lab') {
    return (
      <EndgameLabPage
        onHome={() => setScreen('setup')}
        onStartSimulation={(state) => {
          // 摆好的残局交给推演沙盘：自己走子 / 双方 AI 推演都在那边。
          setSimInitial(state);
          setSimHint(null);
          setSimHintMode('move');
          setSimHintMove(null);
          setSimOrigin('lab');
          setScreen('simulation');
        }}
      />
    );
  }

  /** 推演页元素：三个来处（对局/记谱、残局推演、适情雅趣）共用这一份定义。 */
  const simulationView = (
    <SimulationPage
      initialState={simInitial}
      hintNotation={simHint}
      hintMode={simHintMode}
      hintMove={simHintMove}
      // v2026.11.25.2：从适情雅趣进来的推演是「双人手动」——红黑双方都由玩家走，
      // 不需要 AI 介入（用户原话：有时候不知道为什么人机不这样走，我要自己试试）。
      manual={simOrigin === 'practice'}
      title={simOrigin === 'lab' ? '残局推演' : simOrigin === 'practice' ? '自由推演' : '记谱'}
      onHome={() => setScreen('setup')}
      onBack={() => setScreen(
        simOrigin === 'match' ? 'match'
          : simOrigin === 'lab' ? 'endgame-lab'
            : simOrigin === 'practice' ? 'practice'
              : 'setup',
      )}
    />
  );

  /**
   * v2026.11.25.2：从适情雅趣进推演时，练习页**不卸载，只隐藏**。
   * 否则点「返回」时练习页会重新挂载，玩家刚在残局上试走的着法全部丢失，
   * 来回试几次就得从头摆——正好和用户「我要自己试试才懂」的用法冲突。
   * 保持它在 React 树里同一个位置，状态（moves/提示进度）自然留存。
   */
  const practiceHidden = screen === 'simulation' && simOrigin === 'practice';

  if (screen === 'simulation' && !practiceHidden) {
    return simulationView;
  }

  if (screen === 'practice' || practiceHidden) {
    return (
      <>
        {/* v2026.11.25.2：练习页背景与页头统一收敛到 SKIN「墨玉鎏金」色板。 */}
        <Box data-testid="practice-root" sx={{ display: practiceHidden ? 'none' : 'block', minHeight: '100dvh', background: SKIN.pageBg }}>
          {/* Slim bar so practice mode is reachable back to the setup page. */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 1.2,
              py: 0.7,
              background: 'linear-gradient(180deg, rgba(35,68,49,0.96) 0%, rgba(23,49,31,0.96) 100%)',
              borderBottom: '1px solid rgba(231,197,126,0.30)',
            }}
          >
            <HomeButton onClick={() => setScreen('setup')} tone="dark" size="sm" testId="practice-home" />
            <Typography sx={{ color: SKIN.text, fontWeight: 800, fontFamily: CALLIGRAPHY_FONT, letterSpacing: '0.08em' }}>
              练习模式
            </Typography>
            <Typography sx={{ color: SKIN.gold, fontSize: 11, whiteSpace: 'nowrap' }}>v2026.11.25.2</Typography>
          </Box>
          <Box sx={{ p: 2, display: 'flex', justifyContent: 'center' }}>
            <PracticePage
              // v2026.11.25.2：适情雅趣「推演」——把当前盘面交给推演沙盘，双方手动走子。
              onSimulate={(state) => {
                setSimInitial(state);
                setSimHint(null);
                setSimHintMode('move');
                setSimHintMove(null);
                setSimOrigin('practice');
                setScreen('simulation');
              }}
            />
          </Box>
        </Box>
        {practiceHidden && simulationView}
      </>
    );
  }

  return (
    <MatchPage
      onOpenSetup={() => setScreen('setup')}
      onOpenPractice={() => setScreen('practice')}
      onSimulate={(state, hint, options) => {
        setSimInitial(state);
        setSimHint(hint ?? null);
        setSimHintMode(options?.mode ?? 'mate');
        setSimHintMove(options?.move ?? null);
        setSimOrigin('match');
        setScreen('simulation');
      }}
    />
  );
}
