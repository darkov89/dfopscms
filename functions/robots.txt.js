import '../js/core/utils.js';

/**
 * Cloudflare Pages Function — /robots.txt per host.
 * - Produkcja (dfcms.pl, subdomeny tenantów, custom domains) → indeksacja + wskazanie sitemapy.
 * - Staging / preview (*.pages.dev, staging.dfcms.pl, localhost) → pełny zakaz indeksacji.
 * Bez Supabase; hostname z nagłówka Host (fallback url.hostname), walidowany przeciw wstrzyknięciu.
 */

const normalizeHostname = globalThis.DFOPS_normalizeHostname;
const HOSTNAME_RE =
  /^(?:localhost|127\.0\.0\.1|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/;

function resolveHost(request, url) {
  const candidates = [
    request.headers.get('Host'),
    request.headers.get('X-Forwarded-Host'),
    url.hostname,
  ];
  for (const raw of candidates) {
    const host = normalizeHostname(String(raw || '').split(',')[0].split(':')[0]);
    if (host && HOSTNAME_RE.test(host)) return host;
  }
  return normalizeHostname(url.hostname);
}

/** Staging/preview nie trafia do indeksu wyszukiwarek. */
function isNonProduction(host) {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.includes('pages.dev') ||
    host === 'staging.dfcms.pl' ||
    host.endsWith('.staging.dfcms.pl')
  );
}

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const host = resolveHost(request, url);

  const body = isNonProduction(host)
    ? 'User-agent: *\nDisallow: /\n'
    : [
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin.html',
        'Disallow: /setup.html',
        'Disallow: /godmode.html',
        'Disallow: /router.html',
        'Disallow: /templates/',
        'Disallow: /*dfcms_preview',
        '',
        `Sitemap: https://${host}/sitemap.xml`,
        '',
      ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
