import { Review } from '@apps-in-toss/web-framework';

// 노출 정책(추천 미니앱) — 리뷰는 핵심 행동을 두 번째로 마친 직후에, 세션당 1회·30일에 1회만 요청
const N_KEY = 'review_success_count';
const AT_KEY = 'review_requested_at';
let askedThisSession = false;

export function markSuccess() {
  try {
    const n = Number(localStorage.getItem(N_KEY) ?? '0') + 1;
    localStorage.setItem(N_KEY, String(n));
    const last = Number(localStorage.getItem(AT_KEY) ?? '0');
    if (n < 2 || askedThisSession || Date.now() - last < 30 * 86400000) return;
    askedThisSession = true;
    localStorage.setItem(AT_KEY, String(Date.now()));
    // 결과 화면이 먼저 보이도록 잠시 뒤 요청 (리뷰창이 안 떠도 흐름은 그대로)
    setTimeout(() => {
      try { if (Review.request.isSupported()) void Review.request().catch(() => {}); } catch { /* 토스 앱 밖 */ }
    }, 2500);
  } catch { /* storage 불가 */ }
}
