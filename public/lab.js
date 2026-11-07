// Test Lab page. Every bit of user or AI text is set with textContent (never innerHTML).
const $ = (id) => document.getElementById(id);
const state = { health: null, project: null, samples: [], sdkReady: null };
const PROJECT_KEY = 'mp_lab_project';

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) n.append(k instanceof Node ? k : String(k));
  return n;
}

function show(box, kind, text) {
  $(box).replaceChildren(text ? el('div', { class: `msg ${kind}` }, text) : '');
}

async function api(path, body) {
  const res = await fetch(`/api/lab${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Something went wrong (${res.status})`);
    err.debug = data.paypal_debug_id;
    throw err;
  }
  return data;
}

const money = (minor, cur = state.health?.currency || 'USD') => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${cur}`;
  }
};

const STATUS_TEXT = {
  agreed: 'Waiting for the client to pay',
  authorized: 'Money held by PayPal',
  submitted: 'Money held by PayPal',
  paid: 'Paid to freelancer ✓',
  voided: 'Cancelled, client not charged',
  refunded: 'Refunded to client',
};

// ---------- status ----------
async function loadHealth() {
  try {
    const h = await api('/health');
    state.health = h;
    $('status').replaceChildren(
      el('span', { class: `pill ${h.paypal.ok ? 'ok' : 'bad'}` }, `${h.paypal.ok ? '✓' : '✗'} PayPal: ${h.paypal.message}`),
      el('span', { class: `pill ${h.ai.ok ? 'ok' : 'bad'}` }, `${h.ai.ok ? '✓' : '✗'} AI: ${h.ai.message}`),
    );
  } catch (e) {
    $('status').replaceChildren(el('span', { class: 'pill bad' }, `✗ The app server is not answering: ${e.message}`));
  }
}

// ---------- step 1 ----------
async function loadSamples() {
  const { samples } = await api('/samples');
  state.samples = samples;
  $('sample').replaceChildren(
    ...samples.map((s, i) => el('option', { value: String(i) }, s.name)),
    el('option', { value: 'own' }, 'My own chat (paste below)'),
  );
  pickSample();
}

function pickSample() {
  const v = $('sample').value;
  if (v === 'own') { $('chat').value = ''; $('freelancer').value = ''; return; }
  const s = state.samples[Number(v)];
  $('chat').value = s.text;
  $('freelancer').value = s.freelancer;
}

async function extract() {
  const btn = $('extractBtn');
  btn.disabled = true; btn.textContent = 'Reading the chat…';
  show('step1msg', 'info', 'The AI is reading the chat…');
  try {
    const v = await api('/extract', { text: $('chat').value, freelancer_name: $('freelancer').value });
    show('step1msg', 'ok', '✓ Done. The deal is below. In the real app both people approve it; here we approve it for you.');
    setProject(v);
  } catch (e) {
    show('step1msg', 'bad', `✗ ${e.message}`);
  } finally {
    btn.disabled = false; btn.textContent = 'Read this chat';
  }
}

function renderAgreement(a) {
  if (!a) return $('agreement').replaceChildren();
  const term = (k) => a.terms.find((t) => t.key === k)?.value || '(not agreed in the chat)';
  const kids = [
    el('dl', {},
      el('dt', {}, 'Project'), el('dd', {}, a.title),
      el('dt', {}, 'Client'), el('dd', {}, a.client_name),
      el('dt', {}, 'Freelancer'), el('dd', {}, a.freelancer_name),
      el('dt', {}, 'Total price'), el('dd', {}, money(a.total_minor, a.currency)),
      el('dt', {}, 'What is delivered'), el('dd', {}, term('deliverables')),
      el('dt', {}, 'Deadline'), el('dd', {}, term('deadline')),
      el('dt', {}, 'Revisions'), el('dd', {}, term('revisions')),
    ),
  ];
  if (a.gaps?.length) {
    kids.push(el('div', { class: 'msg warn' }, 'Things the chat never settled (the real app suggests fixes):',
      el('ul', { class: 'plain' }, a.gaps.map((g) => el('li', {}, g.text)))));
  }
  if (a.injection_flags?.length) {
    kids.push(el('div', { class: 'msg bad' }, '🛡 Suspicious message caught and ignored. Someone tried to give the AI orders:',
      el('ul', { class: 'plain' }, a.injection_flags.map((f) => el('li', {}, f.reason)))));
  }
  $('agreement').replaceChildren(...kids);
}

// ---------- step 2/3 ----------
function setProject(v) {
  state.project = v;
  try { localStorage.setItem(PROJECT_KEY, v.project.id); } catch {}
  renderAgreement(v.agreement);
  $('step2').classList.remove('locked');
  $('step4').classList.remove('locked');
  renderMilestones();
  renderLedger();
}

async function renderLogin() {
  try {
    const { email, password } = await api('/test-login');
    if (!email) return;
    const copy = (t) => el('button', { class: 'ghost copy', type: 'button', onclick: () => navigator.clipboard?.writeText(t) }, 'copy');
    $('login').replaceChildren(el('div', { class: 'login' },
      el('b', {}, 'When the PayPal window opens, log in with this FAKE test buyer:'), el('br'),
      'Email: ', el('code', {}, email), copy(email), el('br'),
      'Password: ', el('code', {}, password), copy(password), el('br'),
      el('span', { class: 'small' }, 'Then click the button to pay / continue. It is test money from PayPal\'s sandbox. Never use your real PayPal login here.'),
    ));
  } catch { /* not on localhost: hide it */ }
}

function loadPayPalSdk() {
  if (state.sdkReady) return state.sdkReady;
  const h = state.health;
  state.sdkReady = new Promise((resolve, reject) => {
    if (!h?.client_id) return reject(new Error('PayPal client id is missing in .env'));
    const s = document.createElement('script');
    const q = new URLSearchParams({
      'client-id': h.client_id, intent: 'authorize', currency: h.currency, components: 'buttons',
      'disable-funding': 'card,credit,paylater,venmo',
    });
    s.src = `https://www.paypal.com/sdk/js?${q}`;
    s.onload = () => resolve(window.paypal);
    s.onerror = () => { state.sdkReady = null; reject(new Error('Could not load the PayPal button. Check your internet connection.')); };
    document.head.append(s);
  });
  return state.sdkReady;
}

async function act(path, msgOk) {
  show('step2msg', 'info', 'Talking to PayPal…');
  try {
    const v = await api(path, {});
    setProject(v);
    show('step2msg', 'ok', msgOk);
  } catch (e) {
    show('step2msg', 'bad', `✗ ${e.message}${e.debug ? ` (PayPal ref ${e.debug})` : ''}`);
  }
}

function renderMilestones() {
  const { milestones } = state.project;
  const cur = state.project.agreement?.currency || state.health?.currency || 'USD';
  const box = $('milestones');
  box.replaceChildren();
  for (const m of milestones) {
    const card = el('div', { class: `ms${m.is_current ? ' current' : ''}` },
      el('div', { class: 'ms-head' },
        el('span', { class: 'ms-title' }, `${m.label} · ${m.title} · ${money(m.amount_minor, cur)}`),
        el('span', { class: `tag ${m.status}` }, STATUS_TEXT[m.status] || m.status)),
    );
    if (m.criteria?.length) card.append(el('div', { class: 'small' }, `Done when: ${m.criteria.join(' · ')}`));

    const ids = [
      m.authorization_id && `Hold id: ${m.authorization_id}`,
      m.hold_expires_at && `hold ends ${new Date(m.hold_expires_at).toLocaleDateString()}`,
      m.capture_id && `Payment id: ${m.capture_id}`,
      m.refund_id && `Refund id: ${m.refund_id}`,
    ].filter(Boolean);
    if (ids.length) card.append(el('div', { class: 'ids' }, ids.join(' · ')));

    if (m.status === 'agreed' && m.is_current) {
      const slot = el('div', { class: 'pp' });
      card.append(el('div', { class: 'small', style: 'margin-top:10px' }, 'Client: click the yellow PayPal button ↓'), slot);
      mountButton(m, slot);
    } else if (m.status === 'agreed') {
      card.append(el('div', { class: 'small', style: 'margin-top:8px' }, 'Pay the earlier milestone first.'));
    }
    if (['authorized', 'submitted'].includes(m.status)) {
      card.append(el('div', { class: 'row' },
        el('button', { onclick: () => act(`/milestones/${m.id}/release`, `✓ ${m.label} released: ${money(m.amount_minor, cur)} is now the freelancer's.`) }, 'Approve work & release payment'),
        el('button', { class: 'ghost', onclick: () => act(`/milestones/${m.id}/void`, `✓ Hold cancelled. The client was never charged for ${m.label}.`) }, 'Cancel the hold'),
      ));
    }
    if (m.status === 'paid') {
      card.append(el('div', { class: 'row' },
        el('button', { class: 'ghost', onclick: () => act(`/milestones/${m.id}/refund`, `✓ ${m.label} refunded to the client.`) }, 'Refund'),
      ));
    }
    box.append(card);
  }
  if (milestones.every((m) => ['paid', 'voided', 'refunded'].includes(m.status))) {
    box.append(el('div', { class: 'msg ok' }, '🎉 All milestones are finished. Click "Start over" below to try again or try the other sample.'));
  }
}

async function mountButton(m, slot) {
  try {
    const paypal = await loadPayPalSdk();
    await paypal.Buttons({
      style: { layout: 'vertical', label: 'pay', height: 45 },
      createOrder: async () => (await api(`/milestones/${m.id}/order`, {})).order_id,
      onApprove: async () => {
        await act(`/milestones/${m.id}/authorize`,
          `✓ PayPal is now holding the money for ${m.label}. Next: pretend the work is done and click "Approve work & release payment".`);
      },
      onCancel: () => show('step2msg', 'warn', 'You closed the PayPal window. Nothing was paid. Click the button again when ready.'),
      onError: (err) => show('step2msg', 'bad', `✗ PayPal had a problem: ${err?.message || err}`),
    }).render(slot);
  } catch (e) {
    slot.replaceChildren(el('div', { class: 'msg bad' }, `✗ ${e.message}`));
  }
}

function renderLedger() {
  const rows = state.project?.ledger || [];
  if (!rows.length) return $('ledger').replaceChildren(el('p', { class: 'small' }, 'Nothing yet.'));
  const what = { authorize: 'Client paid into hold', capture: 'Released to freelancer', void: 'Hold cancelled', refund: 'Refunded to client' };
  const ms = Object.fromEntries(state.project.milestones.map((m) => [m.id, m.label]));
  const cur = state.project.agreement?.currency || state.health?.currency || 'USD';
  $('ledger').replaceChildren(el('table', {},
    el('tr', {}, el('th', {}, 'When'), el('th', {}, 'Milestone'), el('th', {}, 'What'), el('th', {}, 'Amount'), el('th', {}, 'PayPal id')),
    rows.map((r) => el('tr', {},
      el('td', {}, new Date(r.at).toLocaleTimeString()),
      el('td', {}, ms[r.milestone_id] || ''),
      el('td', {}, what[r.kind] || r.kind),
      el('td', {}, r.amount_minor ? money(r.amount_minor, cur) : '-'),
      el('td', {}, r.paypal_id || ''))),
  ));
}

async function reset() {
  await api('/reset', {});
  try { localStorage.removeItem(PROJECT_KEY); } catch {}
  state.project = null;
  $('agreement').replaceChildren(); $('milestones').replaceChildren();
  show('step1msg'); show('step2msg');
  $('step2').classList.add('locked'); $('step4').classList.add('locked');
  renderLedger();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- boot ----------
$('sample').addEventListener('change', pickSample);
$('extractBtn').addEventListener('click', extract);
$('resetBtn').addEventListener('click', reset);

(async () => {
  await loadHealth();
  await loadSamples().catch((e) => show('step1msg', 'bad', `✗ ${e.message}`));
  renderLogin();
  let saved = null;
  try { saved = localStorage.getItem(PROJECT_KEY); } catch {}
  if (saved) {
    try { setProject(await api(`/projects/${saved}`)); } catch { try { localStorage.removeItem(PROJECT_KEY); } catch {} }
  }
})();
