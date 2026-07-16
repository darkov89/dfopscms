import {
  resolvePublicHostname,
  isPlatformApexHostname,
  isInternalPagesDevHostname,
} from './_shared/requestHostname.js';

/**
 * Cloudflare Pages Function — /sitemap.xml per host.
 * - Apex platformy → sitemapa marketingowa.
 * - Tenant / custom domain z prawdziwym Host → `/` + `/polityka-prywatnosci`.
 * - Wewnętrzny pages.dev (brak wildcard) → puste urlset (nie trucimy indeksu
 *   URL-ami pages.dev; per-tenant sitemap wraca po dodaniu `*.dfcms.pl` w Pages).
 */

function sitemapEntries(host) {
  if (isPlatformApexHostname(host)) {
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

function emptyUrlset() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>`;
}

export async function onRequest({ request, cf }) {
  const url = new URL(request.url);
  const host = resolvePublicHostname(request, url, cf);

  if (!host || isInternalPagesDevHostname(host)) {
    return new Response(emptyUrlset(), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  }

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
