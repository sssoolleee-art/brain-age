import { useState } from 'react';
import { eventLog, openURL, Notification } from '@apps-in-toss/web-framework';

// 핵심 행동·유입 로그 (콘솔 전환 지표용) — 토스 밖이면 무시
export function logGrowth(name: string, params: Record<string, string | number | boolean> = {}) {
  try { void eventLog({ log_name: name, log_type: 'event', params }).catch(() => {}); } catch { /* ignore */ }
}

// 다른 미니앱으로 이동 (크로스 프로모션)
export function openPromo(link: string) {
  logGrowth('cross_promo_click', { to: link });
  try { void openURL(link).catch(() => {}); } catch { /* ignore */ }
}

function readFlag(key: string) {
  try { return localStorage.getItem(key) === 'true'; } catch { return false; }
}

// 기능성 푸시 동의 버튼 — 동의한 유저에게만 정기 알림이 발송됨 (동의 전엔 대상 0명)
export function PushConsent({ templateCode, label, storageKey, color = '#3182F6' }: {
  templateCode: string; label: string; storageKey: string; color?: string;
}) {
  const [agreed, setAgreed] = useState(() => readFlag(storageKey));
  const supported = (() => { try { return Notification.requestAgreement.isSupported(); } catch { return false; } })();
  if (!supported) return null;

  function handleClick() {
    logGrowth('push_consent_click', { template: templateCode });
    let cleanup: (() => void) | undefined;
    cleanup = Notification.requestAgreement({
      options: { templateCode },
      onEvent: (e) => {
        cleanup?.();
        if (e.type === 'agreementRejected') return;
        try { localStorage.setItem(storageKey, 'true'); } catch { /* ignore */ }
        setAgreed(true);
        if (e.type === 'newAgreement') logGrowth('push_consent_agreed', { template: templateCode });
      },
      onError: () => { cleanup?.(); },
    });
  }

  return (
    <div style={{ margin: '12px 16px 0', textAlign: 'center' }}>
      {agreed ? (
        <p style={{ margin: 0, fontSize: 13, color: '#6B7684', wordBreak: 'keep-all' }}>
          알림을 받고 있어요 · 알림은 토스 설정 › 알림에서 언제든 끌 수 있어요
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={handleClick}
            style={{
              width: '100%', minHeight: 48, padding: '12px 16px', borderRadius: 14,
              border: `1.5px solid ${color}`, background: '#fff', color,
              fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', wordBreak: 'keep-all',
            }}
          >
            {label}
          </button>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#8B95A1', wordBreak: 'keep-all' }}>
            알림은 토스 설정 › 알림에서 언제든 끌 수 있어요
          </p>
        </>
      )}
    </div>
  );
}

// 숨은 지원금 찾기로 보내는 크로스 프로모션 카드
export function SubsidyPromo({ from }: { from: string }) {
  return (
    <button
      type="button"
      onClick={() => openPromo(`intoss://subsidy-finder?_ref=${from}`)}
      style={{
        display: 'block', width: 'calc(100% - 32px)', margin: '12px 16px 0', minHeight: 48,
        padding: '12px 16px', borderRadius: 14, border: '1px solid #C9DAFC', background: '#F3F7FF',
        color: '#1D5BD8', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', wordBreak: 'keep-all',
      }}
    >
      💰 나도 모르는 지원금, 1분 만에 찾아보기
    </button>
  );
}
