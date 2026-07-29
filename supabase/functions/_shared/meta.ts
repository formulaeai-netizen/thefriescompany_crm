// Meta WhatsApp Business Cloud API helpers.
// Credentials are read from the settings table by the caller and passed in.

export interface MetaCreds {
  phoneNumberId: string;
  accessToken: string;
}

export function metaFromSettings(s: {
  meta_phone_number_id?: string | null;
  meta_access_token?: string | null;
} | null | undefined): MetaCreds {
  if (!s?.meta_phone_number_id || !s?.meta_access_token) {
    throw new Error(
      "Meta WhatsApp credentials missing. Please fill Meta Phone Number ID and Meta Access Token on the Settings page.",
    );
  }
  return {
    phoneNumberId: s.meta_phone_number_id,
    accessToken: s.meta_access_token,
  };
}

function normalizePhone(n: string): string {
  let v = n.trim();
  if (v.startsWith("whatsapp:")) v = v.slice("whatsapp:".length);
  v = v.replace(/[^\d+]/g, "");
  if (v.startsWith("+")) v = v.slice(1);
  return v;
}

export async function sendMetaWhatsApp(
  creds: MetaCreds,
  to: string,
  body: string,
): Promise<{ ok: boolean; status: number; id?: string; error?: string; raw?: unknown }> {
  const url = `https://graph.facebook.com/v19.0/${creds.phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: normalizePhone(to),
    type: "text",
    text: { body },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, status: res.status, error: JSON.stringify(json), raw: json };
  }
  const id = json?.messages?.[0]?.id;
  return { ok: true, status: res.status, id, raw: json };
}