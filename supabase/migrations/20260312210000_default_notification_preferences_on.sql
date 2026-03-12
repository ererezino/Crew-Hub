-- Default notification preferences to ON for all existing users who never set them.
-- New behavior: email + in-app default ON, browserPush defaults OFF (requires permission grant).

UPDATE profiles
SET notification_preferences = jsonb_build_object(
  'emailAnnouncements', true,
  'emailApprovals', true,
  'inAppReminders', true,
  'browserPush', COALESCE((notification_preferences->>'browserPush')::boolean, false)
)
WHERE notification_preferences IS NULL
   OR notification_preferences = '{}'::jsonb;
