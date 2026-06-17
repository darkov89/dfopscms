;(function () {
  function normalizeHostname(hostname) {
    return String(hostname || '')
      .replace(/^www\./i, '')
      .toLowerCase();
  }

  globalThis.DFOPS_normalizeHostname = normalizeHostname;
})();
