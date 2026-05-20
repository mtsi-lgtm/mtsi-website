// /.netlify/functions/team-signups
// Storage backend for federation team applications.
// Uses Netlify Blobs so applicant data is NEVER committed to the public repo.
//
// Actions (POST body):
//   { action: "submit", data: {...} }              -> PUBLIC: applicant submits
//   { action: "list",   token: "<admin-token>" }   -> ADMIN:  list all
//   { action: "update", token, id, patch }         -> ADMIN:  update status/notes/fields
//   { action: "delete", token, id }                -> ADMIN:  remove a record

const { getStore } = require("@netlify/blobs");

const STORE_NAME = "mtsi-signups";
const KEY = "all";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function genId() {
  return "sg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function sanitize(s, max = 500) {
  if (s === null || s === undefined) return "";
  return String(s).slice(0, max).replace(/[\u0000-\u001F\u007F]/g, "");
}

function getStoreInstance() {
  return getStore({
    name: STORE_NAME,
    siteID: process.env.SITE_ID || process.env.NETLIFY_SITE_ID || process.env.MTSI_SITE_ID,
    token: process.env.NETLIFY_API_TOKEN,
  });
}

async function loadAll(store) {
  const data = await store.get(KEY, { type: "json" });
  return Array.isArray(data) ? data : [];
}

async function saveAll(store, list) {
  await store.set(KEY, JSON.stringify(list));
}

function requireAdmin(token) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return { ok: false, reason: "ADMIN_TOKEN not configured" };
  if (!token || token !== expected) return { ok: false, reason: "Unauthorized" };
  return { ok: true };
}

exports.handler = async (event) => {
  const headers = corsHeaders();

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const { action } = body;

  try {
    const store = getStoreInstance();

    // ------- PUBLIC: submit a new application -------
    if (action === "submit") {
      const d = body.data || {};
      // Minimal required fields
      const clubName = sanitize(d.clubName, 200).trim();
      const contactName = sanitize(d.contactName, 200).trim();
      const email = sanitize(d.email, 200).trim();
      if (!clubName || !contactName || !email) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Vantar reiti: nafn félags, tengiliður, netfang." }) };
      }

      const rec = {
        id: genId(),
        clubName,
        kt: sanitize(d.kt, 20),
        contactName,
        contactRole: sanitize(d.contactRole, 120),
        email,
        phone: sanitize(d.phone, 40),
        address: sanitize(d.address, 200),
        postnr: sanitize(d.postnr, 40),
        memberCount: sanitize(d.memberCount, 20),
        website: sanitize(d.website, 200),
        notes: sanitize(d.notes, 2000),
        status: "pending",
        adminNotes: "",
        submittedAt: new Date().toISOString(),
        ip: event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"] || "",
      };

      const list = await loadAll(store);
      list.unshift(rec);
      await saveAll(store, list);

      // Fire-and-forget confirmation email (don't fail the submission if it errors)
      try {
        const origin = `https://${event.headers.host || "mtsi.is"}`;
        await fetch(`${origin}/.netlify/functions/signup-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rec }),
        });
      } catch (e) { /* swallow */ }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id: rec.id }) };
    }

    // ------- ADMIN: list all -------
    if (action === "list") {
      const auth = requireAdmin(body.token);
      if (!auth.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: auth.reason }) };
      const list = await loadAll(store);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, list }) };
    }

    // ------- ADMIN: update a record -------
    if (action === "update") {
      const auth = requireAdmin(body.token);
      if (!auth.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: auth.reason }) };
      const { id, patch } = body;
      if (!id || !patch) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing id/patch" }) };

      const list = await loadAll(store);
      const idx = list.findIndex(r => r.id === id);
      if (idx === -1) return { statusCode: 404, headers, body: JSON.stringify({ error: "Not found" }) };

      const allowed = ["status", "adminNotes", "clubName", "kt", "contactName", "contactRole",
                       "email", "phone", "address", "postnr", "memberCount", "website", "notes"];
      const updated = { ...list[idx] };
      for (const k of allowed) {
        if (k in patch) updated[k] = typeof patch[k] === "string" ? sanitize(patch[k], 2000) : patch[k];
      }
      updated.updatedAt = new Date().toISOString();
      list[idx] = updated;
      await saveAll(store, list);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, rec: updated }) };
    }

    // ------- ADMIN: delete a record -------
    if (action === "delete") {
      const auth = requireAdmin(body.token);
      if (!auth.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: auth.reason }) };
      const { id } = body;
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing id" }) };
      const list = await loadAll(store);
      const next = list.filter(r => r.id !== id);
      await saveAll(store, next);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid action" }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
