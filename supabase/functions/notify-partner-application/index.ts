// ─── Go Lucky — Notify Partner Application ───────────────────────────────────
// Supabase Edge Function (Deno)
// Sends an email to applications@golucky.co.za when a new partner application
// is submitted. Uses Resend API for email delivery.
//
// Environment variables required (set in Supabase Dashboard → Edge Functions):
//   RESEND_API_KEY — your Resend.com API key
//
// Deploy:
//   supabase functions deploy notify-partner-application
// ──────────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const NOTIFY_EMAIL = "applications@golucky.co.za";
const FROM_EMAIL = "Go Lucky Partners <noreply@golucky.co.za>";
const SUPABASE_DASHBOARD = "https://supabase.com/dashboard/project/wyrpcvlfrndcloyzxxty/editor";

const TIER_LABELS: Record<string, string> = {
  tier_1: "Tier 1 — Cash on Delivery (Base Price)",
  tier_2: "Tier 2 — Go Lucky Flow, Net 7–14 Days (Base + 5%)",
  tier_3: "Tier 3 — Credit Account, Net 30–60 Days (Base + 10%)",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { business_name, contact_name, contact_mobile, contact_email, selected_tier } = await req.json();

    const tierLabel = TIER_LABELS[selected_tier] || selected_tier;

    const htmlBody = `
      <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #4278bd; padding: 20px; border-radius: 12px 12px 0 0;">
          <h1 style="color: #ffffff; margin: 0; font-size: 20px;">New Partner Application</h1>
        </div>
        <div style="background: #ffffff; padding: 24px; border: 1px solid #e0dad6; border-top: none; border-radius: 0 0 12px 12px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 8px 0; color: #6b6563; width: 140px;">Business Name</td>
              <td style="padding: 8px 0; font-weight: 600;">${business_name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b6563;">Contact Person</td>
              <td style="padding: 8px 0;">${contact_name}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b6563;">Mobile</td>
              <td style="padding: 8px 0;"><a href="tel:${contact_mobile}" style="color: #4278bd;">${contact_mobile}</a></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b6563;">Email</td>
              <td style="padding: 8px 0;"><a href="mailto:${contact_email}" style="color: #4278bd;">${contact_email}</a></td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b6563;">Selected Tier</td>
              <td style="padding: 8px 0; font-weight: 600; color: #f89921;">${tierLabel}</td>
            </tr>
          </table>
          <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #ede9e6;">
            <a href="${SUPABASE_DASHBOARD}" style="display: inline-block; background: #4278bd; color: #ffffff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">View in Dashboard</a>
          </div>
        </div>
        <p style="font-size: 12px; color: #6b6563; margin-top: 12px; text-align: center;">
          Go Lucky Free Range (CC) &middot; partners.golucky.co.za
        </p>
      </div>
    `;

    // Send via Resend API
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [NOTIFY_EMAIL],
        subject: `New Go Lucky Partner Application — ${business_name}`,
        html: htmlBody,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      console.error("Resend error:", err);
      return new Response(JSON.stringify({ error: "Email send failed", detail: err }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Function error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
