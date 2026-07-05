// Silnik Wzrostu — zakładka „Statystyki” (Faza B). Wiązanie Alpine poza monolitem:
// window.DFOPS_attachStatsPanel(app) — wołane w buildAdminAlpineState() (adminApp.js).
// Zależności: growthRepository.js (RPC get_page_stats_range) + host (`app`). Bez SQL tutaj.
// Zakres dat (presety + własny) i unikalne odwiedziny; eksport CSV (otwierany w Excelu).
;(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;

  /** Kolejność i etykiety metryk na zakładce + w eksporcie. */
  const METRICS = [
    { key: 'page_view', label: 'Odwiedziny' },
    { key: 'phone_click', label: 'Telefony' },
    { key: 'booking_click', label: 'Rezerwacje' },
    { key: 'whatsapp_click', label: 'WhatsApp' },
    { key: 'messenger_click', label: 'Messenger' },
    { key: 'email_click', label: 'E-mail' },
    { key: 'map_click', label: 'Mapa dojazdu' },
  ];

  const PRESETS = [
    { id: '7d', label: '7 dni', days: 7 },
    { id: '30d', label: '30 dni', days: 30 },
    { id: '90d', label: '90 dni', days: 90 },
    { id: 'all', label: 'Od zawsze', days: null },
    { id: 'custom', label: 'Zakres', days: null },
  ];

  function safeDebug(scope, err) {
    if (typeof console !== 'undefined' && console.debug) console.debug(`[DFOPS statsPanel] ${scope}`, err);
  }

  function toYmd(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** yyyy-mm-dd → lokalna północ (Date) albo null gdy niepoprawne. */
  function parseYmdLocal(ymd) {
    if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  }

  function csvCell(value) {
    const s = String(value == null ? '' : value);
    if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  window.DFOPS_attachStatsPanel = function attachStatsPanel(app) {
    if (!app || typeof app !== 'object') return;

    // 1) Stan reaktywny.
    app.statsPresets = PRESETS;
    app.statsRangePreset = '7d';
    app.statsFrom = ''; // yyyy-mm-dd (własny zakres)
    app.statsTo = '';
    app.statsData = {}; // { event_name: { total, unique } }
    app.statsLoading = false;
    app.statsError = false;
    app.statsLoadedOnce = false;
    app.statsLastUpdatedAt = null;
    app.statsAppliedRangeLabel = '';

    // 2) Rozwiązanie zakresu [fromISO, toISO) z aktualnego presetu / własnych dat.
    app.resolveStatsRange = function resolveStatsRange() {
      const preset = this.statsRangePreset;
      if (preset === 'all') return { fromISO: null, toISO: null, label: 'Od zawsze' };
      if (preset === 'custom') {
        const from = parseYmdLocal(this.statsFrom);
        const to = parseYmdLocal(this.statsTo);
        if (!from || !to || from.getTime() > to.getTime()) return null;
        const toExclusive = new Date(to.getTime() + DAY_MS); // koniec dnia „do” włącznie
        return {
          fromISO: from.toISOString(),
          toISO: toExclusive.toISOString(),
          label: `${this.statsFrom} – ${this.statsTo}`,
        };
      }
      const def = PRESETS.find((p) => p.id === preset);
      const days = def && def.days ? def.days : 7;
      const fromISO = new Date(Date.now() - days * DAY_MS).toISOString();
      return { fromISO, toISO: null, label: `Ostatnie ${days} dni` };
    };

    app.loadStatsRange = async function loadStatsRange() {
      const repo = window.DFOPS_growthRepository;
      if (!repo || typeof repo.fetchStatsRange !== 'function' || !this.pageId) {
        this.statsLoading = false;
        return;
      }
      const range = this.resolveStatsRange();
      if (!range) {
        this.statsError = true;
        return;
      }
      this.statsLoading = true;
      this.statsError = false;
      try {
        const data = await repo.fetchStatsRange(this.pageId, range.fromISO, range.toISO, this.supabase);
        this.statsData = data || {};
        this.statsLoadedOnce = true;
        this.statsLastUpdatedAt = new Date();
        this.statsAppliedRangeLabel = range.label;
      } catch (e) {
        safeDebug('loadStatsRange', e);
        this.statsError = true;
      } finally {
        this.statsLoading = false;
      }
    };

    app.setStatsPreset = function setStatsPreset(presetId) {
      this.statsRangePreset = presetId;
      if (presetId === 'custom') {
        // Domyślne własne okno: ostatnie 30 dni, gdy jeszcze puste.
        if (!this.statsFrom || !this.statsTo) {
          const now = new Date();
          this.statsTo = toYmd(now);
          this.statsFrom = toYmd(new Date(now.getTime() - 29 * DAY_MS));
        }
        return; // czekamy na „Pokaż” (applyStatsCustomRange)
      }
      void this.loadStatsRange();
    };

    app.applyStatsCustomRange = function applyStatsCustomRange() {
      this.statsRangePreset = 'custom';
      void this.loadStatsRange();
    };

    app.refreshStatsNow = function refreshStatsNow() {
      if (this.statsLoading) return;
      void this.loadStatsRange();
    };

    /** Wiersze metryk do widoku i eksportu (stała kolejność, 0 gdy brak zdarzeń). */
    app.statsMetricRows = function statsMetricRows() {
      const data = this.statsData || {};
      return METRICS.map((m) => {
        const row = data[m.key] || {};
        return {
          key: m.key,
          label: m.label,
          total: Number(row.total || 0),
          unique: Number(row.unique || 0),
        };
      });
    };

    app.statsLastUpdatedLabel = function statsLastUpdatedLabel() {
      if (!(this.statsLastUpdatedAt instanceof Date)) return '';
      try {
        return this.statsLastUpdatedAt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        return '';
      }
    };

    /**
     * Eksport CSV (separator „;”, BOM UTF-8) — otwiera się bez konfiguracji w polskim Excelu.
     * Bez zewnętrznej biblioteki (native .xlsx dołożymy tylko, jeśli będzie potrzebny).
     */
    app.exportStatsCsv = function exportStatsCsv() {
      try {
        const rows = this.statsMetricRows();
        const slug = String(this.slug || 'strona').trim() || 'strona';
        const rangeLabel = this.statsAppliedRangeLabel || '';
        const lines = [];
        lines.push(csvCell(`Statystyki strony: ${slug}`));
        lines.push(csvCell(`Zakres: ${rangeLabel}`));
        lines.push(csvCell(`Wygenerowano: ${new Date().toLocaleString('pl-PL')}`));
        lines.push('');
        lines.push(['Metryka', 'Wszystkie', 'Unikalne'].map(csvCell).join(';'));
        rows.forEach((r) => {
          lines.push([r.label, r.total, r.unique].map(csvCell).join(';'));
        });
        const csv = '\uFEFF' + lines.join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = toYmd(new Date());
        a.href = url;
        a.download = `statystyki_${slug}_${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        safeDebug('exportStatsCsv', e);
      }
    };

    app.maybeLazyLoadStats = function maybeLazyLoadStats() {
      if (this.activeTab === 'stats' && this.pageId && !this.statsLoadedOnce && !this.statsLoading) {
        void this.loadStatsRange();
      }
    };

    // 3) Leniwe ładowanie: przy pierwszym wejściu w zakładkę „stats” (owijamy setTab hosta).
    const prevSetTab = typeof app.setTab === 'function' ? app.setTab : null;
    if (prevSetTab) {
      app.setTab = function (tab, ...rest) {
        const result = prevSetTab.call(this, tab, ...rest);
        try {
          this.maybeLazyLoadStats();
        } catch (e) {
          safeDebug('setTab hook', e);
        }
        return result;
      };
    }

    // 4) Deep-link (#stats na starcie ustawia activeTab bez setTab) — dociągnij po loadData.
    const hookName = typeof app.afterLoadData === 'function' ? 'afterLoadData' : 'loadData';
    const prevHook = typeof app[hookName] === 'function' ? app[hookName] : null;
    if (prevHook) {
      app[hookName] = async function (...args) {
        const result = await prevHook.apply(this, args);
        try {
          this.maybeLazyLoadStats();
        } catch (e) {
          safeDebug(`${hookName} hook`, e);
        }
        return result;
      };
    }
  };
})();
