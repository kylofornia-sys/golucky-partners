-- =============================================
-- GO LUCKY PARTNERS — Phase 2 Schema Update
-- Run this in Supabase SQL Editor
-- Adds: signature_image_url (uploaded sig file)
-- Phase 1 already added all other columns.
-- =============================================

ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS signature_image_url TEXT;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'partner_applications'
  AND column_name = 'signature_image_url';

-- =============================================
-- DONE. One column added: signature_image_url
-- =============================================
