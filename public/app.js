// Milestone Pay frontend. All user/AI text is set via textContent (el helper). No innerHTML with data.
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const IS_CLIENT = params.get('as') === 'client';
const CLIENT_PID = params.get('p');
const IS_EMBED = params.get('embed') === '1';
let JUDGE = params.get('judge') === '1' && !IS_CLIENT;
let CFG = null;

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
  return n;
}
const mount = (...nodes) => $('#app').replaceChildren(...nodes);

function money(minor, cur = 'USD') {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(minor / 100); }
  catch { return `${(minor / 100).toFixed(2)} ${cur}`; }
}
function parseMinor(s) {
  const m = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(String(s));
  return m ? parseInt(m[1], 10) * 100 + parseInt((m[2] || '').padEnd(2, '0') || '0', 10) : null;
}
const major = (minor) => (minor / 100).toFixed(2);

async function api(path, opts = {}) {
  const init = { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET') };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(opts.body); }
  let res;
  try { res = await fetch(path, init); }
  catch { throw Object.assign(new Error('Could not reach the server. Check that it is running and try again.'), { code: 'NETWORK' }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || (res.status === 404 ? 'This action is not available on the server yet (404).' : `Something went wrong (${res.status}).`)), { code: data.error, status: res.status, data });
  return data;
}

function toast(text) {
  const t = el('div', { class: 'toast-i' }, text);
  $('#toast').append(t);
  setTimeout(() => t.remove(), 5000);
}
function errBox(e) { return el('div', { class: 'err', role: 'alert' }, e.code && e.code !== 'NETWORK' ? `${e.message} (${e.code})` : e.message); }
const loadingBox = (text) => el('div', { class: 'loading' }, el('span', { class: 'spin' }), text || 'Loading…');
function copyText(text, label) {
  const done = () => toast(`${label || 'Text'} copied`);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => toast('Could not copy. Select it and copy by hand.'));
  else toast('Could not copy. Select it and copy by hand.');
}
function showModal(...nodes) { $('#modalBody').replaceChildren(...nodes); $('#modal').classList.add('show'); }
function closeModal() { $('#modal').classList.remove('show'); }
const STATUS_TEXT = { draft: 'Draft', agreed: 'Waiting for payment', authorized: 'Paid into hold', submitted: 'Delivered – in review',
  revision_requested: 'Revision requested', paid: 'Paid ✓', voided: 'Cancelled – not charged', refunded: 'Refunded',
  sent: 'Sent to client', approved: 'Approved by both', active: 'In progress', completed: 'Completed', stopped: 'Stopped' };
const pillText = (s) => STATUS_TEXT[s] || 'In progress';
const pill = (s) => el('span', { class: `pill ${s}` }, pillText(s));
const fmtDate = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); };
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const ACCEPT = /\.(pdf|png|jpe?g|zip|mp4)$/i;
const MAX_BYTES = 20 * 1024 * 1024;
const viewUrl = (u) => u + (u.includes('?') ? '&' : '?') + 'inline=1';
const sigOf = (d) => JSON.stringify([d.project?.status, d.agreement?.status,
  (d.milestones || []).map((m) => [m.id, m.status, m.rev_count, m.rev_note, m.payment?.status, m.fundable, m.proposal?.id, m.proposal?.status, (m.deliverables || []).map((f) => f.id)]),
  (d.notifications || []).length, (d.change_requests || []).map((c) => [c.id, c.status, c.classification]),
  (d.ledger || []).length, (d.activity || []).length, (d.agent_runs || []).length]);

// Poll the project while the tab is visible (every 3 s; every 2 s in Judge mode and in the embedded phone, which never stops).
// Redraws only when data changed, and never while someone is typing in a field.
let pollTimer = null;
const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'button'].includes(a.type))) && $('#app').contains(a); };
function startPoll(pid, shouldPoll, getSig, setData, redraw, isBusy) {
  stopPoll();
  const live = JUDGE || IS_EMBED;
  pollTimer = setInterval(async () => {
    if (document.hidden || isBusy()) return;
    try {
      const d = await api(`/api/projects/${pid}`);
      if (isBusy()) return;
      const keep = live || shouldPoll(d);
      const changed = sigOf(d) !== getSig();
      if (changed && typing()) return;
      if (changed) { setData(d); redraw(); }
      if (!keep) stopPoll();
    } catch { /* keep the screen as is; try again next tick */ }
  }, live ? 2000 : 3000);
}
function stopPoll() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
function keepFocus(fn) {
  const a = document.activeElement; const id = a && a.id; const pos = a && a.selectionStart;
  fn();
  if (id) { const n = document.getElementById(id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} } }
}

// ---------------------------------------------------------------- freelancer routing
function route() {
  closeModal(); stopPoll();
  const h = location.hash.replace(/^#/, '') || '/';
  if (h === '/new') { syncPhone(null); return viewNew(); }
  const m = /^\/p\/([\w-]+)(?:\/(scope))?/.exec(h);
  syncPhone(m ? m[1] : null);
  if (m && m[2] === 'scope') return viewScope(m[1]);
  if (m) return viewReview(m[1]);
  return viewDash();
}
const go = (h) => { if (location.hash === '#' + h) route(); else location.hash = h; };

// ---------------------------------------------------------------- dashboard (vDash)
async function viewDash() {
  mount(el('div', { class: 'wrap' }, loadingBox('Loading your projects…')));
  let data;
  try { data = await api('/api/projects'); }
  catch (e) { return mount(el('div', { class: 'wrap' }, errBox(e), el('button', { onclick: viewDash }, 'Try again'))); }
  const { projects, totals } = data;
  const cur = CFG?.currency || 'USD';
  const stat = (v, l) => el('div', { class: 'stat' }, el('b', {}, money(v, cur)), el('span', {}, l));
  const demoBtn = el('button', { onclick: async (ev) => {
    ev.target.disabled = true; ev.target.textContent = 'Setting up the demo… (about 10 s)';
    try { const r = await api('/api/demo', { body: {} }); go(`/p/${r.project_id}`); }
    catch (e) { ev.target.disabled = false; ev.target.textContent = 'Try the demo project'; $('#dashErr').replaceChildren(errBox(e)); }
  } }, 'Try the demo project');
  const list = projects.length
    ? projects.map((p) => el('div', { class: 'card row', style: 'justify-content:space-between' },
        el('div', {},
          el('b', {}, p.title || 'Untitled project'),
          el('span', { class: 'muted small' }, ` · ${p.client || 'client'} · ${money(p.total_minor || 0, cur)}`), el('br'),
          (p.milestones || []).map((m) => [el('span', { class: `pill ${m.status}` }, `${m.label} ${pillText(m.status)}`), ' ']),
          p.open_change_request && p.open_change_request.from === 'client' && p.open_change_request.status === 'open'
            ? el('button', { class: 'badge-btn', onclick: () => go(`/p/${p.id}/scope`) }, `● ${p.client || 'Client'} requested a change`) : null),
        el('div', { class: 'row' },
          ['draft', 'sent'].includes(p.status) ? null : el('a', { class: 'small', href: `?judge=1&p=${encodeURIComponent(p.id)}#/p/${p.id}` }, 'Open in Judge mode'),
          el('button', { onclick: () => go(`/p/${p.id}`) }, 'Open'))))
    : el('div', { class: 'empty' }, el('b', {}, 'No projects yet'), 'Paste a LINE or WhatsApp chat to turn it into an agreement.', el('br'), el('br'),
        el('button', { class: 'primary', onclick: () => go('/new') }, 'Paste a chat'), ' ', demoBtn);
  mount(el('div', { class: 'wrap' },
    el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' },
      el('h2', {}, 'Your projects'),
      el('div', { class: 'row' }, projects.length ? demoBtn : null, el('button', { class: 'primary', onclick: () => go('/new') }, '+ New project'))),
    el('div', { id: 'dashErr' }),
    el('div', { class: 'grid3', style: 'margin-bottom:14px' },
      stat(totals.held_minor, 'Held by PayPal (authorized)'), stat(totals.paid_minor, 'Paid to you'), stat(totals.not_funded_minor, 'Not funded yet')),
    list));
}

// ---------------------------------------------------------------- new project (vNew)
let newDraft = { text: '', name: 'Ploy', files: [], pendingId: null };
function viewNew() {
  let busy = false;
  const ta = el('textarea', { rows: 9, placeholder: 'Paste the chat where you agreed the job. English, Thai or mixed.', value: newDraft.text,
    oninput: () => { newDraft.text = ta.value; } });
  const name = el('input', { value: newDraft.name, maxlength: 60, oninput: () => { newDraft.name = name.value; } });
  const fileList = el('div');
  const errSlot = el('div');
  const progress = el('div');
  const goBtn = el('button', { class: 'primary', onclick: submit }, 'Generate agreement');
  const backBtn = el('button', { class: 'ghost small', onclick: back }, '← Back to projects');
  const fileIn = el('input', { type: 'file', multiple: true, accept: '.txt,.jpg,.jpeg,.png', onchange: () => {
    for (const f of fileIn.files) {
      if (!/\.(txt|jpe?g|png)$/i.test(f.name)) { toast(`${f.name}: only .txt, .jpg or .png files`); continue; }
      if (f.size > 20 * 1024 * 1024) { toast(`${f.name} is over 20 MB`); continue; }
      if (newDraft.files.length >= 10) { toast('Up to 10 files per chat'); break; }
      newDraft.files.push(f);
    }
    fileIn.value = ''; drawFiles();
  } });
  function drawFiles() {
    fileList.replaceChildren(...newDraft.files.map((f, i) => el('div', { class: 'frow' },
      el('span', { class: 'thumb' }, (f.name.split('.').pop() || '').slice(0, 4).toUpperCase()),
      el('span', { class: 'fname' }, f.name),
      el('span', { class: 'muted' }, /\.txt$/i.test(f.name) ? 'text parser' : 'read by AI vision'),
      el('button', { class: 'ghost', onclick: () => { newDraft.files.splice(i, 1); drawFiles(); } }, '✕'))));
  }
  function back() {
    if (busy) return;
    if (!newDraft.text.trim() && !newDraft.files.length) return go('/');
    showModal(el('h3', {}, 'Discard this project?'),
      el('p', { class: 'small' }, "You'll lose what you typed or chose. Nothing has been sent to anyone."),
      el('div', { class: 'row' },
        el('button', { class: 'primary', onclick: () => { newDraft = { text: '', name: newDraft.name, files: [], pendingId: null }; closeModal(); go('/'); } }, 'Discard'),
        el('button', { onclick: closeModal }, 'Keep editing')));
  }
  async function submit() {
    errSlot.replaceChildren();
    if (!newDraft.pendingId && !newDraft.text.trim() && !newDraft.files.length) { errSlot.append(errBox({ message: 'Paste the chat or choose a file first.', code: 'EMPTY_CHAT' })); return; }
    busy = true; [goBtn, backBtn].forEach((b) => { b.disabled = true; });
    progress.replaceChildren(el('div', { class: 'box' }, el('span', { class: 'spin' }), 'Reading the chat… about 5 to 10 seconds. Please keep this page open.'));
    try {
      if (!newDraft.pendingId) {
        const fd = new FormData();
        if (newDraft.text.trim()) fd.append('chatText', newDraft.text);
        fd.append('freelancer_name', (newDraft.name || 'Ploy').trim() || 'Ploy');
        newDraft.files.forEach((f) => fd.append('files[]', f, f.name));
        const r = await api('/api/projects', { form: fd });
        newDraft.pendingId = r.project.id;
      }
      await api(`/api/projects/${newDraft.pendingId}/extract`, { body: {} });
      const id = newDraft.pendingId;
      newDraft = { text: '', name: newDraft.name, files: [], pendingId: null };
      go(`/p/${id}`);
    } catch (e) {
      busy = false; [goBtn, backBtn].forEach((b) => { b.disabled = false; });
      progress.replaceChildren(); errSlot.replaceChildren(errBox(e));
      if (newDraft.pendingId) errSlot.append(el('p', { class: 'small muted' }, 'Your chat was saved. Press Generate agreement to try reading it again.'));
      else if (e.code === 'CURRENCY_MISMATCH') errSlot.append(el('p', { class: 'small muted' }, 'Edit the prices in the chat to USD (for example "$800"), then press Generate again.'));
    }
  }
  drawFiles();
  mount(el('div', { class: 'wrap' },
    el('div', { class: 'row', style: 'margin-bottom:10px' }, backBtn),
    el('h2', {}, 'New project'),
    el('p', { class: 'muted' }, 'Paste the chat where you agreed the job. English, Thai or mixed. Prices should be in USD.'),
    el('label', { class: 'small' }, 'Your name in this chat (freelancer)'), name,
    el('div', { style: 'height:8px' }), ta,
    el('div', { class: 'drop' },
      el('b', { class: 'small' }, 'Or upload the chat'), ' ', el('span', { class: 'muted small' }, 'as screenshots (.png, .jpg) or a LINE or WhatsApp .txt export. Up to 10 files, 20 MB each.'),
      el('div', { class: 'row', style: 'margin-top:6px' }, fileIn), fileList),
    el('div', { class: 'row', style: 'margin-top:10px' }, goBtn),
    progress, errSlot,
    el('p', { class: 'small muted' }, 'Chats contain personal info. The raw chat is not logged.')));
}

// ---------------------------------------------------------------- review (vReview)
const R = { data: null, hl: null, tr: false, showAgreement: false, pid: null };
async function viewReview(pid) {
  mount(el('div', { class: 'wrap' }, loadingBox('Loading the agreement…')));
  try { R.data = await api(`/api/projects/${pid}`); R.hl = null; R.tr = false; R.showAgreement = false; R.pid = pid; Pj.picked = []; Pj.err = null; Pj.msg = null; Pj.upPct = null; Pj.busy = false; Pj.rf = null; Pj.gd = null; }
  catch (e) { return mount(el('div', { class: 'wrap' }, errBox(e), el('button', { onclick: () => viewReview(pid) }, 'Try again'), ' ', el('button', { onclick: () => go('/') }, 'Back to projects'))); }
  renderFreelancer();
  if (JUDGE || ['sent', 'active'].includes(R.data.project?.status)) startPoll(pid, (d) => d.project?.status === 'sent' || d.project?.status === 'active', () => sigOf(R.data), (d) => { R.data = d; }, () => keepFocus(renderFreelancer), () => Pj.busy);
}
function renderFreelancer() {
  const a = R.data.agreement;
  if (a && a.status === 'approved' && !R.showAgreement) drawProject(); else drawReview();
}

function drawReview(err) {
  const { project, agreement, messages = [], milestones = [] } = R.data;
  if (!agreement) {
    return mount(el('div', { class: 'wrap' }, el('button', { class: 'ghost small', onclick: () => go('/') }, '← All projects'),
      el('div', { class: 'empty', style: 'margin-top:12px' }, el('b', {}, 'No agreement yet'), 'This chat has not been read yet.', el('br'), el('br'),
        el('button', { class: 'primary', onclick: async (ev) => {
          ev.target.disabled = true; ev.target.textContent = 'Reading the chat…';
          try { await api(`/api/projects/${project.id}/extract`, { body: {} }); viewReview(project.id); }
          catch (e) { ev.target.disabled = false; ev.target.textContent = 'Read the chat'; ev.target.after(errBox(e)); }
        } }, 'Read the chat'))));
  }
  const body = agreement.body;
  const cur = body.currency || CFG?.currency || 'USD';
  const frozen = agreement.status !== 'draft';
  const flagged = new Set((body.injection_flags || []).map((f) => f.msg_id));
  const en = body.translations?.en || {};
  const hasTr = Object.keys(en).length > 0;

  const chatPane = el('div', { class: 'chat', id: 'chatPane' }, messages.map((m) =>
    el('div', { class: `msg ${m.me ? 'me' : ''} ${R.hl === m.msg_id ? 'hl' : ''} ${flagged.has(m.msg_id) ? 'inj' : ''}`, id: `msg-${m.msg_id}` },
      el('span', { class: 'meta' }, `${m.msg_id} · ${m.sender || ''}${m.time ? ' · ' + m.time : ''}`),
      m.text,
      R.tr && en[m.msg_id] ? el('span', { class: 'tr', 'data-l': 'EN' }, en[m.msg_id]) : null)));
  const hl = (id) => {
    R.hl = id;
    document.querySelectorAll('.msg.hl').forEach((n) => n.classList.remove('hl'));
    const n = document.getElementById(`msg-${id}`);
    if (n) { n.classList.add('hl'); n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  };
  const chips = (ids) => (ids || []).map((id) => el('span', { class: 'chip', onclick: () => hl(id) }, id));

  const terms = (body.terms || []).map((t) => el('div', { class: 'field' }, el('dt', {}, t.label),
    el('dd', {}, t.value || el('span', { style: 'color:var(--warn)' }, '— missing'), ' ', chips(t.source_message_ids))));

  const gapsOpen = (body.gaps || []).filter((g) => !g.fixed).length;
  const gapEls = (body.gaps || []).map((g) => g.fixed
    ? el('div', { class: 'gap fixed' }, `✓ ${g.fix_label}`)
    : el('div', { class: 'gap' }, g.text, el('br'),
        frozen ? null : el('button', { class: 'small', style: 'margin-top:4px', onclick: async (ev) => {
          ev.target.disabled = true;
          try {
            const r = await api(`/api/agreements/${agreement.id}/gaps/${g.id}/fix`, { body: {} });
            R.data.agreement = r.agreement; R.data.milestones = r.milestones; drawReview();
          } catch (e) { ev.target.disabled = false; drawReview(e); }
        } }, g.fix_label)));
  const injEls = (body.injection_flags || []).map((f) => el('div', { class: 'gap inj' }, '⚠ ', el('b', {}, f.msg_id),
    ` contains an instruction aimed at the AI (${f.reason}). It was treated as chat text, ignored, and never obeyed. `, chips([f.msg_id])));

  const sum = milestones.reduce((a, m) => a + m.amount_minor, 0);
  const mismatch = sum !== body.total_minor;
  const mismatchBox = el('div');
  const sumLabel = el('span', {}, `total ${money(sum, cur)}`);
  const apHint = el('span', { class: 'muted small' }, ' This freezes version 1. Amounts can no longer be changed.');
  const apBtn = frozen ? null : el('button', { class: 'primary', id: 'apBtn', onclick: async (ev) => {
    ev.target.disabled = true; ev.target.textContent = 'Sending…';
    try {
      const r = await api(`/api/agreements/${agreement.id}/approve`, { body: { party: 'freelancer' } });
      R.data.agreement = r.agreement; drawReview();
    } catch (e) { drawReview(e); }
  } }, 'Approve & send to client');
  const setMismatch = (s) => {
    sumLabel.textContent = `total ${money(s, cur)}`;
    const small = milestones.some((x) => x.amount_minor < 100);
    const bad = s !== body.total_minor;
    mismatchBox.replaceChildren(bad
      ? el('div', { class: 'gap' }, `The parts add up to ${money(s, cur)} but the agreed total is ${money(body.total_minor, cur)}. Fix the amounts first.`)
      : small ? el('div', { class: 'gap' }, `Each part must be at least ${money(100, cur)}.`) : '');
    if (apBtn) { apBtn.disabled = bad || small; apHint.textContent = bad || small ? ' Fix the amounts above to enable this.' : ' This freezes version 1. Amounts can no longer be changed.'; }
  };
  const msEls = milestones.map((m) => {
    const amt = frozen ? el('span', {}, money(m.amount_minor, cur)) : el('input', { class: 'amt', type: 'text', inputmode: 'decimal', value: major(m.amount_minor), 'aria-label': `${m.label} amount in ${cur}` });
    if (!frozen) amt.addEventListener('change', async () => {
      const v = parseMinor(amt.value);
      if (v == null) { toast('Enter an amount like 240 or 240.50'); amt.value = major(m.amount_minor); return; }
      try {
        const r = await api(`/api/milestones/${m.id}`, { method: 'PATCH', body: { amount_minor: v } });
        m.amount_minor = r.milestone.amount_minor; amt.value = major(m.amount_minor);
        setMismatch(milestones.reduce((a, x) => a + x.amount_minor, 0));
      } catch (e) { toast(e.message); amt.value = major(m.amount_minor); }
    });
    return el('div', { class: 'ms' }, el('div', { class: 'top' }, el('b', {}, `${m.label} · ${m.title}`), el('span', {}, amt, frozen ? '' : ` ${cur}`)),
      el('ul', {}, (m.criteria || []).map((c) => el('li', {}, c))));
  });
  setMismatch(sum);

  const clientUrl = `${location.origin}/?as=client&p=${project.id}`;
  let approveArea;
  if (frozen) {
    approveArea = el('div', {},
      el('div', { class: 'okbox' }, agreement.status === 'approved' ? '✓ Both of you approved this agreement.' : '✓ You approved version 1 and it is frozen. Send this link to your client:',
        el('div', { class: 'linkbox', style: 'margin-top:6px' }, el('input', { readonly: true, value: clientUrl, 'aria-label': 'Client link', onfocus: (e) => e.target.select() }),
          el('button', { onclick: () => copyText(clientUrl, 'Client link') }, 'Copy link'),
          el('a', { href: clientUrl, target: '_blank', rel: 'noopener' }, el('button', { class: 'primary' }, 'Open client view'))),
        agreement.content_hash ? el('div', { style: 'margin-top:6px' }, 'Fingerprint ', el('span', { class: 'hash' }, agreement.content_hash.slice(0, 22) + '…')) : null));
  } else {
    approveArea = el('div', {}, apBtn, apHint);
  }

  mount(el('div', { class: 'wrap' },
    el('div', { class: 'row', style: 'justify-content:space-between' },
      el('div', {}, agreement.status === 'approved' ? el('button', { class: 'ghost small', onclick: () => { R.showAgreement = false; renderFreelancer(); } }, '← Back to project') : el('button', { class: 'ghost small', onclick: () => go('/') }, '← All projects'), el('h2', { style: 'margin-top:8px' }, body.title || 'Agreement draft')),
      pill(frozen ? agreement.status : 'draft')),
    err ? errBox(err) : null,
    el('div', { class: 'col2' },
      el('div', {},
        el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, el('h4', { style: 'margin:0' }, 'Source chat'),
          hasTr ? el('label', { class: 'small row', style: 'gap:6px' }, 'Translate to English',
            el('select', { onchange: (e) => { R.tr = e.target.value === 'en'; drawReview(); } },
              el('option', { value: 'en', selected: R.tr }, 'English'), el('option', { value: '', selected: !R.tr }, 'Off (original only)'))) : null),
        R.tr ? el('p', { class: 'small muted', style: 'margin:0 0 6px' }, 'Translated by AI. Check prices and dates against the original.') : null,
        messages.length ? chatPane : el('div', { class: 'empty' }, el('b', {}, 'No messages'), 'The chat is empty.')),
      el('div', {},
        el('div', { class: 'card' }, el('h4', {}, 'Terms (tap a chip to see where it came from)'), el('dl', { style: 'margin:0' }, terms.length ? terms : el('p', { class: 'muted small' }, 'No terms found.'))),
        el('div', { class: 'card' }, el('h4', {}, `Gaps found · ${gapsOpen} open`), gapEls, injEls, !gapEls.length && !injEls.length ? el('p', { class: 'muted small' }, 'No gaps found.') : null),
        el('div', { class: 'card' }, el('h4', {}, 'Milestones · ', sumLabel), msEls.length ? msEls : el('p', { class: 'muted small' }, 'No milestones found.'), mismatchBox,
          frozen ? null : el('p', { class: 'small muted' }, 'The AI split is shown. You can change any amount before approving.')),
        approveArea))));
  if (R.hl) setTimeout(() => { const n = document.getElementById(`msg-${R.hl}`); if (n) n.scrollIntoView({ block: 'nearest' }); }, 0);
}

// ---------------------------------------------------------------- freelancer project page (vSubmit + project)
const Pj = { picked: [], err: null, upPct: null, busy: false, msg: null, rf: null, gd: null };

function notesBox(d, to) {
  const list = (d.notifications || []).filter((n) => n.to === to).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 3);
  if (!list.length) return null;
  return el('div', { class: 'notes' }, el('b', {}, 'Latest updates'),
    list.map((n) => el('div', { class: 'note' }, el('span', { class: 'muted' }, `${fmtDate(n.at)} · `), n.text)));
}
function fileRow(f) {
  return el('div', { class: 'frow' },
    el('span', { class: 'thumb' }, (f.filename.split('.').pop() || '').slice(0, 4).toUpperCase()),
    el('span', { class: 'fname', title: f.filename }, f.filename),
    el('span', { class: 'muted' }, fmtSize(f.size)),
    el('a', { href: viewUrl(f.download_url), target: '_blank', rel: 'noopener' }, 'View'),
    el('a', { href: f.download_url }, 'Download'));
}
function holdLine(m, cur) {
  const p = m.payment;
  if (!p || !['authorized', 'submitted', 'revision_requested'].includes(m.status)) return null;
  return el('p', { class: 'small', style: 'margin:4px 0' }, `PayPal is holding ${money(m.amount_minor, m.currency || cur)}`,
    p.expires_at ? ` · hold expires ${fmtDate(p.expires_at)}` : '', el('span', { class: 'muted' }, ' · the client is not charged until they approve the work'));
}

function uploadFiles(m) {
  const fd = new FormData();
  Pj.picked.forEach((f) => fd.append('files[]', f, f.name));
  Pj.busy = true; Pj.err = null; Pj.upPct = 0; drawProject();
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/milestones/${m.id}/deliverables`);
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) { Pj.upPct = Math.round((e.loaded / e.total) * 100); const b = document.getElementById('upBar'); if (b) { b.value = Pj.upPct; document.getElementById('upTxt').textContent = Pj.upPct < 100 ? `Uploading… ${Pj.upPct}%` : 'Checking the files…'; } } };
  const fail = (msg) => { Pj.busy = false; Pj.upPct = null; Pj.err = msg; drawProject(); };
  xhr.onerror = () => fail('Could not reach the server. Check that it is running and try again.');
  xhr.onload = async () => {
    let data = {}; try { data = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status < 200 || xhr.status >= 300) return fail(data.message || `Upload failed (${xhr.status}).`);
    Pj.picked = []; Pj.upPct = null; Pj.busy = false;
    try { R.data = await api(`/api/projects/${R.pid}`); } catch (e) { Pj.err = e.message; }
    drawProject();
  };
  xhr.send(fd);
}
async function submitWork(m) {
  Pj.busy = true; Pj.err = null; drawProject();
  try {
    await api(`/api/milestones/${m.id}/submit`, { body: {} });
    Pj.msg = `${m.label} was sent for review.`;
  } catch (e) { Pj.err = e.message + (e.code ? ` (${e.code})` : ''); }
  Pj.busy = false;
  try { R.data = await api(`/api/projects/${R.pid}`); } catch {}
  drawProject();
}

function submitPanel(m, d) {
  const cur = d.agreement?.body?.currency || CFG?.currency || 'USD';
  const clientName = d.project.client || 'the client';
  const revising = m.status === 'revision_requested';
  const fileIn = el('input', { type: 'file', multiple: true, accept: '.pdf,.png,.jpg,.jpeg,.zip,.mp4', id: 'fileIn', disabled: Pj.busy, onchange: (ev) => {
    for (const f of ev.target.files) {
      if (!ACCEPT.test(f.name)) { toast(`${f.name}: only PDF, PNG, JPG, ZIP or MP4 files`); continue; }
      if (f.size > MAX_BYTES) { toast(`${f.name} is over 20 MB`); continue; }
      Pj.picked.push(f);
    }
    ev.target.value = ''; drawProject();
  } });
  const picked = Pj.picked.map((f, i) => el('div', { class: 'frow' },
    el('span', { class: 'thumb' }, (f.name.split('.').pop() || '').slice(0, 4).toUpperCase()), el('span', { class: 'fname' }, f.name),
    el('span', { class: 'muted' }, fmtSize(f.size)), el('button', { class: 'ghost', disabled: Pj.busy, onclick: () => { Pj.picked.splice(i, 1); drawProject(); }, 'aria-label': `Remove ${f.name}` }, '✕')));
  const ver = m.rev_count + 1;
  return el('div', { class: 'card' },
    el('h4', {}, `${m.label} · send your work`),
    revising ? el('div', { class: 'gap' }, el('b', {}, `${clientName} asked for changes`), ` (revision ${m.rev_count}${m.rev_limit ? ` of ${m.rev_limit}` : ''}):`, el('br'), m.rev_note || '(no note)') : null,
    el('div', { class: 'col2' },
      el('div', {}, el('h4', {}, 'What was agreed'), el('ul', { class: 'small' }, (m.criteria || []).map((c) => el('li', {}, c))),
        el('p', { class: 'small muted' }, `${clientName} checks your files against this list. No AI review.`)),
      el('div', {},
        el('h4', {}, `Your files · version ${ver}`),
        m.deliverables.length ? m.deliverables.map(fileRow) : el('p', { class: 'small muted' }, revising ? 'Nothing uploaded for this revision yet.' : 'No files uploaded yet.'),
        el('div', { class: 'drop' }, el('b', { class: 'small' }, 'Add files'), el('div', { class: 'muted small' }, 'PDF, PNG, JPG, ZIP or MP4. Up to 20 MB each. Files you upload are added to this version.'),
          el('div', { style: 'margin-top:6px' }, fileIn), picked),
        Pj.busy && Pj.upPct != null ? el('div', { class: 'small', style: 'margin-top:6px' }, el('span', { id: 'upTxt' }, `Uploading… ${Pj.upPct}%`), el('progress', { id: 'upBar', max: 100, value: Pj.upPct, style: 'width:100%' })) : null,
        el('div', { class: 'row', style: 'margin-top:8px' },
          el('button', { disabled: Pj.busy || !Pj.picked.length, onclick: () => uploadFiles(m) }, Pj.picked.length ? `Upload ${Pj.picked.length} file${Pj.picked.length === 1 ? '' : 's'}` : 'Upload'),
          el('button', { class: 'primary', disabled: Pj.busy || !m.deliverables.length || Pj.picked.length > 0, onclick: () => submitWork(m) }, Pj.busy && Pj.upPct == null ? 'Sending…' : 'Submit for review')),
        Pj.picked.length ? el('p', { class: 'small muted' }, 'Upload your chosen files first, then submit.') : null,
        Pj.err ? errBox({ message: Pj.err }) : null)));
}

function drawProject() {
  const d = R.data; const { project, agreement, milestones = [] } = d;
  const cur = agreement.body.currency || CFG?.currency || 'USD';
  const clientName = project.client || 'the client';
  const clientUrl = `${location.origin}/?as=client&p=${project.id}`;
  const cards = milestones.map((m) => {
    const card = el('div', { class: `ms${m.is_current ? ' cur' : ''}` },
      el('div', { class: 'top' }, el('b', {}, `${m.label} · ${m.title}`), el('span', { class: 'row', style: 'gap:8px' }, money(m.amount_minor, m.currency || cur), pill(m.status))),
      holdLine(m, cur));
    if (m.status === 'agreed') card.append(el('p', { class: 'small muted', style: 'margin:4px 0 0' }, m.fundable ? `Waiting for ${clientName} to pay ${money(m.amount_minor, m.currency || cur)} into PayPal hold. Start once it shows "Paid into hold".` : 'Unlocks after the previous part is paid.'));
    if (m.status === 'submitted') {
      card.append(el('p', { class: 'small', style: 'margin:6px 0' }, `✓ Sent. Waiting for ${clientName} to review.`), ...m.deliverables.map(fileRow));
    }
    if (m.status === 'paid') {
      card.append(el('p', { class: 'small', style: 'margin:4px 0', 'data-capture': '' }, `Paid ${money(m.amount_minor, m.currency || cur)}`, m.payment?.capture_id ? el('span', { class: 'muted' }, ` · PayPal capture ${m.payment.capture_id}`) : null));
      if (m.deliverables.length) card.append(el('details', {}, el('summary', { class: 'muted small', style: 'cursor:pointer' }, `Files (${m.deliverables.length})`), m.deliverables.map(fileRow)));
    }
    if (m.status === 'voided') card.append(el('p', { class: 'small', style: 'margin:4px 0' }, `${clientName} cancelled this part. The PayPal hold was released and nothing was charged. Later parts will not start.`));
    return card;
  });
  const cur_m = milestones.find((m) => m.is_current && ['authorized', 'revision_requested'].includes(m.status));
  const allPaid = milestones.length && milestones.every((m) => m.status === 'paid');
  mount(el('div', { class: 'wrap' },
    el('div', { class: 'row', style: 'justify-content:space-between' },
      el('div', {}, el('button', { class: 'ghost small', onclick: () => go('/') }, '← All projects'), el('h2', { style: 'margin-top:8px' }, agreement.body.title || project.title || 'Project')),
      pill(project.status)),
    Pj.msg && milestones.some((m) => m.is_current && m.status === 'submitted') ? el('div', { class: 'okbox' }, Pj.msg) : null,
    notesBox(d, 'freelancer'),
    allPaid ? el('div', { class: 'okbox' }, 'All parts are delivered and paid. Files stay available on this page.') : null,
    cur_m ? submitPanel(cur_m, d) : null,
    el('h4', { style: 'margin-top:14px' }, 'Milestones'),
    milestones.length ? cards : el('div', { class: 'empty' }, el('b', {}, 'No milestones'), 'This agreement has no milestones.'),
    el('div', { class: 'card' }, el('h4', {}, 'Client link'),
      el('div', { class: 'linkbox' }, el('input', { readonly: true, value: clientUrl, 'aria-label': 'Client link', onfocus: (e) => e.target.select() }),
        el('button', { onclick: () => copyText(clientUrl, 'Client link') }, 'Copy link'),
        el('a', { href: clientUrl, target: '_blank', rel: 'noopener' }, el('button', {}, 'Open client view')),
        el('button', { class: 'ghost', onclick: () => { R.showAgreement = true; renderFreelancer(); } }, 'View agreement'))),
    changeCard(d),
    timelineCard(milestones),
    ledgerCard(d, cur, el('button', { class: 'small ghost', disabled: Pj.rf?.busy, onclick: doRefresh }, Pj.rf?.busy ? 'Checking PayPal…' : 'Refresh from PayPal')),
    refreshBox(),
    deliverablesCard(milestones),
    activityCard(d),
    runsCard(d),
    guardrailCard(d)));
}

// ---------------------------------------------------------------- project page sections (vProject)
const LEDGER_TEXT = { AUTHORIZED: 'Client payment held by PayPal', CAPTURED: 'Paid out to the freelancer', VOIDED: 'Hold released, nothing charged', REFUNDED: 'Refunded to the client' };
const EVENT_TEXT = { 'milestone.submitted': 'Work was submitted', 'proposal.approved': 'Client approved the payment', 'proposal.voided': 'Client cancelled and released the hold' };
const STEP_TEXT = { get_order: 'Checked the order with PayPal', propose_release: 'Asked the client to approve the payment', capture_authorization: 'Captured the held payment',
  void_authorization: 'Released the PayPal hold', notify: 'Told both sides' };
const WHO = { ai: ['AI', 'AI'], pp: ['PP', 'PayPal'], agent: ['AG', 'Agent'], client: ['CL', 'Client'], free: ['FR', 'Freelancer'], sys: ['SY', 'System'] };
const fmtDateTime = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const usd = (v) => `$${Number(v || 0).toFixed(4)}`;

function timelineCard(milestones) {
  if (!milestones.length) return el('div', { class: 'card' }, el('h4', {}, 'Timeline'), el('p', { class: 'muted small' }, 'No milestones yet.'));
  let prevEnd = 0;
  const rows = milestones.map((m) => {
    const start = m.start_day ?? prevEnd; const end = Math.max(m.end_day ?? start + 3, start + 1); prevEnd = end;
    return { m, start, end };
  });
  const span = Math.max(1, ...rows.map((r) => r.end));
  const bars = rows.map(({ m, start, end }) => {
    const blocked = ['draft', 'agreed'].includes(m.status) && !m.fundable;
    const cls = blocked ? 'blocked' : m.status;
    const tip = blocked ? `${m.label}: locked until the earlier parts are paid` : `${m.label}: ${pillText(m.status)}`;
    return el('div', { class: 'r' }, el('span', { title: m.title }, `${m.label} ${m.title}`),
      el('div', { class: 'track' }, el('div', { class: `b ${cls}`, style: `left:${(start / span) * 100}%;width:${Math.max(2, ((end - start) / span) * 100)}%`, title: tip, role: 'img', 'aria-label': tip })));
  });
  return el('div', { class: 'card' }, el('h4', {}, 'Timeline'),
    el('div', { class: 'tl' }, el('div', { class: 'axis' }, el('span', {}, 'Day 0'), el('span', {}, `Day ${Math.round(span / 2)}`), el('span', {}, `Day ${span}`)), bars),
    el('p', { class: 'small muted', style: 'margin:6px 0 0' }, 'Hatched bars are locked: they start only after the part before them is paid.'));
}

function ledgerCard(d, cur, extra) {
  const rows = [...(d.ledger || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const latest = new Map(); rows.forEach((l) => latest.set(l.milestone_id, l));
  let held = 0; latest.forEach((l) => { if (l.event === 'AUTHORIZED') held += l.amount_minor; });
  const paid = rows.reduce((a, l) => a + (l.event === 'CAPTURED' ? l.amount_minor : l.event === 'REFUNDED' ? -l.amount_minor : 0), 0);
  return el('div', { class: 'card' },
    el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, el('h4', { style: 'margin:0' }, 'Payment ledger'), extra || null),
    rows.length
      ? el('div', { class: 'tablewrap' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, 'Time'), el('th', {}, 'Part'), el('th', {}, 'What happened'), el('th', {}, 'PayPal id'), el('th', { class: 'num' }, 'Amount'))),
        el('tbody', {}, rows.map((l) => el('tr', {}, el('td', {}, fmtDateTime(l.at)), el('td', {}, l.label || ''), el('td', {}, LEDGER_TEXT[l.event] || l.event),
          el('td', { class: 'mono', title: l.paypal_id || '' }, l.paypal_id ? (l.paypal_id.length > 14 ? l.paypal_id.slice(0, 14) + '…' : l.paypal_id) : ''), el('td', { class: 'num' }, money(l.amount_minor, cur)))))))
      : el('p', { class: 'muted small' }, 'No PayPal activity yet. Rows appear when a part is funded, paid or cancelled.'),
    el('div', { class: 'row small', style: 'margin-top:8px;gap:16px' }, el('span', {}, 'Held by PayPal now: ', el('b', {}, money(held, cur))), el('span', {}, 'Paid out: ', el('b', {}, money(paid, cur)))));
}

function deliverablesCard(milestones) {
  const withFiles = milestones.filter((m) => (m.deliverables || []).length || m.versions);
  return el('div', { class: 'card' }, el('h4', {}, 'Deliverables'),
    withFiles.length ? withFiles.map((m) => el('div', { style: 'margin-bottom:8px' },
      el('b', { class: 'small' }, `${m.label} ${m.title}`), ' ', pill(m.status), ' ',
      el('span', { class: 'muted small' }, `version ${m.rev_count + 1}${m.versions > 1 ? ` · ${m.versions} versions kept` : ''}`),
      (m.deliverables || []).length ? m.deliverables.map(fileRow) : el('p', { class: 'muted small', style: 'margin:2px 0' }, 'Waiting for new files.')))
      : el('p', { class: 'muted small' }, 'No files submitted yet.'));
}

function activityCard(d) {
  const rows = [...(d.activity || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);
  return el('div', { class: 'card' }, el('h4', {}, 'Activity'),
    rows.length ? el('div', { class: 'feed' }, rows.map((a) => { const w = WHO[a.who] || WHO.sys;
      return el('div', { class: 'item' }, el('span', { class: `who who-${a.who}`, title: w[1] }, w[0]), el('span', { class: 'txt' }, a.text), el('span', { class: 'when muted' }, fmtDateTime(a.at))); }))
      : el('p', { class: 'muted small' }, 'Nothing has happened yet.'));
}

function runsCard(d) {
  const runs = [...(d.agent_runs || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8);
  const ms = new Map((d.milestones || []).map((m) => [m.id, m]));
  return el('div', { class: 'card' }, el('h4', {}, 'Milestone Agent runs'),
    runs.length ? runs.map((r) => el('div', { class: 'run' },
      el('div', { class: 'row small', style: 'gap:6px' }, el('b', {}, `${ms.get(r.milestone_id)?.label || ''} ${EVENT_TEXT[r.event] || r.event}`.trim()),
        el('span', { class: 'badge', title: r.mode === 'fallback' ? 'The AI model was too slow or failed, so fixed rules ran instead' : 'The AI model chose the steps' }, r.mode === 'fallback' ? 'fallback rules' : 'AI model'),
        el('span', { class: 'muted' }, fmtDateTime(r.at))),
      el('ol', { class: 'trace' }, (r.steps || []).map((s) => el('li', {}, s.ok === false ? '✗ ' : '✓ ', STEP_TEXT[s.tool] || 'Ran a step', s.ok === false && s.result?.error ? el('span', { class: 'muted' }, ` (${s.result.error})`) : null)))))
      : el('p', { class: 'muted small' }, 'The agent has not run yet. It runs when work is submitted or the client decides.'),
    el('p', { class: 'small muted', style: 'margin:6px 0 0' }, 'AI cost so far: ', el('b', {}, usd(d.ai_cost?.cost_usd)), ` over ${d.ai_cost?.calls ?? 0} AI call${d.ai_cost?.calls === 1 ? '' : 's'}.`));
}

async function doRefresh() {
  Pj.rf = { busy: true }; drawProject();
  try {
    const r = await api(`/api/projects/${R.pid}/refresh`, { body: {} });
    Pj.rf = { rows: r.payments || [] };
    try { R.data = await api(`/api/projects/${R.pid}`); } catch { /* keep the old data */ }
  } catch (e) { Pj.rf = { err: e }; }
  drawProject();
}
async function doGuardrail(m) {
  Pj.gd = { busy: true }; drawProject();
  try { Pj.gd = { res: await api('/api/agent/guardrail-test', { body: { milestone_id: m.id } }) }; }
  catch (e) { Pj.gd = { err: e }; }
  drawProject();
}
function refreshBox() {
  const r = Pj.rf; if (!r || r.busy) return null;
  if (r.err) return errBox(r.err);
  const lines = r.rows.map((p) => {
    const label = (R.data.milestones || []).find((m) => m.id === p.milestone_id)?.label || '';
    return el('div', {}, `${label} PayPal says: order ${p.order_status || 'unknown'}, hold ${p.authorization_status || 'none'}, payment ${p.capture_status || 'none'}.`);
  });
  return el('div', { class: 'okbox small' }, el('b', {}, 'Checked with PayPal. '), lines.length ? lines : 'No PayPal payments to check yet.');
}
function guardrailCard(d) {
  const ms = d.milestones || []; const m = ms.find((x) => x.is_current) || ms[ms.length - 1];
  const g = Pj.gd; let out = null;
  if (g?.err) out = errBox(g.err);
  else if (g?.res) {
    const blocked = g.res.result?.error === 'NO_APPROVAL';
    out = el('div', { class: blocked ? 'okbox' : 'err', role: 'status' },
      blocked ? el('b', {}, "Blocked: NO_APPROVAL — the agent cannot move money without the client's approval.")
        : el('b', {}, `Unexpected result: ${g.res.result?.error || 'not blocked'}`),
      g.res.proposal_id ? el('div', { class: 'small' }, 'Forged proposal id used: ', el('span', { class: 'hash' }, g.res.proposal_id)) : null,
      g.res.trace ? el('pre', { class: 'tracebox' }, String(g.res.trace)) : null,
      el('div', { class: 'small muted' }, 'PayPal was not called.'));
  }
  return el('div', { class: 'card' }, el('h4', {}, 'Safety check'),
    el('p', { class: 'small', style: 'margin:0 0 6px' }, 'Try to make the agent capture money with a made-up approval. The code must refuse.'),
    el('button', { disabled: !m || g?.busy, onclick: () => doGuardrail(m) }, g?.busy ? 'Testing…' : 'Test the guardrail'), out ? el('div', { style: 'margin-top:6px' }, out) : null);
}

function changeCard(d) {
  const open = (d.change_requests || []).find((c) => c.status === 'open' || c.status === 'sent');
  const clientName = d.project.client || 'The client';
  let body;
  if (!open) body = el('p', { class: 'muted small', style: 'margin:0' }, 'No open change request. Raise one if the scope needs to change, or when the client sends you one on chat.');
  else if (open.status === 'sent') body = el('p', { class: 'small', style: 'margin:0' }, `Quote sent: ${open.sent_version?.title || 'new work'}. Waiting for ${clientName} to accept or decline.`);
  else body = el('p', { class: 'small', style: 'margin:0' }, open.from === 'client' ? el('b', {}, `${clientName} requested a change. `) : 'You opened a change request. ', 'Review it and decide.');
  return el('div', { class: 'card', style: open?.status === 'open' && open.from === 'client' ? 'border-color:var(--warn)' : null },
    el('div', { class: 'row', style: 'justify-content:space-between' }, el('h4', { style: 'margin:0' }, 'Change requests'),
      el('button', { class: open?.status === 'open' ? 'primary small' : 'small', onclick: () => go(`/p/${d.project.id}/scope`) }, open ? 'Review request' : 'Raise a change request')),
    el('div', { style: 'margin-top:6px' }, body));
}

// ---------------------------------------------------------------- scope screen (vScope, freelancer)
const Sc = { id: null, title: '', items: [], price: '', q: null, err: null, busy: false, text: '', creating: false, createErr: null, chain: Promise.resolve() };
const VERDICT = {
  new_work: { cls: 'fail', label: 'NEW WORK', note: 'Not covered by the agreement. You can quote it as a new part.' },
  in_scope: { cls: 'pass', label: 'ALREADY IN SCOPE', note: 'Already covered by what was agreed. No new price is needed.' },
  revision: { cls: 'human', label: 'REVISION', note: 'Looks like a revision of existing work, which the agreement already covers.' },
};
async function viewScope(pid) {
  mount(el('div', { class: 'wrap' }, loadingBox('Loading change requests…')));
  try { R.data = await api(`/api/projects/${pid}`); R.pid = pid; }
  catch (e) { return mount(el('div', { class: 'wrap' }, errBox(e), el('button', { onclick: () => viewScope(pid) }, 'Try again'), ' ', el('button', { onclick: () => go('/') }, 'Back to projects'))); }
  Sc.err = null; Sc.createErr = null; Sc.q = null; Sc.busy = false; Sc.creating = false;
  drawScope();
  startPoll(pid, () => true, () => sigOf(R.data), (x) => { R.data = x; }, () => keepFocus(drawScope), () => Sc.busy || Sc.creating);
}
function initDraft(c) {
  if (Sc.id === c.id) return;
  const dr = c.draft || {};
  Sc.id = c.id; Sc.title = dr.title || ''; Sc.items = [...(dr.deliverables || [])]; Sc.price = major(dr.amount_minor || 0); Sc.err = null; Sc.q = null;
}
function drawScope() {
  const d = R.data; const { project } = d;
  const cur = d.agreement?.body?.currency || CFG?.currency || 'USD';
  const crs = d.change_requests || [];
  const open = crs.find((c) => c.status === 'open' || c.status === 'sent');
  const past = crs.filter((c) => c !== open).reverse();
  const wrap = el('div', { class: 'wrap' },
    el('button', { class: 'ghost small', onclick: () => go(`/p/${project.id}`) }, '← Back to project'),
    el('h2', { style: 'margin-top:8px' }, 'Change requests'),
    el('p', { class: 'muted' }, `${project.client || 'The client'} can ask for changes from their phone, or you can paste one they sent you on chat. The AI compares it with the agreement. You make the final call.`));
  if (!d.agreement || d.agreement.status !== 'approved') {
    wrap.append(el('div', { class: 'empty' }, el('b', {}, 'Not open yet'), 'Change requests are possible once both sides approved the agreement.'));
  } else if (open) wrap.append(crCard(open, d, cur));
  else wrap.append(newRequestForm(project));
  if (past.length) wrap.append(el('h4', { style: 'margin-top:14px' }, 'Earlier requests'), ...past.map((c) => el('div', { class: 'card small' },
    el('div', { class: 'row', style: 'justify-content:space-between' }, el('b', {}, c.sent_version?.title || (c.text.length > 60 ? c.text.slice(0, 60) + '…' : c.text)),
      el('span', { class: `pill ${c.status === 'accepted' ? 'paid' : c.status === 'declined' ? 'voided' : ''}` }, { accepted: 'Accepted', declined: 'Declined', closed: 'Closed' }[c.status] || c.status)),
    el('div', { class: 'muted' }, `${c.from === 'client' ? 'From the client' : 'From you'} · ${fmtDate(c.created_at)}`))));
  mount(wrap);
}
function newRequestForm(project) {
  const errSlot = el('div');
  const ta = el('textarea', { id: 'scopeIn', rows: 3, maxlength: 1000, placeholder: `Paste or describe the change${project.client ? ` ${project.client} asked for` : ''} (at least 5 characters)`, value: Sc.text, disabled: Sc.creating,
    oninput: () => { Sc.text = ta.value; btn.disabled = Sc.creating || Sc.text.trim().length < 5; } });
  const btn = el('button', { class: 'primary', disabled: Sc.creating || Sc.text.trim().length < 5, onclick: async () => {
    Sc.creating = true; Sc.createErr = null; drawScope();
    try { await api(`/api/projects/${project.id}/change-requests`, { body: { message: Sc.text.trim(), from: 'freelancer' } }); Sc.text = ''; Sc.id = null; R.data = await api(`/api/projects/${project.id}`); }
    catch (e) { Sc.createErr = e; }
    Sc.creating = false; drawScope();
  } }, 'Check against agreement');
  return el('div', { class: 'card' }, el('h4', {}, 'Raise a change request'),
    el('div', { class: 'empty', style: 'padding:14px;margin-bottom:8px' }, 'No open change request.'),
    ta, el('div', { class: 'row', style: 'margin-top:8px' }, btn, Sc.creating ? loadingBox('Checking against the agreement…') : null),
    Sc.createErr ? errBox(Sc.createErr) : errSlot);
}
function crCard(c, d, cur) {
  const clientName = d.project.client || 'The client';
  const v = VERDICT[c.classification];
  const msgs = d.messages || [];
  const quoteSlot = el('div');
  const showQuote = (id) => {
    const m = msgs.find((x) => x.msg_id === id);
    quoteSlot.replaceChildren(Sc.q === id ? '' : el('div', { class: 'msg', style: 'max-width:100%;margin-top:6px' }, el('span', { class: 'meta' }, m ? `${m.msg_id} · ${m.sender || ''}` : id), m ? m.text : 'This message is not in the chat.'));
    Sc.q = Sc.q === id ? null : id;
  };
  const chips = (c.reason_source_ids || []).map((id) => el('button', { class: 'chip', type: 'button', onclick: () => showQuote(id), 'aria-label': `Show chat message ${id}` }, id));
  const out = [
    el('div', { class: 'card', style: 'border-color:var(--warn)' }, el('h4', {}, `From ${c.from === 'client' ? clientName : 'you'} · ${fmtDate(c.created_at)}`),
      el('div', { class: 'msg', style: 'max-width:100%' }, c.text)),
    el('div', { class: 'card' }, el('div', { class: 'row' }, v ? el('span', { class: `res ${v.cls}`, style: 'padding:2px 8px' }, v.label) : el('span', { class: 'res human', style: 'padding:2px 8px' }, 'UNKNOWN'),
        el('span', { class: 'muted small' }, 'AI suggestion. You make the final call.')),
      el('p', { style: 'margin-top:8px' }, c.reason || (v ? v.note : ''), ' ', chips), quoteSlot,
      v && c.status === 'open' && c.classification !== 'new_work' ? el('p', { class: 'small muted' }, v.note) : null),
  ];
  if (c.status === 'sent') {
    const sv = c.sent_version || {};
    out.push(el('div', { class: 'card' }, el('h4', {}, 'Quote sent to the client'),
      el('div', { class: 'ms' }, el('div', { class: 'top' }, el('b', {}, `${sv.label || ''} · ${sv.title || ''}`), el('span', {}, money(sv.amount_minor || 0, cur))),
        el('ul', {}, (sv.deliverables || []).map((i) => el('li', {}, i)))),
      el('p', { class: 'muted small' }, `Waiting for ${clientName} to accept or decline. This page updates by itself.`)));
  } else if (c.classification === 'new_work' && c.draft) out.push(draftEditor(c, cur));
  else {
    const errSlot = el('div');
    const btn = el('button', { class: 'primary', onclick: async () => {
      btn.disabled = true; btn.textContent = 'Closing…';
      try { await api(`/api/change-requests/${c.id}/close`, { body: {} }); R.data = await api(`/api/projects/${d.project.id}`); drawScope(); }
      catch (e) { btn.disabled = false; btn.textContent = 'Close request'; errSlot.replaceChildren(errBox(e)); }
    } }, 'Close request');
    out.push(el('div', { class: 'row' }, btn, el('span', { class: 'muted small' }, 'Nothing to price. Tell the client on chat, then close this.')), errSlot);
  }
  return el('div', {}, out);
}
function draftEditor(c, cur) {
  initDraft(c);
  const ai = c.ai_draft || {};
  const errSlot = el('div'); const noteSlot = el('span', { class: 'muted small' });
  const pillSlot = el('span'); const resetSlot = el('span'); const priceNote = el('p', { class: 'small muted', style: 'margin:6px 0 0' });
  const sendBtn = el('button', { class: 'primary' });
  const cleanItems = () => Sc.items.map((x) => x.trim()).filter(Boolean);
  const edited = () => Sc.title.trim() !== (ai.title || '') || parseMinor(Sc.price) !== ai.amount_minor || JSON.stringify(cleanItems()) !== JSON.stringify(ai.deliverables || []);
  const paint = () => {
    const e = edited(); const p = parseMinor(Sc.price);
    pillSlot.replaceChildren(e ? el('span', { class: 'pill' }, 'edited') : '');
    resetSlot.replaceChildren(e ? el('button', { class: 'small ghost', type: 'button', onclick: reset }, 'Reset to AI draft') : '');
    priceNote.replaceChildren(`AI price: ${money(ai.amount_minor || 0, cur)}${ai.price_basis ? ` (${ai.price_basis})` : ''}.`, p != null && p !== ai.amount_minor ? el('b', {}, ` You set ${money(p, cur)}.`) : '');
    sendBtn.textContent = `Send ${money(p || 0, cur)} change order to client`;
    sendBtn.disabled = Sc.busy || p == null;
  };
  const save = (body) => {
    noteSlot.textContent = 'Saving…';
    Sc.chain = Sc.chain.then(async () => {
      try { const r = await api(`/api/change-requests/${c.id}`, { method: 'PATCH', body }); Object.assign(c, r.change_request); errSlot.replaceChildren(); noteSlot.textContent = 'Saved'; }
      catch (e) { noteSlot.textContent = ''; errSlot.replaceChildren(errBox(e)); }
    });
    return Sc.chain;
  };
  async function reset() {
    Sc.title = ai.title || ''; Sc.items = [...(ai.deliverables || [])]; Sc.price = major(ai.amount_minor || 0);
    await save({ title: Sc.title, deliverables: Sc.items, amount_minor: ai.amount_minor }); drawScope();
  }
  const title = el('input', { id: 'crTitle', value: Sc.title, maxlength: 120, 'aria-label': 'Milestone title', style: 'width:min(280px,100%);padding:3px 6px;display:inline-block',
    oninput: () => { Sc.title = title.value; paint(); }, onchange: () => save({ title: Sc.title.trim() }) });
  const price = el('input', { id: 'crPrice', value: Sc.price, inputmode: 'decimal', 'aria-label': `Price in ${cur}`, class: 'amt',
    oninput: () => { Sc.price = price.value; paint(); },
    onchange: () => { const v = parseMinor(price.value); if (v == null) { toast('Enter a price like 200 or 200.50'); Sc.price = major(parseMinor(Sc.price) ?? ai.amount_minor ?? 0); price.value = Sc.price; paint(); return; } save({ amount_minor: v }); } });
  const rows = Sc.items.map((it, i) => el('div', { class: 'row', style: 'gap:6px;margin-bottom:4px;flex-wrap:nowrap' },
    el('input', { id: `crItem-${i}`, value: it, maxlength: 120, placeholder: 'Describe a deliverable', 'aria-label': `Deliverable ${i + 1}`, style: 'padding:4px 6px',
      oninput: (e) => { Sc.items[i] = e.target.value; paint(); }, onchange: () => save({ deliverables: cleanItems() }) }),
    el('button', { class: 'small ghost', type: 'button', 'aria-label': `Remove deliverable ${i + 1}`, onclick: async () => { Sc.items.splice(i, 1); await save({ deliverables: cleanItems() }); drawScope(); } }, '✕')));
  sendBtn.addEventListener('click', async () => {
    Sc.busy = true; sendBtn.disabled = true; errSlot.replaceChildren();
    await Sc.chain;
    try { const r = await api(`/api/change-requests/${c.id}/send`, { body: {} }); Object.assign(c, r.change_request); Sc.busy = false; toast('Change order sent to the client'); drawScope(); }
    catch (e) { Sc.busy = false; paint(); errSlot.replaceChildren(errBox(e)); }
  });
  paint();
  return el('div', { class: 'card' },
    el('p', { class: 'small', style: 'margin:0 0 8px;color:var(--note)' }, "This is the AI's draft. Change anything it got wrong before you send it. ", pillSlot),
    el('div', { class: 'ms' },
      el('div', { class: 'top' }, el('b', { style: 'flex:1;min-width:0' }, `${ai.label || 'New'} · `, title), el('span', { style: 'white-space:nowrap' }, price, ` ${cur}`)),
      priceNote,
      el('h4', { style: 'margin:10px 0 4px' }, 'Deliverables'), rows,
      el('div', { class: 'row', style: 'margin-top:6px' }, el('button', { class: 'small', type: 'button', onclick: () => { Sc.items.push(''); drawScope(); const n = document.getElementById(`crItem-${Sc.items.length - 1}`); if (n) n.focus(); } }, '+ Add deliverable'), resetSlot, noteSlot)),
    el('div', { class: 'row' }, sendBtn, el('span', { class: 'muted small' }, 'The client sees exactly what is above.')), errSlot);
}

// ---------------------------------------------------------------- client view (vClient)
let sdkPromise = null;
function loadPayPalSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (!CFG?.paypal_client_id) return reject(new Error('PayPal is not set up on this server yet (missing client id).'));
    const q = new URLSearchParams({ 'client-id': CFG.paypal_client_id, intent: 'authorize', currency: CFG.api_currency || CFG.currency || 'USD', components: 'buttons', 'disable-funding': 'card,credit,paylater,venmo' });
    const s = el('script', { src: `https://www.paypal.com/sdk/js?${q}` });
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('The PayPal button did not load.')));
    s.onerror = () => reject(new Error('Could not load PayPal. Check your internet connection and try again.'));
    document.head.append(s);
  }).catch((e) => { sdkPromise = null; throw e; });
  return sdkPromise;
}

async function viewClient() {
  $('#side').textContent = 'Client'; $('#side').classList.add('client'); $('#homeLink').style.display = 'none';
  if (!CLIENT_PID) return mount(el('div', { class: 'wrap narrow' }, el('div', { class: 'empty' }, el('b', {}, 'No agreement link'), 'Ask the freelancer for the link they shared with you.')));
  mount(el('div', { class: 'wrap narrow' }, loadingBox('Loading the agreement…')));
  let d;
  try { d = await api(`/api/projects/${CLIENT_PID}`); }
  catch (e) { return mount(el('div', { class: 'wrap narrow' }, errBox(e), el('button', { onclick: viewClient }, 'Try again'))); }
  C.msg = null; C.err = null;
  drawClient(d);
  startPoll(CLIENT_PID, (x) => ['sent', 'active'].includes(x.project?.status), () => sigOf(C.d), (x) => { C.d = x; }, redrawClient, () => C.busy || C.crBusy);
}
const C = { d: null, msg: null, err: null, errFor: null, busy: false, revOpen: false, note: '', release: null, crText: '', crOpen: false, crBusy: false, crErr: null };
function redrawClient() { keepFocus(() => drawClient(C.d)); }
function drawClient(d, msg) {
  C.d = d; if (msg) C.msg = msg;
  const { project, agreement, milestones = [] } = d;
  const wrap = el('div', { class: 'wrap narrow' });
  if (!agreement || agreement.status === 'draft') {
    wrap.append(el('div', { class: 'empty', style: 'margin-top:30px' }, el('b', {}, 'Nothing here yet'), "The freelancer hasn't shared an agreement with you yet."),
      el('p', { style: 'text-align:center' }, el('button', { onclick: viewClient }, 'Check again')));
    return mount(wrap);
  }
  const b = agreement.body; const cur = b.currency || CFG?.currency || 'USD';
  wrap.append(el('div', { class: 'small muted' }, `${b.title || 'Project'} · from ${b.freelancer_name || 'freelancer'}`), el('h3', {}, 'Agreement'));

  const get = (k) => (b.terms || []).find((t) => t.key === k)?.value;
  const summary = el('div', { class: 'card small' },
    get('scope') ? el('p', {}, el('b', {}, 'What you get: '), get('scope')) : null,
    el('p', {}, el('b', {}, 'Price: '), `${money(b.total_minor, cur)} in ${milestones.length} part${milestones.length === 1 ? '' : 's'}. You pay each part only when that work is checked and you approve it.`),
    get('deadline') ? el('p', {}, el('b', {}, 'Deadline: '), get('deadline')) : null,
    el('p', {}, el('b', {}, 'Revisions: '), get('revisions') || el('span', { style: 'color:var(--warn)' }, 'not set')),
    milestones.map((m) => el('div', { class: 'row', style: 'justify-content:space-between;border-top:1px dashed var(--line);padding-top:4px' }, el('span', {}, `${m.label} ${m.title}`), el('b', {}, money(m.amount_minor, m.currency || cur)))));
  wrap.append(summary);

  if (agreement.status === 'sent') {
    const errSlot = el('div');
    wrap.append(el('div', { class: 'small muted', style: 'margin-bottom:8px' }, 'Fingerprint ', el('span', { class: 'hash' }, (agreement.content_hash || '').slice(0, 22) + '…')),
      el('button', { class: 'primary', style: 'width:100%', onclick: async (ev) => {
        ev.target.disabled = true; ev.target.textContent = 'Approving…';
        try { await api(`/api/agreements/${agreement.id}/approve`, { body: { party: 'client', content_hash: agreement.content_hash } }); viewClient(); }
        catch (e) { ev.target.disabled = false; ev.target.textContent = 'Approve agreement'; errSlot.replaceChildren(errBox(e)); }
      } }, 'Approve agreement'),
      el('p', { class: 'small muted', style: 'margin-top:6px' }, "Approving doesn't charge you."), errSlot);
    return mount(wrap);
  }

  wrap.append(el('div', { class: 'small', style: 'margin-bottom:8px' }, '✓ Agreement approved'));
  if (C.release) wrap.append(releaseTrace(C.release, cur));
  if (C.msg) wrap.append(C.msg);
  const notes = notesBox(d, 'client'); if (notes) wrap.append(notes);
  const buttons = [];
  const fname = b.freelancer_name || project.freelancer_name || 'the freelancer';
  const quote = (d.change_requests || []).find((c) => c.status === 'sent' && c.sent_version);
  if (quote) wrap.append(quoteCard(quote, cur, fname));
  wrap.append(el('h4', { style: 'margin-top:12px' }, 'Payments'));
  milestones.forEach((m) => {
    const card = el('div', { class: 'ms small' });
    card.append(el('div', { class: 'top' }, el('b', {}, `${m.label} ${m.title}`), pill(m.status)));
    const line = el('div', { class: 'row', style: 'justify-content:space-between;margin-top:4px' }, el('span', {}, money(m.amount_minor, m.currency || cur)));
    const left = m.rev_limit != null ? Math.max(0, m.rev_limit - m.rev_count) : null;
    const note = { authorized: `PayPal is holding this · ${fname} is working`, submitted: 'delivered · waiting for your review', revision_requested: `held · ${fname} is revising`, paid: 'paid ✓', voided: 'cancelled · hold released', refunded: 'refunded' }[m.status];
    if (note) line.append(el('span', { class: 'muted' }, note));
    card.append(line);
    if (['authorized', 'submitted', 'revision_requested'].includes(m.status) && m.payment?.expires_at) card.append(el('div', { class: 'muted', style: 'font-size:11px' }, `Hold expires ${fmtDate(m.payment.expires_at)}. You are not charged unless you approve.`));
    if (m.status === 'revision_requested') card.append(el('div', { class: 'gap', style: 'margin-top:6px' }, el('b', {}, 'Your note: '), m.rev_note || '', el('br'), `Round ${m.rev_count}${m.rev_limit != null ? ` of ${m.rev_limit}` : ''}. ${fname} will upload new files.`));
    if (m.fundable) {
      const slot = el('div', { class: 'pp-wrap' }, loadingBox('Loading the PayPal button…'));
      const err = el('div');
      const prev = milestones.filter((x) => x.seq < m.seq && x.status === 'paid').length;
      card.append(el('div', { style: 'margin-top:8px' }, prev ? el('div', { style: 'font-size:11px;margin-bottom:6px' }, 'Next up. Fund it so work can start.') : null,
        el('div', { class: 'small' }, `Pay ${money(m.amount_minor, m.currency || cur)} with PayPal`), slot, err,
        el('div', { class: 'muted', style: 'font-size:11px;text-align:center;margin-top:4px' }, "PayPal holds this amount. It's paid out only when you approve the work."),
        el('div', { id: `tl-${m.id}` })));
      buttons.push({ m, slot, err });
    } else if (m.status === 'agreed') {
      const earlier = milestones.filter((x) => x.seq < m.seq && x.status !== 'paid').pop();
      card.append(el('div', { class: 'lockline' }, `Unlocks after ${earlier ? earlier.label : 'the previous part'} is paid`));
    } else if (m.status === 'draft') card.append(el('div', { class: 'lockline' }, 'Waiting for the agreement to be approved'));
    if (m.status === 'submitted') card.append(reviewCard(m, d, cur, fname, left));
    else if (m.deliverables?.length && m.status !== 'draft') {
      card.append(el('details', { style: 'margin-top:6px' }, el('summary', { class: 'muted', style: 'cursor:pointer' }, `Files (${m.deliverables.length})`), m.deliverables.map(fileRow)));
    }
    wrap.append(card);
  });
  wrap.append(changeForm(d, fname));
  wrap.append(el('details', { class: 'card', style: 'margin-top:12px' }, el('summary', { style: 'cursor:pointer;font-weight:600' }, 'Project details'),
    el('div', { style: 'margin-top:8px' }, timelineCard(milestones), ledgerCard(d, cur))));
  wrap.append(el('p', { style: 'text-align:center' }, el('button', { class: 'ghost small', onclick: viewClient }, 'Refresh')));
  mount(wrap);
  buttons.forEach((x) => mountPayPal(x, d));
}

// ---- client: scope creep (request a change, accept or decline a quote)
async function crAct(fn) {
  C.busy = true; C.err = null; redrawClient();
  try { await fn(); } catch (e) { C.err = e.message + (e.code && e.code !== 'NETWORK' ? ` (${e.code})` : ''); C.errFor = 'cr'; }
  C.busy = false;
  try { C.d = await api(`/api/projects/${CLIENT_PID}`); } catch { /* keep the old data */ }
  redrawClient();
}
function quoteCard(c, cur, fname) {
  const sv = c.sent_version;
  return el('div', { class: 'card small', style: 'border-color:var(--warn)' },
    el('b', {}, c.from === 'client' ? `${fname}'s price for your request` : 'New work proposed'), el('br'),
    `${sv.label ? sv.label + ' ' : ''}${sv.title} · ${money(sv.amount_minor, cur)}`, el('br'),
    el('span', { class: 'muted' }, "This wasn't in the original agreement. You'd get:"),
    el('ul', { style: 'padding-left:16px;margin:4px 0' }, (sv.deliverables || []).map((i) => el('li', {}, i))),
    el('div', { class: 'row', style: 'margin-top:6px' },
      el('button', { class: 'primary small', disabled: C.busy, onclick: () => crAct(async () => {
        const r = await api(`/api/change-requests/${c.id}/decide`, { body: { accept: true } });
        C.msg = el('div', { class: 'okbox' }, `Accepted. ${r.milestone ? r.milestone.label + ' ' + r.milestone.title : 'The new part'} was added to your payments. You can pay for it once the earlier parts are paid.`);
      }) }, C.busy ? 'Working…' : 'Accept'),
      el('button', { class: 'small', disabled: C.busy, onclick: () => crAct(async () => {
        await api(`/api/change-requests/${c.id}/decide`, { body: { accept: false } });
        C.msg = el('div', { class: 'okbox' }, 'Declined. The agreement stays as it was.');
      }) }, 'Decline')),
    C.err && C.errFor === 'cr' ? errBox({ message: C.err }) : null);
}
function changeForm(d, fname) {
  const crs = d.change_requests || [];
  const open = crs.find((c) => c.status === 'open');
  const sent = crs.find((c) => c.status === 'sent');
  const last = [...crs].reverse().find((c) => c.from === 'client');
  const head = el('h4', { style: 'margin-top:12px' }, 'Need something else?');
  if (sent) return el('div', {}, head, el('p', { class: 'small muted' }, 'Answer the price above first. You can send another request after that.'));
  if (open) return el('div', {}, head, el('div', { class: 'card small' }, el('b', {}, open.from === 'client' ? `Request sent to ${fname}` : `${fname} opened a change request`),
    open.from === 'client' ? el('div', { class: 'msg', style: 'max-width:100%;margin:6px 0' }, open.text) : null,
    el('span', { class: 'muted' }, `Waiting for ${fname} to answer. This page updates by itself.`)));
  const done = last && ['closed', 'declined'].includes(last.status) ? el('p', { class: 'small muted' }, last.status === 'closed'
    ? `${fname} reviewed your last request and closed it. It was already covered by the agreement, or can be handled as a revision.` : 'You declined the last price. The agreement is unchanged.') : null;
  if (C.crBusy) return el('div', {}, head, loadingBox('Checking against the agreement…'));
  if (!C.crOpen) return el('div', {}, head, done, el('button', { style: 'width:100%', onclick: () => { C.crOpen = true; redrawClient(); } }, 'Request a change'));
  const ta = el('textarea', { id: 'crText', rows: 4, maxlength: 1000, placeholder: 'What would you like to add or change? (at least 5 characters)', value: C.crText,
    oninput: (e) => { C.crText = e.target.value; send.disabled = C.crText.trim().length < 5; } });
  const send = el('button', { class: 'primary', disabled: C.crText.trim().length < 5, onclick: async () => {
    C.crBusy = true; C.crErr = null; redrawClient();
    try {
      await api(`/api/projects/${CLIENT_PID}/change-requests`, { body: { message: C.crText.trim(), from: 'client' } });
      C.crText = ''; C.crOpen = false; C.msg = el('div', { class: 'okbox' }, `Request sent to ${fname}. They will check it and reply with a price if it is new work.`);
    } catch (e) { C.crErr = e.message + (e.code && e.code !== 'NETWORK' ? ` (${e.code})` : ''); }
    C.crBusy = false;
    try { C.d = await api(`/api/projects/${CLIENT_PID}`); } catch { /* keep the old data */ }
    redrawClient();
  } }, 'Send request');
  return el('div', {}, head, el('div', { class: 'revform', style: 'border-color:var(--ink)' }, ta,
    el('div', { class: 'row', style: 'margin-top:6px' }, send, el('button', { class: 'ghost', onclick: () => { C.crOpen = false; C.crErr = null; redrawClient(); } }, 'Cancel')),
    C.crErr ? errBox({ message: C.crErr }) : null));
}

const TOOL_TEXT = {
  get_order: () => 'Checked the PayPal order', propose_release: () => 'Asked for your approval',
  capture_authorization: (s, m) => `Captured ${money(m?.amount_minor ?? 0, m?.currency || 'USD')} from the PayPal hold`,
  void_authorization: () => 'Released the PayPal hold', notify: () => 'Told both sides',
};
function releaseTrace(rel, cur) {
  const steps = rel.agent_run?.steps || [];
  return el('div', { class: 'okbox' }, el('b', {}, `✓ ${rel.milestone?.label || 'Milestone'} approved and paid`),
    el('ol', { class: 'trace' }, steps.map((s) => el('li', {}, s.ok === false ? '✗ ' : '✓ ', (TOOL_TEXT[s.tool] || (() => 'Ran a step'))(s, rel.milestone)))),
    rel.payment?.capture_id ? el('div', { class: 'small' }, 'PayPal capture id ', el('span', { class: 'hash' }, rel.payment.capture_id)) : null,
    rel.next ? el('div', { class: 'small', style: 'margin-top:6px' }, el('b', {}, `Next: fund ${rel.next.label} ${rel.next.title} (${money(rel.next.amount_minor, rel.milestone?.currency || cur)}).`), ' The PayPal button is below.')
      : el('div', { class: 'small', style: 'margin-top:6px' }, 'That was the last part. Everything is paid.'));
}

function reviewCard(m, d, cur, fname, left) {
  const prop = m.proposal && m.proposal.action === 'release' && m.proposal.status === 'pending' ? m.proposal : null;
  const errSlot = C.err && C.errFor === m.id ? errBox({ message: C.err }) : null;
  const act = async (fn) => { C.busy = true; C.err = null; C.msg = null; redrawClient(); try { await fn(); } catch (e) { C.err = e.message + (e.code && e.code !== 'NETWORK' ? ` (${e.code})` : ''); C.errFor = m.id; } C.busy = false; try { C.d = await api(`/api/projects/${CLIENT_PID}`); } catch {} redrawClient(); };
  const noteIn = el('textarea', { id: 'revNote', rows: 3, maxlength: 1000, placeholder: 'Tell them what to change (at least 5 characters)', value: C.note, disabled: C.busy, oninput: (e) => { C.note = e.target.value; sendBtn.disabled = C.busy || C.note.trim().length < 5; } });
  const sendBtn = el('button', { class: 'primary', disabled: C.busy || C.note.trim().length < 5, onclick: () => act(async () => {
    await api(`/api/milestones/${m.id}/revision`, { body: { note: C.note.trim() } });
    C.note = ''; C.revOpen = false; C.msg = el('div', { class: 'okbox' }, `Revision requested. ${fname} will upload new files. PayPal keeps holding the money.`);
  }) }, 'Send revision request');
  const limitHit = left === 0;
  return el('div', { class: 'review', style: 'margin-top:8px' },
    el('div', { class: 'small' }, el('b', {}, `${fname} says ${m.label} is ready.`), ' Check the files against what was agreed:'),
    el('ul', { class: 'small' }, (m.criteria || []).map((c) => el('li', {}, c))),
    m.deliverables.length ? m.deliverables.map(fileRow) : el('p', { class: 'muted small' }, 'No files found for this delivery.'),
    !prop ? el('p', { class: 'muted small' }, 'Waiting for the payment request to be prepared. This page updates by itself.') : null,
    el('div', { class: 'col-btns' },
      el('button', { class: 'primary', disabled: C.busy || !prop, onclick: () => act(async () => {
        const r = await api(`/api/proposals/${prop.id}/approve`, { body: { party: 'client' } });
        C.release = r; C.msg = null;
      }) }, C.busy ? 'Working…' : `Approve & pay ${money(m.amount_minor, m.currency || cur)}`),
      el('button', { disabled: C.busy || limitHit, onclick: () => { C.revOpen = !C.revOpen; redrawClient(); } }, 'Request revision'),
      el('button', { class: 'ghost', disabled: C.busy || !prop, onclick: () => showModal(el('h3', {}, `Cancel ${m.label} and release the hold?`),
        el('p', { class: 'small' }, 'You are not charged. PayPal releases the hold and the work stops here.'),
        el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => { closeModal(); act(async () => {
          await api(`/api/proposals/${prop.id}/cancel`, { body: { party: 'client' } });
          C.msg = el('div', { class: 'okbox' }, 'Cancelled. You were not charged and the PayPal hold is released.');
        }); } }, 'Yes, cancel and release'), el('button', { onclick: closeModal }, 'Keep it'))) }, 'Cancel & release hold')),
    limitHit ? el('p', { class: 'small muted' }, 'No revision rounds left. You can approve or cancel.') : el('p', { class: 'small muted' }, left != null ? `${left} revision round${left === 1 ? '' : 's'} left.` : 'Revision rounds: no limit set.'),
    C.revOpen && !limitHit ? el('div', { class: 'revform' }, noteIn, el('div', { class: 'row', style: 'margin-top:6px' }, sendBtn, el('button', { class: 'ghost', onclick: () => { C.revOpen = false; redrawClient(); } }, 'Close'))) : null,
    errSlot);
}

async function mountPayPal({ m, slot, err }) {
  const say = (t, kind) => err.replaceChildren(t ? el('div', { class: kind === 'ok' ? 'okbox' : 'err', role: 'alert' }, t) : '');
  let pp;
  try { pp = await loadPayPalSdk(); }
  catch (e) { slot.replaceChildren(); return say(e.message); }
  slot.replaceChildren();
  try {
    pp.Buttons({
      style: { layout: 'vertical', shape: 'pill', label: 'paypal' },
      createOrder: async () => { say(''); const r = await api(`/api/milestones/${m.id}/order`, { body: {} }); return r.order_id; },
      onApprove: async (data) => {
        slot.replaceChildren(loadingBox('Confirming with PayPal…'));
        try {
          await api(`/api/milestones/${m.id}/authorize`, { body: { order_id: data.orderID } });
          const d = await api(`/api/projects/${CLIENT_PID}`);
          drawClient(d, el('div', { class: 'okbox' }, `✓ ${m.label} is funded. PayPal is holding ${money(m.amount_minor, m.currency || 'USD')}. Nothing is paid out until you approve the work.`));
        } catch (e) { slot.replaceChildren(); mountPayPal({ m, slot, err }); say(`${e.message} Your milestone is still unpaid, you can try again.`); }
      },
      onCancel: () => say('Payment cancelled. Nothing was charged. You can press the PayPal button again when you are ready.'),
      onError: (e) => say(`PayPal had a problem${e?.message ? ` (${String(e.message).slice(0, 140)})` : ''}. Nothing was charged. Please try again.`),
    }).render(slot).catch((e) => say(`Could not show the PayPal button: ${e.message}`));
  } catch (e) { say(`Could not show the PayPal button: ${e.message}`); }
  // fake-money login helper (localhost only; hidden on 403)
  try {
    const l = await api('/api/sandbox-login');
    const row = (label, v) => el('div', { class: 'r' }, el('span', {}, label), el('code', {}, v), el('button', { class: 'small', onclick: () => copyText(v, label) }, 'Copy'));
    const host = document.getElementById(`tl-${m.id}`);
    if (host) host.replaceChildren(el('div', { class: 'testlogin' }, el('b', {}, 'Test buyer login (fake money)'), el('div', {}, 'Use these in the PayPal popup. This is a sandbox, no real money moves.'), row('Email', l.email), row('Password', l.password)));
  } catch { /* 403 or not available: hide */ }
}

// ---------------------------------------------------------------- Judge mode (freelancer desktop + client phone, both live)
let phonePid = null;
function syncPhone(pid) {
  if (!JUDGE) return;
  const f = $('#phoneFrame');
  $('#phoneEmpty').hidden = !!pid; f.hidden = !pid;
  if (!pid) { phonePid = null; f.removeAttribute('src'); return; }
  if (pid !== phonePid) { phonePid = pid; f.src = `?as=client&p=${encodeURIComponent(pid)}&embed=1`; }
}
function setJudge(on) {
  JUDGE = on; document.body.classList.toggle('judge', on); $('#judgeTog').checked = on;
  const u = new URL(location.href);
  if (on) u.searchParams.set('judge', '1'); else { u.searchParams.delete('judge'); u.searchParams.delete('p'); }
  history.replaceState(null, '', u);
  if (!on) { phonePid = null; $('#phoneFrame').removeAttribute('src'); }
  route();
}

// ---------------------------------------------------------------- boot
(async function boot() {
  if (IS_EMBED) document.body.classList.add('embed');
  try { CFG = await api('/api/config'); } catch (e) { /* PayPal button will show its own error */ }
  if (IS_CLIENT) { $('#judgeLabel').hidden = true; return viewClient(); }
  $('#side').textContent = 'Freelancer';
  $('#judgeTog').addEventListener('change', (e) => setJudge(e.target.checked));
  document.body.classList.toggle('judge', JUDGE); $('#judgeTog').checked = JUDGE;
  window.addEventListener('hashchange', route);
  if (JUDGE && params.get('p') && !location.hash.replace(/^#/, '')) location.hash = `#/p/${params.get('p')}`;
  else route();
})();
