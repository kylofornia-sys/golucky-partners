-- =============================================
-- GO LUCKY — Partner Applications Table
-- Run this in Supabase SQL Editor
-- =============================================

CREATE TABLE IF NOT EXISTS partner_applications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

    -- Business Info
    business_name TEXT NOT NULL,
    business_type TEXT,
    reg_number TEXT,
    vat_number TEXT,
    delivery_address TEXT NOT NULL,

    -- Contact
    contact_name TEXT NOT NULL,
    contact_role TEXT,
    contact_mobile TEXT NOT NULL,
    contact_email TEXT NOT NULL,

    -- Tier Selection
    selected_tier TEXT NOT NULL DEFAULT 'tier_1',

    -- Banking (Tier 1 Debit Order)
    bank_holder TEXT,
    bank_name TEXT,
    bank_account TEXT,
    bank_branch TEXT,
    bank_type TEXT,
    collection_day TEXT,

    -- Supply Details
    weekly_volume TEXT,
    delivery_day TEXT,
    notes TEXT,

    -- Agreement
    signature_data TEXT,
    print_name TEXT NOT NULL,
    designation TEXT,
    agree_terms BOOLEAN DEFAULT false,
    agree_debit BOOLEAN DEFAULT false,

    -- Admin
    status TEXT DEFAULT 'pending',
    admin_notes TEXT,
    submitted_at TIMESTAMPTZ DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by TEXT
);

-- RLS: allow anonymous inserts (public form), restrict reads to authenticated
ALTER TABLE partner_applications ENABLE ROW LEVEL SECURITY;

-- Allow anyone to submit an application (anon insert)
CREATE POLICY "Allow public insert" ON partner_applications
    FOR INSERT
    WITH CHECK (true);

-- Only authenticated users (admin) can read applications
CREATE POLICY "Allow authenticated read" ON partner_applications
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Only authenticated users can update (approve/reject)
CREATE POLICY "Allow authenticated update" ON partner_applications
    FOR UPDATE
    USING (auth.role() = 'authenticated');

-- Index for quick status filtering
CREATE INDEX idx_partner_applications_status ON partner_applications(status);
CREATE INDEX idx_partner_applications_submitted ON partner_applications(submitted_at DESC);

-- =============================================
-- DONE. Test by visiting partners.golucky.co.za
-- and submitting a test application.
-- =============================================
