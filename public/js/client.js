// Client screens: 01b Your jobs, 04 approve agreement, 05 payments + fund, 07 review and pay, 08 request a change / answer a price.
import {
  S, el, icon, api, go, link, back, mount, mountKeep, appShell, pageHead, alertBox, errBox, loading, skeleton, toast, confirmDialog,
  money, moneyEl, fmtNum, fmtDate, fmtDay, plural, initial, badge, msBadge, projectBadge, nextStep, emptyState, stat, progress, msCard, fileRow,
  poll, stopPoll, names, planBase, curOf, sandboxNote, titleOf, chatCard, personChip, invoiceLinks,
} from './core.js';
import { notesBox, holdWarning, projectActions, archivedList } from './freelancer.js';
import { nextFor, nextCard } from './project.js';

const C = { busy: false, flash: null, crText: '', noteText: '', revText: '' };
const flash = () => { const f = C.flash; C.flash = null; return f; };

// ---------------------------------------------------------------- 01b Your jobs
export async function viewJobs() {
  mount(appShell('client', pageHead('Your jobs'), skeleton()));
  let data;
  try { data = await api('/api/projects'); S.projects = data; }
  catch (e) { return mount(appShell('client', pageHead('Your jobs'), errBox(e))); }
  const allJobs = data.projects.filter((p) => p.my_role === 'client');
  const jobs = allJobs.filter((p) => !p.archived);
  const archived = allJobs.filter((p) => p.archived);
  if (!allJobs.length) {
    return mount(appShell('client', pageHead('Your jobs'),
      emptyState({ ic: 'briefcase', title: 'No jobs yet', text: 'When a freelancer sends you an agreement link, open it and the job shows up here, along with everything you fund and pay.' })));
  }
  const ongoing = jobs.filter((p) => !['completed', 'stopped'].includes(p.status));
  const past = jobs.filter((p) => ['completed', 'stopped'].includes(p.status));
  const cur = jobs.find((p) => p.currency)?.currency;
  // the one thing waiting on the client, across jobs
  const pick = ongoing.find((p) => p.current?.status === 'submitted') || ongoing.find((p) => p.agreement_status === 'sent')
    || ongoing.find((p) => p.open_change_request?.status === 'sent') || ongoing.find((p) => p.current?.fundable);
  let next = null;
  if (pick) {
    const c = pick.current;
    next = c?.status === 'submitted' ? nextStep({ ic: 'eye', text: `${pick.freelancer} delivered ${c.label} · ${c.title}`, sub: `Open the files. If you’re happy, pay ${pick.freelancer} ${money(c.amount_minor, pick.currency)}.`, action: link(`/p/${pick.id}/m/${c.id}`, { class: 'mp-btn mp-btn--primary' }, `Review ${c.label}`, icon('arrow-right')) })
      : pick.agreement_status === 'sent' ? nextStep({ ic: 'check', text: `${pick.freelancer}’s agreement is waiting for you`, sub: `${pick.title} · ${money(pick.total_minor, pick.currency)}. Approving doesn’t charge you.`, action: link(`/p/${pick.id}`, { class: 'mp-btn mp-btn--primary' }, 'Review the agreement', icon('arrow-right')) })
        : pick.open_change_request?.status === 'sent' ? nextStep({ ic: 'plus', text: `${pick.freelancer} priced your request`, sub: 'Accept or decline it.', action: link(`/p/${pick.id}`, { class: 'mp-btn mp-btn--primary' }, 'See the price', icon('arrow-right')) })
          : nextStep({ text: `Fund ${c.label} so ${pick.freelancer} can start`, sub: `${money(c.amount_minor, pick.currency)} · Milestone Pay holds it until you approve the work.`, action: link(`/p/${pick.id}`, { class: 'mp-btn mp-btn--primary' }, `Fund ${c.label}`, icon('arrow-right')) });
  }
  const row = (p) => el('div', { class: 'mp-card mp-card--raised mp-jobrow', 'data-project': p.id },
    el('div', { class: 'mp-jobrow__main' },
      el('div', { class: 'mp-stack', style: 'gap:6px;min-width:0' },
        el('div', { class: 'mp-row mp-row--wrap' }, link(`/p/${p.id}`, { class: 'mp-t-sub mp-link-plain' }, p.title || 'Job'),
          p.current?.status === 'submitted' ? badge('pending', 'inbox', `${p.current.label} ready to review`) : p.agreement_status === 'sent' ? badge('pending', 'file', 'Agreement to approve') : projectBadge(p)),
        el('div', { class: 'mp-row mp-row--wrap mp-t-sm mp-muted', style: 'gap:16px' }, el('span', { class: 'mp-row' }, icon('user'), p.freelancer || 'Freelancer'),
          p.deadline ? el('span', { class: 'mp-row' }, icon('calendar'), `Due ${p.deadline}`) : null)),
      el('div', { class: 'mp-jobrow__money' }, moneyEl(p.total_minor, p.currency, 'md'),
        el('div', { class: 'mp-progress' }, el('div', { class: 'mp-progress__label' }, el('span', {}, el('b', {}, `${p.paid_count} of ${p.milestones.length}`), ' paid'), p.held_minor ? el('span', {}, `${fmtNum(p.held_minor)} held`) : null),
          el('div', { class: 'mp-progress__bar' }, p.milestones.map((m) => el('span', { class: `mp-progress__seg ${m.status === 'paid' ? 'mp-progress__seg--paid' : ['authorized', 'submitted', 'revision_requested'].includes(m.status) ? 'mp-progress__seg--held' : ''}` }))))),
      el('div', { class: 'mp-jobrow__actions' }, link(`/p/${p.id}`, { class: 'mp-btn mp-btn--secondary', 'aria-label': `Open ${p.title || 'job'}` }, 'Open', icon('arrow-right')), projectActions(p, viewJobs))));
  mount(appShell('client', pageHead('Your jobs', 'Everything you’ve agreed, funded and paid, in one place.'),
    next,
    el('div', { class: 'mp-grid-3' },
      stat('lock', 'Held by Milestone Pay', data.client_totals.held_minor, cur, 'Your money, waiting for you to approve the work.'),
      stat('check', 'Paid to freelancers', data.client_totals.paid_minor, cur, 'Across all your jobs.'),
      el('div', { class: 'mp-stat' }, el('span', { class: 'mp-row mp-t-sm mp-muted' }, icon('briefcase'), 'Jobs'),
        el('span', { class: 'mp-stat__value mp-num' }, String(ongoing.length), el('small', {}, 'ongoing')), el('span', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, `${past.length} past`))),
    ongoing.length ? el('div', { class: 'mp-stack mp-stack--3' }, el('h2', { class: 'mp-t-section' }, `Ongoing · ${ongoing.length}`), ongoing.map(row)) : null,
    past.length ? el('div', { class: 'mp-stack mp-stack--3' }, el('h2', { class: 'mp-t-section' }, `Past · ${past.length}`),
      el('div', { class: 'mp-card mp-card--raised mp-card--flush mp-tablewrap' }, el('table', { class: 'mp-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Job'), el('th', {}, 'Status'), el('th', { class: 'num' }, 'Total'), el('th'))),
        el('tbody', {}, past.map((p) => el('tr', {}, el('td', {}, el('b', {}, p.title || 'Job'), el('div', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, p.freelancer || '')),
          el('td', {}, p.status === 'completed' ? badge('success', 'check', 'Completed') : badge('neutral', 'x', 'Cancelled')),
          el('td', { class: 'num mp-num mp-strong' }, `${money(p.paid_minor, p.currency)} ${p.status === 'completed' ? 'paid' : 'paid'}`),
          el('td', { style: 'width:1%' }, el('div', { class: 'mp-row', style: 'flex-wrap:nowrap;gap:0' }, link(`/p/${p.id}/project`, { class: 'mp-btn mp-btn--ghost mp-btn--sm' }, 'View'), projectActions(p, viewJobs))))))))) : null,
    archivedList(archived, row),
    sandboxNote()));
}

// ---------------------------------------------------------------- client project entry: 04 or 05
export function viewClientProject(d) {
  if (!d.agreement || d.agreement.status === 'draft') {
    stopPoll();
    mount(appShell('client', back('/jobs', 'Your jobs'),
      emptyState({ ic: 'link', title: 'Nothing here yet', text: `${names(d).fname} hasn’t shared an agreement with you. Check the link they sent, or ask them to send it again.` })));
    poll(d.project.id, () => d, (x) => viewClientProject(x));
    return;
  }
  if (d.agreement.status === 'sent') return viewApprove(d);
  return viewPayments(d);
}
const caption = (d) => { const { fname } = names(d); return el('span', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, `${S.me?.client_type === 'business' && S.me?.display_name ? `${S.me.display_name} · ` : ''}${titleOf(d)} · from ${fname}`); };

// ---------------------------------------------------------------- 04 Approve agreement
function viewApprove(d, keep = false) {
  const { fname } = names(d); const cur = curOf(d); const b = d.agreement.body; const ms = d.milestones;
  const term = (k) => (b.terms || []).find((t) => t.key === k)?.value;
  const err = el('div');
  const approve = el('button', { class: 'mp-btn mp-btn--primary mp-btn--block', id: 'approveAgreement', onclick: async () => {
    const ok = await confirmDialog({ icon: 'check', title: 'Approve this agreement?', text: `You agree to these terms with ${fname}. Approving doesn’t charge you. You fund each milestone separately.`,
      summary: { label: 'Total', minor: b.total_minor, cur }, rows: [['With', fname], ['Milestones', `${ms.length}`], ['Deadline', term('deadline') || 'Not set']], confirm: 'Approve agreement', cancel: 'Go back' });
    if (!ok) return;
    approve.disabled = true;
    try { await api(`/api/agreements/${d.agreement.id}/approve`, { body: { content_hash: d.agreement.content_hash } }); C.flash = 'approved'; d = await api(`/api/projects/${d.project.id}`); viewPayments(d); }
    catch (e) { approve.disabled = false; err.replaceChildren(errBox(e)); }
  } }, 'Approve agreement');
  const openNote = async () => {
    const ta = el('textarea', { class: 'mp-input', rows: 3, maxlength: 500, id: 'noteText', placeholder: 'Does this price include photographing the menu?' });
    const ok = await confirmDialog({ title: `Send ${fname} a note`, text: `Ask about anything before you approve. ${fname} sees it on the agreement page.`,
      body: el('div', { class: 'mp-field' }, el('label', { class: 'mp-label', for: 'noteText' }, 'Your note'), ta), confirm: 'Send note', confirmIcon: 'send', cancel: 'Back to agreement', cancelClass: 'mp-btn--ghost' });
    if (!ok) return;
    try { await api(`/api/agreements/${d.agreement.id}/notes`, { body: { text: ta.value } }); C.flash = 'note'; viewApprove(await api(`/api/projects/${d.project.id}`)); }
    catch (e) { toast(e.message, 'alert'); }
  };
  const f = flash();
  (keep ? mountKeep : mount)(appShell('client', back('/jobs', 'Your jobs'),
    el('div', { class: 'mp-narrow mp-stack mp-stack--4' },
      el('div', { class: 'mp-stack', style: 'gap:2px' }, caption(d), el('h1', { class: 'mp-t-title' }, b.title || 'Agreement')),
      f === 'note' ? alertBox('success', 'check', el('b', {}, `Note sent to ${fname}. `), 'You’ll see the reply here. Nothing is approved or charged yet.')
        : nextStep({ ic: 'check', text: 'Check the details, then approve', sub: 'Approving doesn’t charge you anything.' }),
      el('div', { class: 'mp-card mp-card--raised mp-stack mp-stack--4' },
        term('scope') ? el('div', {}, el('span', { class: 'mp-t-caption mp-muted' }, 'What you get'), el('p', {}, term('scope'))) : null,
        el('div', {}, el('span', { class: 'mp-t-caption mp-muted' }, 'Total price'), el('div', {}, moneyEl(b.total_minor, cur, 'lg')),
          el('p', { class: 'mp-t-sm mp-muted' }, `Paid in ${plural(ms.length, 'part')}. You pay each part only after you approve that work.`)),
        el('div', { class: 'mp-grid-2' },
          el('div', {}, el('span', { class: 'mp-t-caption mp-muted' }, 'Deadline'), el('p', { class: 'mp-strong' }, term('deadline') || 'Not set')),
          el('div', {}, el('span', { class: 'mp-t-caption mp-muted' }, 'Revisions'), el('p', { class: 'mp-strong' }, term('revisions') || 'Not set')))),
      el('div', { class: 'mp-summary' }, ms.map((m) => el('div', { class: 'mp-summary__row' }, el('span', {}, `${m.label} · ${m.title}`), el('span', { class: 'mp-num' }, money(m.amount_minor, cur))))),
      el('details', { class: 'mp-card mp-stack' }, el('summary', { class: 'mp-t-sub' }, 'What each milestone includes'),
        ms.map((m) => el('div', { style: 'margin-top:12px' }, el('b', { class: 'mp-t-sm' }, `${m.label} · ${m.title}`), el('ul', { class: 'mp-ms__crit' }, (m.criteria || []).map((c) => el('li', {}, c)))))),
      el('div', { class: 'mp-row mp-row--between mp-row--wrap mp-t-caption mp-muted', style: 'font-weight:400' }, el('span', { class: 'mp-row' }, icon('lock'), `Version ${d.agreement.version} · locked by ${fname}`), personChip(d, 'freelancer', { label: `About ${fname}` })),
      notesBox(d, 'client'),
      el('div', { class: 'mp-stack mp-sticky-cta' }, approve,
        el('button', { class: 'mp-btn mp-btn--ghost mp-btn--block', onclick: openNote }, `Something’s wrong? Message ${fname}`)), err)));
  poll(d.project.id, () => d, (x) => { if (x.agreement?.status !== 'sent') viewClientProject(x); else viewApprove(x, true); });
}

// ---------------------------------------------------------------- 05 Payments + fund
let sdkPromise = null;
function loadPayPalSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (!S.cfg?.paypal_client_id) return reject(new Error('PayPal isn’t set up on this server yet.'));
    const q = new URLSearchParams({ 'client-id': S.cfg.paypal_client_id, intent: 'authorize', currency: S.cfg.api_currency || S.cfg.currency || 'USD', components: 'buttons', 'disable-funding': 'card,credit,paylater,venmo' });
    const nonce = document.querySelector('meta[name="csp-nonce"]')?.content || '';
    const s = el('script', { src: `https://www.paypal.com/sdk/js?${q}`, 'data-csp-nonce': nonce || null });
    if (nonce) s.nonce = nonce;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('The PayPal button didn’t load.')));
    s.onerror = () => reject(Object.assign(new Error('Couldn’t reach PayPal. Check your connection and try again. Nothing was charged.'), { code: 'PP_UNREACHABLE' }));
    document.head.append(s);
  }).catch((e) => { sdkPromise = null; throw e; });
  return sdkPromise;
}
function fundBlock(m, d) {
  const { fname } = names(d); const cur = curOf(d);
  const host = el('div', { class: 'mp-pp-host' }, loading('Loading the PayPal button…'));
  const msg = el('div');
  const say = (node) => msg.replaceChildren(node || '');
  const helper = el('div');
  (async () => {
    let pp;
    try { pp = await loadPayPalSdk(); } catch (e) { host.replaceChildren(); return say(alertBox('issue', 'refresh', el('b', {}, 'Couldn’t reach PayPal. '), e.message.replace(/^Couldn’t reach PayPal\.\s*/, ''))); }
    host.replaceChildren();
    try {
      await pp.Buttons({
        style: { layout: 'vertical', shape: 'pill', label: 'paypal', height: 48 },
        createOrder: async () => { say(); const r = await api(`/api/milestones/${m.id}/order`, { body: {} }); return r.order_id; },
        onApprove: async (data) => {
          host.replaceChildren(loading('Confirming with PayPal…'));
          try {
            await api(`/api/milestones/${m.id}/authorize`, { body: { order_id: data.orderID } });
            toast(`${money(m.amount_minor, cur)} is now held by Milestone Pay. ${fname} can start.`, 'lock');
            viewPayments(await api(`/api/projects/${d.project.id}`));
          } catch (e) { viewPayments(await api(`/api/projects/${d.project.id}`).catch(() => d)); toast(`${e.message} ${m.label} is still unfunded. You can try again.`, 'alert'); }
        },
        onCancel: () => say(alertBox('issue', 'alert', el('b', {}, 'PayPal didn’t finish. '), 'The window was closed before you confirmed. ', el('b', {}, 'Nothing was charged.'))),
        onError: () => say(alertBox('issue', 'alert', el('b', {}, 'PayPal couldn’t use that card or account. '), 'Nothing was charged. Try another payment method in the PayPal window.')),
      }).render(host);
    } catch (e) { say(alertBox('issue', 'alert', `Couldn’t show the PayPal button: ${e.message}`)); }
    try {
      const l = await api('/api/sandbox-login');
      if (l.email) helper.replaceChildren(el('details', { class: 'mp-testbuyer' }, el('summary', { class: 'mp-t-caption mp-muted' }, 'Test buyer login (sandbox, fake money)'),
        el('div', { class: 'mp-summary', style: 'margin-top:8px' }, el('div', { class: 'mp-summary__row' }, el('span', {}, 'Email'), el('code', {}, l.email)), el('div', { class: 'mp-summary__row' }, el('span', {}, 'Password'), el('code', {}, l.password)))));
    } catch { /* not localhost */ }
  })();
  const usd = (S.cfg?.api_currency || 'USD') !== cur ? alertBox('warn', 'info', el('b', {}, `PayPal will hold this in ${S.cfg.api_currency}. `), 'Your bank may add a conversion fee.') : null;
  return el('div', { class: 'mp-stack mp-stack--3', style: 'margin-top:12px' }, usd, msg, el('div', { class: 'mp-paypal' }, host, el('div', { class: 'mp-paypal__note' }, 'Milestone Pay holds this amount. It’s paid out only when you approve the work.')), helper);
}
function quoteCard(c, d) {
  const { fname } = names(d); const cur = curOf(d); const sv = c.sent_version || {};
  const total = d.milestones.reduce((s, m) => s + m.amount_minor, 0);
  const decide = async (accept) => {
    if (accept) {
      const ok = await confirmDialog({ icon: 'plus', title: `Add ${sv.label || 'this part'} for ${money(sv.amount_minor || 0, cur)}?`, text: 'Nothing is charged now. You fund it after the parts before it, like the others.',
        summary: { label: 'Adds', minor: sv.amount_minor || 0, cur }, rows: [['Part', `${sv.label || ''} · ${sv.title || ''}`], ['From', fname], ['Project total', money(total + (sv.amount_minor || 0), cur)]], confirm: `Add ${sv.label || 'part'}` });
      if (!ok) return;
    }
    C.busy = true;
    try { const r = await api(`/api/change-requests/${c.id}/decide`, { body: { accept } }); C.flash = accept ? `added:${r.milestone?.label || ''}` : 'declined'; }
    catch (e) { toast(e.message, 'alert'); }
    C.busy = false;
    viewPayments(await api(`/api/projects/${d.project.id}`));
  };
  return el('div', { class: 'mp-card mp-card--current mp-stack mp-stack--3' },
    el('div', { class: 'mp-row mp-row--between mp-row--wrap' }, el('span', { class: 'mp-t-caption mp-muted' }, c.from === 'client' ? `${fname}’s price for your request` : `${fname} proposed new work`), badge('pending', 'plus', 'Not in agreement')),
    el('b', { class: 'mp-t-sub' }, `${sv.label || ''} · ${sv.title || ''}`), moneyEl(sv.amount_minor || 0, cur, 'lg'),
    el('ul', { class: 'mp-ms__crit' }, (sv.deliverables || []).map((x) => el('li', {}, x))),
    el('p', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, `If you accept, this becomes ${sv.label || 'a new part'}. You fund it separately, after the parts before it.`),
    el('button', { class: 'mp-btn mp-btn--primary mp-btn--block', disabled: C.busy, onclick: () => decide(true) }, `Accept ${money(sv.amount_minor || 0, cur)}`),
    el('button', { class: 'mp-btn mp-btn--secondary mp-btn--block', disabled: C.busy, onclick: () => decide(false) }, 'Decline'));
}
export function viewPayments(d, keep = false) {
  const { fname } = names(d); const cur = curOf(d); const ms = d.milestones; const pid = d.project.id; const base = planBase(d);
  const held = ms.filter((m) => ['authorized', 'submitted', 'revision_requested'].includes(m.status)).reduce((s, m) => s + m.amount_minor, 0);
  const total = ms.reduce((s, m) => s + m.amount_minor, 0);
  const quote = (d.change_requests || []).find((c) => c.status === 'sent' && c.sent_version);
  const openReq = (d.change_requests || []).find((c) => c.status === 'open' && c.from === 'client');
  const curM = ms.find((m) => m.is_current);
  const f = flash();
  const lastPaid = [...ms].reverse().find((m) => m.status === 'paid');
  const banner = f === 'approved' ? alertBox('success', 'check', el('b', {}, `Agreement approved by you and ${fname}. `), 'Nothing has been charged.')
    : f === 'declined' ? alertBox('info', 'x', 'Declined. The agreement stays as it was.')
      : f?.startsWith('added:') ? alertBox('success', 'check', el('b', {}, `${f.slice(6)} added. `), 'Nothing was charged. You fund it after the parts before it.')
        : f === 'paid' && lastPaid ? alertBox('success', 'check', el('b', {}, money(lastPaid.amount_minor, cur)), ` paid to ${fname} for ${lastPaid.label}.`)
          : f === 'cancelled' ? alertBox('info', 'info', 'Cancelled. You weren’t charged and the hold is released.')
            : f === 'revision' ? alertBox('success', 'check', `Sent to ${fname}. Your money stays held by Milestone Pay while they revise.`)
              : f === 'request' ? alertBox('success', 'check', `Request sent to ${fname}. You’ll get a price here if it’s new work. Nothing changes until you accept.`) : null;
  const cards = ms.map((m) => {
    let body = null;
    if (m.fundable) body = fundBlock(m, d);
    else if (['authorized', 'revision_requested'].includes(m.status)) body = alertBox('held', 'lock', `Milestone Pay is holding this until you approve the work.${m.payment?.expires_at ? ` Held until ${fmtDay(m.payment.expires_at)}.` : ''}`);
    else if (m.status === 'submitted') body = el('div', { class: 'mp-row mp-row--between mp-row--wrap' }, el('span', { class: 'mp-t-sm' }, el('b', {}, `${fname} delivered ${m.label}. `), 'Check the files, then pay or ask for changes.'),
      link(`/p/${pid}/m/${m.id}`, { class: 'mp-btn mp-btn--primary mp-btn--sm' }, `Review ${m.label}`, icon('arrow-right')));
    return msCard(m, { cur, fname, base, current: m.is_current && m.status !== 'voided' && m.status !== 'paid', body, href: ['submitted', 'paid', 'revision_requested', 'authorized'].includes(m.status) ? `/p/${pid}/m/${m.id}` : null });
  });
  // current first, then the rest in order (board 05/07 success)
  const order = curM ? [cards[ms.indexOf(curM)], ...cards.filter((_, i) => ms[i] !== curM)] : cards;
  const paid = ms.filter((m) => m.status === 'paid').reduce((t, m) => t + m.amount_minor, 0);
  const sumRow = (k, v) => el('div', { class: 'mp-summary__row' }, el('span', {}, k), el('span', { class: 'mp-num mp-strong' }, v));
  const redraw = (x) => { d = x; viewPayments(x, true); };
  // Desktop: milestones on the left, a summary column on the right. Phone: one column, summary first.
  (keep ? mountKeep : mount)(appShell('client', back('/jobs', 'Your jobs'),
    el('div', { class: 'mp-paypage' },
      el('div', { class: 'mp-paypage__head' },
        el('div', { class: 'mp-stack', style: 'gap:2px;min-width:0' }, el('span', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, 'Payments'), el('h1', { class: 'mp-t-title' }, titleOf(d))),
        el('div', { class: 'mp-row mp-t-sm mp-muted' }, 'Freelancer', personChip(d, 'freelancer'))),
      el('div', { class: 'mp-paypage__main mp-stack mp-stack--4' },
        banner, curM ? holdWarning(curM, cur, fname, 'client') : null,
        quote ? quoteCard(quote, d) : nextCard(nextFor(d, 'client')?.to === `/p/${pid}` ? { ...nextFor(d, 'client'), btn: null } : nextFor(d, 'client')),
        el('h2', { class: 'mp-t-section' }, 'Milestones'),
        ...order,
        chatCard(d, 'client', redraw)),
      el('aside', { class: 'mp-paypage__side mp-stack mp-stack--4' },
        el('div', { class: 'mp-card mp-card--raised mp-stack mp-stack--3' },
          el('h2', { class: 'mp-t-sub' }, 'Summary'),
          el('div', { class: 'mp-progress' }, el('div', { class: 'mp-progress__label' }, el('span', {}, el('b', {}, `${ms.filter((m) => m.status === 'paid').length} of ${ms.length}`), ' parts paid')),
            el('div', { class: 'mp-progress__bar' }, ms.map((m) => el('span', { class: `mp-progress__seg ${m.status === 'paid' ? 'mp-progress__seg--paid' : ['authorized', 'submitted', 'revision_requested'].includes(m.status) ? 'mp-progress__seg--held' : ''}` })))),
          el('div', { class: 'mp-summary' }, sumRow('Total', money(total, cur)), sumRow('Held by Milestone Pay', money(held, cur)), sumRow(`Paid to ${fname}`, money(paid, cur)), sumRow('Still to fund', money(Math.max(0, total - held - paid), cur)))),
        openReq ? el('div', { class: 'mp-card mp-card--raised mp-stack' }, el('b', { class: 'mp-row' }, icon('check'), `Request sent to ${fname}`),
          el('div', { class: 'mp-bubble', style: 'max-width:100%' }, openReq.text),
          el('p', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, `${fname} will check it against your agreement. If it’s new work, you’ll get a price here to accept or decline. Nothing changes until you accept.`)) : null,
        el('div', { class: 'mp-card mp-card--raised mp-stack' },
          el('h2', { class: 'mp-t-sub' }, 'Need something else?'),
          openReq || quote ? el('button', { class: 'mp-btn mp-btn--secondary mp-btn--block', disabled: true }, `Request a change · 1 open`) : link(`/p/${pid}/change`, { class: 'mp-btn mp-btn--secondary mp-btn--block' }, icon('plus'), 'Request a change'),
          openReq || quote ? el('p', { class: 'mp-t-caption mp-muted', style: 'text-align:center;font-weight:400' }, `You can send another once ${fname} answers this one.`) : null,
          link(`/p/${pid}/project`, { class: 'mp-btn mp-btn--ghost mp-btn--block' }, icon('file'), 'Project details and history')),
        sandboxNote()))));
  poll(pid, () => d, (x) => { if (document.querySelector('.mp-pp-host iframe')) return; d = x; viewPayments(x, true); }, () => C.busy);
}

// ---------------------------------------------------------------- 07 Review and pay
export function viewReview(d, mid) {
  const m = d.milestones.find((x) => x.id === mid);
  const { fname } = names(d); const cur = curOf(d); const pid = d.project.id;
  if (!m) return viewPayments(d);
  if (m.status !== 'submitted') {
    stopPoll();
    return mount(appShell('client', back(`/p/${pid}`, 'Payments'),
      el('div', { class: 'mp-narrow mp-stack mp-stack--4' }, el('div', { class: 'mp-stack', style: 'gap:2px' }, caption(d), el('h1', { class: 'mp-t-title' }, `${m.label} · ${m.title}`)),
        el('div', {}, msBadge(m)),
        m.status === 'paid' && m.invoice ? el('div', { class: 'mp-card mp-card--raised' }, invoiceLinks(m)) : null,
        m.status === 'paid' && !m.invoice ? el('p', { class: 'mp-t-sm mp-muted' }, `The invoice appears here once the payment has reached ${fname}’s PayPal.`) : null,
        m.status === 'paid' ? alertBox('success', 'check', `You paid ${fname} ${money(m.amount_minor, cur)} for ${m.label}.`) : m.status === 'revision_requested' ? alertBox('held', 'lock', `${fname} is revising. Your note: “${m.rev_note || ''}”`) : null,
        m.deliverables.length ? el('div', { class: 'mp-card mp-card--raised' }, m.deliverables.map((f) => fileRow(f))) : el('p', { class: 'mp-muted' }, 'No files delivered yet.'),
        m.status === 'revision_requested' ? chatCard(d, 'client', (x) => viewReview(x, mid)) : null,
        link(`/p/${pid}`, { class: 'mp-btn mp-btn--secondary mp-btn--block' }, 'Back to payments'))));
  }
  const prop = m.proposal && m.proposal.action === 'release' && m.proposal.status === 'pending' ? m.proposal : null;
  const left = m.rev_limit != null ? Math.max(0, m.rev_limit - m.rev_count) : null;
  const pay = el('button', { class: 'mp-btn mp-btn--primary mp-btn--block', id: 'payBtn', disabled: !prop || C.busy, onclick: async () => {
    const ok = await confirmDialog({ title: `Pay ${fname} ${money(m.amount_minor, cur)}?`, text: `Milestone Pay releases the money to ${fname}’s PayPal right away. This can’t be undone.`,
      summary: { label: 'You pay', minor: m.amount_minor, cur }, rows: [['To', `${fname} (PayPal)`], ['For', `${m.label} · ${m.title}`], ['From', 'Your hold with Milestone Pay'], ['Hold after this', money(0, cur)]],
      confirm: `Pay ${money(m.amount_minor, cur)}` });
    if (!ok) return;
    C.busy = true; pay.disabled = true; pay.replaceChildren(el('span', { class: 'mp-spinner', style: 'width:16px;height:16px;border-top-color:var(--on-ink)' }), 'Paying…');
    try { await api(`/api/proposals/${prop.id}/approve`, { body: {} }); C.busy = false; C.flash = 'paid'; viewPayments(await api(`/api/projects/${pid}`)); }
    catch (e) {
      C.busy = false;
      const again = await confirmDialog({ icon: 'alert', iconKind: 'issue', title: 'Payment didn’t go through', text: `PayPal couldn’t complete it. No money moved. Your ${money(m.amount_minor, cur)} is still held safely by Milestone Pay${m.payment?.expires_at ? ` until ${fmtDay(m.payment.expires_at)}` : ''}.`,
        rows: [[`${fname} received`, money(0, cur)], ['Still held for you', money(m.amount_minor, cur)]], body: el('p', { class: 'mp-t-caption mp-muted' }, e.message), confirm: 'Try again', confirmIcon: 'refresh', cancel: 'Not now' });
      if (again) return pay.click();
      viewReview(await api(`/api/projects/${pid}`).catch(() => d), mid);
    }
  } }, `Pay ${fname} ${money(m.amount_minor, cur)}`);
  const reqBtn = left === 0
    ? el('button', { class: 'mp-btn mp-btn--secondary mp-btn--block', disabled: true }, 'Request changes · 0 left')
    : link(`/p/${pid}/m/${m.id}/changes`, { class: 'mp-btn mp-btn--secondary mp-btn--block' }, `Request changes${left != null ? ` · ${left} left` : ''}`);
  const cancel = el('button', { class: 'mp-btn mp-btn--danger-quiet mp-btn--block', disabled: !prop || C.busy, onclick: async () => {
    const later = d.milestones.filter((x) => x.seq > m.seq).map((x) => x.label);
    const ok = await confirmDialog({ icon: 'alert', iconKind: 'issue', title: `Cancel ${m.label}? You won’t be charged.`,
      text: `You won’t be charged for ${m.label}. ${fname} won’t be paid for this work${later.length ? `, and ${later.join(' and ')} won’t start` : ''}. This can’t be undone.`,
      rows: [['Milestone', `${m.label} · ${m.title}`], ['You’re charged', money(0, cur)], [`${fname} receives`, money(0, cur)]], confirm: `Keep ${m.label}`, cancel: `Cancel ${m.label}`, cancelClass: 'mp-btn--danger' });
    if (ok !== false) return; // only the red “Cancel” button cancels; Escape keeps it
    C.busy = true;
    try { await api(`/api/proposals/${prop.id}/cancel`, { body: {} }); C.flash = 'cancelled'; }
    catch (e) { toast(e.message, 'alert'); }
    C.busy = false;
    viewPayments(await api(`/api/projects/${pid}`));
  } }, `Cancel ${m.label} · you won’t be charged`);
  mount(appShell('client', back(`/p/${pid}`, 'Payments'),
    el('div', { class: 'mp-narrow mp-stack mp-stack--4' },
      el('div', { class: 'mp-stack', style: 'gap:2px' }, caption(d), el('h1', { class: 'mp-t-title' }, `Review ${m.label} · ${m.title}`)),
      alertBox('info', 'eye', el('b', {}, 'Your next step: '), `open the files. If you’re happy, pay ${fname}.`),
      holdWarning(m, cur, fname, 'client'),
      el('div', { class: 'mp-card mp-card--raised', style: 'padding:8px 16px' }, m.deliverables.length ? m.deliverables.map((f) => fileRow(f)) : el('p', { class: 'mp-muted' }, 'No files found for this delivery.')),
      m.deliverables.length ? el('a', { class: 'mp-btn mp-btn--ghost mp-btn--sm', href: `/api/milestones/${m.id}/download-all`, style: 'align-self:flex-start' }, icon('download'), `Download all (${plural(m.deliverables.length, 'file')}, .zip)`) : null,
      el('div', {}, el('span', { class: 'mp-t-caption mp-muted' }, 'You agreed on'), el('ul', { class: 'mp-ms__crit' }, (m.criteria || []).map((c) => el('li', {}, c)))),
      !prop ? alertBox('info', 'clock', 'Getting the payment ready… this page updates by itself.') : null,
      el('div', { class: 'mp-stack mp-sticky-cta' }, pay, reqBtn,
        left === 0 ? el('p', { class: 'mp-t-caption mp-muted', style: 'text-align:center;font-weight:400' }, `You’ve used every revision round for ${m.label}. For more changes, `, link(`/p/${pid}/change`, { class: 'mp-link' }, 'request a change'), ` (${fname} may add a price).`) : null,
        cancel))));
  poll(pid, () => d, (x) => { const mm = x.milestones.find((y) => y.id === mid); if (!mm || mm.status !== m.status || !!mm.proposal !== !!m.proposal || mm.proposal?.status !== m.proposal?.status) viewReview(x, mid); }, () => C.busy);
}

/** “Request changes” on a delivered milestone (uses one revision round). */
export function viewRevision(d, mid) {
  stopPoll();
  const m = d.milestones.find((x) => x.id === mid); const { fname } = names(d); const pid = d.project.id;
  if (!m) return viewPayments(d);
  const ta = el('textarea', { class: 'mp-input', id: 'revNote', rows: 5, maxlength: 1000, placeholder: 'Make the menu photos brighter and use our green from the logo', value: C.revText, oninput: () => { C.revText = ta.value; send.disabled = ta.value.trim().length < 5; } });
  const err = el('div');
  const send = el('button', { class: 'mp-btn mp-btn--primary mp-btn--block', disabled: C.revText.trim().length < 5, onclick: async () => {
    send.disabled = true;
    try { await api(`/api/milestones/${m.id}/revision`, { body: { note: ta.value.trim() } }); C.revText = ''; C.flash = 'revision'; go(`/p/${pid}`); }
    catch (e) { send.disabled = false; err.replaceChildren(errBox(e)); }
  } }, icon('send'), `Send to ${fname}`);
  mount(appShell('client', back(`/p/${pid}/m/${m.id}`, `Review ${m.label}`),
    el('div', { class: 'mp-narrow mp-stack mp-stack--4' }, el('div', { class: 'mp-stack', style: 'gap:2px' }, caption(d), el('h1', { class: 'mp-t-title' }, `Review ${m.label} · ${m.title}`)),
      el('div', { class: 'mp-card mp-card--raised mp-field' }, el('label', { class: 'mp-label', for: 'revNote' }, 'What would you like changed?'), ta,
        el('span', { class: 'mp-help' }, `Uses round ${m.rev_count + 1}${m.rev_limit ? ` of ${m.rev_limit}` : ''}. Your money stays held by Milestone Pay.`)),
      err, el('div', { class: 'mp-stack mp-sticky-cta' }, send, link(`/p/${pid}/m/${m.id}`, { class: 'mp-btn mp-btn--ghost mp-btn--block' }, 'Back')))));
  ta.focus();
}

// ---------------------------------------------------------------- 08 Request a change (client)
export function viewRequestChange(d) {
  stopPoll();
  const { fname } = names(d); const pid = d.project.id;
  const open = (d.change_requests || []).find((c) => c.status === 'open' || c.status === 'sent');
  if (open) { toast(`You have a request open with ${fname}. You can send another once they answer.`, 'info'); return go(`/p/${pid}`); }
  const ta = el('textarea', { class: 'mp-input', id: 'crText', rows: 5, maxlength: 1000, placeholder: 'Can you add an online ordering page?', value: C.crText, oninput: () => { C.crText = ta.value; send.disabled = ta.value.trim().length < 5; } });
  const err = el('div');
  const send = el('button', { class: 'mp-btn mp-btn--primary mp-btn--block', disabled: C.crText.trim().length < 5, onclick: async () => {
    send.disabled = true; send.replaceChildren(el('span', { class: 'mp-spinner', style: 'width:16px;height:16px;border-top-color:var(--on-ink)' }), 'Sending…');
    try { await api(`/api/projects/${pid}/change-requests`, { body: { message: ta.value.trim() } }); C.crText = ''; C.flash = 'request'; go(`/p/${pid}`); }
    catch (e) { send.disabled = false; send.replaceChildren(icon('send'), `Send to ${fname}`); err.replaceChildren(errBox(e)); }
  } }, icon('send'), `Send to ${fname}`);
  mount(appShell('client', back(`/p/${pid}`, 'Payments'),
    el('div', { class: 'mp-narrow mp-stack mp-stack--4' }, el('div', { class: 'mp-stack', style: 'gap:2px' }, caption(d), el('h1', { class: 'mp-t-title' }, 'Need something else?')),
      el('div', { class: 'mp-card mp-card--raised mp-field' }, el('label', { class: 'mp-label', for: 'crText' }, 'What would you like to change or add?'), ta,
        el('span', { class: 'mp-help' }, `${fname} reviews it first. You’re only charged if you accept a price.`)),
      err, el('div', { class: 'mp-stack mp-sticky-cta' }, send, link(`/p/${pid}`, { class: 'mp-btn mp-btn--ghost mp-btn--block' }, 'Back')))));
  ta.focus();
}
