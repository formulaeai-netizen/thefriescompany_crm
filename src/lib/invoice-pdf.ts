// HTML-based invoice. Renders in a hidden iframe and triggers browser print dialog
// so the user can immediately Save as PDF — no visible new tab / preview page.

export interface InvoicePdfData {
  invoice_no: string;
  date: string;
  due_date: string;
  amount: number;
  amount_received?: number | null;
  item: string | null;
  payment_status: string;
  client_name: string;
  branch_name?: string | null;
  bank_details?: string | null;
  sales_rep_name?: string | null;
  sales_rep_phone?: string | null;
  unit_price?: number | null;
  weight_kg?: number | null;
  city?: string | null;
  // Optional multi-line support. When provided, replaces the single item row.
  lines?: Array<{ item: string; weight_kg?: number | null; unit_price?: number | null; amount: number }>;
}

function fmtNum(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString("en-US");
}

function fmtShortDate(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const dd = String(dt.getDate()).padStart(2, "0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mm = months[dt.getMonth()];
  const yy = dt.getFullYear();
  return `${dd} ${mm} ${yy}`;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

import logoScreenUrl from "@/assets/logo.png";
import logoNavyUrl from "@/assets/logo-light.png";

function toAbsolute(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).toString();
}

export function generateInvoiceHTML(data: InvoicePdfData, _origin?: string): string {
  const logoScreen = toAbsolute(logoScreenUrl);
  const logoPrint = toAbsolute(logoNavyUrl);

  const lines = data.lines && data.lines.length > 0
    ? data.lines
    : [{ item: data.item ?? "—", weight_kg: data.weight_kg ?? null, unit_price: data.unit_price ?? null, amount: Number(data.amount) }];

  const rowsHtml = lines.map((ln) => {
    const w = ln.weight_kg != null ? `${ln.weight_kg} kg` : "—";
    const r = ln.unit_price != null ? `Rs. ${fmtNum(Number(ln.unit_price))}/kg` : "—";
    return `<tr>
      <td>${esc(ln.item || "—")}</td>
      <td>${esc(w)}</td>
      <td>${esc(r)}</td>
      <td class="total-cell">Rs. ${fmtNum(ln.amount)}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice ${esc(data.invoice_no)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800;900&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#12151F;
    --surface:#1B1F2C;
    --surface-2:#232838;
    --orange:#F5A623;
    --orange-deep:#D9861A;
    --paper:#FFFFFF;
    --line:#2B3040;
    --text:#F1F1EC;
    --muted:#9AA0B0;
    --muted-dark:#C4C8D2;
  }
  *{box-sizing:border-box; margin:0; padding:0;}
  body{
    background:#0A0C13;
    font-family:'Inter', sans-serif;
    display:flex; justify-content:center;
    padding:40px 16px;
  }
  .sheet{
    width:820px; max-width:100%;
    background:var(--bg);
    position:relative; overflow:hidden;
    box-shadow:0 30px 70px -24px rgba(0,0,0,0.6);
  }

  .stripes{ display:flex; gap:8px; padding:36px 48px 0; }
  .stripes .bar{ height:12px; border-radius:6px; }
  .stripes .bar:nth-child(1){ width:64px; background:var(--orange); }
  .stripes .bar:nth-child(2){ width:26px; background:var(--surface-2); }
  .stripes .bar:nth-child(3){ width:44px; background:var(--orange-deep); }

  .header{ display:flex; align-items:flex-start; justify-content:space-between; padding:22px 48px 0; }
  .brand{ display:flex; align-items:center; gap:12px; }
  .brand img{ height:52px; width:auto; display:block; }
  .brand .logo-print{ display:none; }

  .meta{ text-align:right; padding-top:4px; }
  .meta .eyebrow{
    font-family:'Sora', sans-serif; font-size:11px; font-weight:700;
    letter-spacing:0.22em; color:var(--orange); text-transform:uppercase; margin-bottom:6px;
  }
  .meta .invno{ font-family:'Sora', sans-serif; font-size:22px; font-weight:800; color:var(--text); }
  .meta .date{ margin-top:8px; font-size:12px; color:var(--muted); }
  .meta .date span{ color:var(--muted-dark); font-weight:600; }

  .wordmark-row{ display:flex; align-items:center; gap:18px; padding:26px 48px 0; }
  .wordmark-row .dash{ width:56px; height:3px; background:var(--orange); position:relative; }
  .wordmark-row .dash::after{ content:""; position:absolute; left:56px; top:0; width:22px; height:3px; background:var(--surface-2); }
  .wordmark{ font-family:'Sora', sans-serif; font-size:52px; font-weight:900; letter-spacing:-0.01em; color:var(--text); line-height:1; }

  .billto-row{
    display:flex; justify-content:space-between; align-items:flex-end;
    padding:38px 48px 22px; border-bottom:1px solid var(--line);
  }
  .eyebrow-label{
    font-family:'Sora', sans-serif; font-size:10.5px; font-weight:700;
    letter-spacing:0.18em; text-transform:uppercase; color:var(--muted); margin-bottom:8px;
  }
  .client-name{
    font-family:'Sora', sans-serif; font-size:26px; font-weight:800; color:var(--orange);
    display:inline-block; border-bottom:3px solid var(--orange-deep); padding-bottom:4px; margin-bottom:8px;
  }
  .client-addr{ font-size:13px; color:var(--muted-dark); line-height:1.5; }
  .billto-right{ text-align:right; }
  .total-preview .amount{ font-family:'Sora', sans-serif; font-size:26px; font-weight:800; color:var(--text); }

  .items{ padding:24px 48px 0; }
  table{ width:100%; border-collapse:collapse; }
  thead th{
    background:var(--surface); color:var(--text);
    font-family:'Sora', sans-serif; font-size:10.5px; font-weight:700;
    letter-spacing:0.12em; text-transform:uppercase; padding:15px 18px; text-align:left;
  }
  thead th:not(:first-child){ text-align:center; }
  tbody td{ padding:16px 18px; font-size:14px; color:var(--muted-dark); border-bottom:1px solid var(--line); }
  tbody td:first-child{ font-weight:600; color:var(--text); }
  tbody td:not(:first-child){ text-align:center; font-variant-numeric:tabular-nums; }
  tbody tr:nth-child(even) td{ background:var(--surface-2); }
  tbody td.total-cell{ font-weight:700; color:var(--orange); }

  .pay-row{ display:flex; justify-content:space-between; align-items:flex-end; gap:24px; padding:34px 48px 0; }
  .eyebrow-label.underline{
    text-decoration:underline; text-decoration-color:var(--line); text-underline-offset:4px;
    color:var(--muted); font-size:11.5px; letter-spacing:0.02em; text-transform:none;
    font-family:'Inter', sans-serif; font-weight:600; margin-bottom:10px;
  }
  .pay-method{ max-width:320px; }
  .pay-line{ font-size:13px; color:var(--muted-dark); margin-bottom:4px; }
  .pay-line span{ font-weight:700; color:var(--text); margin-right:6px; }
  .pay-total{ text-align:right; min-width:260px; }

  .total-bar{
    margin-top:0; background:var(--orange); border-radius:10px;
    padding:20px 26px; display:flex; align-items:center; justify-content:space-between;
    box-shadow:0 14px 26px -10px rgba(245,166,35,0.35);
  }
  .total-bar .label{ font-family:'Sora', sans-serif; font-size:13px; font-weight:700; letter-spacing:0.14em; text-transform:uppercase; color:#12151F; }
  .total-bar .value{ font-family:'Sora', sans-serif; font-size:27px; font-weight:800; color:#12151F; }

  .footer-wrap{ margin-top:44px; position:relative; }
  .footer-band{
    background:var(--surface); padding:22px 48px;
    display:flex; align-items:center; justify-content:space-between; position:relative;
    border-top:1px solid var(--line); overflow:hidden;
  }
  .footer-cut{
    position:absolute; left:0; bottom:0; width:220px; height:100%;
    background:var(--orange); clip-path:polygon(0 0, 100% 100%, 0 100%); z-index:1; opacity:0.9;
  }
  .footer-band .thanks{ position:relative; z-index:2; font-size:12.5px; color:var(--muted-dark); max-width:340px; }
  .footer-band .thanks b{ color:var(--text); }
  .footer-band .contact{ position:relative; z-index:2; text-align:right; font-size:12px; color:var(--muted-dark); line-height:1.7; }
  .footer-band .contact .line{ display:flex; gap:8px; justify-content:flex-end; }
  .footer-band .contact .dot{ color:var(--orange); }

  @media print{
    :root{
      --bg:#FFFFFF;
      --surface:#F4F2EA;
      --surface-2:#FAF8F2;
      --line:#E2DDCE;
      --text:#12151F;
      --muted:#6B675C;
      --muted-dark:#3E3B33;
    }
    body{ background:#FFFFFF; padding:0; }
    .sheet{ box-shadow:none; width:100%; }
    .brand .logo-screen{ display:none; }
    .brand .logo-print{ display:block; }
    .stripes .bar:nth-child(2){ background:#12151F; }
    .wordmark{ color:#12151F; }
    .meta .invno{ color:#12151F; }
    .meta .eyebrow{ color:var(--orange-deep); }
    .total-preview .amount{ color:#12151F; }
    thead th{ background:#12151F; color:#FFFFFF; }
    tbody td{ color:#12151F; }
    tbody td:first-child{ color:#12151F; }
    tbody td.total-cell{ color:var(--orange-deep); }
    .client-name{ color:var(--orange-deep); border-bottom-color:var(--orange); }
    .total-bar{ background:var(--orange); box-shadow:none; }
    .footer-band{ background:#12151F; }
    .footer-band .thanks, .footer-band .contact{ color:#D9D5C8; }
    .footer-band .thanks b{ color:#FFFFFF; }
    * { -webkit-print-color-adjust:exact; print-color-adjust:exact; color-adjust:exact; }
    @page{ size:A4; margin:0; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="stripes">
      <div class="bar"></div><div class="bar"></div><div class="bar"></div>
    </div>

    <div class="header">
      <div class="brand">
        <img class="logo-screen" src="${esc(logoScreen)}" alt="The Fries Company" onerror="this.style.display='none'"/>
        <img class="logo-print" src="${esc(logoPrint)}" alt="The Fries Company" onerror="this.style.display='none'"/>
      </div>
      <div class="meta">
        <div class="eyebrow">Invoice No.</div>
        <div class="invno">${esc(data.invoice_no)}</div>
        <div class="date">Issued <span>${esc(fmtShortDate(data.date))}</span> &nbsp;·&nbsp; Due <span>${esc(fmtShortDate(data.due_date)) || "—"}</span></div>
      </div>
    </div>

    <div class="wordmark-row">
      <div class="wordmark">INVOICE</div>
      <div class="dash"></div>
    </div>

    <div class="billto-row">
      <div>
        <div class="eyebrow-label">Bill To</div>
        <div class="client-name">${esc(data.client_name)}</div>
        <div class="client-addr">${data.branch_name ? esc(data.branch_name) + "<br>" : ""}${data.city ? esc(data.city) : ""}</div>
      </div>
      <div class="billto-right total-preview">
        <div class="eyebrow-label">Total Due</div>
        <div class="amount">Rs. ${fmtNum(data.amount)}</div>
      </div>
    </div>

    <div class="items">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Weight</th>
            <th>Rate</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>

    <div class="pay-row">
      <div class="pay-method">
        <div class="eyebrow-label underline">Payment Method</div>
        <div class="pay-line"><span>Bank Name</span> MEEZAN BANK</div>
        <div class="pay-line"><span>Account No</span> 99370107838498</div>
        <div class="pay-line"><span>Account Title</span> THC CORPORATION</div>
      </div>
      <div class="pay-total">
        <div class="total-bar">
          <div class="label">Total</div>
          <div class="value">Rs. ${fmtNum(data.amount)}</div>
        </div>
      </div>
    </div>

    <div class="footer-wrap">
      <div class="footer-band">
        <div class="footer-cut"></div>
        <div class="thanks">Thank you for your business — <b>The Fries Company</b> | Premium Frozen Foods</div>
        <div class="contact">
          <div class="line"><span class="dot">✆</span> 0332-8328321</div>
          <div class="line"><span class="dot">✉</span> thefriescompanypk@gmail.com</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Direct-download behavior: mount a hidden iframe, wait for it to render, then
 * invoke the browser print dialog on the iframe so the user can "Save as PDF"
 * immediately — no visible new tab or preview page.
 */
export async function downloadInvoicePdf(data: InvoicePdfData): Promise<void> {
  const html = generateInvoiceHTML(data);

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("aria-hidden", "true");
  iframe.title = `Invoice ${data.invoice_no}`;
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error("Unable to prepare invoice for download.");
  }
  doc.open();
  doc.write(html);
  doc.close();

  const trigger = () => {
    try {
      const win = iframe.contentWindow;
      if (!win) return;
      // Set the document title so the saved PDF filename defaults to the invoice number.
      try { win.document.title = `Invoice-${data.invoice_no}`; } catch {}
      win.focus();
      win.print();
    } finally {
      // Clean up after the print dialog closes.
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1500);
    }
  };

  // Give fonts + logo a moment to load so the print output isn't empty.
  const win = iframe.contentWindow;
  if (win && (win as any).document.readyState === "complete") {
    setTimeout(trigger, 350);
  } else {
    iframe.addEventListener("load", () => setTimeout(trigger, 350), { once: true });
    // Safety fallback in case load never fires.
    setTimeout(trigger, 1200);
  }
}