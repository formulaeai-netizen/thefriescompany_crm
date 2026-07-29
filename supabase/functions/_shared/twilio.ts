// Shared helpers used by payment-reminder-agent and daily-group-report.
// Credentials are passed in explicitly (loaded from the settings table by callers).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export { corsHeaders };

export interface TwilioCreds {
  accountSid: string;
  authToken: string;
  fromNumber: string; // e.g. "whatsapp:+14155238886"
}

export function twilioFromSettings(s: {
  twilio_account_sid?: string | null;
  twilio_auth_token?: string | null;
  twilio_whatsapp_number?: string | null;
} | null | undefined): TwilioCreds {
  if (!s?.twilio_account_sid || !s?.twilio_auth_token || !s?.twilio_whatsapp_number) {
    throw new Error(
      "Twilio credentials missing in settings. Fill Twilio Account SID, Auth Token, and WhatsApp Number on the Settings page.",
    );
  }
  return {
    accountSid: s.twilio_account_sid,
    authToken: s.twilio_auth_token,
    fromNumber: s.twilio_whatsapp_number,
  };
}

function toWhatsAppAddr(num: string): string {
  const n = num.trim();
  if (n.startsWith("whatsapp:")) return n;
  return `whatsapp:${n.startsWith("+") ? n : `+${n}`}`;
}

export async function sendWhatsApp(
  creds: TwilioCreds,
  to: string,
  body: string,
): Promise<{ ok: boolean; status: number; sid?: string; error?: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
  const form = new URLSearchParams({
    To: toWhatsAppAddr(to),
    From: toWhatsAppAddr(creds.fromNumber),
    Body: body,
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${creds.accountSid}:${creds.authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: JSON.stringify(json) };
  }
  return { ok: true, status: res.status, sid: json.sid };
}

export async function sendEmail(
  apiKey: string | null | undefined,
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  const from = "The Fries Company <onboarding@resend.dev>";
  if (!apiKey) return { ok: false, error: "Resend API key not set in settings" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    return { ok: false, error: `${res.status} ${await res.text()}` };
  }
  return { ok: true };
}

export function pkr(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `Rs. ${v.toLocaleString("en-PK")}`;
}

export function todayPKT(): string {
  // PKT = UTC+5, no DST
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  const ad = new Date(a).getTime();
  const bd = new Date(b).getTime();
  return Math.floor((bd - ad) / (1000 * 60 * 60 * 24));
}

// Authorize an incoming edge-function request.
// Accepts either:
//   1. A valid signed-in user JWT (via SUPABASE_PUBLISHABLE_KEY / anon key), OR
//   2. The SUPABASE_SERVICE_ROLE_KEY as bearer (used by pg_cron scheduled calls).
// Returns { ok: true } if authorized, otherwise a Response to return directly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export async function authorizeRequest(
  req: Request,
): Promise<{ ok: true; userId: string | null } | { ok: false; response: Response }> {
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ ok: false, error: "Unauthorized: missing bearer token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }
  const token = authHeader.slice(7).trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) {
    return { ok: true, userId: null };
  }
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ??
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!url || !anonKey) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ ok: false, error: "Server misconfigured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }
  const supabase = createClient(url, anonKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }
  return { ok: true, userId: data.user.id };
}

// Require the caller to be an admin or staff user (or the service role for
// scheduled/system calls). Uses a service-role client to check user_roles.
export async function requireStaffOrAdmin(
  userId: string | null,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  // Service-role (userId === null) is allowed — pg_cron and internal calls.
  if (userId === null) return { ok: true };
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ ok: false, error: "Server misconfigured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }
  const admin = createClient(url, serviceKey);
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "staff"]);
  if (error || !data || data.length === 0) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ ok: false, error: "Forbidden: admin or staff role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }
  return { ok: true };
}