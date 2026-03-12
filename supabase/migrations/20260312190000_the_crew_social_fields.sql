-- The Crew: social profile fields + directory visibility for moderation
--
-- Adds optional social media links so crew members can share their profiles.
-- Adds directory_visible boolean for admin moderation (hide from The Crew page).

-- Social links (all optional)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_linkedin VARCHAR(255);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_twitter VARCHAR(255);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_instagram VARCHAR(255);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_github VARCHAR(255);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS social_website VARCHAR(255);

-- Directory visibility (admin toggle for The Crew page)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS directory_visible BOOLEAN DEFAULT TRUE;

-- Auto-hide known test / system / E2E accounts
UPDATE profiles SET directory_visible = FALSE
WHERE email LIKE '%e2e%'
   OR email LIKE '%test%'
   OR email LIKE '%autodelivery%'
   OR email LIKE '%noreply%'
   OR email LIKE '%system%';
