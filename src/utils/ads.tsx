import { useEffect, useRef } from 'react';
import { TossAds, loadFullScreenAd, showFullScreenAd, IAP } from '@apps-in-toss/web-framework';

export const AD_FREE_SKU = 'ait.0000030897.795abd69.22df55e254.8212209872';
export const AD_FREE_KEY = 'brain_ad_free';

export const REGION_SKU = 'PLACEHOLDER_REGION';
export const REGION_KEY = 'brain_region_unlocked';

export const PLAN_SKU = 'PLACEHOLDER_PLAN';
export const PLAN_KEY = 'brain_plan_unlocked';

export function isAdFree(): boolean {
  return localStorage.getItem(AD_FREE_KEY) === 'true';
}

export async function restoreAdFree(onUnlocked: () => void) {
  if (isAdFree()) { onUnlocked(); return; }
  try {
    const res = await IAP.getCompletedOrRefundedOrders();
    if (res?.orders.some(o => o.status === 'COMPLETED' && o.sku === AD_FREE_SKU)) {
      localStorage.setItem(AD_FREE_KEY, 'true');
      onUnlocked();
    }
  } catch {}
}

export function buyAdFree(onSuccess: () => void, onDone: () => void) {
  const cleanup = IAP.createOneTimePurchaseOrder({
    options: {
      sku: AD_FREE_SKU,
      processProductGrant: async () => {
        try { localStorage.setItem(AD_FREE_KEY, 'true'); onSuccess(); return true; }
        catch { return false; }
      },
    },
    onEvent: () => { cleanup(); onDone(); },
    onError: () => { cleanup(); onDone(); },
  });
}

const AD_IDS = {
  banner:       'ait.v2.live.ad476e3eb91d4f46',
  interstitial: 'ait.v2.live.167d547206c24946',
  rewarded:     'ait.v2.live.3b50c27144364372',
};

let resolveInit!: () => void;
const adsReady = new Promise<void>((r) => { resolveInit = r; });

export function initAds() {
  TossAds.initialize({ callbacks: { onInitialized: () => resolveInit() } });
}

export function BannerAd() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !TossAds.attachBanner.isSupported()) return;
    const el = ref.current;
    let result: { destroy: () => void } | null = null;
    let destroyed = false;
    adsReady.then(() => {
      if (destroyed || !el) return;
      result = TossAds.attachBanner(AD_IDS.banner, el);
    });
    return () => {
      destroyed = true;
      result?.destroy();
    };
  }, []);
  return <div ref={ref} style={{ width: '100%', minHeight: 50 }} />;
}

export function showInterstitialAd(): Promise<void> {
  return new Promise((resolve) => {
    if (!loadFullScreenAd.isSupported()) { resolve(); return; }
    let settled = false;
    let timerId: ReturnType<typeof setTimeout>;
    const done = (c: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timerId);
      c();
      resolve();
    };
    const cleanup = loadFullScreenAd({
      options: { adGroupId: AD_IDS.interstitial },
      onEvent: (event) => {
        if (event.type === 'loaded') {
          showFullScreenAd({
            options: { adGroupId: AD_IDS.interstitial },
            onEvent: (e) => { if (e.type === 'dismissed') done(cleanup); },
            onError: () => done(cleanup),
          });
        }
      },
      onError: () => done(cleanup),
    });
    timerId = setTimeout(() => done(cleanup), 30000);
  });
}

export function showRewardedAd(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!loadFullScreenAd.isSupported()) { resolve(false); return; }
    let settled = false;
    let earned = false;
    let timerId: ReturnType<typeof setTimeout>;
    const done = (c: () => void, result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timerId);
      c();
      resolve(result);
    };
    const cleanup = loadFullScreenAd({
      options: { adGroupId: AD_IDS.rewarded },
      onEvent: (event) => {
        if (event.type === 'loaded') {
          showFullScreenAd({
            options: { adGroupId: AD_IDS.rewarded },
            onEvent: (e) => {
              if (e.type === 'userEarnedReward') earned = true;
              if (e.type === 'dismissed') done(cleanup, earned);
            },
            onError: () => done(cleanup, false),
          });
        }
      },
      onError: () => done(cleanup, false),
    });
    timerId = setTimeout(() => done(cleanup, false), 30000);
  });
}
