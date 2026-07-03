import { useState, useEffect, useCallback, useRef } from 'react';
import { graniteEvent, IAP, openURL } from '@apps-in-toss/web-framework';
// 미니앱 간 이동 (크로스 프로모션) — 토스 밖이면 무시
const openMiniApp = (link: string) => { openURL(link).catch(() => {}); };

import { BannerAd, showInterstitialAd, showRewardedAd, isAdFree, restoreAdFree, buyAdFree, REGION_SKU, REGION_KEY, PLAN_SKU, PLAN_KEY } from './utils/ads';

// ── Types ─────────────────────────────────────────────────────────────────────

type Screen = 'home' | 'play' | 'result' | 'history' | 'share';

type ProblemType =
  | 'arithmetic'
  | 'trap'
  | 'missing'
  | 'compare'
  | 'chain'
  | 'pattern'
  | 'percent'
  | 'time';

interface Problem {
  type: ProblemType;
  display: string;
  answer: number;
  options: number[];
  timeLimit: number;
  level: number;
  explanation?: string;
}

interface AdaptiveState {
  currentLevel: number;
  history: boolean[];
  consecutiveCorrect: number;
  consecutiveWrong: number;
}

type BrainType = 'lightning' | 'calculator' | 'intuitive' | 'steady' | 'creative' | 'rusty';

interface BrainSession {
  date: string;
  brainAge: number;
  brainType: BrainType;
  correctCount: number;
  avgResponseTime: number;
  finalLevel: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_QUESTIONS = 15;
const INITIAL_LEVEL = 3;
const TRAP_POSITIONS = [4, 9];

const SK = {
  BEST:   'brain_best',
  DAILY:  'brain_daily',
  STREAK: 'brain_streak',
};

const BRAIN_TYPE_CONFIG: Record<BrainType, { label: string; emoji: string; color: string; description: string }> = {
  lightning:  { label: '번개 두뇌',  emoji: '⚡', color: '#FFD700', description: '빠르고 정확한 만능 두뇌' },
  calculator: { label: '계산기 두뇌', emoji: '🧮', color: '#3498DB', description: '느리지만 틀리지 않는 정밀한 두뇌' },
  intuitive:  { label: '직감형 두뇌', emoji: '💡', color: '#E74C3C', description: '빠르지만 함정에 약한 감각파' },
  steady:     { label: '꾸준한 두뇌', emoji: '🎯', color: '#2ECC71', description: '균형 잡힌 안정적인 두뇌' },
  creative:   { label: '창의형 두뇌', emoji: '🎨', color: '#9B59B6', description: '패턴을 직감적으로 포착하는 두뇌' },
  rusty:      { label: '녹슨 두뇌',  emoji: '🔧', color: '#95A5A6', description: '매일 하면 금방 돌아올 잠재력' },
};

// ── Storage ───────────────────────────────────────────────────────────────────

function lsGet<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : null; }
  catch { return null; }
}
function lsSet<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

// ── Problem Generators ────────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function generateOptions4(correct: number): number[] {
  const options = new Set<number>([correct]);
  let attempts = 0;
  while (options.size < 4 && attempts < 100) {
    attempts++;
    const range = Math.max(5, Math.abs(correct) * 0.3);
    const wrong = correct + randInt(-Math.ceil(range), Math.ceil(range));
    if (wrong !== correct && wrong >= 0) options.add(wrong);
  }
  let fallback = 1;
  while (options.size < 4) {
    if (!options.has(correct + fallback)) options.add(correct + fallback);
    fallback++;
  }
  return [...options].sort(() => Math.random() - 0.5);
}
function findNaturalFactors(n: number): { a: number; b: number } {
  for (let i = Math.floor(Math.sqrt(Math.abs(n))); i >= 2; i--) {
    if (n % i === 0) return { a: i, b: n / i };
  }
  return { a: 1, b: n };
}

const TRAPS = [
  { display: '1 + 1 + 1 + 1 + 1 × 0 = ?', answer: 4, explanation: '곱셈이 먼저! 1×0=0이고, 나머지 1+1+1+1=4', wrongAnswers: [0, 5, 1] },
  { display: '8 ÷ 2 × (2 + 2) = ?', answer: 16, explanation: '왼쪽부터: 8÷2=4, 4×4=16', wrongAnswers: [1, 8, 4] },
  { display: '100을 반으로 나누고\n50을 더하면?', answer: 250, explanation: '"반으로 나눈다" = ÷0.5 = ×2. 100÷0.5=200, +50=250', wrongAnswers: [100, 150, 75] },
  { display: '공책과 펜을 합치면 1,100원.\n공책이 펜보다 1,000원 비싸면\n펜 가격은?', answer: 50, explanation: '펜=x, 공책=x+1000. 2x+1000=1100. x=50원', wrongAnswers: [100, 10, 150] },
  { display: '10만원짜리를 20% 할인 후\n추가 10% 할인.\n최종 가격은?', answer: 72000, explanation: '80,000 × 0.9 = 72,000원. 30% 할인이 아님!', wrongAnswers: [70000, 68000, 75000] },
  { display: '의사 5명이 사과 5개를\n5분에 다 먹는다.\n100명이 100개를\n먹는데 걸리는 시간은?', answer: 5, explanation: '1명이 1개를 5분에 먹음. 100명이 각자 1개씩 = 5분', wrongAnswers: [100, 20, 50] },
  { display: '달팽이가 10m 우물을\n올라간다. 낮에 3m 올라가고\n밤에 2m 미끄러진다.\n며칠째에 탈출?', answer: 8, explanation: '하루 순이동 1m. 7일 후 7m. 8일째 낮에 10m 도달!', wrongAnswers: [10, 9, 7] },
  { display: '어떤 물건 가격이\n50% 올랐다가 50% 내렸다.\n원래 가격 대비 몇 %?', answer: 75, explanation: '100→150(+50%)→75(-50%). 원래보다 25% 싸짐!', wrongAnswers: [100, 50, 80] },
  { display: '40명 중 60%가 찬성.\n나머지 전원을 설득하면\n찬성률은?', answer: 100, explanation: '반대 40%=16명 전원 설득 → 40명 모두 찬성 = 100%', wrongAnswers: [76, 84, 90] },
  { display: '시속 60km로\n40분 가면 몇 km?', answer: 40, explanation: '60km × (40/60)시간 = 40km', wrongAnswers: [60, 24, 36] },
  { display: '동전을 5번 던져 모두 앞면.\n6번째도 앞면일 확률은?', answer: 50, explanation: '각 시행은 독립! 이전 결과와 무관하게 항상 50%', wrongAnswers: [2, 25, 75] },
  { display: '3개의 문 중 하나에 상품.\n하나를 고른 후 빈 문 하나가\n열렸다. 바꿨을 때\n당첨 확률(%)?', answer: 67, explanation: '몬티홀 문제! 바꾸면 2/3 ≈ 67%', wrongAnswers: [50, 33, 75] },
  { display: '1km² = ?m²', answer: 1000000, explanation: '1km² = 1,000m × 1,000m = 1,000,000m²', wrongAnswers: [1000, 10000, 100000] },
  { display: '아버지와 아들의 나이 합 = 66.\n아버지는 아들의 두 배.\n아들 나이는?', answer: 22, explanation: '아들 x, 아버지 2x. 3x = 66. x = 22', wrongAnswers: [33, 11, 24] },
  { display: '양말 서랍에 검정 10개,\n흰색 10개. 불을 끈 채\n짝을 맞추려면 최소\n몇 개를 꺼내야?', answer: 3, explanation: '최악의 경우 2개가 다른 색. 3개째에 반드시 짝이 생김', wrongAnswers: [2, 10, 11] },
  { display: '어떤 수의 70%의 절반은\n그 수의 몇 %?', answer: 35, explanation: '70% × 0.5 = 35%', wrongAnswers: [50, 40, 25] },
  { display: '하루에 시계 분침과\n시침이 겹치는 횟수는?', answer: 22, explanation: '12시간에 11번. 24시간 = 22번', wrongAnswers: [24, 12, 23] },
  { display: '택시 기본요금 4,800원.\n100m당 100원 추가.\n10km 타면 총 요금은?', answer: 14800, explanation: '10km=10,000m, 추가 100단위×100원=10,000원. 4,800+10,000=14,800원', wrongAnswers: [10000, 104800, 13800] },
];

function genTrap(level: number): Problem {
  const pool = level <= 4 ? TRAPS.slice(0, 6) : level <= 7 ? TRAPS.slice(4, 14) : TRAPS.slice(10);
  const trap = pool[Math.floor(Math.random() * pool.length)];
  const options = [trap.answer, ...trap.wrongAnswers].sort(() => Math.random() - 0.5);
  return { type: 'trap', display: trap.display, answer: trap.answer, options, timeLimit: 15 + level, level, explanation: trap.explanation };
}

function genArithmetic(level: number): Problem {
  let a: number, b: number, op: string, answer: number;
  if (level <= 3) {
    a = randInt(11, 49); b = randInt(11, 49);
    op = pickRandom(['+', '-']);
    if (op === '-' && a < b) [a, b] = [b, a];
    answer = op === '+' ? a + b : a - b;
  } else if (level <= 6) {
    if (Math.random() > 0.5) {
      a = randInt(11, 49); b = randInt(3, 9); op = '×'; answer = a * b;
    } else {
      a = randInt(100, 499); b = randInt(11, 99);
      op = pickRandom(['+', '-']);
      if (op === '-' && a < b) [a, b] = [b, a];
      answer = op === '+' ? a + b : a - b;
    }
  } else {
    a = randInt(11, 35); b = randInt(11, 25); op = '×'; answer = a * b;
  }
  return { type: 'arithmetic', display: `${a} ${op} ${b} = ?`, answer, options: generateOptions4(answer), timeLimit: Math.max(5, 15 - level), level };
}

function genCompare(level: number): Problem {
  const a1 = randInt(5 + level, 15 + level * 3);
  const b1 = randInt(3, 9);
  const left = a1 * b1;
  const maxDiff = Math.max(1, 8 - level);
  const diff = randInt(1, maxDiff);
  let right = left + pickRandom([diff, -diff]);
  if (right <= 0) right = left + diff;
  let factors = findNaturalFactors(right);
  for (let i = 0; i < 20 && factors.a === 1; i++) {
    const d = randInt(1, maxDiff);
    right = left + pickRandom([d, -d]);
    if (right <= 0) right = left + d;
    factors = findNaturalFactors(right);
  }
  if (factors.a === 1) {
    right = right % 2 === 0 ? right : right + 1;
    if (right === left) right += 2;
    factors = findNaturalFactors(right);
  }
  const leftLabel = `${a1} × ${b1}`;
  const rightLabel = `${factors.a} × ${factors.b}`;
  const isLeftBigger = left > right;
  return {
    type: 'compare',
    display: `어느 쪽이 더 클까?\n\nA: ${leftLabel}\nB: ${rightLabel}`,
    answer: isLeftBigger ? 0 : 1,
    options: [0, 1],
    timeLimit: 8 + level,
    level,
  };
}

function genChain(level: number): Problem {
  const steps = Math.min(3 + Math.floor(level / 2), 6);
  let current = 0;
  const ops: string[] = [];
  for (let i = 0; i < steps; i++) {
    const op = pickRandom(['+', '-', '×']);
    let n: number;
    if (op === '×') {
      n = randInt(2, 4);
      if (current === 0 || current * n > 500) {
        n = randInt(3, 10); current += n; ops.push(`+${n}`); continue;
      }
      current *= n;
    } else if (op === '+') {
      n = randInt(3, 15); current += n;
    } else {
      if (current <= 3) { n = randInt(3, 10); current += n; ops.push(`+${n}`); continue; }
      n = randInt(1, current - 1); current -= n;
    }
    ops.push(`${op}${n}`);
  }
  return { type: 'chain', display: `0에서 시작!\n${ops.join(' → ')} = ?`, answer: current, options: generateOptions4(current), timeLimit: 5 + steps * 3, level };
}

function genPattern(level: number): Problem {
  if (level <= 4) {
    const start = randInt(1, 10), diff = randInt(2, 7);
    const seq = Array.from({ length: 5 }, (_, i) => start + diff * i);
    const answer = start + diff * 5;
    return { type: 'pattern', display: `${seq.join(', ')}, ?`, answer, options: generateOptions4(answer), timeLimit: 15, level };
  }
  if (level <= 7) {
    if (Math.random() > 0.5) {
      const start = randInt(2, 4), ratio = randInt(2, 3);
      const seq = Array.from({ length: 5 }, (_, i) => start * Math.pow(ratio, i));
      const answer = start * Math.pow(ratio, 5);
      return { type: 'pattern', display: `${seq.join(', ')}, ?`, answer, options: generateOptions4(answer), timeLimit: 18, level };
    } else {
      const offset = randInt(0, 3);
      const seq = Array.from({ length: 5 }, (_, i) => (i + 1 + offset) ** 2);
      const answer = (6 + offset) ** 2;
      return { type: 'pattern', display: `${seq.join(', ')}, ?`, answer, options: generateOptions4(answer), timeLimit: 18, level };
    }
  }
  if (Math.random() > 0.5) {
    const a = randInt(1, 3), b = randInt(1, 3);
    const seq = [a, b];
    for (let i = 2; i < 6; i++) seq.push(seq[i - 1] + seq[i - 2]);
    const answer = seq[5] + seq[4];
    seq.push(answer);
    return { type: 'pattern', display: `${seq.slice(0, 6).join(', ')}, ?`, answer, options: generateOptions4(answer), timeLimit: 20, level };
  } else {
    const start = randInt(1, 5);
    const seq = [start];
    for (let i = 1; i <= 5; i++) seq.push(seq[i - 1] + i);
    const answer = seq[5] + 6;
    return { type: 'pattern', display: `${seq.join(', ')}, ?`, answer, options: generateOptions4(answer), timeLimit: 20, level };
  }
}

function genMissing(level: number): Problem {
  if (level <= 4) {
    const answer = randInt(3, 20), b = randInt(2, 10);
    const op = pickRandom(['+', '×']);
    const result = op === '+' ? answer + b : answer * b;
    return { type: 'missing', display: `? ${op} ${b} = ${result}`, answer, options: generateOptions4(answer), timeLimit: 10, level };
  }
  const answer = randInt(3, 12), b = randInt(3, 8), c = randInt(5, 20);
  const result = answer * b - c;
  return { type: 'missing', display: `? × ${b} - ${c} = ${result}`, answer, options: generateOptions4(answer), timeLimit: 18, level };
}

function genPercent(level: number): Problem {
  if (level <= 5) {
    const base = pickRandom([100, 200, 500, 1000]);
    const pct = pickRandom([10, 20, 25, 30, 50]);
    const answer = base * pct / 100;
    return { type: 'percent', display: `${base.toLocaleString()}의 ${pct}%는?`, answer, options: generateOptions4(answer), timeLimit: 12, level };
  }
  const base = randInt(2, 8) * 100;
  const pct = pickRandom([10, 20, 25, 40, 50]);
  const part = base * pct / 100;
  return { type: 'percent', display: `${part}은 ${base}의 몇 %?`, answer: pct, options: generateOptions4(pct), timeLimit: 15, level };
}

function genTime(level: number): Problem {
  const hour = randInt(1, 10);
  const min = level <= 5 ? pickRandom([0, 15, 30, 45]) : randInt(5, 55);
  const addH = randInt(1, 3);
  const addM = level <= 5 ? pickRandom([0, 15, 30]) : randInt(10, 50);
  let rH = hour + addH, rM = min + addM;
  if (rM >= 60) { rH++; rM -= 60; }
  if (rH > 12) rH -= 12;
  if (rH <= 0) rH += 12;
  const answer = rH * 100 + rM;
  const display = `${hour}시 ${String(min).padStart(2, '0')}분\n+ ${addH}시간 ${String(addM).padStart(2, '0')}분\n= ?시 ?분`;
  function makeTimeOption(h: number, m: number): number {
    if (m >= 60) { h++; m -= 60; }
    if (m < 0) { h--; m += 60; }
    if (h > 12) h -= 12;
    if (h <= 0) h += 12;
    return h * 100 + m;
  }
  const wrongAnswers = [makeTimeOption(rH, rM + 30), makeTimeOption(rH, rM - 40), makeTimeOption(rH + 1, rM)];
  return { type: 'time', display, answer, options: [answer, ...wrongAnswers].sort(() => Math.random() - 0.5), timeLimit: 15, level };
}

function getLevelWeights(level: number): Record<ProblemType, number> {
  if (level <= 3) return { arithmetic: 40, trap: 10, missing: 20, compare: 15, chain: 5, pattern: 5, percent: 5, time: 0 };
  if (level <= 6) return { arithmetic: 15, trap: 20, missing: 15, compare: 15, chain: 15, pattern: 10, percent: 5, time: 5 };
  return { arithmetic: 5, trap: 25, missing: 10, compare: 10, chain: 20, pattern: 15, percent: 10, time: 5 };
}

function weightedRandom(weights: Record<ProblemType, number>): ProblemType {
  const entries = Object.entries(weights) as [ProblemType, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = Math.random() * total;
  for (const [type, weight] of entries) {
    r -= weight;
    if (r <= 0) return type;
  }
  return entries[0][0];
}

function generateProblem(level: number, forceType?: ProblemType): Problem {
  const type = forceType ?? weightedRandom(getLevelWeights(level));
  switch (type) {
    case 'arithmetic': return genArithmetic(level);
    case 'trap':       return genTrap(level);
    case 'missing':    return genMissing(level);
    case 'compare':    return genCompare(level);
    case 'chain':      return genChain(level);
    case 'pattern':    return genPattern(level);
    case 'percent':    return genPercent(level);
    case 'time':       return genTime(level);
  }
}

// ── Adaptive Difficulty ───────────────────────────────────────────────────────

function getNextLevel(state: AdaptiveState): number {
  if (state.consecutiveCorrect >= 3) return Math.min(state.currentLevel + 1, 10);
  if (state.consecutiveWrong >= 2) return Math.max(state.currentLevel - 1, 1);
  return state.currentLevel;
}

function updateAdaptiveState(state: AdaptiveState, isCorrect: boolean): AdaptiveState {
  const consecutiveCorrect = isCorrect ? state.consecutiveCorrect + 1 : 0;
  const consecutiveWrong = isCorrect ? 0 : state.consecutiveWrong + 1;
  return {
    currentLevel: getNextLevel({ ...state, consecutiveCorrect, consecutiveWrong }),
    history: [...state.history, isCorrect],
    consecutiveCorrect,
    consecutiveWrong,
  };
}

// ── Brain Age Calculation ─────────────────────────────────────────────────────

function formatTimeOption(encoded: number): string {
  const h = Math.floor(encoded / 100);
  const m = encoded % 100;
  return `${h}시 ${String(m).padStart(2, '0')}분`;
}

function calculateBrainAge(
  correctCount: number,
  avgResponseMs: number,
  maxLevelReached: number,
  trapCorrect: number,
): { brainAge: number; brainType: BrainType } {
  let brainAge = 30;
  brainAge -= (correctCount - 10) * 2;
  if (avgResponseMs < 3000) brainAge -= 3;
  else if (avgResponseMs < 5000) brainAge -= 1;
  else if (avgResponseMs > 8000) brainAge += 3;
  else if (avgResponseMs > 6000) brainAge += 1;
  brainAge -= (maxLevelReached - 5) * 1.5;
  brainAge -= trapCorrect * 3;
  brainAge = Math.max(15, Math.min(60, Math.round(brainAge)));

  const fast = avgResponseMs < 4000;
  const accurate = correctCount >= 12;
  const patternStrong = maxLevelReached >= 7;

  let brainType: BrainType;
  if (fast && accurate) brainType = 'lightning';
  else if (!fast && accurate) brainType = 'calculator';
  else if (fast && !accurate) brainType = 'intuitive';
  else if (patternStrong) brainType = 'creative';
  else if (correctCount >= 9) brainType = 'steady';
  else brainType = 'rusty';

  return { brainAge, brainType };
}

// ── Streak ────────────────────────────────────────────────────────────────────

function getStreak(): number {
  const streak = lsGet<{ date: string; count: number }>(SK.STREAK);
  if (!streak) return 0;
  const today = todayStr();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (streak.date === today || streak.date === yesterday) return streak.count;
  return 0;
}

function updateStreak(): number {
  const today = todayStr();
  const prev = lsGet<{ date: string; count: number }>(SK.STREAK);
  if (prev?.date === today) return prev.count;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const count = prev?.date === yesterday ? prev.count + 1 : 1;
  lsSet(SK.STREAK, { date: today, count });
  return count;
}

// ── Simulated total count ─────────────────────────────────────────────────────

function getTotalCount(): number {
  const base = 52341;
  const daysSinceLaunch = Math.floor((Date.now() - new Date('2026-04-20').getTime()) / 86400000);
  return base + daysSinceLaunch * 87 + Math.floor(Math.random() * 10);
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const S = {
  page: {
    minHeight: '100vh',
    background: '#F0EEFF',
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '0 0 16px',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '20px',
    margin: '0 16px 12px',
    boxShadow: '0 2px 8px rgba(108,92,231,0.08)',
  },
  btn: (color = '#6C5CE7', text = '#fff') => ({
    width: '100%',
    padding: '16px',
    background: color,
    color: text,
    border: 'none',
    borderRadius: 14,
    fontSize: 17,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '-0.3px',
  }),
  btnOutline: {
    width: '100%',
    padding: '14px',
    background: '#fff',
    color: '#6C5CE7',
    border: '2px solid #6C5CE7',
    borderRadius: 14,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
};

// ── HomeScreen ────────────────────────────────────────────────────────────────

function HomeScreen({ onStart }: { onStart: () => void }) {
  const bestAge = lsGet<number>(SK.BEST);
  const streak = getStreak();
  const [totalCount] = useState(() => getTotalCount());
  const [adFree, setAdFree] = useState(isAdFree());
  const [purchasing, setPurchasing] = useState(false);

  useEffect(() => {
    const cleanup = graniteEvent.addEventListener('backEvent', { onEvent: () => {} });
    restoreAdFree(() => setAdFree(true));
    return cleanup;
  }, []);

  async function handleStart() {
    if (!isAdFree()) await showInterstitialAd();
    onStart();
  }

  return (
    <div style={S.page}>
      <div style={{ padding: '20px 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 28 }}>🧠</span>
        <span style={{ fontSize: 20, fontWeight: 800, color: '#2d3436', letterSpacing: '-0.5px' }}>두뇌나이</span>
      </div>

      <div style={{ ...S.card, marginTop: 20, textAlign: 'center', padding: '32px 20px' }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>🧠</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#2d3436', marginBottom: 6, letterSpacing: '-0.5px' }}>
          당신의 두뇌는 몇 살일까요?
        </div>
        <div style={{ fontSize: 14, color: '#636e72', lineHeight: 1.6 }}>
          15문제 · 적응형 난이도 · 함정 문제 포함
        </div>
      </div>

      {(bestAge !== null || streak > 0) && (
        <div style={{ ...S.card, display: 'flex', gap: 12 }}>
          {bestAge !== null && (
            <div style={{ flex: 1, textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: 11, color: '#b2bec3', fontWeight: 600, marginBottom: 4 }}>최고 기록</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#6C5CE7' }}>{bestAge}세</div>
            </div>
          )}
          {streak > 0 && (
            <div style={{ flex: 1, textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontSize: 11, color: '#b2bec3', fontWeight: 600, marginBottom: 4 }}>연속 도전</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#e17055' }}>🔥 {streak}일</div>
            </div>
          )}
        </div>
      )}

      <div style={{ padding: '0 16px', marginBottom: 12 }}>
        <button style={S.btn()} onClick={handleStart}>측정 시작</button>
      </div>

      <div style={{ textAlign: 'center', fontSize: 13, color: '#b2bec3', marginBottom: 16 }}>
        {totalCount.toLocaleString()}명이 측정했어요
      </div>

      {!adFree && (
        <div style={{ padding: '0 16px', marginBottom: 8 }}>
          <button
            onClick={() => {
              if (purchasing) return;
              setPurchasing(true);
              buyAdFree(() => setAdFree(true), () => setPurchasing(false));
            }}
            style={{ width: '100%', padding: '12px', borderRadius: 12, background: '#fff', border: '1.5px solid #e0d9ff', color: '#b2bec3', fontSize: 13, cursor: 'pointer' }}
          >
            {purchasing ? '처리 중...' : '🚫 ₩990으로 광고 영구 제거'}
          </button>
        </div>
      )}

      {!adFree && (
        <div style={{ padding: '0 16px' }}>
          <BannerAd />
        </div>
      )}
    </div>
  );
}

// ── PlayScreen ────────────────────────────────────────────────────────────────

interface PlayState {
  qIdx: number;
  adaptive: AdaptiveState;
  problem: Problem;
  answers: (number | null)[];
  problems: Problem[];
  responseTimes: number[];
  maxLevel: number;
  phase: 'question' | 'feedback';
  selectedOption: number | null;
  isCorrect: boolean | null;
  timeLeft: number;
  interstitialShown: boolean;
}

function PlayScreen({ onFinish }: { onFinish: (answers: (number | null)[], problems: Problem[], responseTimes: number[], maxLevel: number) => void }) {
  const initAdaptive: AdaptiveState = { currentLevel: INITIAL_LEVEL, history: [], consecutiveCorrect: 0, consecutiveWrong: 0 };
  const firstProblem = generateProblem(INITIAL_LEVEL, TRAP_POSITIONS.includes(0) ? 'trap' : undefined);

  const [state, setState] = useState<PlayState>({
    qIdx: 0,
    adaptive: initAdaptive,
    problem: firstProblem,
    answers: [],
    problems: [firstProblem],
    responseTimes: [],
    maxLevel: INITIAL_LEVEL,
    phase: 'question',
    selectedOption: null,
    isCorrect: null,
    timeLeft: firstProblem.timeLimit,
    interstitialShown: false,
  });

  const startTimeRef = useRef(performance.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handleAnswerRef = useRef<(selected: number | null) => void>(() => {});

  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const handleAnswer = useCallback(function handleAnswerFn(selected: number | null) {
    clearTimer();
    const elapsed = performance.now() - startTimeRef.current;
    const isCorrect = selected === state.problem.answer;
    setState(prev => ({ ...prev, phase: 'feedback', selectedOption: selected, isCorrect }));

    const newResponseTime = elapsed;
    setTimeout(async () => {
      const newAnswers = [...state.answers, selected];
      const newResponseTimes = [...state.responseTimes, newResponseTime];
      const newProblems = [...state.problems];
      const newAdaptive = updateAdaptiveState(state.adaptive, isCorrect);
      const newMaxLevel = Math.max(state.maxLevel, newAdaptive.currentLevel);
      const nextIdx = state.qIdx + 1;

      if (nextIdx >= TOTAL_QUESTIONS) {
        onFinish(newAnswers, newProblems, newResponseTimes, newMaxLevel);
        return;
      }

      // Interstitial at Q8→Q9
      if (nextIdx === 8 && !state.interstitialShown && !isAdFree()) {
        await showInterstitialAd();
      }

      const forceType = TRAP_POSITIONS.includes(nextIdx) ? 'trap' as ProblemType : undefined;
      const nextProblem = generateProblem(newAdaptive.currentLevel, forceType);

      setState(prev => ({
        ...prev,
        qIdx: nextIdx,
        adaptive: newAdaptive,
        problem: nextProblem,
        answers: newAnswers,
        problems: [...newProblems, nextProblem],
        responseTimes: newResponseTimes,
        maxLevel: newMaxLevel,
        phase: 'question',
        selectedOption: null,
        isCorrect: null,
        timeLeft: nextProblem.timeLimit,
        interstitialShown: nextIdx === 8 ? true : prev.interstitialShown,
      }));
      startTimeRef.current = performance.now();
    }, isCorrect ? 800 : 1800);
  }, [state, clearTimer, onFinish]);

  // Keep ref in sync so timer always calls the latest handleAnswer
  handleAnswerRef.current = handleAnswer;

  // Timer
  useEffect(() => {
    if (state.phase !== 'question') return;
    startTimeRef.current = performance.now();
    setState(prev => ({ ...prev, timeLeft: prev.problem.timeLimit }));
    timerRef.current = setInterval(() => {
      setState(prev => {
        if (prev.phase !== 'question') return prev;
        if (prev.timeLeft <= 1) {
          clearTimer();
          setTimeout(() => handleAnswerRef.current(null), 0);
          return { ...prev, timeLeft: 0 };
        }
        return { ...prev, timeLeft: prev.timeLeft - 1 };
      });
    }, 1000);
    return clearTimer;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.qIdx]);

  const { problem, qIdx, phase, selectedOption, isCorrect, timeLeft, adaptive } = state;
  const isCompare = problem.type === 'compare';
  const isTime = problem.type === 'time';
  const levelStars = '★'.repeat(Math.min(adaptive.currentLevel, 5)) + '☆'.repeat(Math.max(0, 5 - adaptive.currentLevel));
  const timerPct = (timeLeft / problem.timeLimit) * 100;

  function getOptionLabel(opt: number): string {
    if (isCompare) return opt === 0 ? 'A' : 'B';
    if (isTime) return formatTimeOption(opt);
    return opt.toLocaleString();
  }

  function getOptionColor(opt: number): string {
    if (phase !== 'feedback') return '#6C5CE7';
    if (opt === problem.answer) return '#00b894';
    if (opt === selectedOption && !isCorrect) return '#d63031';
    return '#b2bec3';
  }

  return (
    <div style={{ ...S.page, background: '#F0EEFF' }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#6C5CE7' }}>Q{qIdx + 1}/{TOTAL_QUESTIONS}</span>
        <span style={{ fontSize: 13, color: '#a29bfe' }}>{levelStars}</span>
      </div>

      {/* Timer bar */}
      <div style={{ height: 4, background: '#e0d9ff', margin: '0 16px 16px' }}>
        <div style={{ height: '100%', width: `${timerPct}%`, background: timerPct > 40 ? '#6C5CE7' : timerPct > 20 ? '#e17055' : '#d63031', transition: 'width 1s linear, background 0.3s' }} />
      </div>

      {/* Timer countdown */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: timerPct > 40 ? '#6C5CE7' : '#d63031' }}>{timeLeft}</span>
        <span style={{ fontSize: 13, color: '#a29bfe', marginLeft: 4 }}>초</span>
      </div>

      {/* Problem */}
      <div style={{ ...S.card, minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: 19, fontWeight: 700, color: '#2d3436', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
          {problem.display}
        </div>
      </div>

      {/* Feedback */}
      {phase === 'feedback' && (
        <div style={{ ...S.card, textAlign: 'center', padding: '16px 20px', background: isCorrect ? '#f0fff4' : '#fff5f5', border: `1.5px solid ${isCorrect ? '#00b894' : '#d63031'}` }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: isCorrect ? '#00b894' : '#d63031', marginBottom: 6 }}>
            {isCorrect ? '✅ 정답!' : selectedOption === null ? '⏱ 시간 초과!' : '❌ 오답!'}
          </div>
          {!isCorrect && <div style={{ fontSize: 15, color: '#636e72' }}>정답: <strong>{isCompare ? (problem.answer === 0 ? 'A' : 'B') : isTime ? formatTimeOption(problem.answer) : problem.answer.toLocaleString()}</strong></div>}
          {!isCorrect && problem.explanation && (
            <div style={{ fontSize: 13, color: '#636e72', marginTop: 6, lineHeight: 1.6, background: '#f9f9f9', borderRadius: 8, padding: '8px 10px' }}>
              💡 {problem.explanation}
            </div>
          )}
        </div>
      )}

      {/* Options */}
      {phase === 'question' && (
        <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: isCompare ? '1fr 1fr' : '1fr 1fr', gap: 10 }}>
          {problem.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => handleAnswer(opt)}
              style={{ padding: '18px 8px', background: '#fff', border: '2px solid #d6ceff', borderRadius: 14, fontSize: 17, fontWeight: 700, color: '#2d3436', cursor: 'pointer' }}
            >
              {getOptionLabel(opt)}
            </button>
          ))}
        </div>
      )}

      {phase === 'feedback' && (
        <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {problem.options.map((opt, i) => (
            <button
              key={i}
              disabled
              style={{ padding: '18px 8px', background: opt === problem.answer ? '#f0fff4' : opt === selectedOption ? '#fff5f5' : '#f8f8f8', border: `2px solid ${getOptionColor(opt)}`, borderRadius: 14, fontSize: 17, fontWeight: 700, color: getOptionColor(opt), cursor: 'default' }}
            >
              {getOptionLabel(opt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── IAP Content Data ──────────────────────────────────────────────────────────

const GRADE_COLOR: Record<string, string> = { S: '#FFD700', A: '#6C5CE7', B: '#00B894', C: '#FDCB6E', D: '#B2BEC3' };

const TRAINING_PLANS: Record<BrainType, { target: string; weeks: { week: string; goal: string; tasks: string }[] }> = {
  lightning:  { target: '정확도 95%+ · 두뇌 나이 -5세', weeks: [
    { week: '1주차', goal: '함정 정복', tasks: '논리·함정 유형 집중 / 풀기 전 3초 검토 습관 만들기' },
    { week: '2주차', goal: '응용력 강화', tasks: '퍼센트·시간 문제 매일 10개 / 오답 원인 분석' },
    { week: '3주차', goal: '속도·정확 균형', tasks: '전 유형 타임어택 / 평균 응답 -1초 목표' },
    { week: '4주차', goal: '기록 도전', tasks: '매일 2세트 / 두뇌 나이 최저치 갱신 도전' },
  ]},
  calculator: { target: '평균 응답 -2초 · 직관력 향상', weeks: [
    { week: '1주차', goal: '속도 향상', tasks: '연산 문제 빠르게 풀기 / 제한시간 1초씩 단축' },
    { week: '2주차', goal: '직관 개발', tasks: '첫 번째 느낌 믿기 연습 / 패턴 유형 집중' },
    { week: '3주차', goal: '균형 훈련', tasks: '전 유형 고루 / 응답 시간 꾸준히 모니터링' },
    { week: '4주차', goal: '종합 향상', tasks: '타임어택 모드 / 최고 속도 기록 갱신 도전' },
  ]},
  intuitive:  { target: '함정 정답률 100% 달성', weeks: [
    { week: '1주차', goal: '함정 정복', tasks: '논리·함정 문제만 집중 / 문제 천천히 2번 읽기' },
    { week: '2주차', goal: '꼼꼼함 훈련', tasks: '응용·퍼센트 정독 연습 / 검산 습관 만들기' },
    { week: '3주차', goal: '속도 유지 + 정확도', tasks: '빠르되 함정 체크 루틴 만들기 / 오답 0 도전' },
    { week: '4주차', goal: '완성형 도전', tasks: '전 유형 완벽 도전 / 함정 실수 0개 목표' },
  ]},
  steady:     { target: '최상위 10% 두뇌 나이 진입', weeks: [
    { week: '1주차', goal: '레벨 상향', tasks: '고난도 문제 도전 / Lv.5+ 타깃' },
    { week: '2주차', goal: '속도 강화', tasks: '제한 시간 내 전부 풀기 도전 / 빠른 판단 연습' },
    { week: '3주차', goal: '연속 완벽', tasks: '5일 연속 정답률 80%+ 유지 도전' },
    { week: '4주차', goal: '최저 갱신', tasks: '매일 최적 컨디션 / 두뇌 나이 신기록 도전' },
  ]},
  creative:   { target: '전 영역 B등급 이상 달성', weeks: [
    { week: '1주차', goal: '연산 기초', tasks: '사칙연산·빈칸 유형 집중 / 정확도 우선' },
    { week: '2주차', goal: '논리 보완', tasks: '함정·비교 유형 집중 / 섣부른 판단 금지' },
    { week: '3주차', goal: '전 영역 균형', tasks: '랜덤 유형 고루 풀기 / 패턴에 속도 추가' },
    { week: '4주차', goal: '종합 기록', tasks: '강점 패턴 + 보완 논리로 신기록 도전' },
  ]},
  rusty:      { target: '두뇌 나이 -10세 목표', weeks: [
    { week: '1주차', goal: '워밍업', tasks: '매일 1회 테스트 / 결과보다 참여 자체가 목표' },
    { week: '2주차', goal: '기초 재건', tasks: '연산·패턴 집중 / 오답 확인 필수' },
    { week: '3주차', goal: '도전 시작', tasks: '정답률 70% 목표 / 함정 문제 도전' },
    { week: '4주차', goal: '잠재력 폭발', tasks: '매일 2회 도전 / 두뇌 나이 기록 갱신' },
  ]},
};

// ── ResultScreen ──────────────────────────────────────────────────────────────

function ResultScreen({
  answers, problems, responseTimes, maxLevel,
  onRetry, onShare, onHistory,
}: {
  answers: (number | null)[];
  problems: Problem[];
  responseTimes: number[];
  maxLevel: number;
  onRetry: () => void;
  onShare: (brainAge: number, brainType: BrainType, correctCount: number, avgMs: number) => void;
  onHistory: () => void;
}) {
  const [historyUnlocked, setHistoryUnlocked] = useState(false);
  const [analysisUnlocked, setAnalysisUnlocked] = useState(false);
  const [analysisData, setAnalysisData] = useState<{ area: string; emoji: string; score: number; description: string }[] | null>(null);
  const [adFree, setAdFree] = useState(isAdFree());
  const [purchasing, setPurchasing] = useState(false);
  const [regionUnlocked, setRegionUnlocked] = useState(() => localStorage.getItem(REGION_KEY) === 'true');
  const [planUnlocked, setPlanUnlocked] = useState(() => localStorage.getItem(PLAN_KEY) === 'true');
  const [iapPurchasing, setIapPurchasing] = useState<string | null>(null);

  useEffect(() => {
    restoreAdFree(() => setAdFree(true));
  }, []);

  useEffect(() => {
    const products = [
      { sku: REGION_SKU, key: REGION_KEY, set: setRegionUnlocked },
      { sku: PLAN_SKU,   key: PLAN_KEY,   set: setPlanUnlocked },
    ];
    if (products.every(p => localStorage.getItem(p.key) === 'true')) return;
    IAP.getCompletedOrRefundedOrders().then(res => {
      for (const order of res?.orders ?? []) {
        if (order.status !== 'COMPLETED') continue;
        const p = products.find(x => x.sku === order.sku);
        if (p) { localStorage.setItem(p.key, 'true'); p.set(true); }
      }
    }).catch(() => {});
  }, []);

  function handleBuyIap(sku: string, key: string, set: (v: boolean) => void) {
    if (iapPurchasing) return;
    setIapPurchasing(sku);
    const cleanup = IAP.createOneTimePurchaseOrder({
      options: {
        sku,
        processProductGrant: async () => {
          try { localStorage.setItem(key, 'true'); set(true); return true; }
          catch { return false; }
        },
      },
      onEvent: () => { cleanup(); setIapPurchasing(null); },
      onError:  () => { cleanup(); setIapPurchasing(null); },
    });
  }

  // 뇌 영역 정밀 분석 데이터
  const regionDetail = (() => {
    const areaConfig = [
      { key: '연산력', types: ['arithmetic', 'missing'] as ProblemType[], emoji: '🔢', tip: '매일 암산 훈련으로 처리 속도를 높여보세요' },
      { key: '논리력', types: ['trap', 'compare'] as ProblemType[], emoji: '🧩', tip: '문제를 꼼꼼히 읽는 습관을 들여보세요' },
      { key: '패턴 인식', types: ['pattern', 'chain'] as ProblemType[], emoji: '🎯', tip: '규칙성 찾기 퍼즐을 꾸준히 풀어보세요' },
      { key: '응용력', types: ['percent', 'time'] as ProblemType[], emoji: '💡', tip: '실생활 계산 문제로 감각을 키워보세요' },
    ];
    return areaConfig.map(({ key, types, emoji, tip }) => {
      const idxs = problems.map((p, i) => types.includes(p.type) ? i : -1).filter(i => i >= 0);
      const corrects = idxs.filter(i => answers[i] === problems[i].answer).length;
      const accuracy = idxs.length > 0 ? Math.round(corrects / idxs.length * 100) : 0;
      const avgT = idxs.length > 0 ? +(idxs.reduce((s, i) => s + (responseTimes[i] || 10000), 0) / idxs.length / 1000).toFixed(1) : 0;
      const grade = accuracy >= 80 ? 'S' : accuracy >= 60 ? 'A' : accuracy >= 40 ? 'B' : accuracy >= 20 ? 'C' : 'D';
      const wrongItems = idxs.filter(i => answers[i] !== problems[i].answer).slice(0, 2).map(i => problems[i].explanation ?? '');
      return { key, emoji, accuracy, avgT, grade, tip, wrongItems };
    });
  })();

  const correctCount = answers.filter((a, i) => a === problems[i].answer).length;
  const avgMs = responseTimes.length > 0 ? responseTimes.reduce((s, t) => s + t, 0) / responseTimes.length : 5000;
  const trapCorrect = TRAP_POSITIONS.filter(pos => pos < answers.length && answers[pos] === problems[pos].answer).length;
  const { brainAge, brainType } = calculateBrainAge(correctCount, avgMs, maxLevel, trapCorrect);
  const typeConfig = BRAIN_TYPE_CONFIG[brainType];

  // Save record
  useEffect(() => {
    const today = todayStr();
    const prevBest = lsGet<number>(SK.BEST);
    if (prevBest === null || brainAge < prevBest) lsSet(SK.BEST, brainAge);

    const daily = lsGet<Record<string, BrainSession>>(SK.DAILY) ?? {};
    daily[today] = { date: today, brainAge, brainType, correctCount, avgResponseTime: Math.round(avgMs), finalLevel: maxLevel };
    lsSet(SK.DAILY, daily);
    updateStreak();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUnlockHistory() {
    await showInterstitialAd();
    setHistoryUnlocked(true);
  }

  async function handleUnlockAnalysis() {
    await showInterstitialAd();
    {
      const areaMap: Record<string, ProblemType[]> = {
        '연산': ['arithmetic', 'missing'],
        '논리': ['trap', 'compare'],
        '패턴': ['pattern', 'chain'],
        '응용': ['percent', 'time'],
      };
      const data = Object.entries(areaMap).map(([area, types]) => {
        const indices = problems.map((p, i) => types.includes(p.type) ? i : -1).filter(i => i >= 0);
        if (indices.length === 0) return { area, emoji: '➖', score: 50, description: '이 영역의 문제가 없었어요' };
        const correct = indices.filter(i => answers[i] === problems[i].answer).length;
        const avgTime = indices.reduce((s, i) => s + (responseTimes[i] || 10000), 0) / indices.length;
        const accuracy = correct / indices.length;
        const speedScore = Math.max(0, 100 - (avgTime / 100));
        const score = Math.round(accuracy * 70 + (speedScore / 100) * 30);
        const emoji = score >= 80 ? '🌟' : score >= 60 ? '✅' : score >= 40 ? '⚠️' : '❌';
        const description = score >= 80 ? '뛰어나요! 자신감을 가져도 돼요'
          : score >= 60 ? '평균 이상이에요. 조금만 더!'
          : score >= 40 ? '보통 수준이에요. 연습하면 금방 늘어요'
          : '약한 영역이에요. 집중 훈련이 필요해요';
        return { area, emoji, score, description };
      });
      setAnalysisData(data);
      setAnalysisUnlocked(true);
    }
  }

  async function handleRetry() {
    if (!isAdFree()) await showInterstitialAd();
    onRetry();
  }

  const avgSec = (avgMs / 1000).toFixed(1);

  return (
    <div style={S.page}>
      <div style={{ padding: '20px 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 28 }}>🧠</span>
        <span style={{ fontSize: 20, fontWeight: 800, color: '#2d3436' }}>측정 결과</span>
      </div>

      {/* Brain age */}
      <div style={{ ...S.card, marginTop: 16, textAlign: 'center', padding: '28px 20px' }}>
        <div style={{ fontSize: 15, color: '#636e72', marginBottom: 4 }}>당신의 두뇌 나이는</div>
        <div style={{ fontSize: 64, fontWeight: 900, color: '#6C5CE7', lineHeight: 1, animation: 'countUp 0.5s ease', letterSpacing: '-2px' }}>
          {brainAge}<span style={{ fontSize: 28, fontWeight: 700 }}>세</span>
        </div>
        <div style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 8, background: '#F0EEFF', borderRadius: 20, padding: '8px 16px' }}>
          <span style={{ fontSize: 20 }}>{typeConfig.emoji}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: typeConfig.color }}>{typeConfig.label}</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: '#636e72' }}>{typeConfig.description}</div>
      </div>

      {/* Stats */}
      <div style={{ ...S.card, display: 'flex', gap: 0 }}>
        {[
          { label: '정답률', value: `${correctCount}/15`, sub: `${Math.round(correctCount / 15 * 100)}%` },
          { label: '평균 응답', value: `${avgSec}초`, sub: '' },
          { label: '최고 레벨', value: `Lv.${maxLevel}`, sub: '' },
        ].map((item, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', padding: '10px 0', borderRight: i < 2 ? '1px solid #f0eeff' : 'none' }}>
            <div style={{ fontSize: 11, color: '#b2bec3', fontWeight: 600, marginBottom: 3 }}>{item.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#2d3436' }}>{item.value}</div>
            {item.sub && <div style={{ fontSize: 11, color: '#a29bfe' }}>{item.sub}</div>}
          </div>
        ))}
      </div>

      {/* Reward: History */}
      {!historyUnlocked ? (
        <div style={{ ...S.card, cursor: 'pointer' }} onClick={handleUnlockHistory}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>📈</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#2d3436' }}>🔒 두뇌 나이 추이 보기</div>
              <div style={{ fontSize: 12, color: '#b2bec3', marginTop: 2 }}>광고 시청 후 일별 두뇌 나이 그래프 확인</div>
            </div>
            <span style={{ fontSize: 13, color: '#6C5CE7', fontWeight: 700 }}>광고 보기</span>
          </div>
        </div>
      ) : (
        <div style={{ ...S.card, cursor: 'pointer' }} onClick={onHistory}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>📈</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#2d3436' }}>두뇌 나이 추이</div>
              <div style={{ fontSize: 12, color: '#6C5CE7', marginTop: 2 }}>그래프 보기 →</div>
            </div>
          </div>
        </div>
      )}

      {/* Reward: Analysis */}
      {!analysisUnlocked ? (
        <div style={{ ...S.card, cursor: 'pointer' }} onClick={handleUnlockAnalysis}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>🔬</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#2d3436' }}>🔒 두뇌 능력 상세 분석</div>
              <div style={{ fontSize: 12, color: '#b2bec3', marginTop: 2 }}>연산 · 논리 · 패턴 · 응용 4개 영역별 분석</div>
            </div>
            <span style={{ fontSize: 13, color: '#6C5CE7', fontWeight: 700 }}>광고 보기</span>
          </div>
        </div>
      ) : analysisData && (
        <div style={S.card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#2d3436', marginBottom: 12 }}>🔬 두뇌 능력 분석</div>
          {analysisData.map((item) => (
            <div key={item.area} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 18 }}>{item.emoji}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#2d3436' }}>{item.area}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#6C5CE7' }}>{item.score}점</span>
                </div>
                <div style={{ height: 6, background: '#f0eeff', borderRadius: 3 }}>
                  <div style={{ height: '100%', width: `${item.score}%`, background: '#6C5CE7', borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 11, color: '#b2bec3', marginTop: 2 }}>{item.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* IAP: 뇌 영역 정밀 분석 */}
      {regionUnlocked ? (
        <div style={S.card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#2d3436', marginBottom: 12 }}>🧬 뇌 영역 정밀 분석</div>
          {regionDetail.map((area) => (
            <div key={area.key} style={{ marginBottom: 12, padding: 12, background: '#f8f7ff', borderRadius: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#2d3436' }}>{area.emoji} {area.key}</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: GRADE_COLOR[area.grade] }}>{area.grade}등급</span>
              </div>
              <div style={{ fontSize: 12, color: '#636e72', marginBottom: 4 }}>
                정답률 {area.accuracy}% · 평균 {area.avgT}초
              </div>
              {area.wrongItems.filter(Boolean).map((exp, i) => (
                <div key={i} style={{ fontSize: 11, color: '#e17055', marginTop: 2 }}>💡 {exp}</div>
              ))}
              <div style={{ fontSize: 12, color: '#6C5CE7', marginTop: 6 }}>→ {area.tip}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...S.card, cursor: iapPurchasing ? 'default' : 'pointer' }}
          onClick={() => handleBuyIap(REGION_SKU, REGION_KEY, setRegionUnlocked)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>🧬</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#2d3436' }}>🔒 뇌 영역 정밀 분석</div>
              <div style={{ fontSize: 12, color: '#b2bec3', marginTop: 2 }}>연산·논리·패턴·응용 등급 + 오답 원인 + 맞춤 조언</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#6C5CE7', border: '1.5px solid #6C5CE7', borderRadius: 10, padding: '4px 10px' }}>
              {iapPurchasing === REGION_SKU ? '...' : '₩990'}
            </span>
          </div>
        </div>
      )}

      {/* IAP: 30일 두뇌 훈련 플랜 */}
      {planUnlocked ? (
        <div style={S.card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#2d3436', marginBottom: 4 }}>📅 30일 두뇌 훈련 플랜</div>
          <div style={{ fontSize: 12, color: '#6C5CE7', marginBottom: 12 }}>목표: {TRAINING_PLANS[brainType].target}</div>
          {TRAINING_PLANS[brainType].weeks.map((w, i) => (
            <div key={i} style={{ marginBottom: 10, padding: 12, background: '#f8f7ff', borderRadius: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#2d3436', marginBottom: 3 }}>{w.week}: {w.goal}</div>
              <div style={{ fontSize: 12, color: '#636e72' }}>{w.tasks}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ ...S.card, cursor: iapPurchasing ? 'default' : 'pointer' }}
          onClick={() => handleBuyIap(PLAN_SKU, PLAN_KEY, setPlanUnlocked)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 28 }}>📅</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#2d3436' }}>🔒 30일 두뇌 훈련 플랜</div>
              <div style={{ fontSize: 12, color: '#b2bec3', marginTop: 2 }}>두뇌 유형별 4주 맞춤 훈련 일정 · 매일 목표 제시</div>
            </div>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#6C5CE7', border: '1.5px solid #6C5CE7', borderRadius: 10, padding: '4px 10px' }}>
              {iapPurchasing === PLAN_SKU ? '...' : '₩990'}
            </span>
          </div>
        </div>
      )}

      {/* Buttons */}
      <div style={{ padding: '4px 16px 0', display: 'flex', gap: 10 }}>
        <button style={{ ...S.btn(), flex: 1 }} onClick={handleRetry}>한번 더!</button>
        <button style={{ ...S.btnOutline, flex: 1 }} onClick={() => onShare(brainAge, brainType, correctCount, Math.round(avgMs))}>공유하기</button>
      </div>

      {!adFree && (
        <div style={{ padding: '12px 16px 0' }}>
          <button
            onClick={() => {
              if (purchasing) return;
              setPurchasing(true);
              buyAdFree(() => setAdFree(true), () => setPurchasing(false));
            }}
            style={{ width: '100%', padding: '12px', borderRadius: 12, background: '#fff', border: '1.5px solid #e0d9ff', color: '#b2bec3', fontSize: 13, cursor: 'pointer' }}
          >
            {purchasing ? '처리 중...' : '🚫 ₩990으로 광고 영구 제거'}
          </button>
        </div>
      )}

      {!adFree && (
        <div style={{ padding: '12px 16px 0' }}>
          <BannerAd />
        </div>
      )}
    </div>
  );
}

// ── HistoryScreen ─────────────────────────────────────────────────────────────

function HistoryScreen({ onBack }: { onBack: () => void }) {
  const daily = lsGet<Record<string, BrainSession>>(SK.DAILY) ?? {};
  const records = Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)).slice(-14);

  const minAge = records.length > 0 ? Math.min(...records.map(r => r.brainAge)) : 20;
  const maxAge = records.length > 0 ? Math.max(...records.map(r => r.brainAge)) : 40;
  const range = Math.max(maxAge - minAge, 10);

  return (
    <div style={S.page}>
      <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#2d3436', padding: '4px 4px 4px 0' }}>←</button>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#2d3436' }}>두뇌 나이 추이</span>
      </div>

      {records.length < 2 ? (
        <div style={{ ...S.card, marginTop: 20, textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📈</div>
          <div style={{ fontSize: 15, color: '#636e72' }}>2일 이상 측정하면<br />추이 그래프가 나타나요!</div>
        </div>
      ) : (
        <div style={{ ...S.card, marginTop: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#2d3436', marginBottom: 16 }}>최근 {records.length}일</div>
          {/* SVG Line Chart */}
          <svg width="100%" viewBox={`0 0 320 120`} style={{ overflow: 'visible' }}>
            <polyline
              fill="none"
              stroke="#6C5CE7"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={records.map((r, i) => {
                const x = records.length > 1 ? (i / (records.length - 1)) * 300 + 10 : 160;
                const y = 110 - ((maxAge + 5 - r.brainAge) / (range + 10)) * 100;
                return `${x},${y}`;
              }).join(' ')}
            />
            {records.map((r, i) => {
              const x = records.length > 1 ? (i / (records.length - 1)) * 300 + 10 : 160;
              const y = 110 - ((maxAge + 5 - r.brainAge) / (range + 10)) * 100;
              return (
                <g key={r.date}>
                  <circle cx={x} cy={y} r={4} fill="#6C5CE7" />
                  <text x={x} y={y - 10} textAnchor="middle" fontSize="11" fill="#6C5CE7" fontWeight="700">{r.brainAge}</text>
                </g>
              );
            })}
          </svg>

          {/* Date labels */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#b2bec3' }}>{records[0].date.slice(5)}</span>
            <span style={{ fontSize: 11, color: '#b2bec3' }}>{records[records.length - 1].date.slice(5)}</span>
          </div>
        </div>
      )}

      {/* Recent records list */}
      <div style={S.card}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#2d3436', marginBottom: 12 }}>기록 목록</div>
        {records.slice().reverse().map(r => {
          const cfg = BRAIN_TYPE_CONFIG[r.brainType];
          return (
            <div key={r.date} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0eeff' }}>
              <div>
                <div style={{ fontSize: 13, color: '#636e72' }}>{r.date}</div>
                <div style={{ fontSize: 12, color: cfg.color }}>{cfg.emoji} {cfg.label}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#6C5CE7' }}>{r.brainAge}세</div>
                <div style={{ fontSize: 11, color: '#b2bec3' }}>{r.correctCount}/15 정답</div>
              </div>
            </div>
          );
        })}
      </div>

      {!isAdFree() && (
        <div style={{ padding: '0 16px' }}>
          <BannerAd />
        </div>
      )}
    </div>
  );
}

// ── ShareScreen ───────────────────────────────────────────────────────────────

function ShareScreen({
  brainAge, brainType, correctCount, avgMs,
  onBack,
}: {
  brainAge: number;
  brainType: BrainType;
  correctCount: number;
  avgMs: number;
  onBack: () => void;
}) {
  const cfg = BRAIN_TYPE_CONFIG[brainType];
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const text = `🧠 두뇌나이 측정 결과\n두뇌 나이: ${brainAge}세\n${cfg.emoji} ${cfg.label}\n정답률: ${correctCount}/15 (${Math.round(correctCount / 15 * 100)}%)\n\n토스에서 측정해보세요!`;
    if (navigator.share) {
      try { await navigator.share({ title: '두뇌나이 테스트', text }); } catch {}
    } else {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div style={S.page}>
      <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#2d3436', padding: '4px 4px 4px 0' }}>←</button>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#2d3436' }}>결과 공유</span>
      </div>

      {/* Share card */}
      <div style={{ margin: '20px 16px 16px', background: 'linear-gradient(135deg, #6C5CE7 0%, #a29bfe 100%)', borderRadius: 20, padding: '32px 24px', textAlign: 'center', color: '#fff' }}>
        <div style={{ fontSize: 16, fontWeight: 600, opacity: 0.85, marginBottom: 6 }}>🧠 두뇌나이 테스트</div>
        <div style={{ fontSize: 72, fontWeight: 900, lineHeight: 1, letterSpacing: '-3px', marginBottom: 8 }}>
          {brainAge}<span style={{ fontSize: 32 }}>세</span>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.2)', borderRadius: 24, padding: '6px 16px', display: 'inline-block', marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>{cfg.emoji}</span>
          <span style={{ fontSize: 14, fontWeight: 700, marginLeft: 6 }}>{cfg.label}</span>
        </div>
        <div style={{ fontSize: 14, opacity: 0.8 }}>정답률 {correctCount}/15 · 평균 {(avgMs / 1000).toFixed(1)}초</div>
        <div style={{ marginTop: 16, fontSize: 13, opacity: 0.7 }}>"너는 몇 살?"</div>
      </div>

      <div style={{ padding: '0 16px' }}>
        <button style={S.btn()} onClick={handleShare}>공유하기</button>
        {/* 크로스 프로모션 */}
        <button style={{ width: '100%', padding: '14px', fontSize: 14, fontWeight: 700, color: '#fff', background: 'linear-gradient(90deg, #2D1B69, #4C1D95)', border: 'none', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => openMiniApp('intoss://oxquiz')}>🧠 하루 10문제 두뇌 퀴즈 · 두뇌 나이 확인 ›</button>
        <button style={{ width: '100%', padding: '14px', fontSize: 14, fontWeight: 700, color: '#E9D5FF', background: 'rgba(168,85,247,0.14)', border: '1px solid rgba(168,85,247,0.4)', borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit' }} onClick={() => openMiniApp('intoss://fortune-today-kr')}>🔮 오늘의 운세 무료로 보기 ›</button>
        {copied && (
          <div style={{ marginTop: 12, textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#00b894', background: '#f0fff4', borderRadius: 10, padding: '10px 0' }}>
            결과가 복사되었어요!
          </div>
        )}
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [sessionData, setSessionData] = useState<{
    answers: (number | null)[];
    problems: Problem[];
    responseTimes: number[];
    maxLevel: number;
  } | null>(null);
  const [shareData, setShareData] = useState<{ brainAge: number; brainType: BrainType; correctCount: number; avgMs: number } | null>(null);

  function handlePlayFinish(answers: (number | null)[], problems: Problem[], responseTimes: number[], maxLevel: number) {
    setSessionData({ answers, problems, responseTimes, maxLevel });
    setScreen('result');
  }

  function handleShare(brainAge: number, brainType: BrainType, correctCount: number, avgMs: number) {
    setShareData({ brainAge, brainType, correctCount, avgMs });
    setScreen('share');
  }

  if (screen === 'home') return <HomeScreen onStart={() => setScreen('play')} />;
  if (screen === 'play') return <PlayScreen onFinish={handlePlayFinish} />;
  if (screen === 'result' && sessionData) return (
    <ResultScreen
      {...sessionData}
      onRetry={() => setScreen('play')}
      onShare={handleShare}
      onHistory={() => setScreen('history')}
    />
  );
  if (screen === 'history') return <HistoryScreen onBack={() => setScreen('result')} />;
  if (screen === 'share' && shareData) return <ShareScreen {...shareData} onBack={() => setScreen('result')} />;

  return <HomeScreen onStart={() => setScreen('play')} />;
}
