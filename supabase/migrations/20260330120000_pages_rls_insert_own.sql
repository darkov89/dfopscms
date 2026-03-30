-- Rejestracja: użytkownik zalogowany (JWT) może wstawić wiersz z user_id = auth.uid().
-- Uruchom w Supabase → SQL Editor (lub: supabase db push).

DROP POLICY IF EXISTS "pages_insert_own" ON public.pages;

CREATE POLICY "pages_insert_own"
ON public.pages
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);
