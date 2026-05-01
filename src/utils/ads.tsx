import { useEffect, useRef } from 'react';
import { TossAds, loadFullScreenAd, showFullScreenAd } from '@apps-in-toss/web-framework';

const AD_IDS = {
  banner:       'ait.v2.live.ad476e3eb91d4f46',
  interstitial: 'ait.v2.live.167d547206c24946',
  rewarded:     'ait.v2.live.3b50c27144364372',
};

export function BannerAd() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !TossAds.attachBanner.isSupported()) return;
    const result = TossAds.attachBanner(AD_IDS.banner, ref.current);
    return () => result.destroy();
  }, []);
  return <div ref={ref} style={{ width: '100%', minHeight: 50 }} />;
}

export function showInterstitialAd(): Promise<void> {
  return new Promise((resolve) => {
    if (!loadFullScreenAd.isSupported()) { resolve(); return; }
    const cleanup = loadFullScreenAd({
      options: { adGroupId: AD_IDS.interstitial },
      onEvent: (event) => {
        if (event.type === 'loaded') {
          showFullScreenAd({
            options: { adGroupId: AD_IDS.interstitial },
            onEvent: (e) => { if (e.type === 'dismissed') resolve(); },
            onError: () => resolve(),
          });
        }
      },
      onError: () => resolve(),
    });
    setTimeout(() => { cleanup(); resolve(); }, 10000);
  });
}

export function showRewardedAd(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!loadFullScreenAd.isSupported()) { resolve(false); return; }
    let earned = false;
    const cleanup = loadFullScreenAd({
      options: { adGroupId: AD_IDS.rewarded },
      onEvent: (event) => {
        if (event.type === 'loaded') {
          showFullScreenAd({
            options: { adGroupId: AD_IDS.rewarded },
            onEvent: (e) => {
              if (e.type === 'userEarnedReward') earned = true;
              if (e.type === 'dismissed') resolve(earned);
            },
            onError: () => resolve(false),
          });
        }
      },
      onError: () => resolve(false),
    });
    setTimeout(() => { cleanup(); resolve(false); }, 15000);
  });
}
