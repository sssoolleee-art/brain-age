import { useState } from 'react';
import { eventLog } from '@apps-in-toss/web-framework';

// 불만이 낮은 별점으로 가기 전에 앱 안에서 먼저 듣는 창구 (이벤트 로그 'feedback' 으로 사유별 집계)
const REASONS = ['광고가 너무 많아요', '결과가 이상해요', '오류가 있어요', '기타'];

export function FeedbackButton({ app }: { app: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);

  function send(reason: string) {
    try { void eventLog({ log_name: 'feedback', log_type: 'event', params: { app, reason } }).catch(() => {}); } catch { /* ignore */ }
    setSent(true);
    setTimeout(() => { setOpen(false); setSent(false); }, 1400);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ display: 'block', margin: '14px auto 0', minHeight: 44, padding: '10px 16px', border: 'none', background: 'none', color: '#8B95A1', fontSize: 13, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        불편한 점이 있나요? 의견 보내기
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: '#fff', borderRadius: '20px 20px 0 0', padding: '24px 20px calc(24px + env(safe-area-inset-bottom))', boxSizing: 'border-box' }}>
            {sent ? (
              <p style={{ margin: '12px 0', textAlign: 'center', fontSize: 16, fontWeight: 700, color: '#191F28' }}>고마워요. 더 좋게 고칠게요.</p>
            ) : (
              <>
                <p style={{ margin: '0 0 14px', fontSize: 17, fontWeight: 700, color: '#191F28' }}>어떤 점이 불편했나요?</p>
                {REASONS.map((r) => (
                  <button key={r} type="button" onClick={() => send(r)}
                    style={{ display: 'block', width: '100%', minHeight: 48, marginBottom: 8, borderRadius: 12, border: '1px solid #E5E8EB', background: '#F9FAFB', color: '#333D4B', fontSize: 15, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: '0 16px' }}>
                    {r}
                  </button>
                ))}
                <button type="button" onClick={() => setOpen(false)}
                  style={{ display: 'block', width: '100%', minHeight: 44, marginTop: 4, border: 'none', background: 'none', color: '#8B95A1', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                  닫기
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
