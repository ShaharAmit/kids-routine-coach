type AnalyticsParams = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();

let analyticsReady = false;

function getPageLocation(pathWithQuery: string): string {
  const normalizedPath = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;
  return `https://kidocoach.app${normalizedPath}`;
}

export function initAnalytics(): void {
  if (!MEASUREMENT_ID || typeof document === 'undefined' || analyticsReady) {
    return;
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(...args: unknown[]) {
    window.dataLayer.push(args);
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  script.dataset.analytics = 'ga4';
  document.head.appendChild(script);

  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, { send_page_view: false });
  analyticsReady = true;
}

export function trackPageView(pathWithQuery: string): void {
  if (!MEASUREMENT_ID || !analyticsReady || typeof window.gtag !== 'function') {
    return;
  }

  window.gtag('event', 'page_view', {
    page_title: document.title,
    page_path: pathWithQuery,
    page_location: getPageLocation(pathWithQuery),
  });
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}): void {
  if (!MEASUREMENT_ID || !analyticsReady || typeof window.gtag !== 'function') {
    return;
  }

  window.gtag('event', eventName, params);
}
