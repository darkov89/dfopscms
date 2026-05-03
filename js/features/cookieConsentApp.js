;(function () {
  const STORAGE_KEY = 'dfcms_cookie_consent';

  function parseStored() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.essential === 'boolean') return parsed;
      return null;
    } catch {
      return null;
    }
  }

  /** Odczyt zapisanych ustawień zgód (np. żeby wstrzyknąć GTM / Pixel dopiero jeśli dozwolone). */
  function getStoredCookieConsent() {
    return parseStored();
  }

  function emitConsentEvents(consents) {
    if (consents.analytics) {
      window.dispatchEvent(new CustomEvent('consent-analytics'));
    }
    if (consents.marketing) {
      window.dispatchEvent(new CustomEvent('consent-marketing'));
    }
    window.dispatchEvent(new CustomEvent('consent-updated', { detail: consents }));
  }

  window.DFOPS_getStoredCookieConsent = getStoredCookieConsent;

  document.addEventListener('alpine:init', () => {
    Alpine.data('cookieConsent', () => ({
      showBanner: false,
      showDetails: false,
      consents: { essential: true, analytics: false, marketing: false },

      init() {
        const stored = parseStored();
        if (stored) {
          this.consents = { ...this.consents, ...stored };
          this.showBanner = false;
          emitConsentEvents(this.consents);
        } else {
          this.showBanner = true;
        }
      },

      saveAndHide() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.consents));
        this.showBanner = false;
        this.showDetails = false;
        emitConsentEvents(this.consents);
      },

      acceptAll() {
        this.consents = { essential: true, analytics: true, marketing: true };
        this.saveAndHide();
      },

      rejectAll() {
        this.consents = { essential: true, analytics: false, marketing: false };
        this.saveAndHide();
      },

      acceptSelected() {
        this.saveAndHide();
      }
    }));
  });
})();
