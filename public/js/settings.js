// 10 Account settings: profile or business details (with a picture), PayPal, role, account. No password: PayPal handles sign-in.
import { S, el, icon, api, go as goTo, mount, appShell, pageHead, alertBox, errBox, toast, tagPicker, homeRole, myName, switchRole, logout, initial, avatar, confirmDialog } from './core.js';
import { OTHER } from './onboarding.js';

const day = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };

const SKILLS = ['Web design', 'Branding', 'Illustration', 'Photography', 'Copywriting', 'Development', 'Video'];
const HIRE = ['Website', 'Logo & branding', 'Photos', 'Social media', 'Writing'];

/** Shrink a chosen photo to a 256px square JPEG in the browser, so the upload is small. */
function squareJpeg(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const bad = () => reject(new Error('Couldn’t read that picture. Try a .jpg or .png file.'));
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : bad()), 'image/jpeg', 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); bad(); };
    img.src = url;
  });
}

function pictureField() {
  const err = el('div');
  const label = () => [icon('camera'), S.me.avatar_url ? 'Change picture' : 'Upload a picture'];
  const picker = el('input', { type: 'file', accept: '.jpg,.jpeg,.png,image/jpeg,image/png', hidden: true, id: 'avatarFile', onchange: async () => {
    const f = picker.files[0]; picker.value = '';
    if (!f) return;
    err.replaceChildren();
    if (!/\.(jpe?g|png)$/i.test(f.name) && !/^image\/(jpeg|png)$/.test(f.type)) return err.replaceChildren(errBox(new Error('Choose a .jpg or .png picture.')));
    if (f.size > 15 * 1024 * 1024) return err.replaceChildren(errBox(new Error('That picture is over 15 MB. Choose a smaller one.')));
    choose.disabled = true; choose.replaceChildren(el('span', { class: 'mp-spinner', style: 'width:16px;height:16px' }), 'Uploading…');
    try {
      const fd = new FormData(); fd.append('avatar', await squareJpeg(f), 'avatar.jpg');
      S.me = (await api('/api/me/avatar', { form: fd })).user;
      toast('Profile picture updated');
      viewSettings();
    } catch (e) { choose.disabled = false; choose.replaceChildren(...label()); err.replaceChildren(errBox(e)); }
  } });
  const choose = el('button', { class: 'mp-btn mp-btn--secondary mp-btn--sm', type: 'button', id: 'avatarChoose', onclick: () => picker.click() }, ...label());
  const remove = S.me.avatar_url ? el('button', { class: 'mp-btn mp-btn--ghost mp-btn--sm', type: 'button', id: 'avatarRemove', onclick: async () => {
    try { S.me = (await api('/api/me/avatar', { method: 'DELETE' })).user; toast('Profile picture removed'); viewSettings(); } catch (e) { err.replaceChildren(errBox(e)); }
  } }, 'Remove') : null;
  return el('div', { class: 'mp-field' }, el('span', { class: 'mp-label' }, 'Profile picture'),
    el('div', { class: 'mp-row mp-avatarfield' }, avatar(myName(), S.me.avatar_url, `mp-avatar--xl ${homeRole() === 'client' ? '' : 'mp-avatar--me'}`),
      el('div', { class: 'mp-stack', style: 'gap:6px' }, el('div', { class: 'mp-row mp-row--wrap' }, choose, remove), el('span', { class: 'mp-help' }, 'A .jpg or .png. We crop it to a square.'))),
    picker, err);
}

/** Archived projects (open or bring back) and deleted projects (restore within 15 days). Filled in after the page shows. */
function projectsCard() {
  const body = el('div', { class: 'mp-stack mp-stack--4' }, el('p', { class: 'mp-t-sm mp-muted' }, 'Loading…'));
  const load = async () => {
    let list, gone;
    try { [list, gone] = await Promise.all([api('/api/projects'), api('/api/projects/deleted')]); }
    catch (e) { return body.replaceChildren(errBox(e)); }
    const archived = list.projects.filter((p) => p.archived);
    const row = (title, sub, ...btns) => el('div', { class: 'mp-setrow' }, el('div', { style: 'min-width:0' }, el('b', { class: 'mp-t-sm', style: 'overflow-wrap:anywhere' }, title), el('div', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, sub)), el('div', { class: 'mp-row', style: 'flex-wrap:nowrap' }, ...btns));
    const act = (label, ic, fn, id) => { const b = el('button', { class: 'mp-btn mp-btn--secondary mp-btn--sm', type: 'button', 'data-action': id, onclick: async () => { b.disabled = true; try { await fn(); load(); } catch (e) { b.disabled = false; toast(e.message, 'alert'); } } }, icon(ic), label); return b; };
    body.replaceChildren(
      el('div', { id: 'set-archived' }, el('h3', { class: 'mp-t-sub' }, `Archived · ${archived.length}`),
        archived.length ? archived.map((p) => row(p.title || 'Untitled project', p.my_role === 'client' ? `From ${p.freelancer || 'a freelancer'} · hidden from Hired projects` : `${p.client ? `With ${p.client} · ` : ''}hidden from Your projects`,
          el('a', { class: 'mp-btn mp-btn--ghost mp-btn--sm', href: `#/p/${p.id}` }, 'Open'),
          act('Unarchive', 'undo', async () => { await api(`/api/projects/${p.id}/archive`, { body: { archived: false } }); toast('Moved back to your list'); }, 'unarchive')))
          : el('p', { class: 'mp-t-sm mp-muted' }, 'Nothing archived. Archive a project from its row in your list to tidy it away; it stays open to you here.')),
      el('div', { id: 'set-deleted' }, el('h3', { class: 'mp-t-sub' }, `Deleted · ${gone.projects.length}`),
        gone.projects.length ? gone.projects.map((p) => row(p.title || 'Untitled project', `Deleted ${day(p.deleted_at)} · erased for good on ${day(p.restore_until)}`,
          act('Restore', 'undo', async () => { await api(`/api/projects/${p.id}/restore`, { body: {} }); toast('Project restored. It’s back in your list.'); }, 'restore')))
          : el('p', { class: 'mp-t-sm mp-muted' }, `Projects you delete stay here for ${gone.days} days so you can restore them. After that they’re erased for good.`)));
  };
  load();
  return body;
}

export function viewSettings() {
  const role = homeRole();
  const roles = new Set(S.me.roles || []);
  const isClient = role === 'client';
  let type = S.me.client_type || 'business';
  const name = el('input', { class: 'mp-input', id: 'setName', maxlength: 60, value: S.me.display_name || S.me.name || '' });
  const tags = isClient ? tagPicker(HIRE, S.me.hire_for, { other: OTHER, addLabel: 'Type what you hire for' }) : tagPicker(SKILLS, S.me.skills, { allowAdd: true, addLabel: 'Add a skill' });
  const bio = el('textarea', { class: 'mp-input', id: 'setBio', rows: 2, maxlength: 160, placeholder: isClient ? 'A small café in Ari, Bangkok.' : 'Bangkok-based designer for cafés and small shops.' }, S.me.bio || '');
  const count = el('span', { class: 'mp-t-caption mp-muted' }, `${(S.me.bio || '').length} / 160`);
  bio.addEventListener('input', () => { count.textContent = `${bio.value.length} / 160`; });
  const seg = el('div', { class: 'mp-seg', role: 'radiogroup', 'aria-label': 'Hiring as' });
  const nameLabel = el('label', { class: 'mp-label', for: 'setName' }, isClient ? (type === 'business' ? 'Business name' : 'Your name') : 'Display name');
  const paintSeg = () => { seg.replaceChildren(...[['individual', 'user', 'Individual'], ['business', 'building', 'Business']].map(([v, ic, t]) => el('button', { type: 'button', role: 'radio', 'aria-checked': type === v ? 'true' : 'false', class: type === v ? 'on' : '', onclick: () => { type = v; paintSeg(); } }, icon(ic), t))); nameLabel.textContent = isClient ? (type === 'business' ? 'Business name' : 'Your name') : 'Display name'; };
  paintSeg();
  const err = el('div');
  const save = el('button', { class: 'mp-btn mp-btn--primary', id: 'saveProfile', onclick: async () => {
    err.replaceChildren(); save.disabled = true;
    const body = isClient ? { display_name: name.value.trim(), client_type: type, hire_for: tags.values(), bio: bio.value.trim() } : { display_name: name.value.trim(), skills: tags.values(), bio: bio.value.trim() };
    try { S.me = (await api('/api/me', { method: 'PATCH', body })).user; toast(isClient ? 'Details saved. Freelancers you work with can see them.' : 'Profile saved. Your clients can see it.'); viewSettings(); }
    catch (e) { save.disabled = false; err.append(errBox(e)); }
  } }, 'Save changes');
  const delErr = el('div');
  const del = el('button', { class: 'mp-btn mp-btn--danger-quiet', id: 'deleteAccount', type: 'button', onclick: async () => {
    const ok = await confirmDialog({ icon: 'trash', iconKind: 'issue', title: 'Delete your account?',
      text: 'You’ll be logged out now. After 15 days we delete your profile, your projects and their files for good. If you log in again before then, the deletion stops and everything stays as it is.',
      rows: [['Logged out', 'Right away'], ['Data deleted', 'After 15 days'], ['To cancel', 'Log in within 15 days']],
      confirm: 'Keep my account', cancel: 'Delete my account', cancelClass: 'mp-btn--danger' });
    if (ok !== false) return; // only the red button deletes
    del.disabled = true; delErr.replaceChildren();
    try {
      const r = await api('/api/me', { method: 'DELETE' });
      try { sessionStorage.setItem('mp_delete_on', r.scheduled_for); } catch { /* private mode */ }
      S.me = null; S.projects = null;
      goTo('/account-deleted');
    } catch (e) { del.disabled = false; delErr.replaceChildren(errBox(e)); }
  } }, icon('trash'), 'Delete account');
  const other = isClient ? 'freelancer' : 'client';
  const card = (id, title, sub, ...kids) => el('section', { class: 'mp-card mp-card--raised mp-stack mp-stack--4', id }, el('div', {}, el('h2', { class: 'mp-t-section' }, title), sub ? el('p', { class: 'mp-t-sm mp-muted' }, sub) : null), ...kids);
  const go = (id) => (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  mount(appShell(role, pageHead('Settings'),
    el('div', { class: 'mp-settings' },
      el('nav', { class: 'mp-sidenav', 'aria-label': 'Settings sections' },
        el('a', { href: '#set-profile', onclick: go('set-profile'), class: 'on' }, icon(isClient ? 'building' : 'user'), isClient ? 'Business details' : 'Profile'),
        el('a', { href: '#set-paypal', onclick: go('set-paypal') }, icon('banknote'), 'PayPal'),
        el('a', { href: '#set-projects', onclick: go('set-projects') }, icon('archive'), 'Archived & deleted'),
        el('a', { href: '#set-role', onclick: go('set-role') }, icon('briefcase'), 'Role'),
        el('a', { href: '#set-account', onclick: go('set-account') }, icon('lock'), 'Account')),
      el('div', { class: 'mp-stack mp-stack--6' },
        card('set-profile', isClient ? 'Business details' : 'Profile', isClient ? 'Freelancers you work with see this on your profile.' : 'Your clients see this on your profile.',
          pictureField(),
          isClient ? el('div', { class: 'mp-field' }, el('span', { class: 'mp-label' }, 'Hiring as'), seg) : null,
          el('div', { class: 'mp-field' }, nameLabel, name),
          el('div', { class: 'mp-field' }, el('span', { class: 'mp-label' }, isClient ? 'What you usually hire for' : 'What you do'),
            isClient ? el('span', { class: 'mp-help' }, 'Pick any, or choose “Something else” and type your own.') : null, tags.node),
          el('div', { class: 'mp-field' }, el('div', { class: 'mp-label-row' }, el('label', { class: 'mp-label', for: 'setBio' }, isClient ? 'About you or your business' : 'Short bio', el('span', { class: 'mp-opt' }, '(optional)')), count), bio),
          el('div', {}, save), err),
        card('set-paypal', 'PayPal', isClient ? 'The account you fund milestones from.' : 'Where clients’ payments are sent when they approve your work.',
          alertBox('success', 'check', el('b', {}, 'Signed in with PayPal'), S.me.email ? ` · ${S.me.email}` : '', el('div', {}, isClient ? 'You log in and pay with this account.' : 'You log in and get paid with this account.')),
          el('span', { class: 'mp-trust', style: 'justify-content:flex-start' }, icon('lock'), 'We never see your PayPal password, card or bank details. To use a different PayPal account, log out and continue with that one.'),
          alertBox('info', 'info', isClient ? 'Sandbox beta: fake money. Milestone Pay holds what you fund and releases it when you approve the work.' : 'Sandbox beta: fake money. Milestone Pay holds each payment and sends it to this PayPal account when your client approves the work.')),
        card('set-projects', 'Archived and deleted projects', 'Open or bring back archived projects, and restore a deleted project within 15 days.', projectsCard()),
        card('set-role', 'Role', `You use Milestone Pay as a ${isClient ? 'client' : 'freelancer'}${roles.has(other) ? ` and a ${other}` : ''}.`,
          el('div', { class: 'mp-setrow' }, el('div', {}, el('b', { class: 'mp-t-sm' }, roles.has(other) ? `Switch to ${other === 'client' ? 'Hired projects' : 'Projects'}` : other === 'client' ? 'Hire people too?' : 'Freelance too?'),
            el('div', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, roles.has(other) ? 'You can also switch from the menu in the top bar.' : `Add the ${other} role, then switch between them from the menu in the top bar.`)),
          el('button', { class: 'mp-btn mp-btn--secondary', onclick: () => switchRole(other, !roles.has(other)) }, icon(roles.has(other) ? 'refresh' : 'plus'), roles.has(other) ? 'Switch' : `Add ${other} role`))),
        card('set-account', 'Account', null,
          el('div', { class: 'mp-setrow' }, el('div', {}, el('b', { class: 'mp-t-sm' }, 'Email'), el('div', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, `${S.me.email || 'Not shared'} · from PayPal`)),
            el('span', { class: 'mp-ok' }, icon('check'), 'Verified by PayPal')),
          el('div', { class: 'mp-setrow' }, el('div', {}, el('b', { class: 'mp-t-sm' }, 'Log out'), el('div', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, 'On this device. Your projects and payments stay as they are.')),
            el('button', { class: 'mp-btn mp-btn--secondary', id: 'logoutBtn', onclick: logout }, icon('arrow-right'), 'Log out')),
          el('div', { class: 'mp-setrow' }, el('div', {}, el('b', { class: 'mp-t-sm' }, 'Delete account'), el('div', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, 'Your data is deleted after 15 days. Log in before then to keep your account.')),
            del), delErr)))));
}
export { initial, myName };
