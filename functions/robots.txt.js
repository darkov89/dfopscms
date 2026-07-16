import {
  resolvePublicHostname,
  isNonProductionHostname,
} from './_shared/requestHostname.js';

/**
 * Cloudflare Pages Function — /robots.txt per host.
 * - Produkcja (dfcms.pl, subdomeny tenantów, custom domains) → indeksacja + wskazanie sitemapy.
 * - Staging / preview (*.pages.dev, staging.dfcms.pl, localhost) → pełny zakaz indeksacji.
 * Hostname: resolvePublicHostname (jak middleware — nie pages.dev po rewrite CF).
 */

export async function onRequest({ request, cf }) {
  const url = new URL(request.url);
  const host = resolvePublicHostname(request, url, cf);

  const body = isNonProductionHostname(host)
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
