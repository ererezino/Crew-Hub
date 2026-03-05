-- TECH-3: Add signature_image_path column for drawn signatures stored as images
ALTER TABLE signature_signers
  ADD COLUMN IF NOT EXISTS signature_image_path TEXT;

COMMENT ON COLUMN signature_signers.signature_image_path IS
  'Storage path for drawn signature images (e.g. signatures/{requestId}_{signerId}_{ts}.png)';
