/**
 * GET /api/verify-domain?domain=klient.pl
 * Sprawdza rekord CNAME domeny klienta (Cloudflare DNS over HTTPS).
 */

const VALID_CNAME_TARGETS = new Set([
  'dfopscms.pages.dev',
  'dfcms.pl',
  'www.dfcms.pl',
  'proxy.dfcms.pl',
]);

/** Prosty hostname FQDN (bez protokołu, ścieżki, portu). */
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
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

  domain = domain
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/[?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./i, '')
    .toLowerCase();

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

async function queryCname(domain) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=CNAME`;
  const response = await fetch(url, {
    headers: { Accept: 'application/dns-json' },
  });

  if (!response.ok) {
    throw new Error(`DOH_HTTP_${response.status}`);
  }

  return response.json();
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
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
    );
  }

  try {
    const dns = await queryCname(domain);
    const answers = Array.isArray(dns?.Answer) ? dns.Answer : [];

    for (let i = 0; i < answers.length; i++) {
      const entry = answers[i];
      if (Number(entry.type) !== 5 && String(entry.type).toUpperCase() !== 'CNAME') continue;

      const match = isValidCnameTarget(entry.data);
      if (match) {
        return jsonResponse({
          status: 'verified',
          domain,
          target: typeof match === 'string' ? match : normalizeDnsTarget(entry.data),
        });
      }
    }

    return jsonResponse({
      status: 'pending',
      domain,
      error: 'MISSING_CNAME',
    });
  } catch (err) {
    return jsonResponse({
      status: 'pending',
      domain,
      error: 'MISSING_CNAME',
    });
  }
}
