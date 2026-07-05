;(function () {
  /**
   * DEPRECATED (Silnik Wzrostu, G1): stary telemetry panelu (onboarding/checkout) nie zapisuje już
   * bezpośrednio do `analytics_events` — ta tabela jest repurposed pod konwersje publiczne i insertuje
   * do niej wyłącznie Edge Function `record-site-event` (service_role). `DFOPS_trackEvent` zostaje jako
   * cichy stub (console.debug), żeby ewentualne niecałkowicie usunięte wywołania niczego nie łamały.
   * Zob. docs/GROWTH_AUTOPILOT_ARCHITECTURE.md §5.1. Tracking konwersji publicznych: js/core/siteAnalytics.js.
   */
  function trackEvent(name, props) {
    try {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[DFOPS analytics:deprecated]', { name, props: props || {} });
      }
    } catch (_) {
      /* noop */
    }
  }

  window.DFOPS_trackEvent = trackEvent;
})();
