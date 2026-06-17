# Security Policy

## Reporting a Vulnerability

If you find a security issue in DFCMS, please report it privately.

- Contact: kontakt@dfops.eu
- Include: affected URL, reproduction steps, expected impact, and any relevant logs/screenshots.
- Do not publicly disclose the issue until we confirm a fix or mitigation.

We aim to acknowledge serious reports within 72 hours.

## Secret Handling

- Browser-safe values: Supabase URL and anon/publishable keys may appear in static frontend code.
- Cloudflare Turnstile site keys are public; Turnstile secret keys are server-only.
- Server-only secrets must never be committed or exposed in browser JavaScript.
- Store service role keys, Stripe secrets, Cloudflare tokens, Google API keys, Telegram tokens, cron secrets, and wFirma credentials only in Supabase Edge Function secrets or protected Cloudflare environment variables.

## Anti-Abuse

- Public forms and sensitive Edge Function calls should include a Cloudflare Turnstile token.
- Edge Functions must verify Turnstile tokens before calling Supabase service role clients, Stripe, Cloudflare APIs, or other paid/external services.

## Public Data Access

Public page rendering must query only the requested slug or custom domain, with a single-row limit and public visibility filters. Owner-only draft content must remain behind authenticated RLS checks.
