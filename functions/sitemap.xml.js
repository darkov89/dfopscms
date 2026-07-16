import '../js/core/utils.js';
import '../js/core/platformRouting.js';

/**
 * Cloudflare Pages Function — /sitemap.xml per host.
 * - Apex platformy (dfcms.pl, dfopscms.pl, *.pages.dev, staging) → sitemapa marketingowa.
 * - Subdomena tenanta / custom domain klienta → sitemapa strony klienta (`/`, `/polityka-prywatnosci`).
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

function isPlatformApex(host) {
  return typeof globalThis.DFOPS_isPlatformApexHostname === 'function'
    ? globalThis.DFOPS_isPlatformApexHostname(host, normalizeHostname)
    : false;
}

/** Marketing (apex) vs publiczna strona klienta (tenant / custom domain). */
function sitemapEntries(host) {
  if (isPlatformApex(host)) {
    return [
      { loc: '/', changefreq: 'weekly', priority: '1.0' },
      { loc: '/rejestracja.html', changefreq: 'monthly', priority: '0.8' },
      { loc: '/polityka.html', changefreq: 'yearly', priority: '0.3' },
      { loc: '/regulamin.html', changefreq: 'yearly', priority: '0.3' },
    ];
  }
  return [
    { loc: '/', changefreq: 'weekly', priority: '1.0' },
    { loc: '/polityka-prywatnosci', changefreq: 'yearly', priority: '0.3' },
  ];
}

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const host = resolveHost(request, url);

  const urls = sitemapEntries(host)
    .map(
      (u) =>
        `  <url>\n    <loc>https://${host}${u.loc}</loc>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
