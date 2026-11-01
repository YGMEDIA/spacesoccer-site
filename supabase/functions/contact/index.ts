// Contact form endpoint for www.space-soccer.com.
// Stores the message in public.contact_messages and forwards it by email via Resend.
//
// Secrets (Supabase dashboard -> Edge Functions -> Secrets):
//   RESEND_API_KEY   Resend key with sending access for space-soccer.com
//   CONTACT_TO       where messages go, e.g. info@yg-media.de
//   IP_SALT          any long random string, used to hash IPs for rate limiting
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy with JWT verification off (the site calls it without a user session).

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://www.space-soccer.com",
  "https://space-soccer.com",
  "https://ygmedia.github.io",
]);
const FROM = "Space Soccer <contact@space-soccer.com>";
const MAX_PER_WINDOW = 3;        // messages per IP
const WINDOW_MINUTES = 10;

function cors(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://www.space-soccer.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(origin) },
  });
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json(405, { ok: false, error: "method" }, origin);
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return json(403, { ok: false, error: "origin" }, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "json" }, origin); }

  // Honeypot: real visitors never fill this field. Pretend success so bots learn nothing.
  if (typeof body.website === "string" && body.website.trim() !== "") return json(200, { ok: true }, origin);

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const message = String(body.message ?? "").trim();
  const lang = body.lang === "de" ? "de" : "en";

  if (name.length < 1 || name.length > 100) return json(400, { ok: false, error: "name" }, origin);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return json(400, { ok: false, error: "email" }, origin);
  if (message.length < 10 || message.length > 4000) return json(400, { ok: false, error: "message" }, origin);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ipHash = await sha256((Deno.env.get("IP_SALT") ?? "") + ip);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();
  const { count } = await db.from("contact_messages")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash).gte("created_at", since);
  if ((count ?? 0) >= MAX_PER_WINDOW) return json(429, { ok: false, error: "rate" }, origin);

  const { data: row, error: insertError } = await db.from("contact_messages")
    .insert({ name, email, message, lang, ip_hash: ipHash })
    .select("id").single();
  if (insertError) return json(500, { ok: false, error: "store" }, origin);

  const to = Deno.env.get("CONTACT_TO");
  const key = Deno.env.get("RESEND_API_KEY");
  if (to && key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "authorization": `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: email,
        subject: `Space Soccer contact: ${name}`,
        text: `Name: ${name}\nEmail: ${email}\nLanguage: ${lang}\n\n${message}`,
        html: `<p><b>Name:</b> ${escapeHtml(name)}<br><b>Email:</b> ${escapeHtml(email)}<br><b>Language:</b> ${lang}</p>` +
              `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>`,
      }),
    });
    if (res.ok) await db.from("contact_messages").update({ mailed: true }).eq("id", row.id);
  }

  return json(200, { ok: true }, origin);
});
