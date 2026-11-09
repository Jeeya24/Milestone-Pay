// 10 Account settings: profile or business details, PayPal, role, account. No password: PayPal handles sign-in.
import { S, el, icon, api, mount, appShell, pageHead, alertBox, errBox, toast, tagPicker, homeRole, myName, switchRole, logout, initial } from './core.js';

const SKILLS = ['Web design', 'Branding', 'Illustration', 'Photography', 'Copywriting', 'Development', 'Video'];
const HIRE = ['Website', 'Logo & branding', 'Photos', 'Social media', 'Writing', 'Something else'];

export function viewSettings() {
  const role = homeRole();
  const roles = new Set(S.me.roles || []);
  const isClient = role === 'client';
  let type = S.me.client_type || 'business';
  const name = el('input', { class: 'mp-input', id: 'setName', maxlength: 60, value: S.me.display_name || S.me.name || '' });
  const tags = tagPicker(isClient ? HIRE : SKILLS, isClient ? S.me.hire_for : S.me.skills, { allowAdd: !isClient, addLabel: 'Add a skill and press Enter' });
  const bio = el('textarea', { class: 'mp-input', id: 'setBio', rows: 2, maxlength: 160 }, S.me.bio || '');
  const count = el('span', { class: 'mp-t-caption mp-muted' }, `${(S.me.bio || '').length} / 160`);
  bio.addEventListener('input', () => { count.textContent = `${bio.value.length} / 160`; });
  const seg = el('div', { class: 'mp-seg', role: 'radiogroup', 'aria-label': 'Hiring as' });
  const nameLabel = el('label', { class: 'mp-label', for: 'setName' }, isClient ? (type === 'business' ? 'Business name' : 'Your name') : 'Display name');
  const paintSeg = () => { seg.replaceChildren(...[['individual', 'user', 'Individual'], ['business', 'building', 'Business']].map(([v, ic, t]) => el('button', { type: 'button', role: 'radio', 'aria-checked': type === v ? 'true' : 'false', class: type === v ? 'on' : '', onclick: () => { type = v; paintSeg(); } }, icon(ic), t))); nameLabel.textContent = isClient ? (type === 'business' ? 'Business name' : 'Your name') : 'Display name'; };
  paintSeg();
  const err = el('div');
  const save = el('button', { class: 'mp-btn mp-btn--primary', id: 'saveProfile', onclick: async () => {
    err.replaceChildren(); save.disabled = true;
    const body = isClient ? { display_name: name.value.trim(), client_type: type, hire_for: tags.values() } : { display_name: name.value.trim(), skills: tags.values(), bio: bio.value.trim() };
    try { S.me = (await api('/api/me', { method: 'PATCH', body })).user; toast(isClient ? 'Details saved. Freelancers see them on your next agreement.' : 'Profile saved. Clients see the new details on your next agreement.'); viewSettings(); }
    catch (e) { save.disabled = false; err.append(errBox(e)); }
  } }, 'Save changes');
  const other = isClient ? 'freelancer' : 'client';
  const card = (id, title, sub, ...kids) => el('section', { class: 'mp-card mp-card--raised mp-stack mp-stack--4', id }, el('div', {}, el('h2', { class: 'mp-t-section' }, title), sub ? el('p', { class: 'mp-t-sm mp-muted' }, sub) : null), ...kids);
  const go = (id) => (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  mount(appShell(role, pageHead('Settings'),
    el('div', { class: 'mp-settings' },
      el('nav', { class: 'mp-sidenav', 'aria-label': 'Settings sections' },
        el('a', { href: '#set-profile', onclick: go('set-profile'), class: 'on' }, icon(isClient ? 'building' : 'user'), isClient ? 'Business details' : 'Profile'),
        el('a', { href: '#set-paypal', onclick: go('set-paypal') }, icon('banknote'), 'PayPal'),
        el('a', { href: '#set-role', onclick: go('set-role') }, icon('briefcase'), 'Role'),
        el('a', { href: '#set-account', onclick: go('set-account') }, icon('lock'), 'Account')),
      el('div', { class: 'mp-stack mp-stack--6' },
        card('set-profile', isClient ? 'Business details' : 'Profile', isClient ? 'Freelancers see this on agreements you approve.' : 'Clients see this on agreements you send.',
          isClient ? el('div', { class: 'mp-field' }, el('span', { class: 'mp-label' }, 'Hiring as'), seg) : null,
          el('div', { class: 'mp-field' }, nameLabel, name),
          el('div', { class: 'mp-field' }, el('span', { class: 'mp-label' }, isClient ? 'What you usually hire for' : 'What you do'), tags.node),
          isClient ? null : el('div', { class: 'mp-field' }, el('div', { class: 'mp-label-row' }, el('label', { class: 'mp-label', for: 'setBio' }, 'Short bio', el('span', { class: 'mp-opt' }, '(optional)')), count), bio),
          el('div', {}, save), err),
        card('set-paypal', 'PayPal', isClient ? 'The account you fund milestones from.' : 'Where clients’ payments are sent when they approve your work.',
          alertBox('success', 'check', el('b', {}, 'Signed in with PayPal'), S.me.email ? ` · ${S.me.email}` : '', el('div', {}, isClient ? 'You log in and pay with this account.' : 'You log in and get paid with this account.')),
          el('span', { class: 'mp-trust', style: 'justify-content:flex-start' }, icon('lock'), 'We never see your PayPal password, card or bank details. To use a different PayPal account, log out and continue with that one.'),
          alertBox('info', 'info', 'Sandbox beta: payments go to the Milestone Pay demo merchant, not your own PayPal yet.')),
        card('set-role', 'Role', `You use Milestone Pay as a ${isClient ? 'client' : 'freelancer'}${roles.has(other) ? ` and a ${other}` : ''}.`,
          el('div', { class: 'mp-setrow' }, el('div', {}, el('b', { class: 'mp-t-sm' }, roles.has(other) ? `Switch to ${other === 'client' ? 'Your jobs' : 'Projects'}` : other === 'client' ? 'Hire people too?' : 'Freelance too?'),
            el('div', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, roles.has(other) ? 'You can also switch from the menu in the top bar.' : `Add the ${other} role, then switch between them from the menu in the top bar.`)),
          el('button', { class: 'mp-btn mp-btn--secondary', onclick: () => switchRole(other, !roles.has(other)) }, icon(roles.has(other) ? 'refresh' : 'plus'), roles.has(other) ? 'Switch' : `Add ${other} role`))),
        card('set-account', 'Account', null,
          el('div', { class: 'mp-setrow' }, el('div', {}, el('b', { class: 'mp-t-sm' }, 'Email'), el('div', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, `${S.me.email || 'Not shared'} · from PayPal`)),
            el('span', { class: 'mp-ok' }, icon('check'), 'Verified by PayPal')),
          el('div', { class: 'mp-setrow' }, el('div', {}, el('b', { class: 'mp-t-sm' }, 'Log out'), el('div', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, 'On this device. Your jobs and payments stay as they are.')),
            el('button', { class: 'mp-btn mp-btn--secondary', id: 'logoutBtn', onclick: logout }, icon('arrow-right'), 'Log out')))))));
}
export { initial, myName };
