// Meta WhatsApp incoming webhook — bank slip OCR + auto-match.
// Public endpoint: no JWT verification (Meta calls it directly).
// Configure verify_jwt = false in supabase/config.toml for this function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/twilio.ts";
import { metaFromSettings, sendMetaWhatsApp } from "../_shared/meta.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function extractAmount(text: string): number | null {
  // Rs. 12,345.67  |  PKR 12345  |  Amount: 12,345
  const patterns = [
    /(?:Rs\.?|PKR|Rupees)\s*([\d,]+(?:\.\d{1,2})?)/i,
    /Amount[:\s]+([\d,]+(?:\.\d{1,2})?)/i,
    /Total[:\s]+([\d,]+(?:\.\d{1,2})?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const v = Number(m[1].replace(/,/g, ""));
      if (!Number.isNaN(v) && v > 0) return v;
    }
  }
  return null;
}

function extractTxnId(text: string): string | null {
  const patterns = [
    /(?:TXN|Transaction|Ref(?:erence)?|TRN)[\s#:.]*([A-Z0-9\-]{6,})/i,
    /\b([A-Z0-9]{10,})\b/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractDate(text: string): string | null {
  const m = text.match(/(\d{1,2}[\/\-.](?:\d{1,2}|[A-Za-z]{3,9})[\/\-.]\d{2,4})/);
  return m ? m[1] : null;
}

function last10(s: string | null | undefined): string {
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  return digits.slice(-10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---------- GET: Meta webhook verification ----------
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const { data: settings } = await supabase
      .from("settings")
      .select("meta_verify_token")
      .limit(1)
      .single();
    if (mode === "subscribe" && token && token === settings?.meta_verify_token) {
      return new Response(challenge ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // ---------- POST: incoming message ----------
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const change = payload?.entry?.[0]?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    if (!message) return json({ ok: true, ignored: "no_message" });

    const from: string = message.from ?? "";

    const { data: settings } = await supabase
      .from("settings")
      .select("*")
      .limit(1)
      .single();
    const meta = metaFromSettings(settings);

    if (message.type !== "image") {
      await sendMetaWhatsApp(
        meta,
        from,
        "Please send a clear photo of the bank transfer slip so we can match your payment.",
      ).catch(() => {});
      return json({ ok: true, ignored: "not_image" });
    }

    const imageId: string | undefined = message.image?.id;
    if (!imageId) return json({ ok: false, error: "missing image id" }, 400);

    // 1. Resolve media URL from Meta
    const mediaMetaRes = await fetch(`https://graph.facebook.com/v19.0/${imageId}`, {
      headers: { Authorization: `Bearer ${meta.accessToken}` },
    });
    if (!mediaMetaRes.ok) throw new Error(`Meta media metadata failed: ${await mediaMetaRes.text()}`);
    const mediaMeta = await mediaMetaRes.json();
    const mediaUrl: string = mediaMeta.url;

    // 2. Download the image bytes with same auth
    const imgRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${meta.accessToken}` },
    });
    if (!imgRes.ok) throw new Error(`Meta media download failed: ${imgRes.status}`);
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    const base64 = bytesToBase64(imgBytes);

    // 3. Google Vision OCR
    const visionKey = Deno.env.get("GOOGLE_VISION_API_KEY");
    if (!visionKey) throw new Error("GOOGLE_VISION_API_KEY not set in edge function secrets");
    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${visionKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content: base64 },
            features: [{ type: "TEXT_DETECTION" }],
          }],
        }),
      },
    );
    const visionJson = await visionRes.json();
    const ocrText: string = visionJson?.responses?.[0]?.fullTextAnnotation?.text ?? "";

    // 4. Regex extraction
    const extractedAmount = extractAmount(ocrText);
    const extractedTxn = extractTxnId(ocrText);
    const extractedDate = extractDate(ocrText);

    // 5. Match sender to client
    const senderLast10 = last10(from);
    const { data: clients } = await supabase
      .from("clients")
      .select("id, legal_name, phone");
    const client = (clients ?? []).find((c: any) => last10(c.phone) === senderLast10) ?? null;

    // 6. Load unpaid invoices for this client
    let unpaid: any[] = [];
    if (client) {
      const { data } = await supabase
        .from("invoices")
        .select("id, invoice_no, amount")
        .eq("client_id", client.id)
        .eq("payment_status", "Not Done")
        .or("is_deleted.is.null,is_deleted.eq.false");
      unpaid = data ?? [];
    }

    // 7. Match
    let match_status: "Matched" | "Partial Match" | "Mismatch" | "Unreadable" = "Unreadable";
    let matchedInvoice: any = null;
    let match_notes = "";

    if (extractedAmount == null) {
      match_status = "Unreadable";
      match_notes = "Could not read amount from slip";
    } else if (!client) {
      match_status = "Mismatch";
      match_notes = `Unknown sender (${from}); no client with matching phone`;
    } else if (unpaid.length === 0) {
      match_status = "Mismatch";
      match_notes = `${client.legal_name} has no unpaid invoices`;
    } else {
      // Pick invoice with smallest diff
      let best: { inv: any; diff: number } | null = null;
      for (const inv of unpaid) {
        const diff = Math.abs(Number(inv.amount) - extractedAmount);
        if (!best || diff < best.diff) best = { inv, diff };
      }
      matchedInvoice = best!.inv;
      if (best!.diff <= 50) match_status = "Matched";
      else if (best!.diff <= 500) match_status = "Partial Match";
      else match_status = "Mismatch";
      match_notes = `Amount ${extractedAmount} vs invoice ${matchedInvoice.invoice_no} (${matchedInvoice.amount}); diff ${best!.diff}`;
    }

    // 8. Save proof
    await supabase.from("payment_screenshots").insert({
      client_id: client?.id ?? null,
      invoice_id: matchedInvoice?.id ?? null,
      whatsapp_from: from,
      image_url: mediaUrl,
      extracted_amount: extractedAmount,
      extracted_transaction_id: extractedTxn,
      extracted_date: extractedDate,
      match_status,
      matched_invoice_no: matchedInvoice?.invoice_no ?? null,
      match_notes,
      uploaded_by: "whatsapp-customer",
      raw_vision_response: JSON.stringify({ text: ocrText }).slice(0, 8000),
    });

    // 9. Reply to customer
    let replyBody = "";
    if (match_status === "Matched") {
      replyBody =
        `✅ Payment received!\n` +
        `Invoice ${matchedInvoice.invoice_no} — Rs. ${Number(matchedInvoice.amount).toLocaleString("en-PK")}\n` +
        `Thank you for your payment. Our team will confirm shortly.`;
    } else if (match_status === "Partial Match") {
      replyBody =
        `Received your slip.\n` +
        `We matched it to Invoice ${matchedInvoice.invoice_no} but the amount doesn't fully match.\n` +
        `Extracted: Rs. ${extractedAmount}\nInvoice: Rs. ${matchedInvoice.amount}\n` +
        `Our team will verify and get back to you.`;
    } else if (match_status === "Unreadable") {
      replyBody = `We received your slip but couldn't read the amount clearly. Please resend a sharper photo.`;
    } else {
      replyBody = `Received your slip. Our team will review and confirm shortly.`;
    }
    await sendMetaWhatsApp(meta, from, replyBody).catch(() => {});

    // 10. Alert sales rep on success
    if ((match_status === "Matched" || match_status === "Partial Match") && settings?.sales_rep_phone) {
      const alert =
        `💰 Payment slip received (${match_status})\n` +
        `Client: ${client?.legal_name ?? "—"}\n` +
        `Invoice: ${matchedInvoice?.invoice_no ?? "—"} (Rs. ${matchedInvoice?.amount ?? "—"})\n` +
        `Extracted amount: Rs. ${extractedAmount}\n` +
        `Txn: ${extractedTxn ?? "—"}\n` +
        `From: ${from}`;
      await sendMetaWhatsApp(meta, settings.sales_rep_phone, alert).catch(() => {});
    }

    return json({ ok: true, match_status, invoice: matchedInvoice?.invoice_no ?? null });
  } catch (e) {
    console.error("[whatsapp-incoming-webhook]", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});