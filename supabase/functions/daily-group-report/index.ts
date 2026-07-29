// Daily group report.
// Schedule via pg_cron at 15:00 UTC (20:00 PKT) — see docs/migrations/pg-cron-agents.sql.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  corsHeaders,
  daysBetween,
  authorizeRequest,
  requireStaffOrAdmin,
  pkr,
  todayPKT,
} from "../_shared/twilio.ts";
import { metaFromSettings, sendMetaWhatsApp } from "../_shared/meta.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await authorizeRequest(req);
  if (!auth.ok) return auth.response;
  const roleCheck = await requireStaffOrAdmin(auth.userId);
  if (!roleCheck.ok) return roleCheck.response;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const today = todayPKT();

    const { data: settings } = await supabase
      .from("settings")
      .select("*")
      .limit(1)
      .single();

    const meta = metaFromSettings(settings);

    const body = await req.json().catch(() => ({}));
    const isManual = body?.manual === true ||
      req.headers.get("x-manual-trigger") === "true";
    const enabled = settings?.day_end_notification_enabled ?? settings?.daily_report_enabled;
    if (!isManual && !enabled) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "day_end_notification_enabled is off" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const recipient = settings?.whatsapp_report_number ?? settings?.whatsapp_group_number;
    if (!recipient) {
      return new Response(
        JSON.stringify({ ok: false, error: "whatsapp_report_number not set in Settings" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const PACK_SIZE = 2.5;

    // ------------------------------------------------------------------
    // Pull everything we need for the day-end report
    // ------------------------------------------------------------------
    const [
      { data: production },
      { data: deliveries },
      { data: paidToday },
      { data: pending },
      { data: expenses },
      { data: stockRow },
    ] = await Promise.all([
      supabase.from("daily_production").select("*").eq("date", today),
      supabase
        .from("invoices")
        .select("invoice_no, amount, weight_kg, clients(legal_name), branches(branch_name)")
        .eq("delivery_date", today)
        .or("is_deleted.is.null,is_deleted.eq.false"),
      supabase
        .from("invoices")
        .select("amount, amount_received, payment_status, created_at")
        .eq("payment_status", "Done")
        .gte("created_at", today),
      supabase
        .from("invoices")
        .select("amount, due_date, date, payment_status, is_deleted, clients(legal_name)")
        .eq("payment_status", "Not Done")
        .or("is_deleted.is.null,is_deleted.eq.false"),
      supabase.from("expenses").select("*").eq("date", today),
      supabase.from("inventory_stock").select("*").eq("date", today).maybeSingle(),
    ]);

    const prod = production ?? [];
    const dels = deliveries ?? [];
    const exps = expenses ?? [];
    const pend = pending ?? [];

    // Production aggregates
    const sumRaw = prod.reduce((s: number, r: any) => s + Number(r.raw_input_kg ?? 0), 0);
    const sumUsable = prod.reduce((s: number, r: any) => s + Number(r.usable_kg ?? 0), 0);
    const sumExpected = prod.reduce((s: number, r: any) => s + Number(r.packs_produced ?? 0), 0);
    const sumActual = prod.reduce((s: number, r: any) => s + Number(r.actual_packs_produced ?? r.packs_produced ?? 0), 0);
    const wastedKg = sumRaw - sumUsable;
    const wastagePct = sumRaw > 0 ? (wastedKg / sumRaw) * 100 : 0;
    const varianceReasons = prod.map((r: any) => r.variance_reason).filter(Boolean).join(" · ");
    const investigate = prod.some((r: any) => r.ai_flag === "Investigate");
    const hasVariance = prod.some((r: any) =>
      r.actual_packs_produced != null && Number(r.packs_produced) > 0 &&
      ((Number(r.packs_produced) - Number(r.actual_packs_produced)) / Number(r.packs_produced)) * 100 > 5,
    );

    // Deliveries
    const totalDeliveredPacks = dels.reduce((s: number, d: any) => s + Number(d.weight_kg ?? 0) / PACK_SIZE, 0);
    const totalDeliveredKg = dels.reduce((s: number, d: any) => s + Number(d.weight_kg ?? 0), 0);
    const totalInvoicedToday = dels.reduce((s: number, d: any) => s + Number(d.amount ?? 0), 0);

    // Payments
    const collectedToday = (paidToday ?? []).reduce(
      (s: number, p: any) => s + Number(p.amount_received ?? p.amount ?? 0), 0);
    const totalPending = pend.reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
    const overdueRows = pend.filter((p: any) => daysBetween(p.due_date ?? p.date ?? today, today) >= 15);
    const overdueCount = overdueRows.length;
    const overdueNames = Array.from(new Set(overdueRows.map((p: any) => p.clients?.legal_name).filter(Boolean)));

    // Expenses by group
    const sumExp = exps.reduce((s: number, e: any) => s + Number(e.price ?? e.amount ?? 0), 0);
    const groupTotal = (g: string) => exps.filter((e: any) => e.category === g)
      .reduce((s: number, e: any) => s + Number(e.price ?? e.amount ?? 0), 0);
    const fixedOverhead = groupTotal("Fixed Overhead");
    const variableCosts = groupTotal("Variable Costs");
    const oneTime = sumExp - fixedOverhead - variableCosts;

    // Stock
    const closingPacks = Math.max(0, Number(stockRow?.closing_packs ?? 0));

    // P&L
    const net = totalInvoicedToday - sumExp;

    // ------------------------------------------------------------------
    // Build the message
    // ------------------------------------------------------------------
    const dayOfWeek = new Date(today + "T00:00:00").toLocaleDateString("en", { weekday: "long" });
    const fmt = (n: number, d = 1) => n.toLocaleString("en", { maximumFractionDigits: d });
    const lines: string[] = [];

    lines.push("🌙 The Fries Company — Day End Report");
    lines.push(`📅 ${today} | ${dayOfWeek}`);
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━");

    if (prod.length === 0 && dels.length === 0 && exps.length === 0) {
      lines.push("");
      lines.push("⚠️ No production data logged today.");
      lines.push("Please update the Daily Production page.");
    } else {
      lines.push("");
      lines.push("🥔 RAW MATERIAL");
      lines.push(`Input Today: ${fmt(sumRaw)} kg`);
      lines.push(`Usable After Wastage: ${fmt(sumUsable)} kg`);
      lines.push(`Wastage: ${fmt(wastagePct, 1)}% (${fmt(wastedKg)} kg wasted)`);
      if (hasVariance) {
        lines.push(`⚠️ Variance: Expected ${fmt(sumExpected)} packs, Got ${fmt(sumActual)} packs${varianceReasons ? ` — ${varianceReasons}` : ""}`);
      }

      lines.push("");
      lines.push("📦 PRODUCTION");
      lines.push(`Packs Produced Today: ${fmt(sumActual)} packs`);
      lines.push(`Total Weight: ${fmt(sumActual * PACK_SIZE)} kg`);
      if (investigate) lines.push("🚨 Anomaly Detected — check production log");

      lines.push("");
      lines.push("🚚 DELIVERIES TODAY");
      if (dels.length === 0) {
        lines.push("(none)");
      } else {
        for (const d of dels as any[]) {
          const cname = d.clients?.legal_name ?? "—";
          const bname = d.branches?.branch_name ?? "—";
          const kg = Number(d.weight_kg ?? 0);
          lines.push(`• ${cname} (${bname}): ${fmt(kg)} kg / ${fmt(kg / PACK_SIZE)} packs — ${pkr(d.amount)}`);
        }
      }
      lines.push("─────────────────────");
      lines.push(`Total Delivered: ${fmt(totalDeliveredPacks)} packs (${fmt(totalDeliveredKg)} kg)`);
      lines.push(`Total Invoiced Today: ${pkr(totalInvoicedToday)}`);

      lines.push("");
      lines.push("💰 PAYMENTS");
      lines.push(`Collected Today: ${pkr(collectedToday)}`);
      lines.push(`Pending (all time): ${pkr(totalPending)}`);
      lines.push(`Overdue 15+ days: ${overdueCount} invoices`);
      if (overdueCount > 0 && overdueNames.length > 0) {
        lines.push(`⚠️ Overdue clients: ${overdueNames.join(", ")}`);
      }

      lines.push("");
      lines.push("💸 EXPENSES TODAY");
      if (exps.length === 0) {
        lines.push("(none)");
      } else {
        for (const e of exps as any[]) {
          lines.push(`• ${e.subcategory ?? e.category ?? "—"}: ${e.item ?? e.description ?? "—"} — ${pkr(e.price ?? e.amount)}`);
        }
      }
      lines.push("─────────────────────");
      lines.push(`Total Spent Today: ${pkr(sumExp)}`);
      lines.push(`├ Fixed Overhead: ${pkr(fixedOverhead)}`);
      lines.push(`├ Variable Costs: ${pkr(variableCosts)}`);
      lines.push(`└ One-Time: ${pkr(oneTime)}`);

      lines.push("");
      lines.push("🏭 CURRENT STOCK");
      if (closingPacks === 0) {
        lines.push(`In Hand Right Now: 0 packs (0 kg)`);
        lines.push("🔴 OUT OF STOCK — reorder needed");
      } else {
        lines.push(`In Hand Right Now: ${fmt(closingPacks)} packs (${fmt(closingPacks * PACK_SIZE)} kg)`);
        if (closingPacks <= 20) lines.push("⚠️ Stock getting low — plan reorder");
        else lines.push("✅ Stock healthy");
      }

      lines.push("");
      lines.push("📊 TODAY'S P&L SNAPSHOT");
      lines.push(`Revenue: ${pkr(totalInvoicedToday)}`);
      lines.push(`Expenses: ${pkr(sumExp)}`);
      lines.push(`Net: ${pkr(net)}`);
      if (net > 0) lines.push("✅ Profitable day");
      else if (net < 0) lines.push("🔴 Loss today — review expenses");
      else lines.push("➡️ Break even");
    }

    lines.push("");
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━");
    lines.push("— The Fries Company CRM 🏢");

    const msg = lines.join("\n");

    // ------------------------------------------------------------------
    // Send
    // ------------------------------------------------------------------
    const result = await sendMetaWhatsApp(meta, recipient, msg);

    // Optional anomaly DM to sales rep
    let repAlert: any = null;
    if (investigate && settings?.sales_rep_phone) {
      const alertMsg = `🚨 Production anomaly on ${today}\n` +
        `Expected ${fmt(sumExpected)} packs, got ${fmt(sumActual)}.` +
        (varianceReasons ? `\nReason: ${varianceReasons}` : "");
      repAlert = await sendMetaWhatsApp(meta, settings.sales_rep_phone, alertMsg);
    }

    // Mark sent + bookkeeping
    if (result.ok) {
      await supabase
        .from("settings")
        .update({ day_end_last_sent_at: new Date().toISOString() })
        .eq("id", settings.id);
      if (prod.length > 0) {
        await supabase
          .from("daily_production")
          .update({ day_end_sent: true })
          .eq("date", today);
      }
    }

    return new Response(
      JSON.stringify({ ok: result.ok, today, sent: result.ok, id: result.id, error: result.error, repAlert }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[daily-group-report]", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});