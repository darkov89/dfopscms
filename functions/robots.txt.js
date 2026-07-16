import {
  resolvePublicHostname,
  isNonProductionHostname,
  isInternalPagesDevHostname,
} from './_shared/requestHostname.js';

/**
 * Cloudflare Pages Function — /robots.txt per host.
 * - Produkcja z prawdziwym Host (dfcms.pl, custom domain) → Allow + Sitemap.
 * - Staging/preview → Disallow: /.
 * - Wewnętrzny pages.dev (brak wildcard *.dfcms.pl) → Allow bez Sitemap
 *   (nie noindexujemy produkcyjnych subdomen; poprawny Sitemap wymaga Host).
 */

export async function onRequest({ request, cf }) {
  const url = new URL(request.url);
  const host = resolvePublicHostname(request, url, cf);

  let body;
  if (isNonProductionHostname(host)) {
    body = 'User-agent: *\nDisallow: /\n';
  } else if (isInternalPagesDevHostname(host)) {
    body = [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin.html',
      'Disallow: /setup.html',
      'Disallow: /godmode.html',
      'Disallow: /router.html',
      'Disallow: /templates/',
      'Disallow: /*dfcms_preview',
      '',
    ].join('\n');
  } else {
    body = [
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
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
