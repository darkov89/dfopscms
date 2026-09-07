-- Rate-limit column: last time this user called the agent
ALTER TABLE public.billing_profiles
  ADD COLUMN IF NOT EXISTS last_agent_call_at timestamptz;

-- Atomic increment for agent chat count (prevents race conditions)
-- Used by chat-site-agent Edge Function instead of read-then-write pattern
CREATE OR REPLACE FUNCTION increment_agent_chat(uid UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE billing_profiles
  SET agent_chat_count = agent_chat_count + 1,
      last_agent_call_at = now()
  WHERE user_id = uid;
$$;
