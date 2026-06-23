-- GTM pivot cleanup:
-- Remove generated lead demo pages while keeping official DFCMS demo templates.

DELETE FROM public.pages
WHERE slug LIKE 'demo-%'
  AND slug NOT IN (
    'demo-beauty',
    'demo-fitness',
    'demo-services',
    'demo-gastro',
    'demo-care',
    'demo-consultant'
  );
