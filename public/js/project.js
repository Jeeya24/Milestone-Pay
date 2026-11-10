// 09 Project page, for both roles: totals, next step, milestones, timeline, payment history, deliverables.
import {
  S, el, icon, api, go, link, back, mount, mountKeep, appShell, alertBox, errBox, toast, money, moneyEl, fmtDay, fmtDateTime, fmtDate,
  badge, msBadge, nextStep, stat, progress, msCard, fileRow, poll, names, planBase, curOf, dueOf, plural, emptyState,
  titleOf, editableTitle, chatCard, personChip,
} from './core.js';
import { inviteBox, holdWarning } from './freelancer.js';

const HELD = ['authorized', 'submitted', 'revision_requested'];
const LEDGER = {
  AUTHORIZED: ['held', 'lock', 'Held by Milestone Pay'], CAPTURED: ['released', 'check', 'Released by the client'], PAID_OUT: ['released', 'banknote', 'Sent to PayPal'], VOIDED: ['refunded', 'undo', 'Cancelled · not charged'], REFUNDED: ['refunded', 'undo', 'Refunded'],
};
const P = { refreshed: null, refreshing: false, refreshErr: null, guard: null };

/** The one thing waiting on the viewer, for this project (board 09 note 4). */
export function nextFor(d, role) {
  const { fname, cname } = names(d); const cur = curOf(d); const pid = d.project.id;
  const a = d.agreement;
  if (!a || a.status === 'draft') return role === 'freelancer' ? { text: 'Finish the agreement and send it', sub: 'Fix the gaps, check the amounts, then lock version 1.', btn: 'Review the agreement', to: `/p/${pid}/agreement` } : null;
  if (a.status === 'sent') return role === 'freelancer' ? { ic: 'clock', text: `Waiting for ${cname} to approve the agreement`, sub: 'Approving doesn’t charge them anything.', btn: 'See the agreement', to: `/p/${pid}/agreement` }
    : { ic: 'check', text: 'Check the details, then approve', sub: 'Approving doesn’t charge you anything.', btn: 'Review the agreement', to: `/p/${pid}` };
  const quote = (d.change_requests || []).find((c) => c.status === 'sent');
  const crOpen = (d.change_requests || []).find((c) => c.status === 'open' && c.from === 'client');
  if (role === 'client' && quote) return { ic: 'plus', text: `${fname} priced your request`, sub: `${quote.sent_version?.title || 'New work'} · ${money(quote.sent_version?.amount_minor || 0, cur)}. Accept or decline it.`, btn: 'See the price', to: `/p/${pid}` };
  if (role === 'freelancer' && crOpen) return { ic: 'chat', text: `${cname} requested a change`, sub: 'Check it against the agreement before you reply.', btn: 'Review request', to: `/p/${pid}/changes` };
  const m = d.milestones.find((x) => x.is_current);
  if (!m) return { ic: 'check', text: 'Everything is paid', sub: 'Files and the payment history stay here for both of you.' };
  if (m.status === 'voided') return { ic: 'x', text: `${m.label} was cancelled`, sub: role === 'client' ? 'You weren’t charged for it. Later milestones won’t start.' : `${cname} wasn’t charged. Later milestones won’t start.` };
  if (role === 'client') {
    if (m.status === 'agreed') return { text: `Fund ${m.label} so ${fname} can start`, sub: `${money(m.amount_minor, cur)} · Milestone Pay holds it until you approve the work.`, btn: `Fund ${m.label}`, to: `/p/${pid}` };
    if (m.status === 'submitted') return { ic: 'eye', text: `${fname} delivered ${m.label} · ${m.title}`, sub: `Open the files. If you’re happy, pay ${fname} ${money(m.amount_minor, cur)}.`, btn: `Review ${m.label}`, to: `/p/${pid}/m/${m.id}` };
    if (m.status === 'revision_requested') return { ic: 'clock', text: `${fname} is revising ${m.label}`, sub: 'Your money stays held by Milestone Pay until you approve.' };
    return { ic: 'clock', text: `${fname} is working on ${m.label}`, sub: 'Milestone Pay holds your money. You’ll review the files when they’re delivered.' };
  }
  if (m.status === 'agreed') return { ic: 'clock', text: `Waiting for ${cname} to fund ${m.label}`, sub: `${money(m.amount_minor, cur)}. Start once Milestone Pay holds it.`, btn: `Go to ${m.label}`, to: `/p/${pid}/m/${m.id}` };
  if (m.status === 'submitted') return { ic: 'clock', text: `Waiting for ${cname} to review ${m.label}`, sub: 'The money stays held by Milestone Pay.', btn: `Go to ${m.label}`, to: `/p/${pid}/m/${m.id}` };
  if (m.status === 'revision_requested') return { text: `Revise ${m.label} and send it back`, sub: `${cname} asked for changes.`, btn: `Go to ${m.label}`, to: `/p/${pid}/m/${m.id}` };
  return { text: `Do the work and submit ${m.label}`, sub: `${cname} funded ${money(m.amount_minor, cur)}. It’s held by Milestone Pay.`, btn: `Go to ${m.label}`, to: `/p/${pid}/m/${m.id}` };
}
export const nextCard = (n) => n && nextStep({ ic: n.ic, text: n.text, sub: n.sub, action: n.btn ? link(n.to, { class: 'mp-btn mp-btn--primary' }, n.btn, icon('arrow-right')) : null });

function timeline(d) {
  const ms = d.milestones; const base = planBase(d);
  if (!ms.length) return null;
  let prev = 0;
  const rows = ms.map((m) => { const s = m.start_day ?? prev; const e = Math.max(m.end_day ?? s + 3, s + 1); prev = e; return { m, s, e }; });
  const span = Math.max(1, ...rows.map((r) => r.e));
  const axisDay = (n) => { if (!base) return `Day ${n}`; const x = new Date(base); x.setDate(x.getDate() + n); return fmtDay(x.toISOString()); };
  const ticks = [0, Math.round(span / 4), Math.round(span / 2), Math.round((3 * span) / 4), span];
  return el('div', { class: 'mp-card mp-card--raised' }, el('div', { class: 'mp-card__head' }, el('h2', { class: 'mp-t-section' }, 'Timeline'),
    el('span', { class: 'mp-t-caption mp-muted' }, 'Locked milestones start after the one before is paid')),
  el('div', { class: 'mp-tl' }, el('span'), el('div', { class: 'mp-tl__axis' }, ticks.map((t) => el('span', {}, axisDay(t)))),
    rows.map(({ m, s, e }) => {
      const blocked = m.status === 'agreed' && !m.fundable && !m.is_current;
      const prevM = ms.filter((x) => x.seq < m.seq && x.status !== 'paid').pop();
      const [cls, ic, txt] = m.status === 'paid' ? ['paid', 'check', 'Paid'] : HELD.includes(m.status) ? ['held', 'lock', m.status === 'submitted' ? 'Submitted' : 'Funded · in progress']
        : m.status === 'voided' ? ['blocked', 'x', 'Cancelled'] : blocked ? ['blocked', 'clock', `Waits for ${prevM?.label || 'previous'}`] : ['blocked', 'circle-dashed', 'Not funded'];
      return [el('span', { class: 'mp-t-sm' }, `${m.label} ${m.title}`),
        el('div', { class: 'mp-tl__track' }, el('div', { class: `mp-tl__bar mp-tl__bar--${cls}`, style: `left:${(s / span) * 100}%;width:${Math.max(8, ((e - s) / span) * 100)}%`, title: `${m.label}: ${txt}` }, icon(ic), txt))];
    })));
}

function ledgerCard(d, role) {
  const { fname } = names(d); const cur = curOf(d);
  const rows = [...(d.ledger || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const refresh = el('button', { class: 'mp-btn mp-btn--ghost mp-btn--sm', disabled: P.refreshing, onclick: async () => {
    P.refreshing = true; P.refreshErr = null; draw(d, role, true);
    try { await api(`/api/projects/${d.project.id}/refresh`, { body: {} }); P.refreshed = new Date().toISOString(); d = await api(`/api/projects/${d.project.id}`); }
    catch (e) { P.refreshErr = e; }
    P.refreshing = false; draw(d, role, true);
  } }, icon('refresh'), P.refreshing ? 'Checking with PayPal…' : P.refreshed ? `Updated from PayPal ${fmtDateTime(P.refreshed)}` : 'Check with PayPal');
  return el('div', { class: 'mp-card mp-card--raised mp-card--flush' },
    el('div', { class: 'mp-card__head', style: 'padding:20px 24px 0' }, el('h2', { class: 'mp-t-section' }, 'Payment history'), refresh),
    P.refreshErr ? el('div', { style: 'padding:0 24px' }, alertBox('warn', 'alert', 'Couldn’t reach PayPal. Showing the last saved statuses.')) : null,
    el('div', { class: 'mp-tablewrap' }, el('table', { class: 'mp-table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'When'), el('th', {}, 'Milestone'), el('th', {}, 'What happened'), el('th', { class: 'mp-hide-phone' }, 'PayPal reference'), el('th', { class: 'num' }, 'Amount'))),
      el('tbody', {}, rows.length ? rows.map((l) => {
        const [k, ic, t] = LEDGER[l.event] || ['none', 'info', l.event];
        return el('tr', {}, el('td', { class: 'mp-num' }, fmtDateTime(l.at)), el('td', {}, l.label || ''),
          el('td', {}, el('span', { class: `mp-where mp-where--${k}` }, icon(ic), l.event === 'CAPTURED' ? `Released to ${fname}` : l.event === 'PAID_OUT' ? `Sent to ${fname}’s PayPal` : t)),
          el('td', { class: 'mp-ref mp-hide-phone', title: l.paypal_id || '' }, l.paypal_id || ''), el('td', { class: 'num mp-num mp-strong' }, money(l.amount_minor, cur)));
      }) : el('tr', {}, el('td', { colspan: '5', class: 'mp-muted', style: 'text-align:center;padding:24px' }, icon('banknote'), ' No payments yet.',
        role === 'client' ? ' You fund the first milestone after approving the agreement.' : ` ${names(d).cname} funds the first milestone after approving the agreement.`))))));
}

function deliverablesCard(d) {
  const ms = d.milestones.filter((m) => m.deliverables?.length || ['authorized', 'submitted', 'revision_requested', 'paid'].includes(m.status));
  if (!ms.length) return null;
  return el('div', { class: 'mp-stack mp-stack--4' }, el('h2', { class: 'mp-t-section' }, 'Deliverables'),
    el('div', { class: 'mp-grid-2' }, ms.map((m) => el('div', { class: 'mp-card mp-card--raised mp-stack' },
      el('div', { class: 'mp-row mp-row--between' }, el('b', { class: 'mp-t-sub' }, `${m.label} · ${m.title}`), msBadge(m, true)),
      m.deliverables.length ? el('div', {}, m.deliverables.map((f) => fileRow(f)),
        el('a', { class: 'mp-btn mp-btn--ghost mp-btn--sm', href: `/api/milestones/${m.id}/download-all` }, icon('download'), `Download all (${plural(m.deliverables.length, 'file')}, .zip)`))
        : el('p', { class: 'mp-t-sm mp-muted' }, m.status === 'revision_requested' ? 'Waiting for revised files' : 'No files submitted yet')))));
}

/** Developer-facing demo tooling, folded away (design note: keep raw traces in a debug view only). */
function underTheHood(d) {
  const m = d.milestones.find((x) => x.is_current) || d.milestones.at(-1);
  const out = el('div');
  const g = P.guard;
  if (g?.res) out.append(g.res.result?.error === 'NO_APPROVAL' ? alertBox('success', 'shield', el('b', {}, 'Blocked: NO_APPROVAL. '), 'The agent can’t move money without the client’s approval. PayPal was not called.', el('pre', { class: 'mp-trace' }, String(g.res.trace || '')))
    : alertBox('issue', 'alert', `Unexpected result: ${g.res.result?.error || 'not blocked'}`));
  if (g?.err) out.append(errBox(g.err));
  const runs = [...(d.agent_runs || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 6);
  return el('details', { class: 'mp-card mp-hood' }, el('summary', { class: 'mp-t-sub' }, 'Under the hood (demo)'),
    el('div', { class: 'mp-stack mp-stack--4', style: 'margin-top:16px' },
      el('div', { class: 'mp-stack' }, el('b', { class: 'mp-t-sm' }, 'Safety check'), el('p', { class: 'mp-t-sm mp-muted' }, 'Try to make the agent capture money with a made-up approval. The code must refuse.'),
        el('div', {}, el('button', { class: 'mp-btn mp-btn--secondary mp-btn--sm', disabled: !m || g?.busy, onclick: async () => {
          P.guard = { busy: true }; draw(d, 'freelancer', true);
          try { P.guard = { res: await api('/api/agent/guardrail-test', { body: { milestone_id: m.id } }) }; } catch (e) { P.guard = { err: e }; }
          draw(d, 'freelancer', true);
        } }, icon('shield'), 'Test the guardrail')), out),
      el('div', { class: 'mp-stack' }, el('b', { class: 'mp-t-sm' }, 'Milestone Agent runs'),
        runs.length ? runs.map((r) => el('div', { class: 'mp-t-sm' }, el('b', {}, `${d.milestones.find((x) => x.id === r.milestone_id)?.label || ''} ${r.event}`), ` · ${r.mode === 'fallback' ? 'fixed rules' : 'AI model'} · ${fmtDateTime(r.at)}`,
          el('ol', { class: 'mp-trace-list' }, (r.steps || []).map((s) => el('li', {}, `${s.ok === false ? '✗' : '✓'} ${s.tool}${s.ok === false && s.result?.error ? ` (${s.result.error})` : ''}`)))))
          : el('p', { class: 'mp-t-sm mp-muted' }, 'The agent runs when work is submitted or the client decides.'),
        el('p', { class: 'mp-t-caption mp-muted' }, `AI cost so far: $${Number(d.ai_cost?.cost_usd || 0).toFixed(4)} over ${plural(d.ai_cost?.calls ?? 0, 'AI call')}.`))));
}

export function projectOverview(d, role) {
  P.refreshed = null; P.refreshErr = null; P.guard = null;
  draw(d, role);
  poll(d.project.id, () => d, (x) => { d = x; draw(x, role, true); }, () => P.refreshing);
}
function draw(d, role, keep = false) {
  const { fname, cname } = names(d); const cur = curOf(d); const b = d.agreement?.body || {};
  const ms = d.milestones; const pid = d.project.id;
  const total = ms.reduce((s, m) => s + m.amount_minor, 0);
  const held = ms.filter((m) => HELD.includes(m.status)).reduce((s, m) => s + m.amount_minor, 0);
  const paid = ms.filter((m) => m.status === 'paid').reduce((s, m) => s + m.amount_minor, 0);
  const extra = total - (b.total_minor || total);
  const deadline = (b.terms || []).find((t) => t.key === 'deadline')?.value;
  const voided = ms.find((m) => m.status === 'voided');
  const base = planBase(d);
  const curM = ms.find((m) => m.is_current);
  const shell = appShell(role,
    back(role === 'client' ? '/jobs' : '/projects', role === 'client' ? 'Your jobs' : 'Your projects'),
    el('div', { class: 'mp-row mp-row--between mp-row--top mp-row--wrap', style: 'gap:16px' },
      el('div', { class: 'mp-stack', style: 'gap:6px;min-width:0' },
        role === 'freelancer' ? editableTitle(d, (x) => { d = x; draw(x, role, true); }) : el('h1', { class: 'mp-t-title' }, titleOf(d)),
        el('div', { class: 'mp-row mp-row--wrap mp-t-sm mp-muted', style: 'gap:16px' },
          d.agreement?.status === 'approved' ? badge('success', 'check', `Agreement v${d.agreement.version} · approved by both`) : null,
          personChip(d, role === 'client' ? 'freelancer' : 'client'), deadline ? el('span', { class: 'mp-row' }, icon('calendar'), `Due ${deadline}`) : null)),
      el('div', { class: 'mp-stack', style: 'gap:2px;align-items:flex-end' }, moneyEl(total, cur, 'lg'),
        extra > 0 ? el('span', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, `${money(b.total_minor, cur)} agreed + ${money(extra, cur)} change orders`) : null)),
    voided ? (role === 'client' ? alertBox('info', 'info', el('b', {}, `You cancelled ${voided.label}. `), `You weren’t charged for it.${paid ? ` ${fname} keeps the ${money(paid, cur)} already paid.` : ''}`)
      : alertBox('issue', 'x', el('b', {}, `${cname} cancelled ${voided.label}. `), `The ${money(voided.amount_minor, cur)} hold was cancelled and ${cname} wasn’t charged. Later milestones won’t start.${paid ? ` ${money(paid, cur)} stays paid.` : ''}`)) : null,
    el('div', { class: 'mp-statrow' },
      el('div', { class: 'mp-stat' }, progress(ms)),
      stat('lock', 'Held by Milestone Pay', held, cur),
      stat('check', role === 'client' ? `Paid to ${fname}` : 'Paid to you', paid, cur)),
    curM ? holdWarning(curM, cur, role === 'client' ? fname : cname, role) : null,
    nextCard(nextFor(d, role)),
    role === 'freelancer' ? inviteBox(d) : null,
    chatCard(d, role, (x) => { d = x; draw(x, role, true); }),
    el('div', { class: 'mp-stack mp-stack--3' }, el('div', { class: 'mp-row mp-row--between mp-row--wrap' }, el('h2', { class: 'mp-t-section' }, 'Milestones'),
      el('div', { class: 'mp-row mp-row--wrap' },
        link(`/p/${pid}/agreement`, { class: 'mp-btn mp-btn--ghost mp-btn--sm' }, icon('file'), 'Agreement'),
        role === 'freelancer' ? link(`/p/${pid}/changes`, { class: 'mp-btn mp-btn--ghost mp-btn--sm' }, icon('chat'), 'Change requests') : link(`/p/${pid}/change`, { class: 'mp-btn mp-btn--ghost mp-btn--sm' }, icon('plus'), 'Request a change'),
        role === 'freelancer' ? link(`/p/${pid}/activity`, { class: 'mp-btn mp-btn--ghost mp-btn--sm' }, icon('inbox'), 'Activity') : link(`/p/${pid}`, { class: 'mp-btn mp-btn--ghost mp-btn--sm' }, icon('banknote'), 'Payments'))),
      ms.map((m) => msCard(m, { cur, fname, base, current: m.is_current && m.status !== 'voided', href: `/p/${pid}/m/${m.id}` }))),
    timeline(d), ledgerCard(d, role), deliverablesCard(d),
    role === 'freelancer' ? underTheHood(d) : null);
  (keep ? mountKeep : mount)(shell);
}
export { draw as drawProject, emptyState };
