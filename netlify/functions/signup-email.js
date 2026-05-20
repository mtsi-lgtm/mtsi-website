// /.netlify/functions/signup-email
// Sends a confirmation email to a club that just submitted a federation application,
// and a notification to MTSÍ.
//
// Uses Resend (https://resend.com) over plain HTTPS so no extra deps are needed.
// Configure the following Netlify env vars:
//   RESEND_API_KEY     - API key from resend.com
//   MAIL_FROM          - "MTSÍ <noreply@mtsi.is>"  (must be a verified Resend sender)
//   MAIL_ADMIN_TO      - admin notification address, e.g. "mtsi@muaythai.is"
//
// If RESEND_API_KEY is missing the function returns ok:true without sending,
// so the submission flow never fails because of email config.

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function applicantHtml(rec) {
  return `
  <div style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:24px;border:1px solid #e5e5e5;border-radius:8px">
    <div style="border-bottom:3px solid #003897;padding-bottom:14px;margin-bottom:18px">
      <div style="font-size:13px;color:#003897;font-weight:700;letter-spacing:1.5px;text-transform:uppercase">Muay Thai Samband Íslands</div>
      <div style="font-size:11px;color:#888;margin-top:4px">MTSÍ — IFMA aðildarsamband</div>
    </div>
    <h2 style="color:#003897;font-size:18px;margin:0 0 12px">Umsókn móttekin</h2>
    <p style="font-size:14px;line-height:1.6;color:#333">
      Sæl(l) ${esc(rec.contactName)},<br><br>
      Við höfum móttekið umsókn frá <strong>${esc(rec.clubName)}</strong> um aðild að Muaythai Sambandi Íslands.
      Stjórn MTSÍ mun fara yfir umsóknina og hafa samband við þig á næstu dögum.
    </p>
    <table style="width:100%;font-size:13px;color:#555;margin:18px 0;border-collapse:collapse">
      <tr><td style="padding:6px 0;width:140px;color:#888">Félag</td><td>${esc(rec.clubName)}</td></tr>
      ${rec.kt ? `<tr><td style="padding:6px 0;color:#888">Kennitala</td><td>${esc(rec.kt)}</td></tr>` : ""}
      <tr><td style="padding:6px 0;color:#888">Tengiliður</td><td>${esc(rec.contactName)}${rec.contactRole ? " (" + esc(rec.contactRole) + ")" : ""}</td></tr>
      <tr><td style="padding:6px 0;color:#888">Netfang</td><td>${esc(rec.email)}</td></tr>
      ${rec.phone ? `<tr><td style="padding:6px 0;color:#888">Sími</td><td>${esc(rec.phone)}</td></tr>` : ""}
      ${rec.memberCount ? `<tr><td style="padding:6px 0;color:#888">Fjöldi iðkenda</td><td>${esc(rec.memberCount)}</td></tr>` : ""}
    </table>
    <p style="font-size:13px;color:#666;line-height:1.6">
      Ef þú þarft að breyta eða bæta við upplýsingum, sendu okkur tölvupóst á
      <a href="mailto:mtsi@muaythai.is" style="color:#003897">mtsi@muaythai.is</a>.
    </p>
    <div style="border-top:1px solid #e5e5e5;margin-top:24px;padding-top:14px;font-size:11px;color:#999">
      Þessi tölvupóstur er sendur sjálfvirkt — ekki svara honum beint.
    </div>
  </div>`;
}

function adminHtml(rec) {
  const url = "https://mtsi.is/#admin"; // admin opens panel
  return `
  <div style="font-family:Arial,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;padding:20px">
    <h2 style="color:#003897;font-size:16px">Ný aðildarumsókn</h2>
    <p style="font-size:13px;color:#333"><strong>${esc(rec.clubName)}</strong> sótti um aðild að MTSÍ.</p>
    <table style="width:100%;font-size:13px;color:#444;border-collapse:collapse">
      <tr><td style="padding:4px 0;color:#888;width:130px">Félag</td><td>${esc(rec.clubName)}</td></tr>
      <tr><td style="padding:4px 0;color:#888">Kennitala</td><td>${esc(rec.kt || "—")}</td></tr>
      <tr><td style="padding:4px 0;color:#888">Tengiliður</td><td>${esc(rec.contactName)} ${rec.contactRole ? "(" + esc(rec.contactRole) + ")" : ""}</td></tr>
      <tr><td style="padding:4px 0;color:#888">Netfang</td><td>${esc(rec.email)}</td></tr>
      <tr><td style="padding:4px 0;color:#888">Sími</td><td>${esc(rec.phone || "—")}</td></tr>
      <tr><td style="padding:4px 0;color:#888">Heimilisfang</td><td>${esc(rec.address || "—")} ${esc(rec.postnr || "")}</td></tr>
      <tr><td style="padding:4px 0;color:#888">Iðkendur</td><td>${esc(rec.memberCount || "—")}</td></tr>
      <tr><td style="padding:4px 0;color:#888">Vefur</td><td>${esc(rec.website || "—")}</td></tr>
      <tr><td style="padding:4px 0;color:#888;vertical-align:top">Athugasemd</td><td style="white-space:pre-wrap">${esc(rec.notes || "—")}</td></tr>
    </table>
    <p style="margin-top:18px;font-size:13px">
      <a href="${url}" style="background:#003897;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:12px">Opna stjórnborð</a>
    </p>
  </div>`;
}

async function sendResend({ from, to, subject, html, apiKey }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const rec = body.rec;
  if (!rec || !rec.email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing rec" }) };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Email not configured — return ok so submission flow doesn't fail.
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, skipped: "RESEND_API_KEY not set" }) };
  }

  const from = process.env.MAIL_FROM || "MTSÍ <noreply@mtsi.is>";
  const adminTo = process.env.MAIL_ADMIN_TO || "mtsi@muaythai.is";

  const results = {};
  try {
    results.applicant = await sendResend({
      from, to: rec.email,
      subject: "MTSÍ — staðfesting á aðildarumsókn",
      html: applicantHtml(rec), apiKey,
    });
  } catch (e) { results.applicantError = e.message; }

  try {
    results.admin = await sendResend({
      from, to: adminTo,
      subject: `Ný aðildarumsókn: ${rec.clubName}`,
      html: adminHtml(rec), apiKey,
    });
  } catch (e) { results.adminError = e.message; }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, results }) };
};
