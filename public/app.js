// Milestone Pay frontend. All user/AI text is set via textContent (el helper). No innerHTML with data.
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const IS_CLIENT = params.get('as') === 'client';
const CLIENT_PID = params.get('p');
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
  if (!res.ok) throw Object.assign(new Error(data.message || `Something went wrong (${res.status}).`), { code: data.error, status: res.status, data });
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
const pillText = (s) => String(s).replace('_', ' ');
const pill = (s) => el('span', { class: `pill ${s}` }, pillText(s));

// ---------------------------------------------------------------- freelancer routing
function route() {
  closeModal();
  const h = location.hash.replace(/^#/, '') || '/';
  if (h === '/new') return viewNew();
  const m = /^\/p\/([\w-]+)/.exec(h);
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
            ? el('span', { class: 'pill authorized' }, `● ${p.client || 'Client'} requested a change`) : null),
        el('button', { onclick: () => go(`/p/${p.id}`) }, 'Open')))
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
const R = { data: null, hl: null, tr: false };
async function viewReview(pid) {
  mount(el('div', { class: 'wrap' }, loadingBox('Loading the agreement…')));
  try { R.data = await api(`/api/projects/${pid}`); R.hl = null; R.tr = false; }
  catch (e) { return mount(el('div', { class: 'wrap' }, errBox(e), el('button', { onclick: () => viewReview(pid) }, 'Try again'), ' ', el('button', { onclick: () => go('/') }, 'Back to projects'))); }
  drawReview();
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
  const setMismatch = (s) => {
    sumLabel.textContent = `total ${money(s, cur)}`;
    mismatchBox.replaceChildren(s !== body.total_minor
      ? el('div', { class: 'gap' }, `Milestones add up to ${money(s, cur)}, but the chat agreed ${money(body.total_minor, cur)}. The client will see the new total.`) : '');
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
    approveArea = el('div', {},
      el('button', { class: 'primary', id: 'apBtn', onclick: async (ev) => {
        ev.target.disabled = true; ev.target.textContent = 'Sending…';
        try {
          const r = await api(`/api/agreements/${agreement.id}/approve`, { body: { party: 'freelancer' } });
          R.data.agreement = r.agreement; drawReview();
        } catch (e) { drawReview(e); }
      } }, 'Approve & send to client'),
      el('span', { class: 'muted small' }, ' This freezes version 1. Amounts can no longer be changed.'));
  }

  mount(el('div', { class: 'wrap' },
    el('div', { class: 'row', style: 'justify-content:space-between' },
      el('div', {}, el('button', { class: 'ghost small', onclick: () => go('/') }, '← All projects'), el('h2', { style: 'margin-top:8px' }, body.title || 'Agreement draft')),
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
  drawClient(d);
}
function drawClient(d, msg) {
  const { project, agreement, milestones = [] } = d;
  const wrap = el('div', { class: 'wrap narrow' });
  if (!agreement || agreement.status === 'draft') {
    wrap.append(el('div', { class: 'empty', style: 'margin-top:30px' }, el('b', {}, 'Nothing here yet'), "The freelancer hasn't shared an agreement with you yet."),
      el('p', { style: 'text-align:center' }, el('button', { onclick: viewClient }, 'Check again')));
    return mount(wrap);
  }
  const b = agreement.body; const cur = b.currency || CFG?.currency || 'USD';
  wrap.append(el('div', { class: 'small muted' }, `${b.title || 'Project'} · from ${b.freelancer_name || 'freelancer'}`), el('h3', {}, 'Agreement'));
  if (msg) wrap.append(msg);

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

  wrap.append(el('div', { class: 'small', style: 'margin-bottom:8px' }, '✓ Agreement approved'), el('h4', { style: 'margin-top:12px' }, 'Payments'));
  const buttons = [];
  milestones.forEach((m) => {
    const card = el('div', { class: 'ms small' });
    card.append(el('div', { class: 'top' }, el('b', {}, `${m.label} ${m.title}`), pill(m.status)));
    const line = el('div', { class: 'row', style: 'justify-content:space-between;margin-top:4px' }, el('span', {}, money(m.amount_minor, m.currency || cur)));
    const note = { authorized: 'held by PayPal · work in progress', submitted: 'delivered · waiting for your review', revision_requested: 'held · being revised', paid: 'paid ✓', voided: 'cancelled · hold released', refunded: 'refunded' }[m.status];
    if (note) line.append(el('span', { class: 'muted' }, note));
    card.append(line);
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
    if (m.deliverables?.length && m.status !== 'draft') {
      card.append(el('details', { style: 'margin-top:6px' }, el('summary', { class: 'muted', style: 'cursor:pointer' }, `Files (${m.deliverables.length})`),
        m.deliverables.map((f) => el('div', { class: 'frow' }, el('span', { class: 'fname' }, f.filename),
          el('a', { href: f.download_url }, 'Download')))));
    }
    wrap.append(card);
  });
  wrap.append(el('p', { style: 'text-align:center' }, el('button', { class: 'ghost small', onclick: viewClient }, 'Refresh')));
  mount(wrap);
  buttons.forEach((x) => mountPayPal(x, d));
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

// ---------------------------------------------------------------- boot
(async function boot() {
  try { CFG = await api('/api/config'); } catch (e) { /* PayPal button will show its own error */ }
  if (IS_CLIENT) return viewClient();
  $('#side').textContent = 'Freelancer';
  window.addEventListener('hashchange', route);
  route();
})();
