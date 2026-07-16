import {
  resolvePublicHostname,
  isPlatformApexHostname,
} from './_shared/requestHostname.js';

/**
 * Cloudflare Pages Function — /sitemap.xml per host.
 * - Apex platformy → sitemapa marketingowa.
 * - Subdomena tenanta / custom domain → `/` + `/polityka-prywatnosci`.
 * Hostname: resolvePublicHostname (jak middleware — nie pages.dev po rewrite CF).
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

export async function onRequest({ request, cf }) {
  const url = new URL(request.url);
  const host = resolvePublicHostname(request, url, cf);

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
