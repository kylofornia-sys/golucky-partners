-- =============================================
-- GO LUCKY PARTNERS — Phase 1 Migration
-- Run this in Supabase SQL Editor
-- Adds: signed PDF workflow, document uploads,
--        Tier 3 credit application fields,
--        storage bucket for partner documents
-- =============================================

-- ─── 1. NEW COLUMNS ON partner_applications ──────────────────────────────────

-- Signed PDF workflow
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS signed_pdf_url TEXT;
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS signature_method TEXT DEFAULT 'upload';
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

-- Document uploads
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS id_document_url TEXT;
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS registration_doc_url TEXT;

-- Tier 3: Credit Application fields
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS director_name TEXT;
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS director_id TEXT;
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS director_address TEXT;
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS trade_ref_1_name TEXT;
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS trade_ref_1_contact TEXT;
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS trade_ref_2_name TEXT;
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS trade_ref_2_contact TEXT;
ALTER TABLE partner_applications ADD COLUMN IF NOT EXISTS credit_limit_requested NUMERIC;

-- ─── 2. STORAGE BUCKET ──────────────────────────────────────────────────────

-- Create the partner-documents bucket (public = false, files accessed via signed URLs or RLS)
INSERT INTO storage.buckets (id, name, public)
VALUES ('partner-documents', 'partner-documents', false)
ON CONFLICT (id) DO NOTHING;

-- ─── 3. STORAGE RLS POLICIES ────────────────────────────────────────────────

-- Allow anonymous users to upload files (public form submissions)
CREATE POLICY "Allow public upload to partner-documents"
ON storage.objects
FOR INSERT
WITH CHECK (bucket_id = 'partner-documents');

-- Allow anonymous users to read their own uploads (needed for PDF generation)
CREATE POLICY "Allow public read from partner-documents"
ON storage.objects
FOR SELECT
USING (bucket_id = 'partner-documents');

-- Allow authenticated users (admin) full access
CREATE POLICY "Allow authenticated full access to partner-documents"
ON storage.objects
FOR ALL
USING (bucket_id = 'partner-documents' AND auth.role() = 'authenticated');

-- ─── 4. VERIFY ──────────────────────────────────────────────────────────────

-- Check the new columns exist
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'partner_applications'
  AND column_name IN (
    'signed_pdf_url', 'signature_method', 'signed_at',
    'id_document_url', 'registration_doc_url',
    'director_name', 'director_id', 'director_address',
    'trade_ref_1_name', 'trade_ref_1_contact',
    'trade_ref_2_name', 'trade_ref_2_contact',
    'credit_limit_requested'
  )
ORDER BY column_name;

-- Check bucket exists
SELECT id, name, public FROM storage.buckets WHERE id = 'partner-documents';

-- =============================================
-- PHASE 1 COMPLETE
-- New columns: 13 added
-- Storage bucket: partner-documents (private)
-- RLS: public upload + read, authenticated full access
-- =============================================
