import '../../js/core/utils.js';
import '../../js/core/platformRouting.js';

/**
 * Publiczny hostname requestu — ten sam model co functions/_middleware.js.
 * Po wewnętrznym rewrite CF `Host` / `url.hostname` bywa pages.dev; bierzemy
 * X-Forwarded-Host / Forwarded / cf.hostMetadata i preferujemy host tenantowy.
 *
 * Znana luka infra: bez wildcard `*.dfcms.pl` w Cloudflare Pages worker widzi
 * wyłącznie `dfopscms.pages.dev` dla subdomen — wtedy nie da się odtworzyć
 * publicznego hosta na edge (to samo ograniczenie co middleware HTML).
 */

const normalizeHostname = globalThis.DFOPS_normalizeHostname;

const HOSTNAME_RE =
  /^(?:localhost|127\.0\.0\.1|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/;

function parseForwardedHost(request) {
  const fwd = request.headers.get('Forwarded') || '';
  const m = fwd.match(/host=([^;,\s"]+)/i);
  if (!m) return '';
  return normalizeHostname(m[1].replace(/^"|"$/g, '').split(':')[0]);
}

function collectHostCandidates(request, url, cf) {
  const raw = [
    request.headers.get('Host'),
    request.headers.get('X-Forwarded-Host'),
    request.headers.get('X-Original-Host'),
    parseForwardedHost(request),
    cf && cf.hostMetadata && cf.hostMetadata.httpHost,
    cf && cf.hostname,
    url.hostname,
  ];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const h = normalizeHostname(String(raw[i] || '').split(',')[0].split(':')[0]);
    if (h && HOSTNAME_RE.test(h) && !seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

/** Preferuj host publiczny (tenant / custom / dfcms.pl) zamiast wewnętrznego pages.dev. */
function pickPublicHostname(candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const h = candidates[i];
    if (
      typeof globalThis.DFOPS_isTenantPublicHostname === 'function' &&
      globalThis.DFOPS_isTenantPublicHostname(h, normalizeHostname)
    ) {
      return h;
    }
  }
  for (let i = 0; i < candidates.length; i++) {
    const h = candidates[i];
    if (h.endsWith('.dfcms.pl') && h !== 'dfcms.pl' && h !== 'staging.dfcms.pl') return h;
  }
  for (let i = 0; i < candidates.length; i++) {
    const h = candidates[i];
    if (h.includes('dfcms.pl') || h.includes('dfopscms.pl')) return h;
  }
  for (let i = 0; i < candidates.length; i++) {
    const h = candidates[i];
    if (!h.includes('pages.dev')) return h;
  }
  return candidates[0] || '';
}

export function resolvePublicHostname(request, url, cf) {
  return pickPublicHostname(collectHostCandidates(request, url, cf));
}

/**
 * Staging/preview poza indeksem.
 * Uwaga: sam `dfopscms.pages.dev` NIE jest non-prod — przy braku wildcard
 * `*.dfcms.pl` worker widzi ten host także dla produkcyjnych subdomen tenantów.
 */
export function isNonProductionHostname(host) {
  const h = normalizeHostname(host);
  if (!h) return true;
  if (h === 'localhost' || h === '127.0.0.1') return true;
  if (h === 'staging.dfcms.pl' || h.endsWith('.staging.dfcms.pl')) return true;
  if (h === 'staging.dfopscms.pages.dev' || h.endsWith('.staging.dfopscms.pages.dev')) return true;
  // Preview deploy CF (hash.project.pages.dev), nie apex produkcyjnego projektu
  if (h.includes('pages.dev') && h !== 'dfopscms.pages.dev') return true;
  return false;
}

/** Host wewnętrzny po rewrite — nie emitujemy go w <loc> / Sitemap. */
export function isInternalPagesDevHostname(host) {
  const h = normalizeHostname(host);
  return h.includes('pages.dev');
}

export function isPlatformApexHostname(host) {
  return typeof globalThis.DFOPS_isPlatformApexHostname === 'function'
    ? globalThis.DFOPS_isPlatformApexHostname(host, normalizeHostname)
    : false;
}
