// Shared helpers and design-system components (classes from public/ds/bundle.css, the Milestone Pay design system).
// Every piece of user or AI text goes in through textContent (el); never innerHTML with data.

export const S = { cfg: null, me: null, projects: null };
export const $ = (s, root = document) => root.querySelector(s);

export function el(tag, attrs = {}, ...kids) {
  const n = tag === 'svg' || tag === 'use' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.setAttribute('class', v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') n[k] = !!v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
  return n;
}

/** Stroke icon from the design-system sprite (public/ds/icons.js). */
export function icon(name, cls = '') {
  const svg = el('svg', { class: `mp-i ${cls}`.trim(), 'aria-hidden': 'true' });
  svg.append(el('use', { href: `#i-${name}` }));
  return svg;
}

export const mount = (...nodes) => { $('#app').replaceChildren(...nodes); window.scrollTo(0, 0); };
export const mountKeep = (...nodes) => $('#app').replaceChildren(...nodes);

// ---------------------------------------------------------------- formatting
/** "2,400.00 USD": two decimals, thousands separator, currency code after (design-system content rule). */
export function money(minor, cur) {
  const c = cur || S.cfg?.currency || 'USD';
  return `${fmtNum(minor)} ${c}`;
}
export const fmtNum = (minor) => (Number(minor || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function moneyEl(minor, cur, size = 'md') {
  return el('span', { class: `mp-money mp-money--${size}` }, fmtNum(minor), el('span', { class: 'cur' }, cur || S.cfg?.currency || 'USD'));
}
export function parseMinor(s) {
  const m = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(String(s).replace(/,/g, ''));
  return m ? parseInt(m[1], 10) * 100 + parseInt((m[2] || '').padEnd(2, '0') || '0', 10) : null;
}
export const major = (minor) => (Number(minor || 0) / 100).toFixed(2);
const D = (iso) => { const d = new Date(iso); return isNaN(d) ? null : d; };
export const fmtDate = (iso) => { const d = D(iso); return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
export const fmtDay = (iso) => { const d = D(iso); return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''; };
export const fmtTime = (iso) => { const d = D(iso); return d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''; };
export const fmtDateTime = (iso) => { const d = D(iso); return d ? `${fmtDay(iso)} ${fmtTime(iso)}` : ''; };
export const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
export const initial = (s) => (String(s || '?').trim()[0] || '?').toUpperCase();
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const daysUntil = (iso) => { const d = D(iso); return d ? Math.ceil((d - Date.now()) / 864e5) : null; };

// ---------------------------------------------------------------- api
export async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body !== undefined || opts.form ? 'POST' : 'GET'), headers: {} };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  let res;
  try { res = await fetch(path, init); }
  catch { throw Object.assign(new Error('Couldn’t reach Milestone Pay. Check your connection and try again.'), { code: 'NETWORK' }); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !opts.noLoginRedirect) {
    S.me = null;
    go('/login');
    throw Object.assign(new Error('Please log in again.'), { code: 'UNAUTHENTICATED', status: 401 });
  }
  if (!res.ok) throw Object.assign(new Error(data.message || `Something went wrong (${res.status}).`), { code: data.error, status: res.status, data });
  return data;
}

// ---------------------------------------------------------------- routing
export function go(h) { if (location.hash === `#${h}`) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; }
export const link = (h, attrs, ...kids) => el('a', { href: `#${h}`, ...attrs }, ...kids);
export const back = (h, text) => link(h, { class: 'mp-back' }, icon('arrow-left'), text);

// ---------------------------------------------------------------- feedback
export function toast(text, ic = 'check') {
  const t = el('div', { class: 'mp-toast', role: 'status' }, icon(ic), el('span', {}, text));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 5000);
}
export function alertBox(kind, ic, ...content) {
  return el('div', { class: `mp-alert mp-alert--${kind}`, role: kind === 'issue' ? 'alert' : 'status' }, icon(ic), el('div', { class: 'mp-grow' }, ...content));
}
export const errBox = (e) => alertBox('issue', 'alert', e?.message || String(e));
export const loading = (text = 'Loading…') => el('div', { class: 'mp-row mp-t-sm mp-muted mp-loading', role: 'status' }, el('span', { class: 'mp-spinner' }), text);
export function skeleton() {
  return el('div', { class: 'mp-card mp-card--raised mp-stack mp-stack--3', 'aria-busy': 'true' },
    el('div', { class: 'mp-skel', style: 'width:40%' }), el('div', { class: 'mp-skel' }), el('div', { class: 'mp-skel', style: 'width:80%' }), el('div', { class: 'mp-skel', style: 'width:60%' }));
}

/**
 * Confirmation dialog (a bottom sheet on phones). Resolves true on confirm, false on cancel.
 * Resolves true (confirm button), false (cancel button) or null (Escape / click outside: nothing chosen).
 * opts: { icon, iconKind, title, text, summary:{label,minor,cur}, rows:[[k,v]], confirm, confirmClass, cancel, body }
 */
export function confirmDialog(o) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const close = (v) => { scrim.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const ok = el('button', { class: `mp-btn ${o.confirmClass || 'mp-btn--primary'} mp-btn--block`, onclick: () => close(true) }, o.confirmIcon ? icon(o.confirmIcon) : null, o.confirm || 'Confirm');
    const no = el('button', { class: `mp-btn ${o.cancelClass || 'mp-btn--secondary'} mp-btn--block`, onclick: () => close(false) }, o.cancel || 'Go back');
    const dlg = el('div', { class: 'mp-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlgTitle' },
      el('span', { class: 'mp-sheet__grab mp-only-phone' }),
      o.icon ? el('span', { class: `mp-dialog__icon ${o.iconKind ? `mp-dialog__icon--${o.iconKind}` : ''}` }, icon(o.icon, 'mp-i--lg')) : null,
      el('div', { class: 'mp-stack' }, el('h2', { class: 'mp-t-section', id: 'dlgTitle' }, o.title), o.text ? el('p', { class: 'mp-t-sm mp-muted' }, o.text) : null),
      o.summary || o.rows ? el('div', { class: 'mp-summary' },
        o.summary ? el('div', { class: 'mp-summary__total' }, el('span', { class: 'mp-t-sm mp-muted' }, o.summary.label), moneyEl(o.summary.minor, o.summary.cur, 'lg')) : null,
        (o.rows || []).map(([k, v]) => el('div', { class: 'mp-summary__row' }, el('span', {}, k), el('span', {}, v)))) : null,
      o.body || null,
      el('div', { class: 'mp-dialog__actions' }, ok, o.cancel === null ? null : no));
    const scrim = el('div', { class: 'mp-scrim mp-overlay', onclick: (e) => { if (e.target === scrim) close(null); } }, dlg);
    document.body.append(scrim);
    document.addEventListener('keydown', onKey);
    ok.focus();
  });
}

// ---------------------------------------------------------------- status
/** Milestone badge: icon + text + tint, never colour alone (design system Badge table). */
export const STATUS = {
  draft: ['neutral', 'edit', 'Draft'],
  agreed: ['neutral', 'circle-dashed', 'Not funded'],
  locked: ['outline', 'clock', 'Waiting on previous'],
  authorized: ['held', 'lock', 'Funded · in progress'],
  submitted: ['pending', 'inbox', 'Submitted · awaiting review'],
  revision_requested: ['issue', 'alert', 'Changes requested'],
  paid: ['success', 'check', 'Paid'],
  voided: ['neutral', 'x', 'Cancelled'],
  refunded: ['neutral', 'undo', 'Refunded'],
};
export function badge(kind, ic, text) { return el('span', { class: `mp-badge mp-badge--${kind}` }, ic ? icon(ic) : null, text); }
export function msBadge(m, short = false) {
  const key = m.status === 'agreed' && !m.fundable && !m.is_current ? 'locked' : m.status;
  const [k, ic, t] = STATUS[key] || STATUS.draft;
  return badge(k, ic, short && key === 'submitted' ? 'Submitted' : t);
}
/** Where the money is, for one milestone. */
export function where(m, fname) {
  if (['authorized', 'submitted', 'revision_requested'].includes(m.status)) return el('span', { class: 'mp-where mp-where--held' }, icon('lock'), 'Held by PayPal');
  if (m.status === 'paid') return el('span', { class: 'mp-where mp-where--released' }, icon('check'), `Paid to ${fname || 'the freelancer'}`);
  if (m.status === 'voided') return el('span', { class: 'mp-where mp-where--refunded' }, icon('undo'), 'Cancelled · not charged');
  if (m.status === 'refunded') return el('span', { class: 'mp-where mp-where--refunded' }, icon('undo'), 'Refunded');
  return el('span', { class: 'mp-where mp-where--none' }, icon('circle-dashed'), 'Not funded yet');
}
export const AGREEMENT_BADGE = {
  draft: () => badge('neutral', 'edit', 'Draft · version 1'),
  sent: () => badge('pending', 'send', 'Sent · waiting for approval'),
  approved: () => badge('success', 'check', 'Agreement approved'),
};
export function projectBadge(p) {
  if (p.status === 'completed') return badge('success', 'check', 'Completed');
  if (p.status === 'stopped') return badge('neutral', 'x', 'Cancelled');
  return (AGREEMENT_BADGE[p.agreement_status || (p.status === 'sent' ? 'sent' : p.status === 'draft' ? 'draft' : 'approved')] || AGREEMENT_BADGE.draft)();
}

// ---------------------------------------------------------------- components
export function nextStep({ ic = 'arrow-right', text, sub, action, stack = false }) {
  return el('div', { class: `mp-next ${stack ? 'mp-next--stack' : ''}` },
    stack ? el('div', { class: 'mp-row', style: 'gap:12px;align-items:flex-start' }, el('span', { class: 'mp-next__icon' }, icon(ic)),
      el('div', { class: 'mp-grow' }, el('div', { class: 'mp-next__label' }, 'Your next step'), el('div', { class: 'mp-next__text' }, text), sub ? el('div', { class: 'mp-t-sm mp-muted' }, sub) : null))
      : [el('span', { class: 'mp-next__icon' }, icon(ic)),
        el('div', { class: 'mp-grow' }, el('div', { class: 'mp-next__label' }, 'Your next step'), el('div', { class: 'mp-next__text' }, text), sub ? el('div', { class: 'mp-t-sm mp-muted' }, sub) : null)],
    action || null);
}
export function emptyState({ ic, title, text, actions }) {
  return el('div', { class: 'mp-empty' }, el('span', { class: 'mp-empty__icon' }, icon(ic, 'mp-i--xl')),
    el('h2', { class: 'mp-t-section' }, title), text ? el('p', { class: 'mp-muted', style: 'max-width:460px' }, text) : null,
    actions ? el('div', { class: 'mp-row mp-row--wrap', style: 'justify-content:center;gap:12px' }, actions) : null);
}
export function stat(ic, label, minor, cur, note) {
  return el('div', { class: 'mp-stat' }, el('span', { class: 'mp-row mp-t-sm mp-muted' }, icon(ic), label),
    el('span', { class: 'mp-stat__value mp-num' }, fmtNum(minor), el('small', {}, cur || S.cfg?.currency || 'USD')),
    note ? el('span', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, note) : null);
}
export function progress(ms, label) {
  const paid = ms.filter((m) => m.status === 'paid').length;
  return el('div', { class: 'mp-progress' },
    el('div', { class: 'mp-progress__label' }, el('span', {}, el('b', {}, `${paid} of ${ms.length}`), ` ${label || 'milestones paid'}`)),
    el('div', { class: 'mp-progress__bar' }, ms.map((m) => el('span', { class: `mp-progress__seg ${m.status === 'paid' ? 'mp-progress__seg--paid' : ['authorized', 'submitted', 'revision_requested'].includes(m.status) ? 'mp-progress__seg--held' : ''}` }))));
}
/** Due date of a milestone: plan start (agreement approval, else project creation) + its end day. */
export function dueOf(m, base) {
  if (!base || m.end_day == null) return null;
  const d = new Date(base); if (isNaN(d)) return null;
  d.setDate(d.getDate() + Number(m.end_day));
  return d.toISOString();
}
export function msCard(m, { cur, fname, base, current = false, body = null, compact = false, href = null } = {}) {
  const due = dueOf(m, base);
  const idx = m.status === 'paid' ? el('span', { class: 'mp-ms__idx mp-ms__idx--done' }, icon('check'))
    : el('span', { class: `mp-ms__idx ${current ? 'mp-ms__idx--cur' : ''}` }, String(m.seq));
  const locked = m.status === 'agreed' && !m.fundable && !m.is_current;
  const title = href ? link(href, { class: 'mp-ms__title mp-link-plain' }, `${m.label} · ${m.title}`) : el('div', { class: 'mp-ms__title' }, `${m.label} · ${m.title}`);
  return el('div', { class: `mp-ms ${current ? 'mp-ms--current' : ''} ${locked ? 'mp-ms--locked' : ''} ${compact ? 'mp-ms--compact' : ''}`, 'data-ms': m.label },
    idx,
    el('div', {}, title, el('div', { class: 'mp-ms__meta' }, due ? el('span', {}, icon('calendar'), ` Due ${fmtDay(due)}`) : null, where(m, fname))),
    el('div', { class: 'mp-ms__right' }, moneyEl(m.amount_minor, m.currency || cur, 'md'), msBadge(m)),
    body ? el('div', { class: 'mp-ms__body' }, body) : null);
}
export const viewUrl = (u) => u + (u.includes('?') ? '&' : '?') + 'inline=1';
export function fileRow(f, { onRemove } = {}) {
  const name = f.filename || f.name;
  const ext = (name.split('.').pop() || '').slice(0, 4).toUpperCase();
  return el('div', { class: 'mp-file' }, el('span', { class: 'mp-file__thumb' }, ext), el('span', { class: 'mp-file__name', title: name }, name),
    el('span', { class: 'mp-file__size' }, fmtSize(f.size || 0)),
    f.download_url ? el('a', { class: 'mp-iconbtn', href: viewUrl(f.download_url), target: '_blank', rel: 'noopener', 'aria-label': `View ${name}` }, icon('eye')) : null,
    f.download_url ? el('a', { class: 'mp-iconbtn', href: f.download_url, 'aria-label': `Download ${name}` }, icon('download')) : null,
    onRemove ? el('button', { class: 'mp-iconbtn', type: 'button', onclick: onRemove, 'aria-label': `Remove ${name}` }, icon('x')) : null);
}
export function copyText(text, label) {
  const ok = () => toast(`${label || 'Text'} copied`);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(ok, () => toast('Couldn’t copy. Select it and copy by hand.', 'alert'));
  else toast('Couldn’t copy. Select it and copy by hand.', 'alert');
}
/** Tag picker (mp-tags): returns { node, values() }. */
export function tagPicker(options, selected, { onChange, allowAdd = false, addLabel = 'Add your own and press Enter' } = {}) {
  const sel = new Set(selected || []);
  const all = [...new Set([...options, ...(selected || [])])];
  const box = el('div', { class: 'mp-tags', role: 'group' });
  const draw = () => box.replaceChildren(...all.map((t) => el('button', {
    type: 'button', class: `mp-tag ${sel.has(t) ? 'on' : ''}`, 'aria-pressed': sel.has(t) ? 'true' : 'false',
    onclick: () => { sel.has(t) ? sel.delete(t) : sel.add(t); draw(); onChange?.([...sel]); },
  }, icon(sel.has(t) ? 'check' : 'plus'), t)));
  draw();
  const add = allowAdd ? el('input', { class: 'mp-input', placeholder: addLabel, maxlength: 40, 'aria-label': addLabel,
    onkeydown: (e) => {
      if (e.key !== 'Enter') return; e.preventDefault();
      const v = add.value.trim(); if (!v) return;
      if (!all.includes(v)) all.push(v);
      sel.add(v); add.value = ''; draw(); onChange?.([...sel]);
    } }) : null;
  return { node: el('div', { class: 'mp-stack' }, box, add), values: () => [...sel] };
}

// ---------------------------------------------------------------- page shells
export const footer = () => el('footer', { class: 'mp-auth__foot' }, el('span', {}, 'Sandbox · fake money'),
  el('span', { class: 'mp-row' }, icon('lock'), ' Payments processed securely by PayPal'));
export const wordmark = (href = '/') => link(href, { class: 'mp-wordmark mp-link-plain', 'aria-label': 'Milestone Pay home' }, el('i'), 'Milestone Pay');

/** Centred auth card page (O2–O5). */
export function authShell(card, { backTo = null, right = null } = {}) {
  return el('div', { class: 'mp-auth' },
    el('header', { class: 'mp-auth__top' }, el('span', { class: 'mp-row' }, backTo ? link(backTo, { class: 'mp-iconbtn mp-only-phone', 'aria-label': 'Back' }, icon('arrow-left')) : null, wordmark()), right || el('span')),
    el('main', { class: 'mp-auth__main' }, card),
    el('footer', { class: 'mp-auth__foot' }, el('a', { class: 'mp-link-plain', href: '#/', }, 'Home'), el('span', {}, 'Sandbox · fake money'), el('span', { class: 'mp-row' }, icon('lock'), ' Payments processed securely by PayPal')));
}

/** The role the person is acting in on this screen ('freelancer' | 'client'). */
export const homeRole = () => S.me?.active_role || (S.me?.roles || [])[0] || 'freelancer';
export const myName = () => S.me?.display_name || S.me?.name || S.me?.email || 'You';

/** App top bar with nav, role chip and the avatar menu (board 10). */
export function topbar(role = homeRole()) {
  const roles = new Set(S.me?.roles || []);
  const isClient = role === 'client';
  const nav = el('nav', { class: 'mp-nav' },
    roles.has('freelancer') || !roles.size || !isClient ? link('/projects', { class: !isClient ? 'on' : '' }, 'Projects') : null,
    roles.has('client') || isClient ? link('/jobs', { class: isClient ? 'on' : '' }, 'Your jobs') : null);
  const btn = el('button', { class: `mp-avatarbtn ${isClient ? 'mp-avatarbtn--client' : ''}`, 'aria-label': 'Account menu', 'aria-haspopup': 'menu', 'aria-expanded': 'false', id: 'avatarBtn' }, el('span', {}, initial(myName())));
  const wrap = el('div', { class: 'mp-menuwrap' }, btn);
  let menu = null;
  const closeMenu = () => { menu?.remove(); menu = null; btn.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside, true); };
  const outside = (e) => { if (!wrap.contains(e.target)) closeMenu(); };
  const item = (ic, text, onclick, extra) => el('button', { class: 'mp-menu__item', role: 'menuitem', type: 'button', onclick: () => { closeMenu(); onclick(); } }, icon(ic), text, extra || null);
  btn.addEventListener('click', () => {
    if (menu) return closeMenu();
    const other = isClient ? 'freelancer' : 'client';
    menu = el('div', { class: 'mp-menu', role: 'menu' },
      el('div', { class: 'mp-menu__who' }, el('span', { class: `mp-avatar mp-avatar--lg ${isClient ? '' : 'mp-avatar--me'}` }, initial(myName())),
        el('div', {}, el('b', { class: 'mp-t-sm', id: 'userName' }, myName()), el('div', { class: 'mp-t-caption mp-muted' }, S.me?.email || ''))),
      item(isClient ? 'building' : 'user', isClient ? 'Business details' : 'Profile', () => go('/settings')),
      item('banknote', 'PayPal', () => go('/settings#paypal'), el('small', { class: 'mp-ok' }, icon('check'), 'Connected')),
      roles.has(other) ? item(other === 'client' ? 'briefcase' : 'laptop', other === 'client' ? 'Switch to Your jobs' : 'Switch to Projects', () => switchRole(other))
        : item(other === 'client' ? 'briefcase' : 'laptop', other === 'client' ? 'Add client role' : 'Add freelancer role', () => switchRole(other, true), el('small', {}, other === 'client' ? 'for hiring' : 'to get paid')),
      item('menu', 'Settings', () => go('/settings')),
      el('span', { class: 'mp-menu__sep' }),
      item('arrow-right', 'Log out', logout));
    wrap.append(menu); btn.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('click', outside, true));
    menu.querySelector('button')?.focus();
  });
  return el('header', { class: 'mp-top' }, wordmark(isClient ? '/jobs' : '/projects'), nav, el('span', { class: 'mp-grow' }),
    el('span', { class: `mp-role ${isClient ? 'mp-role--client' : ''}`, id: 'roleChip' }, el('span', { class: 'dot' }, initial(myName())),
      el('span', { class: 'mp-hide-phone' }, `${isClient ? 'Client' : 'Freelancer'} view · `), el('span', {}, isClient ? el('span', { class: 'mp-only-phone' }, 'Client') : null, el('span', { class: 'mp-hide-phone' }, myName()))),
    wrap);
}
export async function switchRole(role, add = false) {
  try { S.me = (await api('/api/me', { method: 'PATCH', body: add ? { add_role: role } : { role } })).user; } catch (e) { return toast(e.message, 'alert'); }
  if (add) toast(role === 'client' ? 'Client role added. You can hire people from Your jobs.' : 'Freelancer role added. Paste a chat to start a job.');
  go(role === 'client' ? '/jobs' : '/projects');
}
export async function logout() {
  try { await api('/auth/logout', { body: {}, noLoginRedirect: true }); } catch { /* the session may already be gone */ }
  S.me = null; S.projects = null;
  go('/logged-out');
}
/** Standard app page: top bar + centred content. */
export function appShell(role, ...content) {
  return el('div', { class: 'mp-app' }, topbar(role), el('main', { class: 'mp-page', id: 'main' }, ...content));
}
export function pageHead(title, sub, right) {
  return el('div', { class: 'mp-row mp-row--between mp-row--top mp-row--wrap', style: 'gap:16px' },
    el('div', { class: 'mp-stack', style: 'gap:4px' }, el('h1', { class: 'mp-t-title' }, title), sub ? el('p', { class: 'mp-muted' }, sub) : null), right || null);
}
export const sandboxNote = () => alertBox('info', 'info', el('span', {}, el('b', {}, 'Sandbox beta. '), 'Payments use PayPal’s test system and go to the Milestone Pay demo merchant, not your own PayPal yet.'));

// ---------------------------------------------------------------- live updates
const sigOf = (d) => JSON.stringify([d.project?.status, d.agreement?.status, (d.notes || []).length,
  (d.milestones || []).map((m) => [m.id, m.status, m.rev_count, m.payment?.status, m.fundable, m.proposal?.id, m.proposal?.status, (m.deliverables || []).map((f) => f.id)]),
  (d.change_requests || []).map((c) => [c.id, c.status]), (d.ledger || []).length, (d.activity || []).length, (d.members || []).length]);
let pollTimer = null;
export function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'button'].includes(a.type))); };
/** Poll /api/projects/:id every 3 s while visible; redraw only when it changed and nobody is typing or busy. */
export function poll(pid, getData, onChange, isBusy = () => false) {
  stopPoll();
  pollTimer = setInterval(async () => {
    if (document.hidden || isBusy() || document.querySelector('.mp-overlay')) return;
    try {
      const d = await api(`/api/projects/${pid}`);
      if (isBusy() || sigOf(d) === sigOf(getData()) || typing()) return;
      onChange(d);
    } catch { /* keep the screen; try again next tick */ }
  }, 3000);
}

/** People on a project, by role: account display name first, then the names from the chat. */
export function names(d) {
  const b = d.agreement?.body || {};
  const f = (d.members || []).find((m) => m.role === 'freelancer')?.name || b.freelancer_name || d.project?.freelancer || 'the freelancer';
  const c = (d.members || []).find((m) => m.role === 'client')?.name || b.client_name || d.project?.client || 'your client';
  return { fname: f, cname: c };
}
/** Plan start used for due dates: when the client approved, else when the project was created. */
export const planBase = (d) => (d.approvals || []).find((a) => a.party === 'client')?.at || d.project?.created_at || null;
export const curOf = (d) => d.agreement?.body?.currency || d.milestones?.[0]?.currency || S.cfg?.currency || 'USD';
