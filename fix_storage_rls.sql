-- =============================================
-- Fix storage RLS for partner-documents bucket
-- Run in Supabase SQL Editor
-- =============================================

-- Drop existing policies if they conflict
DROP POLICY IF EXISTS "Allow public upload to partner-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read from partner-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated full access to partner-documents" ON storage.objects;

-- Re-create with broader permissions for anon uploads
CREATE POLICY "anon_upload_partner_docs"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (bucket_id = 'partner-documents');

CREATE POLICY "anon_read_partner_docs"
ON storage.objects
FOR SELECT
TO anon
USING (bucket_id = 'partner-documents');

CREATE POLICY "auth_all_partner_docs"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'partner-documents');

-- Verify
SELECT policyname, permissive, roles, cmd
FROM pg_policies
WHERE tablename = 'objects' AND schemaname = 'storage'
  AND policyname LIKE '%partner%';
