// Freelancer screens: 01 dashboard, 02 paste chat, 03 agreement review, 06 submit work, 07 activity, 08 change requests.
import {
  S, el, icon, api, go, link, back, mount, mountKeep, appShell, pageHead, alertBox, errBox, loading, skeleton, toast, confirmDialog,
  money, moneyEl, fmtNum, parseMinor, major, fmtDate, fmtDay, fmtTime, fmtDateTime, fmtSize, plural, initial,
  badge, msBadge, where, projectBadge, AGREEMENT_BADGE, nextStep, emptyState, stat, progress, msCard, fileRow, copyText,
  poll, stopPoll, names, planBase, curOf, sandboxNote, daysUntil, titleOf, editableTitle, chatCard, memberOf,
} from './core.js';
import { projectOverview } from './project.js';

// ---------------------------------------------------------------- 01 Dashboard
export async function viewProjects() {
  mount(appShell('freelancer', pageHead('Your projects'), skeleton()));
  let data;
  try { data = await api('/api/projects'); S.projects = data; }
  catch (e) { return mount(appShell('freelancer', pageHead('Your projects'), errBox(e), el('button', { class: 'mp-btn mp-btn--secondary', onclick: viewProjects }, 'Try again'))); }
  const all = data.projects.filter((p) => p.my_role === 'freelancer');
  const mine = all.filter((p) => !p.archived);
  const archived = all.filter((p) => p.archived);
  const cur = all.find((p) => p.currency)?.currency || S.cfg?.currency;
  const demoBtn = (cls) => el('button', { class: `mp-btn ${cls}`, onclick: async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Setting up the example… about 10 s';
    try { const r = await api('/api/demo', { body: {} }); go(`/p/${r.project_id}`); }
    catch (e) { b.disabled = false; b.textContent = 'Load demo project'; b.closest('.mp-page')?.prepend(errBox(e)); }
  } }, 'Load demo project');
  const newBtn = link('/new', { class: 'mp-btn mp-btn--primary' }, icon('plus'), 'New project');
  if (!all.length) {
    return mount(appShell('freelancer', pageHead('Your projects', null, el('span', { class: 'mp-hide-phone' })),
      emptyState({ ic: 'chat', title: 'No projects yet', text: 'Paste a LINE or WhatsApp chat where you agreed a job. We’ll turn it into an agreement with milestones.',
        actions: [link('/new', { class: 'mp-btn mp-btn--primary' }, 'Paste a chat'), demoBtn('mp-btn--secondary')] }),
      sandboxNote()));
  }
  const row = (p) => {
    const cr = p.open_change_request?.from === 'client' && p.open_change_request.status === 'open';
    return el('div', { class: 'mp-card mp-card--raised mp-card--flush mp-jobrow', 'data-project': p.id },
      el('div', { class: 'mp-jobrow__main' },
        el('div', { class: 'mp-stack', style: 'gap:6px;min-width:0' },
          el('div', { class: 'mp-row mp-row--wrap' }, link(`/p/${p.id}`, { class: 'mp-t-section mp-link-plain' }, p.title || 'Unfinished chat import'), projectBadge(p)),
          el('div', { class: 'mp-row mp-row--wrap mp-t-sm mp-muted', style: 'gap:16px' },
            p.client ? el('span', { class: 'mp-row' }, icon('user'), p.client) : null,
            p.deadline ? el('span', { class: 'mp-row' }, icon('calendar'), `Due ${p.deadline}`) : null,
            !p.title ? el('span', {}, 'The agreement wasn’t created yet. Open it to try again.') : null),
          p.milestones.length ? el('div', { class: 'mp-row mp-row--wrap', style: 'gap:6px' }, p.milestones.map((m) => msBadgeShort(m))) : null),
        el('div', { class: 'mp-jobrow__money' }, moneyEl(p.total_minor, p.currency || cur, 'md'),
          p.milestones.length ? el('div', { class: 'mp-progress' }, el('div', { class: 'mp-progress__label' }, el('span', {}, el('b', {}, `${p.paid_count} of ${p.milestones.length}`), ' paid'),
            p.held_minor ? el('span', {}, `${fmtNum(p.held_minor)} held`) : null),
          el('div', { class: 'mp-progress__bar' }, p.milestones.map((m) => el('span', { class: `mp-progress__seg ${m.status === 'paid' ? 'mp-progress__seg--paid' : ['authorized', 'submitted', 'revision_requested'].includes(m.status) ? 'mp-progress__seg--held' : ''}` })))) : null),
        el('div', { class: 'mp-jobrow__actions' },
          link(`/p/${p.id}`, { class: 'mp-btn mp-btn--secondary', 'aria-label': `Open ${p.title || 'project'}` }, 'Open', icon('arrow-right')),
          projectActions(p, viewProjects))),
      cr ? el('div', { class: 'mp-jobrow__banner' }, icon('chat'), el('span', { class: 'mp-grow' }, el('b', {}, `${p.client || 'Your client'} requested a change. `), 'Check it against the agreement before you reply.'),
        link(`/p/${p.id}/changes`, { class: 'mp-btn mp-btn--secondary mp-btn--sm' }, 'Review request')) : null);
  };
  mount(appShell('freelancer',
    pageHead('Your projects', 'What’s held for you, what’s paid, and what still needs funding.', newBtn),
    el('div', { class: 'mp-grid-3' },
      stat('lock', 'Held by Milestone Pay', data.totals.held_minor, cur, 'Clients have funded this. You get it when they approve your work.'),
      stat('check', 'Paid to you', data.totals.paid_minor, cur, 'Paid into your PayPal account.'),
      stat('circle-dashed', 'Not funded yet', data.totals.not_funded_minor, cur, 'Agreed or drafted, but the client hasn’t funded it.')),
    mine.length ? el('div', { class: 'mp-stack mp-stack--4' }, mine.map(row))
      : el('p', { class: 'mp-muted' }, 'Every project is archived. Open the list below to bring one back, or start a new project.'),
    archivedList(archived, row),
    el('div', { class: 'mp-row mp-row--between mp-row--wrap' }, sandboxNote(), demoBtn('mp-btn--ghost mp-btn--sm'))));
}
/** Archived projects, folded away under the list. */
export function archivedList(list, row) {
  if (!list.length) return null;
  return el('details', { class: 'mp-archived', id: 'archived' }, el('summary', { class: 'mp-t-sub' }, icon('archive'), `Archived · ${list.length}`),
    el('div', { class: 'mp-stack mp-stack--4', style: 'margin-top:16px' }, list.map(row)));
}
/**
 * Archive (either role, hides it from your own list) and Delete (freelancer, only while no money was held or paid).
 * Both sit on every project row.
 */
export function projectActions(p, reload) {
  const name = p.title || 'this project';
  const archive = el('button', { class: 'mp-iconbtn', type: 'button', 'data-action': p.archived ? 'unarchive' : 'archive',
    'aria-label': `${p.archived ? 'Unarchive' : 'Archive'} ${name}`, title: p.archived ? 'Unarchive' : 'Archive', onclick: async () => {
      archive.disabled = true;
      try { await api(`/api/projects/${p.id}/archive`, { body: { archived: !p.archived } }); toast(p.archived ? 'Moved back to your list' : 'Archived. Find it under Archived at the bottom of the list.', 'archive'); reload(); }
      catch (e) { archive.disabled = false; toast(e.message, 'alert'); }
    } }, icon(p.archived ? 'undo' : 'archive'));
  const moneyMoved = p.paid_count > 0 || p.held_minor > 0;
  const del = p.my_role !== 'freelancer' ? null : el('button', { class: 'mp-iconbtn mp-iconbtn--danger', type: 'button', 'data-action': 'delete', 'aria-label': `Delete ${name}`, title: 'Delete', onclick: async () => {
    if (moneyMoved) {
      const ok = await confirmDialog({ icon: 'archive', title: 'This project can’t be deleted', text: 'Money was held or paid on it, so its payment record is kept for you and your client. You can archive it to move it out of your list.',
        confirm: p.archived ? 'OK' : 'Archive instead', cancel: p.archived ? null : 'Go back' });
      if (ok && !p.archived) archive.click();
      return;
    }
    const ok = await confirmDialog({ icon: 'trash', iconKind: 'issue', title: `Delete ${name}?`,
      text: `This removes the chat, the agreement and its milestones for good${p.client ? `, for you and ${p.client}` : ''}. It can’t be undone. No money has moved on this project.`,
      confirm: 'Keep project', cancel: 'Delete project', cancelClass: 'mp-btn--danger' });
    if (ok !== false) return; // only the red button deletes
    try { await api(`/api/projects/${p.id}`, { method: 'DELETE' }); toast('Project deleted', 'trash'); reload(); }
    catch (e) { toast(e.message, 'alert'); }
  } }, icon('trash'));
  return el('div', { class: 'mp-row', style: 'gap:0' }, archive, del);
}
function msBadgeShort(m) {
  const map = { draft: ['neutral', 'edit', 'Draft'], agreed: ['neutral', 'circle-dashed', 'Not funded'], authorized: ['held', 'lock', 'Funded'], submitted: ['pending', 'inbox', 'Submitted'],
    revision_requested: ['issue', 'alert', 'Changes requested'], paid: ['success', 'check', 'Paid'], voided: ['neutral', 'x', 'Cancelled'], refunded: ['neutral', 'undo', 'Refunded'] };
  const [k, ic, t] = map[m.status] || map.draft;
  return badge(k, ic, `${m.label} ${t}`);
}

// ---------------------------------------------------------------- 02 Paste chat
let draft = { text: '', name: '', files: [], rejected: [], pendingId: null };
export function viewNew() {
  stopPoll();
  if (!draft.name) draft.name = (S.me?.name || S.me?.display_name || '').split(' ')[0] || '';
  let busy = false;
  const ta = el('textarea', { class: 'mp-input mp-chatbox', id: 'chatText', rows: 12, placeholder: 'Paste your chat here…\n\nNok: Hi Ploy! I’d like a website for my café\nPloy: Sure! How many pages do you need?', value: draft.text,
    oninput: () => { draft.text = ta.value; paintGo(); } });
  const name = el('input', { class: 'mp-input', id: 'freelancerName', maxlength: 60, value: draft.name, oninput: () => { draft.name = name.value; } });
  const files = el('div');
  const errs = el('div', { class: 'mp-stack' });
  const goBtn = el('button', { class: 'mp-btn mp-btn--primary', id: 'generate' }, icon('sparkle'), 'Generate agreement');
  const uses = el('span', { class: 'mp-t-sm mp-muted' });
  const out = el('div');
  const picker = el('input', { type: 'file', multiple: true, accept: '.txt,.jpg,.jpeg,.png', hidden: true, onchange: () => { addFiles(picker.files); picker.value = ''; } });
  const drop = el('div', { class: 'mp-drop', tabindex: '0', role: 'button', 'aria-label': 'Upload chat screenshots or a chat export',
    onclick: () => picker.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } },
    ondragover: (e) => { e.preventDefault(); drop.classList.add('is-over'); }, ondragleave: () => drop.classList.remove('is-over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('is-over'); addFiles(e.dataTransfer.files); } },
  el('span', { class: 'mp-drop__icon' }, icon('upload')), el('b', { class: 'mp-t-sm' }, 'Drop screenshots or a chat export here'),
  el('span', { class: 'mp-t-caption mp-muted' }, 'or ', el('span', { class: 'mp-link' }, 'browse files'), ' · up to 10 files, 20 MB each'),
  el('div', { class: 'mp-formats' }, el('span', {}, 'JPG'), el('span', {}, 'PNG'), el('span', {}, 'TXT')));
  function addFiles(list) {
    for (const f of list) {
      if (!/\.(txt|jpe?g|png)$/i.test(f.name)) { draft.rejected.push({ name: f.name, why: 'can’t be read. Upload a screenshot (.png, .jpg) or a .txt chat export instead.' }); continue; }
      if (f.size > 20 * 1024 * 1024) { draft.rejected.push({ name: f.name, why: 'is over 20 MB. Upload a smaller file.' }); continue; }
      if (draft.files.length >= 10) { draft.rejected.push({ name: f.name, why: 'wasn’t added: up to 10 files per chat.' }); continue; }
      draft.files.push(f);
    }
    paintFiles();
  }
  function paintFiles() {
    files.replaceChildren(draft.files.length ? el('div', { class: 'mp-card mp-card--raised', style: 'padding:8px 16px' },
      draft.files.map((f, i) => fileRow(f, { onRemove: () => { draft.files.splice(i, 1); paintFiles(); } }))) : '');
    errs.replaceChildren(...draft.rejected.map((r, i) => el('div', { class: 'mp-alert mp-alert--issue', role: 'alert' }, icon('alert'),
      el('span', { class: 'mp-grow' }, el('b', {}, r.name), ` ${r.why}`), el('button', { class: 'mp-iconbtn', 'aria-label': 'Dismiss', onclick: () => { draft.rejected.splice(i, 1); paintFiles(); } }, icon('x')))));
    paintGo();
  }
  function paintGo() {
    const parts = [draft.files.length ? plural(draft.files.length, 'file') : null, draft.text.trim() ? 'the pasted text' : null].filter(Boolean);
    uses.textContent = parts.length ? `Uses ${parts.join(' + ')}` : 'Paste the chat or add a file first';
    goBtn.disabled = busy;
  }
  const leave = async () => {
    if (busy) return;
    if (!draft.text.trim() && !draft.files.length) return go('/projects');
    const ok = await confirmDialog({ icon: 'alert', iconKind: 'issue', title: 'Discard this project?',
      text: `You’ll lose the pasted chat${draft.files.length ? ` and ${plural(draft.files.length, 'uploaded file')}` : ''}. Nothing has been sent to the client yet.`,
      confirm: 'Keep editing', cancel: 'Discard', cancelClass: 'mp-btn--danger-quiet' });
    if (ok === false) { draft = { text: '', name: draft.name, files: [], rejected: [], pendingId: null }; go('/projects'); }
  };
  goBtn.addEventListener('click', async () => {
    out.replaceChildren();
    if (!draft.pendingId && !draft.text.trim() && !draft.files.length) { out.append(alertBox('issue', 'alert', 'Paste the chat or choose a file first.')); return; }
    busy = true; paintGo();
    const steps = [draft.files.some((f) => !/\.txt$/i.test(f.name)) ? `Reading ${plural(draft.files.filter((f) => !/\.txt$/i.test(f.name)).length, 'screenshot')}` : 'Reading the messages',
      'Pulling out price, deadline and scope', 'Linking each term to its message', 'Checking for gaps', 'Splitting into milestones'];
    const stepEls = steps.map((t) => el('div', { class: 'mp-loadstep mp-loadstep--wait' }, icon('circle-dashed'), ` ${t}`));
    let k = 0;
    const tick = () => stepEls.forEach((n, i) => {
      n.className = `mp-loadstep ${i < k ? 'mp-loadstep--done' : i === k ? '' : 'mp-loadstep--wait'}`;
      n.replaceChildren(i < k ? icon('check') : i === k ? el('span', { class: 'mp-spinner', style: 'width:16px;height:16px' }) : icon('circle-dashed'), ` ${steps[i]}`);
    });
    tick();
    const timer = setInterval(() => { if (k < steps.length - 1) { k++; tick(); } }, 2500);
    mountKeep(appShell('freelancer', el('div', { class: 'mp-card mp-card--raised mp-stack mp-stack--4 mp-reading', role: 'status' },
      el('div', { class: 'mp-row' }, el('span', { class: 'mp-spinner' }), el('h1', { class: 'mp-t-section' }, 'Reading your chat…')),
      el('p', { class: 'mp-muted' }, 'This will take about 10 to 20 seconds.'),
      el('div', { class: 'mp-card', style: 'display:flex;flex-direction:column;gap:12px' }, stepEls))));
    try {
      if (!draft.pendingId) {
        const fd = new FormData();
        if (draft.text.trim()) fd.append('chatText', draft.text);
        fd.append('freelancer_name', (draft.name || 'Ploy').trim() || 'Ploy');
        draft.files.forEach((f) => fd.append('files[]', f, f.name));
        const r = await api('/api/projects', { form: fd });
        draft.pendingId = r.project.id;
      }
      await api(`/api/projects/${draft.pendingId}/extract`, { body: {} });
      const id = draft.pendingId;
      draft = { text: '', name: draft.name, files: [], rejected: [], pendingId: null };
      clearInterval(timer);
      go(`/p/${id}`);
    } catch (e) {
      clearInterval(timer); busy = false;
      viewNew();
      const box = document.getElementById('newErr');
      box?.append(errBox(e));
      if (draft.pendingId) box?.append(el('p', { class: 'mp-t-sm mp-muted' }, 'Your chat was saved. Press Generate agreement to try reading it again.'));
      else if (e.code === 'CURRENCY_MISMATCH') box?.append(el('p', { class: 'mp-t-sm mp-muted' }, 'Write the prices in the chat in USD (for example “$800”), then press Generate again.'));
    }
  });
  paintFiles();
  mount(appShell('freelancer',
    el('button', { class: 'mp-back', type: 'button', onclick: leave }, icon('arrow-left'), 'Back to projects'),
    pageHead('New project', 'Paste the chat where you agreed the job. Thai, English or mixed is fine. Prices should be in USD.'),
    el('div', { class: 'mp-grid-2 mp-paste' },
      el('div', { class: 'mp-stack mp-stack--4' },
        el('div', { class: 'mp-field' }, el('label', { class: 'mp-label', for: 'freelancerName' }, 'Your name in this chat'), name, el('span', { class: 'mp-help' }, 'So we know which messages are yours.')),
        el('div', { class: 'mp-field' }, el('label', { class: 'mp-label', for: 'chatText' }, 'Paste your chat'), ta,
          el('span', { class: 'mp-help' }, 'We read names, prices, dates and what was agreed. Nothing is sent to your client yet.'))),
      el('div', { class: 'mp-stack mp-stack--4' }, el('span', { class: 'mp-label' }, 'Or upload the chat'), drop, picker, files, errs,
        el('p', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, 'Upload screenshots in order. Overlapping messages are merged, and you can check every line on the next screen.'))),
    el('div', { id: 'newErr', class: 'mp-stack' }), out,
    el('div', { class: 'mp-divider' }),
    el('div', { class: 'mp-row mp-row--between mp-row--wrap mp-sticky-cta' },
      el('div', { class: 'mp-row mp-row--wrap' }, goBtn, uses),
      el('span', { class: 'mp-row mp-t-caption mp-muted', style: 'font-weight:400' }, icon('shield'), 'Chats contain personal info. We don’t keep the raw chat in logs.'))));
}

// ---------------------------------------------------------------- 03 Agreement review
const R = { d: null, hl: null, tr: false };
export async function viewAgreement(d, { fromProject = false } = {}) {
  R.d = d;
  drawAgreement({ fromProject });
  if (d.agreement?.status === 'sent') poll(d.project.id, () => R.d, (x) => { R.d = x; if (x.agreement?.status === 'approved' && !fromProject) go(`/p/${x.project.id}`); else drawAgreement({ fromProject, keep: true }); });
}
function chipFor(id, msgs) {
  const m = msgs.find((x) => x.msg_id === id);
  const n = id.replace(/^m/, '');
  return el('button', { class: 'mp-chip', type: 'button', onclick: () => highlight(id), 'aria-label': `Show message ${n}` }, icon('chat'), `#${n}${m ? ` ${m.sender || ''} ${m.time || ''}` : ''}`.trim());
}
function highlight(id) {
  R.hl = id;
  document.querySelectorAll('.mp-msg.is-hl').forEach((n) => n.classList.remove('is-hl'));
  const n = document.getElementById(`msg-${id}`);
  if (n) { n.classList.add('is-hl'); n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}
function drawAgreement({ fromProject = false, keep = false, err = null } = {}) {
  const d = R.d; const { project, agreement, messages = [], milestones = [] } = d;
  const { fname, cname } = names(d);
  if (!agreement) {
    return mount(appShell('freelancer', back('/projects', 'Your projects'),
      emptyState({ ic: 'chat', title: 'No agreement yet', text: 'This chat hasn’t been read yet.', actions: [el('button', { class: 'mp-btn mp-btn--primary', onclick: async (ev) => {
        ev.currentTarget.disabled = true; ev.currentTarget.textContent = 'Reading the chat…';
        try { await api(`/api/projects/${project.id}/extract`, { body: {} }); go(`/p/${project.id}?r=${Date.now()}`); }
        catch (e) { ev.target.disabled = false; ev.target.textContent = 'Read the chat'; ev.target.after(errBox(e)); }
      } }, 'Read the chat')] })));
  }
  const b = agreement.body; const cur = curOf(d);
  const frozen = agreement.status !== 'draft';
  const flagged = new Set((b.injection_flags || []).map((f) => f.msg_id));
  const en = b.translations?.en || {};
  const hasTr = Object.keys(en).length > 0;
  // chat pane
  const chat = el('div', { class: 'mp-chat mp-chatpane', id: 'chatPane' },
    el('div', { class: 'mp-day' }, `Pasted chat${project.created_at ? ` · ${fmtDate(project.created_at)}` : ''}`),
    messages.map((m) => el('div', { class: `mp-msg ${m.me ? 'mp-msg--me' : ''} ${R.hl === m.msg_id ? 'is-hl' : ''}`, id: `msg-${m.msg_id}` },
      el('span', { class: `mp-avatar ${m.me ? 'mp-avatar--me' : ''}` }, initial(m.sender)),
      el('div', { class: `mp-bubble ${flagged.has(m.msg_id) ? 'mp-bubble--flag' : ''}` },
        el('div', { class: 'mp-bubble__meta' }, el('b', {}, m.sender || ''), m.time ? el('span', {}, m.time) : null, el('span', {}, `· #${m.msg_id.replace(/^m/, '')}`)),
        m.text,
        R.tr && en[m.msg_id] ? el('span', { class: 'mp-bubble__tr', 'data-l': 'EN' }, en[m.msg_id]) : null,
        flagged.has(m.msg_id) ? el('span', { class: 'mp-bubble__flag' }, icon('shield'), 'Ignored: this was an instruction aimed at the AI') : null))));
  const chatCard = el('div', { class: 'mp-card mp-card--raised mp-card--flush mp-chatcard' },
    el('div', { class: 'mp-chatcard__head' }, el('b', { class: 'mp-t-sub' }, 'Source chat'),
      hasTr ? el('label', { class: 'mp-row mp-t-sm' }, icon('globe'), 'Translate to',
        el('select', { class: 'mp-input mp-select mp-select--sm', 'aria-label': 'Translate to', onchange: (e) => { R.tr = e.target.value === 'en'; drawAgreement({ fromProject, keep: true }); } },
          el('option', { value: '', selected: !R.tr }, 'Off · original'), el('option', { value: 'en', selected: R.tr }, 'English'))) : null),
    R.tr ? el('p', { class: 'mp-row mp-t-caption mp-muted', style: 'padding:0 16px 8px;font-weight:400' }, icon('sparkle'), 'Translated by AI. Check prices and dates against the original.') : null,
    messages.length ? chat : el('p', { class: 'mp-muted', style: 'padding:16px' }, 'The chat is empty.'));
  // terms
  const terms = el('div', { class: 'mp-card mp-card--raised' },
    el('div', { class: 'mp-card__head' }, el('h2', { class: 'mp-t-section' }, 'Terms'), el('span', { class: 'mp-t-caption mp-muted mp-hide-phone' }, 'Click a chip to see the message it came from')),
    el('dl', { class: 'mp-terms' }, (b.terms || []).map((t) => el('div', { class: 'mp-term' }, el('dt', {}, t.label),
      el('dd', {}, el('span', {}, t.value || el('span', { class: 'mp-missing' }, icon('alert'), 'Not agreed yet')), (t.source_message_ids || []).map((id) => chipFor(id, messages)))))));
  // gaps
  const gaps = b.gaps || [];
  const open = gaps.filter((g) => !g.fixed).length;
  const gapsCard = el('div', { class: 'mp-card mp-card--raised' },
    el('div', { class: 'mp-card__head' }, el('h2', { class: 'mp-t-section' }, 'Gaps found'),
      open ? badge('pending', 'alert', `${open} to fix`) : badge('success', 'check', 'All fixed')),
    el('div', { class: 'mp-stack mp-stack--3' },
      gaps.map((g) => el('div', { class: 'mp-gap' }, el('span', { class: `mp-gap__icon ${g.fixed ? 'mp-gap__icon--ok' : ''}` }, icon(g.fixed ? 'check' : 'alert')),
        el('div', { class: 'mp-grow' }, el('div', { class: g.fixed ? 'mp-muted' : '' }, g.fixed ? `${g.fix_label.replace(/^Set:\s*/i, 'Set: ')}.` : g.text),
          !g.fixed && !frozen ? el('button', { class: 'mp-btn mp-btn--secondary mp-btn--sm', style: 'margin-top:8px', onclick: async (ev) => {
            ev.currentTarget.disabled = true;
            try { const r = await api(`/api/agreements/${agreement.id}/gaps/${g.id}/fix`, { body: {} }); R.d.agreement = r.agreement; R.d.milestones = r.milestones; drawAgreement({ fromProject, keep: true }); }
            catch (e) { drawAgreement({ fromProject, keep: true, err: e }); }
          } }, g.fix_label) : null))),
      (b.injection_flags || []).map((f) => el('div', { class: 'mp-gap' }, el('span', { class: 'mp-gap__icon mp-gap__icon--issue' }, icon('shield')),
        el('div', { class: 'mp-grow' }, el('div', {}, el('b', {}, `Message #${f.msg_id.replace(/^m/, '')} tried to give the AI an order`), ` (“${f.reason}”). We ignored it. Money only moves when ${cname} approves.`),
          el('div', { style: 'margin-top:6px' }, chipFor(f.msg_id, messages))))),
      !gaps.length && !(b.injection_flags || []).length ? el('p', { class: 'mp-muted mp-t-sm' }, 'No gaps found.') : null));
  // milestones
  const sum = milestones.reduce((a, m) => a + m.amount_minor, 0);
  const totalEl = el('span', { class: 'mp-row mp-t-sm' }, 'Total ', moneyEl(sum, cur, 'sm'));
  const mismatch = el('div');
  const apBtn = frozen ? null : el('button', { class: 'mp-btn mp-btn--primary', id: 'approveSend' }, icon('send'), `Approve & send to ${cname}`);
  const apWhy = el('span', { class: 'mp-row mp-t-sm' });
  const paintSum = () => {
    const s = milestones.reduce((a, m) => a + m.amount_minor, 0);
    totalEl.replaceChildren('Total ', moneyEl(s, cur, 'sm'));
    const bad = s !== b.total_minor; const small = milestones.some((m) => m.amount_minor < 100);
    mismatch.replaceChildren(bad ? alertBox('warn', 'alert', el('span', {}, `Milestones add up to ${money(s, cur)}, but the chat agreed `, el('b', {}, money(b.total_minor, cur)), `. Fix the amounts so ${cname} sees the agreed total.`))
      : small ? alertBox('warn', 'alert', `Each milestone must be at least ${money(100, cur)}.`) : '');
    if (apBtn) {
      const why = open ? `Fix the ${plural(open, 'open gap')} first. Sending locks version 1.` : bad || small ? 'Fix the amounts first.' : 'Next: a summary to check before it locks.';
      apBtn.disabled = !!(open || bad || small);
      apWhy.className = `mp-row mp-t-sm ${open || bad || small ? 'mp-err' : 'mp-muted'}`;
      apWhy.replaceChildren(open || bad || small ? icon('alert') : '', why);
    }
  };
  const redraw = (e) => drawAgreement({ fromProject, keep: true, err: e || null });
  const msList = milestones.map((m) => {
    const amt = frozen ? moneyEl(m.amount_minor, cur, 'sm') : el('input', { class: 'mp-input mp-input--amount', inputmode: 'decimal', value: major(m.amount_minor), 'aria-label': `${m.label} amount in ${cur}` });
    if (!frozen) amt.addEventListener('change', async () => {
      const v = parseMinor(amt.value);
      if (v == null) { toast('Enter an amount like 240 or 240.50', 'alert'); amt.value = major(m.amount_minor); return; }
      try { const r = await api(`/api/milestones/${m.id}`, { method: 'PATCH', body: { amount_minor: v } }); m.amount_minor = r.milestone.amount_minor; amt.value = major(m.amount_minor); paintSum(); }
      catch (e) { toast(e.message, 'alert'); amt.value = major(m.amount_minor); }
    });
    if (frozen) {
      return el('div', { class: 'mp-ms mp-ms--edit' }, el('span', { class: 'mp-ms__idx' }, String(m.seq)),
        el('div', {}, el('div', { class: 'mp-ms__title' }, `${m.label} · ${m.title}`), el('ul', { class: 'mp-ms__crit' }, (m.criteria || []).map((c) => el('li', {}, c)))),
        el('div', { class: 'mp-ms__right' }, amt));
    }
    // Draft: the AI's title and description can be rewritten before sending.
    const saved = el('span', { class: 'mp-t-caption mp-muted', 'aria-live': 'polite' });
    const patch = async (body, revert) => {
      saved.textContent = 'Saving…';
      try { const r = await api(`/api/milestones/${m.id}`, { method: 'PATCH', body }); Object.assign(m, { title: r.milestone.title, criteria: r.milestone.criteria }); saved.textContent = 'Saved'; }
      catch (e) { saved.textContent = ''; toast(e.message, 'alert'); revert(); }
    };
    const title = el('input', { class: 'mp-input', id: `msTitle-${m.id}`, maxlength: 120, value: m.title, 'aria-label': `${m.label} title`,
      onchange: () => { const v = title.value.trim(); if (!v) { toast('Give the milestone a title', 'alert'); title.value = m.title; return; } if (v !== m.title) patch({ title: v }, () => { title.value = m.title; }); } });
    const lines = () => crit.value.split('\n').map((x) => x.trim()).filter(Boolean);
    const crit = el('textarea', { class: 'mp-input mp-ms__desc', id: `msDesc-${m.id}`, rows: Math.max(3, (m.criteria || []).length + 1), 'aria-label': `What ${m.label} includes, one item per line`,
      placeholder: 'What this milestone includes, one item per line', value: (m.criteria || []).join('\n'),
      onchange: () => { const v = lines(); if (v.length > 12 || v.some((x) => x.length > 200)) { toast('Use up to 12 lines, each up to 200 characters', 'alert'); return; }
        if (JSON.stringify(v) !== JSON.stringify(m.criteria || [])) patch({ criteria: v }, () => { crit.value = (m.criteria || []).join('\n'); }); } });
    const remove = milestones.length > 1 ? el('button', { class: 'mp-iconbtn mp-iconbtn--danger', type: 'button', 'aria-label': `Remove ${m.label}`, title: `Remove ${m.label}`, onclick: async () => {
      const ok = await confirmDialog({ icon: 'trash', iconKind: 'issue', title: `Remove ${m.label} · ${m.title}?`, text: 'The milestones after it move up one. You can still change the amounts before you send the agreement.',
        confirm: `Keep ${m.label}`, cancel: `Remove ${m.label}`, cancelClass: 'mp-btn--danger' });
      if (ok !== false) return;
      try { const r = await api(`/api/milestones/${m.id}`, { method: 'DELETE' }); R.d.milestones = r.milestones; redraw(); } catch (e) { redraw(e); }
    } }, icon('trash')) : null;
    return el('div', { class: 'mp-ms mp-ms--edit mp-ms--draft', 'data-ms': m.label }, el('span', { class: 'mp-ms__idx' }, String(m.seq)),
      el('div', { class: 'mp-stack', style: 'gap:8px;min-width:0' },
        el('div', { class: 'mp-field' }, el('label', { class: 'mp-label', for: `msTitle-${m.id}` }, `${m.label} title`), title),
        el('div', { class: 'mp-field' }, el('div', { class: 'mp-label-row' }, el('label', { class: 'mp-label', for: `msDesc-${m.id}` }, 'What it includes'), saved), crit,
          el('span', { class: 'mp-help' }, 'One item per line. Your client checks the work against this list.'))),
      el('div', { class: 'mp-ms__right' }, el('div', { class: 'mp-affix' }, amt, el('span', { class: 'mp-t-sm mp-muted' }, cur)), remove));
  });
  const addMs = frozen || milestones.length >= 12 ? null : el('button', { class: 'mp-btn mp-btn--secondary mp-btn--sm', type: 'button', id: 'addMilestone', onclick: async () => {
    addMs.disabled = true;
    try { const r = await api(`/api/agreements/${agreement.id}/milestones`, { body: {} }); R.d.milestones = r.milestones; redraw(); setTimeout(() => document.getElementById(`msTitle-${r.milestones.at(-1).id}`)?.select()); }
    catch (e) { redraw(e); }
  } }, icon('plus'), 'Add milestone');
  const msCardEl = el('div', { class: 'mp-card mp-card--raised' },
    el('div', { class: 'mp-card__head' }, el('h2', { class: 'mp-t-section' }, `Milestones · ${milestones.length}`), totalEl),
    el('div', { class: 'mp-stack mp-stack--3' }, msList.length ? msList : el('p', { class: 'mp-muted' }, 'No milestones found.')), mismatch,
    frozen ? null : el('div', { class: 'mp-row mp-row--between mp-row--wrap', style: 'margin-top:12px' }, addMs,
      el('p', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, 'The AI drafted these. Change any title, description or amount, and add or remove milestones, before you send it.')));
  paintSum();
  apBtn?.addEventListener('click', async () => {
    const term = (k) => (b.terms || []).find((t) => t.key === k)?.value;
    const ok = await confirmDialog({ icon: 'lock', title: `Send version 1 to ${cname}?`, text: 'This locks the agreement. To change it later, you’d cancel it and send a new one.',
      summary: { label: 'Total', minor: milestones.reduce((a, m) => a + m.amount_minor, 0), cur }, rows: [['To', cname], ['Milestones', `${milestones.length} · ${milestones.map((m) => m.label).join(', ')}`], ['Deadline', term('deadline') || 'Not set'], ['Revisions', term('revisions') || 'Not set']],
      confirm: `Lock and send to ${cname}`, confirmIcon: 'send', cancel: 'Keep editing' });
    if (!ok) return;
    apBtn.disabled = true;
    try { const r = await api(`/api/agreements/${agreement.id}/approve`, { body: {} }); R.d.agreement = r.agreement; R.d = await api(`/api/projects/${project.id}`); viewAgreement(R.d, { fromProject }); toast(`Version 1 is locked. Send ${cname} the link.`); }
    catch (e) { drawAgreement({ fromProject, keep: true, err: e }); }
  });
  // sent state: invite + notes
  const sentArea = agreement.status === 'sent' ? el('div', { class: 'mp-stack mp-stack--4' },
    alertBox('success', 'check', el('b', {}, 'You approved version 1. '), (d.members || []).some((m) => m.role === 'client') ? `${cname} joined and is reviewing it.` : `Send ${cname} the link to review and approve it.`),
    inviteBox(d),
    el('span', { class: 'mp-row mp-t-caption mp-muted', style: 'font-weight:400' }, icon('lock'), 'Version 1 is locked. Nobody can change it now.'),
    notesBox(d, 'freelancer')) : null;
  const shell = appShell('freelancer',
    back(fromProject ? `/p/${project.id}` : '/projects', fromProject ? titleOf(d) : 'Your projects'),
    el('div', { class: 'mp-row mp-row--between mp-row--top mp-row--wrap', style: 'gap:16px' },
      el('div', { class: 'mp-stack', style: 'gap:4px;min-width:0' },
        agreement.status === 'draft' ? el('span', { class: 'mp-t-caption mp-muted' }, 'Review the agreement') : null,
        editableTitle(d, (x) => { R.d = x; redraw(); }),
        el('p', { class: 'mp-muted' }, agreement.status === 'draft' ? `The AI drafted this from your chat. Check it, fix the gaps, then send it to ${cname}.` : `Version 1 · ${fname} and ${cname}`)),
      (AGREEMENT_BADGE[agreement.status] || AGREEMENT_BADGE.draft)()),
    err ? errBox(err) : null,
    el('div', { class: 'mp-review' }, el('div', { class: 'mp-review__chat' }, chatCard),
      el('div', { class: 'mp-stack mp-stack--4' }, terms, gapsCard, msCardEl,
        apBtn ? el('div', { class: 'mp-row mp-row--wrap mp-sticky-cta' }, apBtn, apWhy) : null, sentArea)));
  (keep ? mountKeep : mount)(shell);
  if (R.hl) setTimeout(() => highlight(R.hl));
}

/**
 * The client's link, for the freelancer to copy. One lasting link per project: it can be copied again at any time,
 * before and after the agreement is approved, and the client can open it as often as they like.
 */
const inviteUrls = new Map();
export function inviteBox(d) {
  const client = memberOf(d, 'client');
  const { cname } = names(d); const pid = d.project.id;
  const who = client?.name || cname;
  const box = el('div', { class: 'mp-card mp-card--raised mp-stack mp-stack--3', id: 'inviteBox' });
  const paint = (url, err) => box.replaceChildren(
    el('b', { class: 'mp-t-sub mp-row' }, icon(client ? 'check' : 'link'), client ? `${who} joined as the client` : `Link for ${who}`),
    el('p', { class: 'mp-t-sm mp-muted' }, client ? `This is the link you sent. Copy it again any time: ${who} can use it to get back to this project as often as they need.`
      : `${who} opens it, continues with PayPal and sees the agreement. The link keeps working, so you can copy and send it again whenever you need to.`),
    url ? el('div', { class: 'mp-row mp-linkrow' }, el('input', { class: 'mp-input', readonly: true, value: url, id: 'inviteUrl', 'aria-label': 'Client link', onfocus: (e) => e.target.select() }),
      el('button', { class: 'mp-btn mp-btn--secondary', type: 'button', id: 'copyInvite', onclick: () => copyText(url, 'Link') }, icon('link'), 'Copy link'))
      : err ? el('div', { class: 'mp-stack' }, errBox(err), el('div', {}, el('button', { class: 'mp-btn mp-btn--secondary mp-btn--sm', type: 'button', onclick: load }, 'Try again')))
        : loading('Getting the link…'));
  async function load() {
    paint(null);
    try { const { url } = await api(`/api/projects/${pid}/invites`, { body: {} }); inviteUrls.set(pid, url); paint(url); }
    catch (e) { paint(null, e); }
  }
  if (inviteUrls.has(pid)) paint(inviteUrls.get(pid)); else load();
  return box;
}

/** Notes on a sent agreement (board 03 note 7 / board 04). Untrusted text, rendered as text. */
export function notesBox(d, me) {
  const notes = d.notes || [];
  const { fname, cname } = names(d);
  const other = me === 'freelancer' ? cname : fname;
  if (!notes.length) return null;
  const ta = el('textarea', { class: 'mp-input', rows: 2, maxlength: 500, id: 'noteReply', placeholder: `Reply to ${other}` });
  const send = el('button', { class: 'mp-btn mp-btn--secondary mp-btn--sm', onclick: async () => {
    send.disabled = true;
    try { await api(`/api/agreements/${d.agreement.id}/notes`, { body: { text: ta.value } }); ta.value = ''; toast(`Sent to ${other}`); window.dispatchEvent(new HashChangeEvent('hashchange')); }
    catch (e) { send.disabled = false; send.after(errBox(e)); }
  } }, icon('send'), `Reply to ${other}`);
  return el('div', { class: 'mp-card mp-notecard mp-stack mp-stack--3' },
    el('b', { class: 'mp-row' }, icon('chat'), `Notes about this agreement`),
    notes.map((n) => el('div', { class: `mp-msg ${n.from === me ? 'mp-msg--me' : ''}`, style: 'max-width:100%' },
      el('span', { class: `mp-avatar ${n.from === 'freelancer' ? 'mp-avatar--me' : ''}` }, initial(n.from === 'freelancer' ? fname : cname)),
      el('div', { class: 'mp-bubble' }, el('div', { class: 'mp-bubble__meta' }, el('b', {}, n.from === 'freelancer' ? fname : cname), el('span', {}, fmtDateTime(n.at))), n.text))),
    me === 'freelancer' ? el('div', { class: 'mp-stack' }, ta, el('div', { class: 'mp-row mp-row--wrap' }, send,
      el('span', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, 'Version 1 stays locked. If the terms must change, cancel it and send a new one.'))) : null);
}

// ---------------------------------------------------------------- 06 Submit work
const Pj = { picked: [], busy: false, pct: null, err: null };
export function viewSubmit(d, mid) {
  const m = (d.milestones || []).find((x) => x.id === mid);
  if (!m) return mount(appShell('freelancer', back(`/p/${d.project.id}`, 'Back to project'), emptyState({ ic: 'flag', title: 'Milestone not found' })));
  Pj.err = null;
  drawSubmit(d, m);
  poll(d.project.id, () => d, (x) => { d = x; const mm = x.milestones.find((y) => y.id === mid); if (mm) drawSubmit(x, mm, true); }, () => Pj.busy);
}
function strip(d, m, base) {
  return el('nav', { class: 'mp-strip', 'aria-label': 'Milestones' }, d.milestones.map((x) => link(`${base}/${x.id}`, {
    class: `mp-strip__item ${x.id === m.id ? 'mp-strip__item--cur' : ''} ${x.status === 'paid' ? 'mp-strip__item--paid' : ''}`, 'aria-current': x.id === m.id ? 'page' : null,
  }, el('span', { class: 'mp-strip__dot' }, x.status === 'paid' ? icon('check') : String(x.seq)), `${x.label} ${x.title}`)));
}
function drawSubmit(d, m, keep = false) {
  const cur = curOf(d); const { cname } = names(d);
  const pid = d.project.id;
  const revising = m.status === 'revision_requested';
  const canWork = ['authorized', 'revision_requested'].includes(m.status) && m.is_current;
  const picker = el('input', { type: 'file', multiple: true, accept: '.pdf,.png,.jpg,.jpeg,.zip,.mp4', hidden: true, id: 'fileIn', onchange: () => { upload(picker.files); picker.value = ''; } });
  function upload(list) {
    const ok = [];
    for (const f of list) {
      if (!/\.(pdf|png|jpe?g|zip|mp4)$/i.test(f.name)) { toast(`${f.name}: use PDF, PNG, JPG, ZIP or MP4`, 'alert'); continue; }
      if (f.size > 20 * 1024 * 1024) { toast(`${f.name} is over 20 MB`, 'alert'); continue; }
      ok.push(f);
    }
    if (!ok.length) return;
    const fd = new FormData(); ok.forEach((f) => fd.append('files[]', f, f.name));
    Pj.busy = true; Pj.err = null; Pj.pct = 0; drawSubmit(d, m, true);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/milestones/${m.id}/deliverables`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) { Pj.pct = Math.round((e.loaded / e.total) * 100); const t = document.getElementById('upTxt'); if (t) t.textContent = Pj.pct < 100 ? `Uploading… ${Pj.pct}%` : 'Checking the files…'; } };
    const done = async (err) => { Pj.busy = false; Pj.pct = null; Pj.err = err; try { d = await api(`/api/projects/${pid}`); } catch { /* keep */ } drawSubmit(d, d.milestones.find((x) => x.id === m.id) || m, true); };
    xhr.onerror = () => done('Couldn’t reach Milestone Pay. Check your connection and try again.');
    xhr.onload = () => { let r = {}; try { r = JSON.parse(xhr.responseText); } catch { /* not json */ } done(xhr.status >= 200 && xhr.status < 300 ? null : r.message || `Upload failed (${xhr.status}).`); };
    xhr.send(fd);
  }
  const markBtn = el('button', { class: 'mp-btn mp-btn--primary', id: 'markDelivered', disabled: Pj.busy, onclick: async () => {
    if (!m.deliverables.length) { Pj.err = 'Add at least one file first.'; return drawSubmit(d, m, true); }
    Pj.busy = true; drawSubmit(d, m, true);
    try { await api(`/api/milestones/${m.id}/submit`, { body: {} }); toast(`${m.label} sent to ${cname} for review`); }
    catch (e) { Pj.err = e.message; }
    Pj.busy = false;
    try { d = await api(`/api/projects/${pid}`); } catch { /* keep */ }
    drawSubmit(d, d.milestones.find((x) => x.id === m.id) || m, true);
  } }, icon('send'), Pj.busy && Pj.pct == null ? 'Sending…' : revising ? 'Send revised files' : `Mark ${m.label} delivered`);
  let head;
  if (canWork) head = nextStep({ text: revising ? 'Upload the revised files, then send them back' : `Upload your files, then mark ${m.label} delivered`,
    sub: revising ? `The ${money(m.amount_minor, cur)} hold stays in place while you revise.` : `${cname} reviews the files against the list on the left.`, action: markBtn });
  else if (m.status === 'submitted') head = nextStep({ ic: 'clock', text: `Waiting for ${cname} to review ${m.label}`, sub: 'You’ll see their answer here. The money stays held by Milestone Pay.' });
  else if (m.status === 'paid') head = m.payment?.payout_status === 'FAILED'
    ? alertBox('warn', 'clock', el('b', {}, `${cname} approved ${m.label}. `), `${money(m.amount_minor, cur)} is released, but sending it to your PayPal hasn’t gone through yet. Open the project page and press “Check with PayPal” to try again.`)
    : alertBox('success', 'check', `${m.label} paid · `, el('b', {}, `${money(m.amount_minor, cur)}`), m.payment?.payout_status === 'SENT' ? ' sent to your PayPal.' : ' received.');
  else if (m.status === 'voided') head = alertBox('issue', 'x', el('b', {}, `${cname} cancelled ${m.label}. `), `The ${money(m.amount_minor, cur)} hold was cancelled and ${cname} wasn’t charged.`);
  else head = null;
  const notFunded = m.status === 'agreed' || m.status === 'draft';
  const body = notFunded
    ? emptyState({ ic: 'clock', title: `${m.label} · ${m.title} isn’t funded yet`, text: m.fundable ? `We asked ${cname} to fund ${m.label} (${money(m.amount_minor, cur)}). Work starts once Milestone Pay holds it. Milestones are funded one at a time.` : `It unlocks after the milestones before it are paid.` })
    : el('div', { class: 'mp-grid-2 mp-submit' },
      el('div', { class: 'mp-card mp-card--raised mp-stack mp-stack--3' }, el('h2', { class: 'mp-t-section' }, 'Agreed deliverables'),
        el('span', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, `From agreement version ${d.agreement?.version || 1}`),
        el('ul', { class: 'mp-ms__crit' }, (m.criteria || []).map((c) => el('li', {}, c))),
        alertBox('info', 'user', `${cname} reviews your files against this list. There’s no AI check of the work.`)),
      el('div', { class: 'mp-card mp-card--raised mp-stack mp-stack--3' },
        el('div', { class: 'mp-card__head', style: 'margin:0' }, el('h2', { class: 'mp-t-section' }, 'Your files'), badge('outline', null, `Version ${m.rev_count + 1}`)),
        m.deliverables.length ? el('div', {}, m.deliverables.map((f) => fileRow(f))) : el('p', { class: 'mp-t-sm mp-muted' }, revising ? 'Nothing uploaded for this revision yet.' : 'No files yet.'),
        canWork ? el('div', { class: 'mp-drop mp-drop--compact', tabindex: '0', role: 'button', 'aria-label': 'Add files',
          onclick: () => !Pj.busy && picker.click(), onkeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && !Pj.busy) { e.preventDefault(); picker.click(); } },
          ondragover: (e) => { e.preventDefault(); }, ondrop: (e) => { e.preventDefault(); if (!Pj.busy) upload(e.dataTransfer.files); } },
        el('span', { class: 'mp-row' }, icon('upload'), el('b', { class: 'mp-t-sm' }, m.deliverables.length ? 'Drop more files' : 'Drop files'), ' or ', el('span', { class: 'mp-link' }, 'browse')),
        el('span', { class: 'mp-t-caption mp-muted' }, 'PDF, PNG, JPG, ZIP, MP4 · max 20 MB each')) : null,
        picker,
        Pj.pct != null ? el('div', { class: 'mp-row mp-t-sm', role: 'status' }, el('span', { class: 'mp-spinner', style: 'width:16px;height:16px' }), el('span', { id: 'upTxt' }, `Uploading… ${Pj.pct}%`)) : null,
        canWork && !m.deliverables.length ? el('span', { class: 'mp-help' }, `Add at least one file, then mark ${m.label} delivered.`) : null));
  (keep ? mountKeep : mount)(appShell('freelancer',
    back(`/p/${pid}`, titleOf(d)),
    strip(d, m, `/p/${pid}/m`),
    el('div', { class: 'mp-stack', style: 'gap:6px' }, el('h1', { class: 'mp-t-title' }, `${m.label} · ${m.title}`),
      el('div', { class: 'mp-row mp-row--wrap mp-t-sm mp-muted' }, msBadge(m), ['authorized', 'submitted', 'revision_requested'].includes(m.status) ? el('span', { class: 'mp-row' }, icon('lock'), `${money(m.amount_minor, cur)} held by Milestone Pay${m.payment?.expires_at ? ` until ${fmtDay(m.payment.expires_at)}` : ''}`) : null)),
    holdWarning(m, cur, cname, 'freelancer'),
    revising ? el('div', { class: 'mp-stack' }, badge('issue', 'alert', `Changes requested · round ${m.rev_count}${m.rev_limit ? ` of ${m.rev_limit}` : ''}`),
      alertBox('issue', 'flag', el('b', {}, `${cname} asked for changes`), el('div', {}, `“${m.rev_note || ''}”`))) : null,
    head, Pj.err ? alertBox('issue', 'alert', Pj.err) : null, body,
    revising || m.rev_count > 0 ? chatCard(d, 'freelancer', (x) => { const mm = x.milestones.find((y) => y.id === m.id); if (mm) drawSubmit(x, mm, true); }) : null,
    d.milestones.every((x) => x.status === 'paid') ? emptyState({ ic: 'check', title: 'All milestones paid', text: `Everything in the agreement is delivered and paid. Files stay available to both of you on the project page.`, actions: [link(`/p/${pid}`, { class: 'mp-btn mp-btn--secondary' }, 'Open project page')] }) : null));
}
/** “Hold ends in 3 days” warning for both sides (board 05). */
export function holdWarning(m, cur, other, me) {
  const left = m.payment?.expires_at && ['authorized', 'submitted', 'revision_requested'].includes(m.status) ? daysUntil(m.payment.expires_at) : null;
  if (left == null || left > 3) return null;
  return alertBox('warn', 'clock', el('b', {}, me === 'client' ? `Hold ends in ${plural(Math.max(0, left), 'day')}. ` : `${other}’s hold for ${m.label} ends in ${plural(Math.max(0, left), 'day')}. `),
    me === 'client' ? `The hold on your ${money(m.amount_minor, cur)} ends on ${fmtDay(m.payment.expires_at)}. If the work isn’t delivered by then, you’ll be asked to fund ${m.label} again. You won’t be charged twice.`
      : `Submit before ${fmtDay(m.payment.expires_at)} so ${other} can pay you.`);
}

// ---------------------------------------------------------------- 07 Activity (freelancer desktop feed)
const EVENT_ICON = { ai: 'sparkle', pp: 'lock', agent: 'sparkle', client: 'user', free: 'inbox', sys: 'info' };
export function viewActivity(d) {
  const { cname } = names(d);
  const rows = [...(d.activity || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const feed = []; let day = '';
  for (const a of rows) {
    const dd = fmtDate(a.at);
    if (dd !== day) { day = dd; feed.push(el('div', { class: 'mp-day' }, dd)); }
    const tone = /paid|approved/i.test(a.text) && a.who !== 'free' ? 'mp-event--success' : /cancel|refused|blocked|fail/i.test(a.text) ? 'mp-event--issue' : /held|fund/i.test(a.text) ? 'mp-event--held' : '';
    if (a.who === 'agent' || a.who === 'ai') feed.push(el('div', { class: 'mp-ai' }, el('div', { class: 'mp-ai__label' }, icon('sparkle'), 'Milestone assistant · AI'), el('div', {}, a.text), el('time', { class: 'mp-t-caption mp-muted' }, fmtTime(a.at))));
    else feed.push(el('div', { class: `mp-event ${tone}` }, icon(EVENT_ICON[a.who] || 'info'), el('span', {}, a.text), el('time', {}, fmtTime(a.at))));
  }
  const cur = d.milestones.find((m) => m.is_current);
  const nextTxt = !cur ? 'Everything is paid' : cur.status === 'agreed' ? `Next: wait for ${cname} to fund ${cur.label}` : cur.status === 'submitted' ? `Next: wait for ${cname} to review ${cur.label}` : `Next: work on ${cur.label}`;
  mount(appShell('freelancer', back(`/p/${d.project.id}`, titleOf(d)),
    pageHead('Activity', 'What happened on this project, oldest first.'),
    el('div', { class: 'mp-card mp-card--raised' }, el('div', { class: 'mp-chat', style: 'padding:0' }, feed.length ? feed : el('p', { class: 'mp-muted' }, 'Nothing has happened yet.'))),
    el('div', { class: 'mp-row mp-row--wrap' }, cur ? link(`/p/${d.project.id}/m/${cur.id}`, { class: 'mp-btn mp-btn--secondary' }, nextTxt, icon('arrow-right')) : el('span', { class: 'mp-muted' }, nextTxt),
      el('span', { class: 'mp-t-sm mp-muted' }, `${cname} decides on their phone.`))));
  poll(d.project.id, () => d, (x) => viewActivity(x));
}

// ---------------------------------------------------------------- 08 Change requests (freelancer)
const Sc = { id: null, title: '', items: [], price: '', busy: false, text: '', chain: Promise.resolve(), quote: null };
const VERDICT = {
  new_work: ['pending', 'plus', 'New work'],
  in_scope: ['success', 'check', 'Already in scope'],
  revision: ['held', 'refresh', 'Revision'],
};
export function viewChanges(d) {
  drawChanges(d);
  poll(d.project.id, () => d, (x) => { d = x; drawChanges(x, true); }, () => Sc.busy);
}
function drawChanges(d, keep = false) {
  const { cname } = names(d); const cur = curOf(d); const pid = d.project.id;
  const crs = d.change_requests || [];
  const open = crs.find((c) => c.status === 'open' || c.status === 'sent');
  const past = crs.filter((c) => c !== open).reverse();
  const msgs = d.messages || [];
  const approved = d.agreement?.status === 'approved';
  const left = el('div', { class: 'mp-card mp-card--raised mp-stack mp-stack--4' });
  if (open) {
    left.append(el('div', { class: 'mp-row mp-row--between' }, el('b', { class: 'mp-t-sub' }, `From ${open.from === 'client' ? `${cname} · in the app` : 'you'}`), el('span', { class: 'mp-t-caption mp-muted' }, fmtDateTime(open.created_at))),
      el('div', { class: 'mp-msg', style: 'max-width:100%' }, el('span', { class: 'mp-avatar' }, initial(open.from === 'client' ? cname : 'You')),
        el('div', { class: 'mp-bubble' }, el('div', { class: 'mp-bubble__meta' }, el('b', {}, open.from === 'client' ? cname : 'You')), open.text)));
  } else if (approved) {
    const ta = el('textarea', { class: 'mp-input', id: 'scopeIn', rows: 4, maxlength: 1000, placeholder: 'Paste the client’s message…', value: Sc.text, oninput: () => { Sc.text = ta.value; btn.disabled = Sc.busy || Sc.text.trim().length < 5; } });
    const err = el('div');
    const btn = el('button', { class: 'mp-btn mp-btn--secondary mp-btn--block', disabled: Sc.busy || Sc.text.trim().length < 5, onclick: async () => {
      Sc.busy = true; btn.disabled = true; btn.replaceChildren(el('span', { class: 'mp-spinner', style: 'width:16px;height:16px' }), 'Checking against the agreement…');
      try { await api(`/api/projects/${pid}/change-requests`, { body: { message: Sc.text.trim() } }); Sc.text = ''; Sc.id = null; d = await api(`/api/projects/${pid}`); Sc.busy = false; drawChanges(d, true); }
      catch (e) { Sc.busy = false; btn.disabled = false; btn.textContent = 'Check against agreement'; err.replaceChildren(errBox(e)); }
    } }, 'Check against agreement');
    left.append(el('div', { class: 'mp-row mp-row--between' }, el('b', { class: 'mp-t-sub' }, `No open request from ${cname}`)),
      el('div', { class: 'mp-field' }, el('label', { class: 'mp-label', for: 'scopeIn' }, 'Or paste one from LINE or WhatsApp'), ta), btn, err);
  } else left.append(emptyState({ ic: 'lock', title: 'Not open yet', text: 'Change requests open once both of you have approved the agreement.' }));
  let right = null;
  if (open) {
    const v = VERDICT[open.classification] || ['outline', 'info', 'Unclear'];
    const chips = (open.reason_source_ids || []).map((id) => { const m = msgs.find((x) => x.msg_id === id); return el('span', { class: 'mp-chip', title: m?.text || '' }, icon('chat'), `#${id.replace(/^m/, '')}${m ? ` ${m.sender} ${m.time || ''}` : ''}`); });
    right = el('div', { class: 'mp-card mp-card--raised mp-stack mp-stack--4' },
      el('div', { class: 'mp-row mp-row--wrap' }, badge(v[0], v[1], v[2]), el('span', { class: 'mp-t-caption mp-muted' }, 'AI suggestion. You make the final call.')),
      el('p', { class: 'mp-t-sm' }, open.reason || '', ' ', chips));
    if (open.status === 'sent') {
      const sv = open.sent_version || {};
      right.append(el('div', { class: 'mp-ms' }, el('span', { class: 'mp-ms__idx' }, icon('plus')), el('div', {}, el('div', { class: 'mp-ms__title' }, `${sv.label || ''} · ${sv.title || ''}`),
        el('ul', { class: 'mp-ms__crit' }, (sv.deliverables || []).map((x) => el('li', {}, x)))), el('div', { class: 'mp-ms__right' }, moneyEl(sv.amount_minor || 0, cur, 'md'), badge('pending', 'clock', 'Sent'))),
      alertBox('info', 'clock', `Waiting for ${cname} to accept or decline. This page updates by itself.`));
    } else if (open.classification === 'new_work' && open.draft) right.append(draftEditor(open, d, cur, cname));
    else {
      const err = el('div');
      const btn = el('button', { class: 'mp-btn mp-btn--primary', onclick: async () => {
        btn.disabled = true;
        try { await api(`/api/change-requests/${open.id}/close`, { body: {} }); d = await api(`/api/projects/${pid}`); drawChanges(d, true); toast('Request closed'); }
        catch (e) { btn.disabled = false; err.replaceChildren(errBox(e)); }
      } }, 'Close request');
      right.append(el('p', { class: 'mp-t-sm mp-muted' }, `Nothing to price. Tell ${cname} on chat, then close this.`), el('div', {}, btn), err);
    }
  }
  const decided = past.find((c) => c.status === 'accepted' || c.status === 'declined');
  (keep ? mountKeep : mount)(appShell('freelancer', back(`/p/${pid}`, titleOf(d)),
    pageHead('Change requests', `${cname} can request changes from their phone, or you can paste one they sent on chat. The AI checks it against agreement version 1.`),
    decided && decided === past[0] ? (decided.status === 'declined'
      ? alertBox('issue', 'x', el('b', {}, `${cname} declined the change order. `), `${decided.sent_version?.label || ''} · ${decided.sent_version?.title || ''} · ${money(decided.sent_version?.amount_minor || 0, cur)}. Scope stays as agreed in version 1.`)
      : alertBox('success', 'check', el('b', {}, `${cname} accepted the change order. `), `${decided.sent_version?.label || ''} · ${decided.sent_version?.title || ''} (${money(decided.sent_version?.amount_minor || 0, cur)}) is now a new milestone, funded after the ones before it.`)) : null,
    el('div', { class: right ? 'mp-changes' : '' }, left, right),
    past.length ? el('div', { class: 'mp-stack mp-stack--3' }, el('h2', { class: 'mp-t-section' }, 'Earlier requests'),
      el('div', { class: 'mp-card mp-card--raised mp-card--flush' }, el('table', { class: 'mp-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'Request'), el('th', {}, 'From'), el('th', {}, 'When'), el('th', {}, 'Result'))),
        el('tbody', {}, past.map((c) => el('tr', {}, el('td', {}, c.sent_version?.title || (c.text.length > 70 ? `${c.text.slice(0, 70)}…` : c.text)), el('td', {}, c.from === 'client' ? cname : 'You'), el('td', {}, fmtDate(c.created_at)),
          el('td', {}, c.status === 'accepted' ? badge('success', 'check', 'Accepted') : c.status === 'declined' ? badge('neutral', 'x', 'Declined') : badge('neutral', 'check', 'Closed')))))))) : null));
}
function draftEditor(c, d, cur, cname) {
  if (Sc.id !== c.id) { const dr = c.draft || {}; Sc.id = c.id; Sc.title = dr.title || ''; Sc.items = [...(dr.deliverables || [])]; Sc.price = major(dr.amount_minor || 0); }
  const ai = c.ai_draft || {};
  const err = el('div'); const saved = el('span', { class: 'mp-t-caption mp-muted' });
  const send = el('button', { class: 'mp-btn mp-btn--primary', id: 'sendQuote' });
  const priceNote = el('p', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' });
  const clean = () => Sc.items.map((x) => x.trim()).filter(Boolean);
  const paint = () => {
    const p = parseMinor(Sc.price);
    priceNote.textContent = `AI price: ${money(ai.amount_minor || 0, cur)}${ai.price_basis ? ` (${ai.price_basis})` : ''}.${p != null && p !== ai.amount_minor ? ` You set ${money(p, cur)}.` : ''}`;
    send.replaceChildren(icon('send'), `Send ${money(p || 0, cur)} change order to ${cname}`);
    send.disabled = Sc.busy || p == null;
  };
  const save = (body) => { saved.textContent = 'Saving…'; Sc.chain = Sc.chain.then(async () => { try { const r = await api(`/api/change-requests/${c.id}`, { method: 'PATCH', body }); Object.assign(c, r.change_request); err.replaceChildren(); saved.textContent = 'Saved'; } catch (e) { saved.textContent = ''; err.replaceChildren(errBox(e)); } }); return Sc.chain; };
  const title = el('input', { class: 'mp-input', id: 'crTitle', maxlength: 120, value: Sc.title, oninput: () => { Sc.title = title.value; }, onchange: () => save({ title: Sc.title.trim() }) });
  const price = el('input', { class: 'mp-input mp-input--amount', id: 'crPrice', inputmode: 'decimal', value: Sc.price, 'aria-label': `Price in ${cur}`,
    oninput: () => { Sc.price = price.value; paint(); },
    onchange: () => { const v = parseMinor(price.value); if (v == null) { toast('Enter a price like 200 or 200.50', 'alert'); return; } save({ amount_minor: v }); } });
  const list = el('div', { class: 'mp-stack' });
  const drawItems = () => list.replaceChildren(...Sc.items.map((it, i) => el('div', { class: 'mp-row', style: 'flex-wrap:nowrap' },
    el('input', { class: 'mp-input', id: `crItem-${i}`, value: it, maxlength: 120, placeholder: 'Describe a deliverable', 'aria-label': `Deliverable ${i + 1}`, oninput: (e) => { Sc.items[i] = e.target.value; }, onchange: () => save({ deliverables: clean() }) }),
    el('button', { class: 'mp-iconbtn', type: 'button', 'aria-label': `Remove deliverable ${i + 1}`, onclick: () => { Sc.items.splice(i, 1); drawItems(); save({ deliverables: clean() }); } }, icon('x')))));
  drawItems();
  send.addEventListener('click', async () => {
    Sc.busy = true; send.disabled = true; await Sc.chain;
    try { await api(`/api/change-requests/${c.id}/send`, { body: {} }); Sc.busy = false; toast(`Change order sent to ${cname}`); drawChanges(await api(`/api/projects/${d.project.id}`), true); }
    catch (e) { Sc.busy = false; paint(); err.replaceChildren(errBox(e)); }
  });
  paint();
  return el('div', { class: 'mp-stack mp-stack--4' },
    alertBox('info', 'edit', 'This is the AI’s draft. Change anything it got wrong before you send it.'),
    el('div', { class: 'mp-crgrid' },
      el('div', { class: 'mp-field' }, el('label', { class: 'mp-label', for: 'crTitle' }, 'Milestone title'), title),
      el('div', { class: 'mp-field' }, el('label', { class: 'mp-label', for: 'crPrice' }, 'Price'), el('div', { class: 'mp-affix' }, price, el('span', { class: 'mp-t-sm mp-muted' }, cur)))),
    priceNote,
    el('div', { class: 'mp-field' }, el('span', { class: 'mp-label' }, 'Deliverables'), list,
      el('div', { class: 'mp-row mp-row--wrap' },
        el('button', { class: 'mp-btn mp-btn--ghost mp-btn--sm', type: 'button', onclick: () => { Sc.items.push(''); drawItems(); document.getElementById(`crItem-${Sc.items.length - 1}`)?.focus(); } }, icon('plus'), 'Add deliverable'),
        el('button', { class: 'mp-btn mp-btn--ghost mp-btn--sm', type: 'button', onclick: async () => { Sc.title = ai.title || ''; Sc.items = [...(ai.deliverables || [])]; Sc.price = major(ai.amount_minor || 0); await save({ title: Sc.title, deliverables: Sc.items, amount_minor: ai.amount_minor }); Sc.id = null; drawChanges(await api(`/api/projects/${d.project.id}`), true); } }, icon('undo'), 'Reset to AI draft'), saved)),
    el('div', { class: 'mp-divider' }),
    el('div', { class: 'mp-row mp-row--wrap' }, send, el('span', { class: 'mp-t-sm mp-muted' }, `${cname} sees exactly what’s above.`)), err);
}

export { projectOverview };
