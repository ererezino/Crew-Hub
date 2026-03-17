-- Add TikTok social link column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS social_tiktok TEXT;

COMMENT ON COLUMN public.profiles.social_tiktok IS 'TikTok profile URL';
