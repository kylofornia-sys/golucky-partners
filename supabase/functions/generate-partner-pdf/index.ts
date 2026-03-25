// ─── Go Lucky — Generate Partner Agreement PDF ───────────────────────────────
// Supabase Edge Function (Deno)
// Generates a branded Supplier Agreement PDF from application data.
//
// Usage: POST /functions/v1/generate-partner-pdf
// Body: { "application_id": "uuid-here" }
//
// Environment variables:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-available in Edge Functions)
// ──────────────────────────────────────────────────────────────────────────────

import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "partner-documents";

const BLUE = rgb(66 / 255, 120 / 255, 189 / 255);
const ORANGE = rgb(248 / 255, 153 / 255, 33 / 255);
const BLACK = rgb(35 / 255, 31 / 255, 32 / 255);
const GRAY = rgb(107 / 255, 101 / 255, 99 / 255);
const WHITE = rgb(1, 1, 1);

const TIER_LABELS: Record<string, string> = {
  tier_1: "Tier 1 — Cash on Delivery",
  tier_2: "Tier 2 — Go Lucky Flow (Net 7–14 Days)",
  tier_3: "Tier 3 — Credit Account (Net 30 Days)",
};

const TIER_PRICING: Record<string, string> = {
  tier_1: "Base Price (Best)",
  tier_2: "Base + 5%",
  tier_3: "Base + 10%",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper: draw wrapped text, returns new Y position
function drawWrapped(
  page: any, text: string, x: number, y: number,
  font: any, size: number, color: any, maxWidth: number, lineHeight: number
): number {
  const words = text.split(" ");
  let line = "";
  let currentY = y;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, size);
    if (width > maxWidth && line) {
      page.drawText(line, { x, y: currentY, size, font, color });
      currentY -= lineHeight;
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) {
    page.drawText(line, { x, y: currentY, size, font, color });
    currentY -= lineHeight;
  }
  return currentY;
}

// Helper: draw a horizontal line
function drawLine(page: any, x: number, y: number, width: number, thickness = 0.5) {
  page.drawRectangle({ x, y, width, height: thickness, color: rgb(0.85, 0.83, 0.81) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { application_id } = await req.json();
    if (!application_id) throw new Error("application_id is required");

    // ── Fetch application data ──
    const appRes = await fetch(
      `${SUPABASE_URL}/rest/v1/partner_applications?id=eq.${application_id}&select=*`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const apps = await appRes.json();
    if (!apps.length) throw new Error("Application not found");
    const app = apps[0];

    // ── Fetch logo image ──
    let logoImageBytes: Uint8Array | null = null;
    try {
      const logoRes = await fetch("https://golucky.co.za/golucky-script-transparent.png");
      if (logoRes.ok) {
        logoImageBytes = new Uint8Array(await logoRes.arrayBuffer());
      }
    } catch (e) {
      console.warn("Could not fetch logo:", e);
    }

    // ── Fetch signature image ──
    let sigImageBytes: Uint8Array | null = null;
    let sigImageType = "png";
    if (app.signature_image_url) {
      const sigPath = app.signature_image_url.split(`/storage/v1/object/${BUCKET}/`)[1];
      if (sigPath) {
        const ext = sigPath.split(".").pop()?.toLowerCase() || "png";
        sigImageType = ext === "jpg" || ext === "jpeg" ? "jpeg" : "png";
        const sigRes = await fetch(
          `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${sigPath}`,
          { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
        );
        if (sigRes.ok) {
          sigImageBytes = new Uint8Array(await sigRes.arrayBuffer());
        }
      }
    }

    // ── Create PDF ──
    const pdf = await PDFDocument.create();
    const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const helveticaOblique = await pdf.embedFont(StandardFonts.HelveticaOblique);

    const W = 595.28; // A4 width
    const H = 841.89; // A4 height
    const M = 50; // margin
    const CW = W - 2 * M; // content width

    // ════════════════════════════════════════════════════════════
    // PAGE 1 — Header, Partnership Intro, Tier Table
    // ════════════════════════════════════════════════════════════
    let page = pdf.addPage([W, H]);
    let y = H - M;

    // Header bar
    page.drawRectangle({ x: 0, y: H - 4, width: W / 4, height: 4, color: BLUE });
    page.drawRectangle({ x: W / 4, y: H - 4, width: W / 4, height: 4, color: ORANGE });
    page.drawRectangle({ x: W / 2, y: H - 4, width: W / 4, height: 4, color: rgb(0.93, 0.91, 0.9) });
    page.drawRectangle({ x: 3 * W / 4, y: H - 4, width: W / 4, height: 4, color: BLACK });

    // Logo (centred)
    if (logoImageBytes) {
      try {
        const logoImage = await pdf.embedPng(logoImageBytes);
        const logoScale = Math.min(320 / logoImage.width, 140 / logoImage.height);
        const logoDims = logoImage.scale(logoScale);
        const logoX = (W - logoDims.width) / 2;
        page.drawImage(logoImage, { x: logoX, y: y - logoDims.height, width: logoDims.width, height: logoDims.height });
        y -= logoDims.height + 2;
      } catch (e) {
        y -= 10;
      }
    }

    // Title (centred, 60% smaller)
    const titleText = "GO LUCKY CLIENT SUPPLY AGREEMENT";
    const titleSize = 8;
    const titleWidth = helveticaBold.widthOfTextAtSize(titleText, titleSize);
    page.drawText(titleText, { x: (W - titleWidth) / 2, y, size: titleSize, font: helveticaBold, color: GRAY });
    y -= 12;
    drawLine(page, M, y, CW);
    y -= 12;
    const regText = "Go Lucky Free Range (CC)  Reg No: 2007/157032/23  VAT: 4610290712";
    const regWidth = helvetica.widthOfTextAtSize(regText, 7);
    page.drawText(regText, { x: (W - regWidth) / 2, y, size: 7, font: helvetica, color: GRAY });
    y -= 10;
    const dateStr = new Date().toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" });
    const dateText = `Generated: ${dateStr}`;
    const dateWidth = helvetica.widthOfTextAtSize(dateText, 7);
    page.drawText(dateText, { x: (W - dateWidth) / 2, y, size: 7, font: helvetica, color: GRAY });

    // Client details box
    y -= 25;
    page.drawRectangle({ x: M, y: y - 80, width: CW, height: 90, color: rgb(0.96, 0.95, 0.94), borderColor: rgb(0.88, 0.86, 0.84), borderWidth: 0.5 });
    y -= 5;
    page.drawText("CLIENT DETAILS", { x: M + 10, y, size: 9, font: helveticaBold, color: BLUE });
    y -= 15;
    const details = [
      ["Business Name:", app.business_name || ""],
      ["Contact Person:", app.contact_name || ""],
      ["Mobile:", app.contact_mobile || ""],
      ["Email:", app.contact_email || ""],
      ["Delivery Address:", app.delivery_address || ""],
    ];
    for (const [label, value] of details) {
      page.drawText(label, { x: M + 10, y, size: 8, font: helveticaBold, color: BLACK });
      page.drawText(value, { x: M + 120, y, size: 8, font: helvetica, color: BLACK });
      y -= 13;
    }
    y -= 15;

    // Selected Tier highlight
    page.drawRectangle({ x: M, y: y - 22, width: CW, height: 28, color: BLUE });
    page.drawText(`Selected Tier: ${TIER_LABELS[app.selected_tier] || app.selected_tier}`, { x: M + 10, y: y - 5, size: 10, font: helveticaBold, color: WHITE });
    page.drawText(`Pricing: ${TIER_PRICING[app.selected_tier] || ""}`, { x: M + 10, y: y - 17, size: 9, font: helvetica, color: WHITE });
    y -= 40;

    // Section 1: Partnership
    page.drawText("1. THE GO LUCKY PARTNERSHIP", { x: M, y, size: 14, font: helveticaBold, color: BLACK });
    y -= 5;
    drawLine(page, M, y, CW);
    y -= 15;

    const intro = "Go Lucky Free Range is committed to supplying the freshest, highest quality eggs at the most competitive prices. To maintain this standard and ensure sustainability for both parties, we offer a Tiered Supply Model. The faster you pay, the less you pay — our tiered model rewards clients who keep things simple.";
    y = drawWrapped(page, intro, M, y, helvetica, 9, BLACK, CW, 13);
    y -= 10;

    // Section 2: Tier Table
    page.drawText("2. TIERED PRICING & TERMS STRUCTURE", { x: M, y, size: 14, font: helveticaBold, color: BLACK });
    y -= 5;
    drawLine(page, M, y, CW);
    y -= 15;

    // Table header
    const colX = [M, M + 50, M + 180, M + 290, M + 400];
    page.drawRectangle({ x: M, y: y - 16, width: CW, height: 20, color: rgb(0.92, 0.9, 0.88) });
    const headers = ["TIER", "PARTNERSHIP TYPE", "PAYMENT METHOD", "PAYMENT TERMS", "PRICING"];
    for (let i = 0; i < headers.length; i++) {
      page.drawText(headers[i], { x: colX[i] + 4, y: y - 11, size: 7, font: helveticaBold, color: BLACK });
    }
    y -= 20;

    // Table rows
    const tiers = [
      { tier: "TIER 1", name: "CASH ON DELIVERY", method: "Cash / EFT", terms: "Immediate (COD)", price: "Base Price (Best)" },
      { tier: "TIER 2", name: "GO LUCKY FLOW", method: "Debit Order / EFT", terms: "Net 7–14 Days", price: "Base + 5%" },
      { tier: "TIER 3", name: "CREDIT ACCOUNT", method: "EFT", terms: "Net 30 Days", price: "Base + 10%" },
    ];

    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const isSelected = app.selected_tier === `tier_${i + 1}`;
      if (isSelected) {
        page.drawRectangle({ x: M, y: y - 16, width: CW, height: 20, color: rgb(0.93, 0.96, 1) });
      }
      const rowFont = isSelected ? helveticaBold : helvetica;
      page.drawText(t.tier, { x: colX[0] + 4, y: y - 11, size: 7, font: rowFont, color: BLACK });
      page.drawText(t.name, { x: colX[1] + 4, y: y - 11, size: 7, font: rowFont, color: BLACK });
      page.drawText(t.method, { x: colX[2] + 4, y: y - 11, size: 7, font: rowFont, color: BLACK });
      page.drawText(t.terms, { x: colX[3] + 4, y: y - 11, size: 7, font: rowFont, color: BLACK });
      page.drawText(t.price, { x: colX[4] + 4, y: y - 11, size: 7, font: rowFont, color: isSelected ? ORANGE : BLACK });
      y -= 20;
    }

    y -= 10;

    // Tier notes
    const note1 = "Tier 1 (COD): No credit facility required. Pay on delivery for the best price.";
    const note2 = "Tier 2 (Flow): Requires a signed Debit Order Mandate. Invoices generated weekly. Payment collected 7–14 days later.";
    const note3 = "Tier 3 (Credit): Subject to strict credit vetting. Interest of 2.5% per month on late payments beyond agreed terms.";
    y = drawWrapped(page, note1, M, y, helveticaOblique, 8, GRAY, CW, 11);
    y = drawWrapped(page, note2, M, y, helveticaOblique, 8, GRAY, CW, 11);
    y = drawWrapped(page, note3, M, y, helveticaOblique, 8, GRAY, CW, 11);
    y -= 15;

    // Section 3: Supply Agreement Terms
    page.drawText("3. SUPPLY AGREEMENT TERMS", { x: M, y, size: 14, font: helveticaBold, color: BLACK });
    y -= 5;
    drawLine(page, M, y, CW);
    y -= 15;

    const terms = [
      ["Standing Order:", "The Client agrees to a minimum weekly standing order. Adjustments must be communicated 48 hours prior to delivery."],
      ["Retention of Title:", "Ownership of all goods remains with Go Lucky Free Range until full payment has been received."],
      ["Cession of Proceeds:", "If goods are sold prior to payment, the proceeds are deemed held in trust for Go Lucky Free Range and are ceded as security for the debt."],
      ["Automatic Suspension:", "Supply will be automatically suspended if payment is not received by the due date. Reinstatement may require COD terms."],
      ["Price Adjustments:", "Go Lucky reserves the right to adjust the Base Price in line with farm gate cost increases. Clients will be notified 7 days in advance."],
      ["Freshness Guarantee:", "Fresh or we replace — every delivery, every time."],
    ];

    for (const [label, text] of terms) {
      page.drawText(label, { x: M, y, size: 9, font: helveticaBold, color: BLACK });
      y -= 13;
      y = drawWrapped(page, text, M, y, helvetica, 8, GRAY, CW, 11);
      y -= 6;
    }

    // ════════════════════════════════════════════════════════════
    // PAGE 2 — Debit Order (Tier 2) / Credit App (Tier 3) + Signature
    // ════════════════════════════════════════════════════════════
    page = pdf.addPage([W, H]);
    y = H - M;

    // Color bar
    page.drawRectangle({ x: 0, y: H - 4, width: W / 4, height: 4, color: BLUE });
    page.drawRectangle({ x: W / 4, y: H - 4, width: W / 4, height: 4, color: ORANGE });
    page.drawRectangle({ x: W / 2, y: H - 4, width: W / 4, height: 4, color: rgb(0.93, 0.91, 0.9) });
    page.drawRectangle({ x: 3 * W / 4, y: H - 4, width: W / 4, height: 4, color: BLACK });

    y -= 10;

    // Tier 2: Debit Order Mandate
    if (app.selected_tier === "tier_2") {
      page.drawText("4. DEBIT ORDER MANDATE", { x: M, y, size: 14, font: helveticaBold, color: BLACK });
      y -= 5;
      drawLine(page, M, y, CW);
      y -= 15;

      const bankDetails = [
        ["Account Holder:", app.bank_holder || "_______________"],
        ["Bank:", app.bank_name || "_______________"],
        ["Account Number:", app.bank_account || "_______________"],
        ["Branch Code:", app.bank_branch || "_______________"],
        ["Account Type:", app.bank_type || "_______________"],
        ["Collection Day:", app.collection_day || "_______________"],
      ];

      for (const [label, value] of bankDetails) {
        page.drawText(label, { x: M, y, size: 9, font: helveticaBold, color: BLACK });
        page.drawText(value, { x: M + 130, y, size: 9, font: helvetica, color: BLACK });
        y -= 16;
      }

      y -= 10;
      const mandate = 'I/We hereby authorize Go Lucky Free Range (CC) to issue and deliver payment instructions to the bank for collection against my/our above-mentioned account, on condition that the sum of such payment instructions will never exceed my/our obligations as agreed to in this Agreement. Each withdrawal will be processed through a computerized system provided by the South African Banks with the reference "GOLUCKY".';
      y = drawWrapped(page, mandate, M, y, helvetica, 8, GRAY, CW, 11);
      y -= 20;
    }

    // Tier 3: Credit Application
    if (app.selected_tier === "tier_3") {
      page.drawText("4. CREDIT APPLICATION", { x: M, y, size: 14, font: helveticaBold, color: BLACK });
      y -= 5;
      drawLine(page, M, y, CW);
      y -= 15;

      const creditDetails = [
        ["Director Full Name:", app.director_name || "_______________"],
        ["Director ID Number:", app.director_id || "_______________"],
        ["Director Address:", app.director_address || "_______________"],
        ["Trade Reference 1:", `${app.trade_ref_1_name || "N/A"} — ${app.trade_ref_1_contact || "N/A"}`],
        ["Trade Reference 2:", `${app.trade_ref_2_name || "N/A"} — ${app.trade_ref_2_contact || "N/A"}`],
        ["Credit Limit Requested:", app.credit_limit_requested ? `R ${Number(app.credit_limit_requested).toLocaleString()}` : "_______________"],
      ];

      for (const [label, value] of creditDetails) {
        page.drawText(label, { x: M, y, size: 9, font: helveticaBold, color: BLACK });
        page.drawText(value, { x: M + 150, y, size: 9, font: helvetica, color: BLACK });
        y -= 16;
      }

      y -= 10;
      const creditNote = "This credit application is subject to approval. Go Lucky Free Range reserves the right to decline or limit credit at its sole discretion. Interest of 2.5% per month will be charged on any late payments beyond the agreed 30 day terms.";
      y = drawWrapped(page, creditNote, M, y, helveticaOblique, 8, GRAY, CW, 11);
      y -= 20;
    }

    // Section: Signature Block
    const sigSection = app.selected_tier === "tier_1" ? "4" : "5";
    page.drawText(`${sigSection}. AGREEMENT & SIGNATURE`, { x: M, y, size: 14, font: helveticaBold, color: BLACK });
    y -= 5;
    drawLine(page, M, y, CW);
    y -= 15;

    const agreement = `I, ${app.print_name || "_______________"}, in my capacity as ${app.designation || "_______________"} of ${app.business_name || "_______________"}, hereby confirm that I have read and agree to the Go Lucky Client Supply Agreement Terms as outlined above. I understand that pricing is determined by my selected tier and that late payments are subject to interest charges.`;
    y = drawWrapped(page, agreement, M, y, helvetica, 9, BLACK, CW, 13);
    y -= 20;

    // Signed at / date
    const signedDate = app.submitted_at ? new Date(app.submitted_at) : new Date();
    const signedStr = signedDate.toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric" });
    page.drawText(`Signed on: ${signedStr}`, { x: M, y, size: 9, font: helvetica, color: BLACK });
    y -= 25;

    // Signature image
    if (sigImageBytes) {
      try {
        let sigImage;
        if (sigImageType === "jpeg") {
          sigImage = await pdf.embedJpg(sigImageBytes);
        } else {
          sigImage = await pdf.embedPng(sigImageBytes);
        }
        const sigDims = sigImage.scale(Math.min(180 / sigImage.width, 60 / sigImage.height));
        page.drawText("Signature:", { x: M, y, size: 9, font: helveticaBold, color: BLACK });
        y -= 5;
        page.drawImage(sigImage, { x: M, y: y - sigDims.height, width: sigDims.width, height: sigDims.height });
        y -= sigDims.height + 10;
      } catch (e) {
        page.drawText("Signature: [uploaded — see storage]", { x: M, y, size: 9, font: helveticaOblique, color: GRAY });
        y -= 15;
      }
    } else {
      page.drawText("Signature: ____________________________________", { x: M, y, size: 9, font: helvetica, color: BLACK });
      y -= 15;
    }

    // Print name and designation
    y -= 10;
    page.drawText(`Print Name: ${app.print_name || "_______________"}`, { x: M, y, size: 9, font: helvetica, color: BLACK });
    page.drawText(`Designation: ${app.designation || "_______________"}`, { x: M + 250, y, size: 9, font: helvetica, color: BLACK });
    y -= 30;

    // Footer
    drawLine(page, M, y, CW);
    y -= 12;
    page.drawText("Go Lucky Free Range (CC) · Reg No: 2007/157032/23 · VAT: 4610290712", { x: M, y, size: 7, font: helvetica, color: GRAY });
    y -= 10;
    page.drawText("partners.golucky.co.za · HappyClient@golucky.co.za · 083 642 4645", { x: M, y, size: 7, font: helvetica, color: GRAY });

    // ── Save PDF ──
    const pdfBytes = await pdf.save();
    const folder = (app.business_name || "unknown").replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_");
    const pdfPath = `${folder}/Go_Lucky_Supply_Agreement_${new Date().toISOString().slice(0, 10)}.pdf`;

    // Upload to storage
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${pdfPath}`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/pdf",
          "x-upsert": "true",
        },
        body: pdfBytes,
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`PDF upload failed: ${err}`);
    }

    const pdfUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${pdfPath}`;

    // Update application record
    await fetch(
      `${SUPABASE_URL}/rest/v1/partner_applications?id=eq.${application_id}`,
      {
        method: "PATCH",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          signed_pdf_url: pdfUrl,
          signed_at: new Date().toISOString(),
          status: "agreement_generated",
        }),
      }
    );

    return new Response(
      JSON.stringify({ success: true, pdf_url: pdfUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("PDF generation error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
