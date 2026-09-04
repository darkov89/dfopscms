// Silnik Wzrostu (G3) — wiązanie Alpine (stan + metody UI dashboardu panelu).
// Jedyny punkt wejścia do monolitu: window.DFOPS_attachGrowthPanel(app) — cienki hook
// wywoływany w buildAdminAlpineState() (js/features/adminApp.js), patrz §14.3 spec.
// Zależności dozwolone: growthRules.js (domena) + growthRepository.js (DB) + host (`app`).
// Zakaz: bezpośredni SQL poza repository, logika reguł poza growthRules.js.
;(function () {
  const DISMISSED_IDS_LIMIT = 50;
  const ROTATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  function safeDebug(scope, err) {
    if (typeof console !== 'undefined' && console.debug) console.debug(`[DFOPS growthPanel] ${scope}`, err);
  }

  /** `pl.settings.growth` powinno istnieć dzięki contentUpgrader.js — tu tylko obrona przed brakiem. */
  function ensureGrowthSettings(app) {
    const pl = app.content && app.content.pl;
    if (!pl) return null;
    if (!pl.settings || typeof pl.settings !== 'object') pl.settings = {};
    if (!pl.settings.growth || typeof pl.settings.growth !== 'object') {
      pl.settings.growth = {
        dismissed_rule_ids: [],
        last_shown_rule_id: '',
        last_shown_at: '',
        onboarding_growth_seen: false,
      };
    }
    if (!Array.isArray(pl.settings.growth.dismissed_rule_ids)) pl.settings.growth.dismissed_rule_ids = [];
    return pl.settings.growth;
  }

  function persistGrowthSettings(app) {
    if (typeof app.scheduleDraftAutosave === 'function') {
      app.scheduleDraftAutosave();
    } else if (typeof app.autosaveDraftNow === 'function') {
      void app.autosaveDraftNow();
    }
  }

  /**
   * Rotacja tygodniowa (§7): jeśli reguła pokazana w ostatnich 7 dniach nadal jest aktualna,
   * nie zamieniaj jej na inną o podobnym priorytecie — unika "migotania" karty codziennie.
   */
  function pickWithRotation(ctx, growthSettings) {
    const dismissed = growthSettings.dismissed_rule_ids || [];
    const lastId = growthSettings.last_shown_rule_id;
    const lastAt = growthSettings.last_shown_at ? new Date(growthSettings.last_shown_at).getTime() : 0;
    const withinWindow = !!lastAt && Date.now() - lastAt < ROTATION_WINDOW_MS;

    if (lastId && withinWindow && !dismissed.includes(lastId)) {
      const stillValid = window.DFOPS_evaluateGrowthRule(lastId, ctx);
      if (stillValid) return stillValid;
    }
    return window.DFOPS_pickGrowthRecommendation(ctx, dismissed);
  }

  window.DFOPS_attachGrowthPanel = function attachGrowthPanel(app) {
    if (!app || typeof app !== 'object') return;

    // 1) Pola reaktywne — jawne, mutacja obiektu (spread niszczyłby gettery Alpine 3).
    app.growthLoading = false;
    app.growthRefreshing = false;
    app.growthBenchmarks = {};
    app.growthWeekStats = {};
    app.growthPriority = null;
    app.growthHasEnoughData = false;
    app.growthDataError = false;
    app.growthLastUpdatedAt = null;

    // 2) Metody — czytają stan hosta (`this.theme`, `this.pageId`, `this.content`, `this.supabase`).
    //    `isManualRefresh` różnicuje wskaźnik: pełny skeleton przy pierwszym ładowaniu,
    //    a przy ręcznym odświeżeniu (przycisk) tylko lekki spinner na przycisku (bez migotania karty).
    app.loadGrowthData = async function loadGrowthData(isManualRefresh) {
      const repo = window.DFOPS_growthRepository;
      if (!repo || !this.pageId || !this.theme) {
        this.growthLoading = false;
        this.growthRefreshing = false;
        return;
      }
      if (isManualRefresh) this.growthRefreshing = true;
      else this.growthLoading = true;
      this.growthDataError = false;
      try {
        const { benchmarks, weekStats } = await repo.loadGrowthData({
          theme: this.theme,
          pageId: this.pageId,
          supabaseClient: this.supabase,
          days: 7,
        });
        this.growthBenchmarks = benchmarks || {};
        this.growthWeekStats = weekStats || {};
        this.growthHasEnoughData = Number(this.growthWeekStats.page_age_days || 0) >= 7;
        this.growthLastUpdatedAt = new Date();
      } catch (e) {
        safeDebug('loadGrowthData', e);
        this.growthDataError = true;
      } finally {
        this.growthLoading = false;
        this.growthRefreshing = false;
      }
    };

    // Wywoływane przyciskiem "Odśwież" w tab-dashboard.html — bez auto-pollingu (świadoma decyzja v0).
    app.refreshGrowthStatsNow = async function refreshGrowthStatsNow() {
      if (this.growthRefreshing) return;
      await this.loadGrowthData(true);
      this.refreshGrowthPriority();
    };

    app.refreshGrowthPriority = function refreshGrowthPriority() {
      const growthSettings = ensureGrowthSettings(this);
      const pl = this.content && this.content.pl;
      if (!growthSettings || !pl || typeof window.DFOPS_buildGrowthContext !== 'function') {
        this.growthPriority = null;
        return;
      }
      const ctx = window.DFOPS_buildGrowthContext(this.theme, pl, this.growthBenchmarks, this.growthWeekStats);
      const picked = pickWithRotation(ctx, growthSettings);
      this.growthPriority = picked;

      if (picked && picked.id !== growthSettings.last_shown_rule_id) {
        growthSettings.last_shown_rule_id = picked.id;
        growthSettings.last_shown_at = new Date().toISOString();
        persistGrowthSettings(this);
      }
    };

    app.dismissGrowthPriority = async function dismissGrowthPriority() {
      const growthSettings = ensureGrowthSettings(this);
      if (!growthSettings || !this.growthPriority) return;
      const id = this.growthPriority.id;
      if (!growthSettings.dismissed_rule_ids.includes(id)) {
        growthSettings.dismissed_rule_ids.push(id);
        if (growthSettings.dismissed_rule_ids.length > DISMISSED_IDS_LIMIT) {
          growthSettings.dismissed_rule_ids = growthSettings.dismissed_rule_ids.slice(-DISMISSED_IDS_LIMIT);
        }
      }
      if (growthSettings.last_shown_rule_id === id) {
        growthSettings.last_shown_rule_id = '';
        growthSettings.last_shown_at = '';
      }
      persistGrowthSettings(this);
      this.refreshGrowthPriority();
    };

    app.goToGrowthAction = function goToGrowthAction() {
      if (!this.growthPriority || typeof this.setTab !== 'function') return;
      const tab = this.growthPriority.action && this.growthPriority.action.tab;
      if (tab) this.setTab(tab);
    };

    app.growthLastUpdatedLabel = function growthLastUpdatedLabel() {
      if (!(this.growthLastUpdatedAt instanceof Date)) return '';
      try {
        return this.growthLastUpdatedAt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        return '';
      }
    };

    // 3) Lifecycle — rejestr kernela (onAfterLoadData). Zakaz owijania loadData.
    if (typeof app.onAfterLoadData === 'function') {
      app.onAfterLoadData(async function growthAfterLoad() {
        await this.loadGrowthData();
        this.refreshGrowthPriority();
      });
    }
  };
})();
