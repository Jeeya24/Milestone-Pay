// Invoices. One per milestone, issued the moment its payment has gone the whole way: funded by the client,
// approved by the client, captured, and paid out to the freelancer. The record lives on the payment row
// (payment.invoice) with the names as they were on that day; the document is rendered from it on request.
import * as db from './db.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nameOf = (u) => (u ? u.display_name || u.name || null : null);
const fmtMoney = (minor, cur) => `${(Math.trunc(minor / 100)).toLocaleString('en-US')}.${String(minor % 100).padStart(2, '0')} ${cur}`;
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); };

/** The payment that completed the milestone, or null unless every step is done. */
function settledPayment(m) {
  const d = db.load();
  if (!m || m.status !== 'paid') return null;
  const pay = [...d.payments].reverse().find((p) => p.milestone_id === m.id && p.status === 'CAPTURED' && p.capture_id && p.authorization_id);
  const approved = d.proposals.some((p) => p.milestone_id === m.id && p.action === 'release' && p.status === 'executed' && p.approved_by === 'client');
  return pay && approved && pay.payout_status === 'SENT' ? pay : null;
}

/**
 * Issue the milestone's invoice if it is due and not issued yet. Idempotent; returns the invoice record or null.
 * Needs: funded (authorization), approved by the client (executed release proposal), captured, and paid out (SENT).
 */
export function issueInvoice(milestoneId) {
  const d = db.load();
  const m = d.milestones.find((x) => x.id === milestoneId);
  const pay = settledPayment(m);
  if (!pay) return null;
  if (pay.invoice) return pay.invoice;
  const project = d.projects.find((p) => p.id === m.project_id);
  const agreement = d.agreements.find((a) => a.project_id === m.project_id);
  const member = (role) => d.users.find((u) => u.id === d.project_members.find((x) => x.project_id === m.project_id && x.role === role)?.user_id);
  const at = new Date().toISOString();
  pay.invoice = {
    number: `INV-${at.slice(0, 10).replace(/-/g, '')}-${String(pay.capture_id).replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase()}`,
    issued_at: at,
    freelancer_name: nameOf(member('freelancer')) || project?.freelancer || project?.freelancer_name || 'Freelancer',
    client_name: nameOf(member('client')) || project?.client || 'Client',
    project_title: project?.title || agreement?.body?.title || 'Project',
    label: m.label, title: m.title, criteria: [...(m.criteria || [])],
    amount_minor: m.amount_minor, currency: m.currency,
  };
  db.save();
  db.activity(m.project_id, 'sys', `${m.label}: invoice ${pay.invoice.number} issued`);
  return pay.invoice;
}

/** What the API shows on a milestone: { number, issued_at, url } or null. */
export function invoiceView(m) {
  const inv = settledPayment(m)?.invoice;
  return inv ? { number: inv.number, issued_at: inv.issued_at, url: `/api/milestones/${m.id}/invoice` } : null;
}

/** Everything the document needs, or null when there is no invoice. */
export function invoiceData(milestoneId) {
  const d = db.load();
  const m = d.milestones.find((x) => x.id === milestoneId);
  const pay = settledPayment(m);
  if (!pay?.invoice) return null;
  const when = (event) => d.ledger.find((l) => l.milestone_id === m.id && l.event === event)?.at || null;
  return {
    ...pay.invoice,
    funded_at: when('AUTHORIZED'), approved_at: when('CAPTURED'), paid_out_at: when('PAID_OUT'),
    order_id: pay.order_id, capture_id: pay.capture_id, payout_batch_id: pay.payout_batch_id || null,
  };
}

/** A self-contained HTML document (inline CSS, prints to one page). Every value is escaped. */
export function renderInvoiceHtml(v, { nonce = '' } = {}) {
  const row = (k, val) => (val ? `<tr><th>${esc(k)}</th><td>${esc(val)}</td></tr>` : '');
  const amount = fmtMoney(v.amount_minor, v.currency);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${esc(v.number)}</title>
<style>
  *{box-sizing:border-box} body{margin:0;background:#f5f1ea;color:#1c1a17;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans Thai",Arial,sans-serif}
  .sheet{max-width:760px;margin:32px auto;background:#fff;border:1px solid #e4ddd0;border-radius:12px;padding:48px}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap;margin-bottom:32px}
  .brand{font-weight:700;font-size:18px} h1{font-size:28px;margin:0 0 4px} .muted{color:#6b655c} .small{font-size:13px}
  .paid{display:inline-block;padding:4px 12px;border-radius:999px;background:#e2ede4;color:#23633a;font-weight:600;font-size:13px}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px} .parties b{display:block;font-size:16px;overflow-wrap:anywhere}
  .label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b655c;margin-bottom:4px}
  table{width:100%;border-collapse:collapse} .items th,.items td{text-align:left;padding:12px 0;border-bottom:1px solid #e4ddd0;vertical-align:top}
  .items th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b655c} .num{text-align:right!important;white-space:nowrap;font-variant-numeric:tabular-nums}
  .items ul{margin:6px 0 0;padding-left:18px;color:#4a453d;font-size:14px} .items td:first-child{overflow-wrap:anywhere}
  .total td{border-bottom:0;font-size:18px;font-weight:700;padding-top:16px}
  .meta{margin-top:32px} .meta th{width:250px;padding-right:16px;text-align:left;font-weight:400;color:#6b655c;padding:4px 0;vertical-align:top} .meta td{padding:4px 0;overflow-wrap:anywhere}
  footer{margin-top:32px;padding-top:16px;border-top:1px solid #e4ddd0}
  .bar{max-width:760px;margin:24px auto -16px;display:flex;justify-content:flex-end;padding:0 4px}
  button{font:inherit;font-weight:600;padding:10px 16px;border-radius:8px;border:1px solid #1c1a17;background:#1c1a17;color:#fff;cursor:pointer}
  @media (max-width:600px){.sheet{margin:0;border:0;border-radius:0;padding:24px 20px}.parties{grid-template-columns:1fr;gap:16px}.meta th{width:46%;padding-right:12px}.bar{margin:12px 16px;justify-content:stretch}.bar button{width:100%;min-height:44px}header{margin-bottom:24px}}
  @media print{body{background:#fff}.sheet{margin:0;border:0;max-width:none;padding:0}.bar{display:none}}
</style>
</head>
<body>
<div class="bar"><button type="button" id="print">Print or save as PDF</button></div>
<main class="sheet">
  <header>
    <div><div class="brand">Milestone Pay</div><div class="muted small">Sandbox · test money</div></div>
    <div style="text-align:right"><h1>Invoice</h1><div>${esc(v.number)}</div><div class="muted small">Issued ${esc(fmtDate(v.issued_at))}</div><div style="margin-top:8px"><span class="paid">Paid in full</span></div></div>
  </header>
  <section class="parties">
    <div><div class="label">From (freelancer)</div><b>${esc(v.freelancer_name)}</b></div>
    <div><div class="label">Billed to (client)</div><b>${esc(v.client_name)}</b></div>
  </section>
  <table class="items">
    <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
    <tbody>
      <tr><td><b>${esc(v.label)} · ${esc(v.title)}</b><div class="muted small">${esc(v.project_title)}</div>${v.criteria?.length ? `<ul>${v.criteria.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</td><td class="num">${esc(amount)}</td></tr>
      <tr class="total"><td>Total paid</td><td class="num">${esc(amount)}</td></tr>
    </tbody>
  </table>
  <table class="meta">
    ${row('Funded by the client', fmtDate(v.funded_at))}
    ${row('Work approved by the client', fmtDate(v.approved_at))}
    ${row('Paid out to the freelancer', fmtDate(v.paid_out_at))}
    ${row('Payment method', 'PayPal')}
    ${row('PayPal order', v.order_id)}
    ${row('PayPal capture', v.capture_id)}
    ${row('PayPal payout', v.payout_batch_id)}
  </table>
  <footer class="muted small">The client funded this milestone through Milestone Pay, approved the delivered work, and the amount was paid out to the freelancer’s PayPal account. Nothing further is owed for this milestone.</footer>
</main>
<script${nonce ? ` nonce="${esc(nonce)}"` : ''}>document.getElementById('print').addEventListener('click', function () { window.print(); });</script>
</body>
</html>
`;
}
