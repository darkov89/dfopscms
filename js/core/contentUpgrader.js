;(function () {
  function upgradeContent(theme, content, targetVersion) {
    const normalized = window.DFOPS_normalizeContent(theme, content);
    if (!normalized.pl) normalized.pl = {};
    if (!normalized.pl.settings) normalized.pl.settings = {};
    normalized.pl.settings.template_version = targetVersion || window.DFOPS_LATEST_TEMPLATE_VERSION || 1;
    return normalized;
  }

  window.DFOPS_upgradeContent = upgradeContent;
})();

