import '../../js/core/utils.js';

/**
 * GET /api/verify-domain?domain=klient.pl
 * Sprawdza DNS domeny klienta (Cloudflare DNS over HTTPS):
 * - A na apex → IP Cloudflare SaaS (instrukcja panelu)
 * - CNAME na www → proxy.dfcms.pl (lub inny dozwolony target)
 */

const VALID_CNAME_TARGETS = new Set([
  'dfopscms.pages.dev',
  'dfcms.pl',
  'www.dfcms.pl',
  'proxy.dfcms.pl',
]);

/** Anycast IP strefy dfcms — wpisy A dla apex z instrukcji DNS w panelu. */
const VALID_APEX_A_IPS = new Set(['172.67.154.121', '104.21.66.9']);

/** Prosty hostname FQDN (bez protokołu, ścieżki, portu). */
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const normalizeHostname = globalThis.DFOPS_normalizeHostname;

/** Origins allowed to call verify-domain from a browser (panel). */
function isAllowedBrowserOrigin(origin) {
  const o = String(origin || '').trim();
  if (!o) return false;
  if (o === 'https://dfcms.pl') return true;
  try {
    const u = new URL(o);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const h = u.hostname.toLowerCase();
    if (h === 'dfcms.pl' || h.endsWith('.dfcms.pl')) return true;
    if (h === 'localhost' || h === '127.0.0.1') return true;
    if (h === 'dfopscms.pages.dev' || h.endsWith('.dfopscms.pages.dev')) return true;
    return false;
  } catch {
    return false;
  }
}

function corsHeadersForRequest(request) {
  const origin = request?.headers?.get?.('Origin') || '';
  if (origin && isAllowedBrowserOrigin(origin)) {
    return {
      ...CORS_HEADERS,
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    };
  }
  // Same-origin / no Origin (panel fetch from Pages) — keep permissive default for Pages Functions.
  return CORS_HEADERS;
}

function jsonResponse(body, status = 200, request = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForRequest(request),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function normalizeDnsTarget(value) {
  return String(value || '')
    .trim()
    .replace(/\.$/, '')
    .toLowerCase();
}

function parseDomainParam(raw) {
  if (raw == null || typeof raw !== 'string') return null;

  let domain = raw.trim();
  if (!domain) return null;

  domain = normalizeHostname(
    domain
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/[?#].*$/, '')
      .replace(/:\d+$/, '')
  );

  if (!domain || domain.length > 253) return null;
  if (/[^a-z0-9.-]/.test(domain)) return null;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return null;
  if (!DOMAIN_RE.test(domain)) return null;

  return domain;
}

function isValidCnameTarget(target) {
  const normalized = normalizeDnsTarget(target);
  if (!normalized) return false;
  if (VALID_CNAME_TARGETS.has(normalized)) return normalized;
  if (normalized.endsWith('.dfopscms.pages.dev')) return 'dfopscms.pages.dev';
  if (normalized.endsWith('.dfcms.pl')) return normalized;
  return false;
}

async function queryDns(name, type) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/dns-json' },
  });

  if (!response.ok) {
    throw new Error(`DOH_HTTP_${response.status}`);
  }

  return response.json();
}

function cnameAnswers(dns) {
  const answers = Array.isArray(dns?.Answer) ? dns.Answer : [];
  const out = [];
  for (let i = 0; i < answers.length; i++) {
    const entry = answers[i];
    if (Number(entry.type) !== 5 && String(entry.type).toUpperCase() !== 'CNAME') continue;
    out.push(entry);
  }
  return out;
}

function aRecordIps(dns) {
  const answers = Array.isArray(dns?.Answer) ? dns.Answer : [];
  const ips = new Set();
  for (let i = 0; i < answers.length; i++) {
    const entry = answers[i];
    if (Number(entry.type) !== 1 && String(entry.type).toUpperCase() !== 'A') continue;
    const ip = String(entry.data || '').trim();
    if (ip) ips.add(ip);
  }
  return ips;
}

function findValidCname(answers) {
  for (let i = 0; i < answers.length; i++) {
    const match = isValidCnameTarget(answers[i].data);
    if (match) return typeof match === 'string' ? match : normalizeDnsTarget(answers[i].data);
  }
  return null;
}

function hasRequiredApexA(ips) {
  for (const ip of VALID_APEX_A_IPS) {
    if (!ips.has(ip)) return false;
  }
  return true;
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: corsHeadersForRequest(request) });
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const domain = parseDomainParam(url.searchParams.get('domain'));

  if (!domain) {
    return jsonResponse(
      {
        status: 'pending',
        domain: url.searchParams.get('domain') || '',
        error: 'INVALID_DOMAIN',
      },
      400,
      request,
    );
  }

  const wwwHost = `www.${domain}`;

  try {
    const [apexCnameDns, wwwCnameDns, apexADns] = await Promise.all([
      queryDns(domain, 'CNAME'),
      queryDns(wwwHost, 'CNAME'),
      queryDns(domain, 'A'),
    ]);

    const apexCname = findValidCname(cnameAnswers(apexCnameDns));
    if (apexCname) {
      return jsonResponse({
        status: 'verified',
        domain,
        target: apexCname,
        checked: 'apex_cname',
      }, 200, request);
    }

    const wwwCname = findValidCname(cnameAnswers(wwwCnameDns));
    const apexIps = aRecordIps(apexADns);
    const apexAOk = hasRequiredApexA(apexIps);

    if (apexAOk && wwwCname) {
      return jsonResponse({
        status: 'verified',
        domain,
        target: wwwCname,
        checked: 'apex_a_www_cname',
        apex_a: [...VALID_APEX_A_IPS],
      }, 200, request);
    }

    if (wwwCname) {
      return jsonResponse({
        status: 'verified',
        domain,
        target: wwwCname,
        checked: 'www_cname',
      }, 200, request);
    }

    if (apexAOk) {
      // Same IP co strefa — bez CNAME www CF for SaaS często nie aktywuje hostname (Error 1001).
      return jsonResponse({
        status: 'pending',
        domain,
        error: 'MISSING_WWW_CNAME',
        apex_a: [...VALID_APEX_A_IPS],
      }, 200, request);
    }

    return jsonResponse({
      status: 'pending',
      domain,
      error: 'MISSING_CNAME',
    }, 200, request);
  } catch (err) {
    return jsonResponse({
      status: 'pending',
      domain,
      error: 'MISSING_CNAME',
    }, 200, request);
  }
}
