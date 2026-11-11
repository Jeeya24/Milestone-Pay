// Onboarding (design-system boards O1–O5) and the agreement-link entry. PayPal is the only way in.
import { S, el, icon, api, go, link, mount, authShell, wordmark, alertBox, errBox, money, loading, tagPicker, toast, initial, myName } from './core.js';

const params = new URLSearchParams(location.search);
const loginUrl = (next) => `/auth/paypal/start?next=${encodeURIComponent(next || '/#/')}`;
/** ?login=cancelled|failed from the OAuth callback; read once, then removed from the address bar. */
let loginFlag = params.get('login');
if (loginFlag) history.replaceState(null, '', location.pathname + location.hash);
export const takeLoginFlag = () => { const f = loginFlag; loginFlag = null; return f; };

const INVITE_KEY = 'mp_invite';
export const pendingInvite = {
  get: () => { try { return sessionStorage.getItem(INVITE_KEY); } catch { return null; } },
  set: (t) => { try { sessionStorage.setItem(INVITE_KEY, t); } catch { /* private mode */ } },
  clear: () => { try { sessionStorage.removeItem(INVITE_KEY); } catch { /* private mode */ } },
};

// ---------------------------------------------------------------- O1 Welcome
/** The welcome page is a static page of its own (public/welcome.html); its buttons link back to #/start and #/login. */
export function viewWelcome() {
  location.replace('/welcome.html');
}


// ---------------------------------------------------------------- O2 Continue with PayPal
function paypalLoginButton(next) {
  const a = el('a', { class: 'mp-pp-login', href: loginUrl(next), id: 'ppLogin' }, el('span', { class: 'mp-pp-login__pp' }, 'Log in with ', el('b', {}, 'PayPal')));
  a.addEventListener('click', () => {
    a.classList.add('is-loading'); a.setAttribute('aria-busy', 'true');
    a.after(el('div', { class: 'mp-row mp-t-sm mp-muted', style: 'justify-content:center' }, el('span', { class: 'mp-spinner', style: 'width:16px;height:16px' }), 'Finish in the PayPal window…'));
  });
  return a;
}
const trust = () => el('span', { class: 'mp-trust' }, icon('lock'), 'We never see your PayPal password, card or bank details.');
const noAccount = () => el('p', { class: 'mp-switch' }, 'No PayPal account? ',
  el('a', { class: 'mp-link', href: 'https://www.sandbox.paypal.com/', target: '_blank', rel: 'noopener' }, 'Create one at PayPal'), ' (free), then come back.');
const legal = () => el('p', { class: 'mp-legal' }, 'By continuing you agree to our Terms and Privacy Policy.');
function loginErrors() {
  const f = takeLoginFlag();
  if (f === 'cancelled') return alertBox('issue', 'alert', el('b', {}, 'You closed the PayPal window. '), 'Nothing changed. Try again when you’re ready.');
  if (f === 'failed') return alertBox('issue', 'alert', el('b', {}, 'PayPal says this account can’t be used right now. '), 'Check your account at PayPal, then try again, or use a different PayPal account.');
  return null;
}
function testLogin(next) {
  if (!S.cfg?.test_auth) return null;
  const name = el('input', { class: 'mp-input', id: 'testName', placeholder: 'Name (local testing only)', 'aria-label': 'Test user name' });
  const err = el('div');
  return el('details', { class: 'mp-testlogin' }, el('summary', { class: 'mp-t-caption mp-muted' }, 'Local test login (TEST_AUTH=1)'),
    el('div', { class: 'mp-row', style: 'margin-top:8px' }, name, el('button', { class: 'mp-btn mp-btn--secondary', type: 'button', onclick: async () => {
      try {
        const r = await api('/auth/test-login', { body: { name: name.value }, noLoginRedirect: true });
        // A query change is a real page load (a hash change alone would re-route the logged-out page first).
        location.assign(`/?login=${r.restored ? 'restored' : 'ok'}${next.startsWith('/#') ? next.slice(1) : '#/'}`);
      }
      catch (e) { err.replaceChildren(errBox(e)); }
    } }, 'Log in')), err);
}

/** mode: 'start' (new user) | 'login' (returning) | 'expired' (logged out after the session ended). */
export function viewContinue(mode = 'start', next = '/#/') {
  const isNew = mode === 'start';
  const head = mode === 'expired'
    ? el('div', { class: 'mp-authcard__head' }, el('span', { class: 'mp-authcard__icon' }, icon('clock', 'mp-i--lg')), el('h1', { class: 'mp-t-title' }, 'You’ve been logged out'),
      el('p', { class: 'mp-muted mp-t-sm' }, 'For your safety we log you out after a while. Continue with PayPal to pick up where you left off.'))
    : el('div', { class: 'mp-authcard__head' }, el('h1', { class: 'mp-t-title' }, isNew ? 'Create your account' : 'Welcome back'),
      el('p', { class: 'mp-muted mp-t-sm' }, isNew ? 'Milestone Pay uses your PayPal account to sign you in. No new password to remember.' : 'Continue with the PayPal account you used before.'));
  const what = isNew ? el('div', { class: 'mp-stack', style: 'gap:8px' }, el('span', { class: 'mp-t-caption mp-muted' }, 'What we get from PayPal'),
    el('div', { class: 'mp-summary' },
      el('div', { class: 'mp-summary__row' }, el('span', { class: 'mp-row' }, icon('user'), 'Your name'), el('span', {}, 'from PayPal')),
      el('div', { class: 'mp-summary__row' }, el('span', { class: 'mp-row' }, icon('mail'), 'Your email'), el('span', {}, 'already verified by PayPal')),
      el('div', { class: 'mp-summary__row' }, el('span', { class: 'mp-row' }, icon('banknote'), 'Your PayPal account'), el('span', {}, 'to pay and get paid')))) : null;
  mount(authShell(el('div', { class: 'mp-authcard' }, head, loginErrors(), paypalLoginButton(next), what, trust(), noAccount(),
    isNew ? legal() : el('p', { class: 'mp-switch' }, 'New here? ', el('a', { class: 'mp-link', href: '#/start' }, 'Create your account')),
    testLogin(next)), { backTo: '/' }));
}

export function viewLoggedOut() {
  mount(authShell(el('div', { class: 'mp-authcard' },
    el('div', { class: 'mp-authcard__head' }, el('span', { class: 'mp-authcard__icon mp-authcard__icon--success' }, icon('check', 'mp-i--lg')),
      el('h1', { class: 'mp-t-title' }, 'You’re logged out'), el('p', { class: 'mp-muted mp-t-sm' }, 'Your projects and payments are safe. Log in again any time to see them.')),
    paypalLoginButton('/#/'), trust())));
}

// ---------------------------------------------------------------- agreement link (logged out → O2 from a link)
export async function viewInviteLanding(token) {
  mount(authShell(el('div', { class: 'mp-authcard' }, loading('Opening the agreement link…'))));
  let info;
  try { info = await api(`/api/invite-preview/${encodeURIComponent(token)}`, { noLoginRedirect: true }); }
  catch (e) {
    const expired = e.code === 'INVITE_EXPIRED' || e.code === 'INVITE_USED';
    return mount(authShell(el('div', { class: 'mp-authcard' },
      el('div', { class: 'mp-authcard__head' }, el('span', { class: 'mp-authcard__icon mp-authcard__icon--issue' }, icon(expired ? 'clock' : 'link', 'mp-i--lg')),
        el('h1', { class: 'mp-t-title' }, expired ? (e.code === 'INVITE_USED' ? 'This link was already used' : 'This link has expired') : 'This link doesn’t work'),
        el('p', { class: 'mp-muted mp-t-sm' }, `${e.message} Nothing was approved or charged.`)),
      el('p', { class: 'mp-switch' }, 'Have an account? ', el('a', { class: 'mp-link', href: loginUrl('/#/') }, 'Continue with PayPal'), ' to see your projects.'))));
  }
  const f = info.freelancer?.name || 'Your freelancer';
  mount(authShell(el('div', { class: 'mp-authcard' },
    el('div', { class: 'mp-sender' }, el('span', { class: 'mp-avatar mp-avatar--me' }, initial(f)),
      el('div', {}, el('b', { class: 'mp-t-sm' }, `${f} sent you an agreement`),
        el('div', { class: 'mp-t-caption mp-muted', style: 'font-weight:400' }, [info.project?.title || 'A project', info.total_minor ? money(info.total_minor, info.currency) : null, info.parts ? `${info.parts} parts` : null].filter(Boolean).join(' · ')))),
    el('div', { class: 'mp-authcard__head' }, el('h1', { class: 'mp-t-title' }, 'Continue with PayPal to view it'),
      el('p', { class: 'mp-muted mp-t-sm' }, 'You’ll be set up as the client. Already have an account? The same button logs you in.')),
    loginErrors(), paypalLoginButton(`/#/invite/${token}`), trust(), noAccount(), testLogin(`/#/invite/${token}`))));
}

/** Logged in and opening an agreement link: new users do the client setup first; everyone then joins and sees the agreement. */
export async function acceptInvite(token) {
  if (!S.me.onboarded) { pendingInvite.set(token); return go('/welcome/client'); }
  mount(authShell(el('div', { class: 'mp-authcard' }, loading('Opening the agreement…'))));
  try {
    const r = await api(`/api/invites/${encodeURIComponent(token)}/accept`, { body: {} });
    pendingInvite.clear();
    if (!(S.me.roles || []).includes('client')) { try { S.me = (await api('/api/me', { method: 'PATCH', body: { add_role: 'client' } })).user; } catch { /* the project still opens */ } }
    go(`/p/${r.project_id}`);
  } catch (e) {
    pendingInvite.clear();
    mount(authShell(el('div', { class: 'mp-authcard' },
      el('div', { class: 'mp-authcard__head' }, el('span', { class: 'mp-authcard__icon mp-authcard__icon--issue' }, icon('link', 'mp-i--lg')),
        el('h1', { class: 'mp-t-title' }, e.code === 'SELF_INVITE' ? 'This is your own agreement' : 'This link can’t be opened'),
        el('p', { class: 'mp-muted mp-t-sm' }, `${e.message} Nothing was approved or charged.`)),
      el('a', { class: 'mp-btn mp-btn--primary mp-btn--block', href: '#/' }, 'Go to your dashboard'))));
  }
}

// ---------------------------------------------------------------- O3 Choose role
export function viewRole() {
  let pick = S.me.active_role || null;
  const cont = el('button', { class: 'mp-btn mp-btn--primary mp-btn--block', id: 'roleContinue' });
  const why = el('p', { class: 'mp-t-caption mp-muted', style: 'text-align:center' });
  const card = (role, ic, title, sub, desc) => el('div', {
    class: `mp-role-card ${pick === role ? 'on' : ''}`, role: 'radio', tabindex: '0', 'aria-checked': pick === role ? 'true' : 'false', 'data-role': role,
    onclick: () => choose(role), onkeydown: (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); choose(role); } },
  }, el('span', { class: 'mp-role-card__radio' }, pick === role ? icon('check') : null), el('span', { class: 'mp-role-card__icon' }, icon(ic)),
    el('div', {}, el('div', { class: 'mp-role-card__title' }, title), el('div', { class: 'mp-t-caption mp-muted' }, sub), el('div', { class: 'mp-role-card__desc', style: 'margin-top:6px' }, desc)));
  const cards = el('div', { class: 'mp-roles', role: 'radiogroup', 'aria-label': 'How will you use Milestone Pay?' });
  const paint = () => {
    cards.replaceChildren(card('client', 'briefcase', 'I’m hiring', 'Client', 'Fund work one milestone at a time and pay only when you approve it.'),
      card('freelancer', 'laptop', 'I’m a freelancer', 'Freelancer', 'Keep every project in one place and get paid as you finish each milestone.'));
    cont.disabled = !pick;
    cont.replaceChildren(pick ? `Continue as a ${pick === 'client' ? 'client' : 'freelancer'}` : 'Continue', pick ? icon('arrow-right') : '');
    why.textContent = pick ? '' : 'Choose an option to continue';
  };
  const choose = (r) => { pick = r; paint(); cards.querySelector(`[data-role="${r}"]`)?.focus(); };
  cont.addEventListener('click', async () => {
    cont.disabled = true;
    try { S.me = (await api('/api/me', { method: 'PATCH', body: { role: pick } })).user; go(`/welcome/${pick}`); }
    catch (e) { cont.disabled = false; cont.after(errBox(e)); }
  });
  paint();
  mount(authShell(el('div', { class: 'mp-authcard mp-authcard--wide' },
    el('span', { class: 'mp-row mp-t-caption mp-muted' }, icon('check'), `Signed in with PayPal${S.me.email ? ` · ${S.me.email}` : ''}`),
    el('div', { class: 'mp-authcard__head' }, el('h1', { class: 'mp-t-title' }, 'How will you use Milestone Pay?'), el('p', { class: 'mp-muted mp-t-sm' }, 'Pick one to finish setting up. It takes under a minute.')),
    cards, el('span', { class: 'mp-row mp-t-sm mp-muted' }, icon('refresh'), 'You can add the other role later in Settings.'),
    el('div', { class: 'mp-stack mp-sticky-cta' }, cont, why))));
}

// ---------------------------------------------------------------- O4a / O4b setup
const SKILLS = ['Web design', 'Branding', 'Illustration', 'Photography', 'Copywriting', 'Development', 'Video'];
const HIRE = ['Website', 'Logo & branding', 'Photos', 'Social media', 'Writing'];
export const OTHER = 'Something else';
const paypalConnected = () => alertBox('success', 'check', el('b', {}, 'PayPal connected'), S.me.email ? ` · ${S.me.email}. ` : '. ', 'This is the PayPal account you sign in and pay or get paid with.');

export function viewSetup(role) {
  const fromLink = role === 'client' && !!pendingInvite.get();
  if (role === 'client' && S.me.active_role !== 'client') api('/api/me', { method: 'PATCH', body: { role: 'client' } }).then((r) => { S.me = r.user; }).catch(() => {});
  let type = S.me.client_type || 'business';
  const nameIn = el('input', { class: 'mp-input', id: 'displayName', maxlength: 60, value: S.me.display_name || S.me.name || '', autocomplete: 'name' });
  const nameMsg = el('span', { class: 'mp-ok' }, icon('check'), role === 'client' ? 'Freelancers will see this on agreements' : S.me.name ? `From PayPal (${S.me.name}). Change it if you freelance under another name.` : 'Clients will see this name');
  nameIn.addEventListener('input', () => { if (nameIn.value.trim() && nameMsg.className === 'mp-err') { nameIn.classList.remove('mp-input--error'); nameMsg.className = 'mp-ok'; nameMsg.replaceChildren(icon('check'), role === 'client' ? 'Freelancers will see this on agreements' : 'Clients will see this name'); } });
  const nameLabel = el('label', { class: 'mp-label', for: 'displayName' }, role === 'client' ? 'Business name' : 'Display name');
  const tags = role === 'client' ? tagPicker(HIRE, S.me.hire_for, { other: OTHER, addLabel: 'Type what you hire for' })
    : tagPicker(SKILLS, S.me.skills, { allowAdd: true, addLabel: 'Add a skill' });
  const tagErr = el('div');
  const bio = role === 'freelancer' ? el('textarea', { class: 'mp-input', id: 'bio', rows: 2, maxlength: 160, placeholder: 'Design student doing logos and menus for cafés.' }, S.me.bio || '') : null;
  const bioCount = el('span', { class: 'mp-t-caption mp-muted' }, `${(S.me.bio || '').length} / 160`);
  bio?.addEventListener('input', () => { bioCount.textContent = `${bio.value.length} / 160`; });
  const seg = el('div', { class: 'mp-seg', role: 'radiogroup', 'aria-label': 'Are you hiring as' });
  const paintSeg = () => {
    seg.replaceChildren(...[['individual', 'user', 'Individual'], ['business', 'building', 'Business']].map(([v, ic, t]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': type === v ? 'true' : 'false', class: type === v ? 'on' : '', onclick: () => { type = v; paintSeg(); },
    }, icon(ic), t)));
    if (role === 'client') nameLabel.textContent = type === 'business' ? 'Business name' : 'Your name';
  };
  paintSeg();
  const finish = el('button', { class: 'mp-btn mp-btn--primary mp-btn--block', id: 'finishSetup' }, 'Finish setup', icon('arrow-right'));
  const err = el('div');
  finish.addEventListener('click', async () => {
    err.replaceChildren(); tagErr.replaceChildren(); nameIn.classList.remove('mp-input--error');
    const name = nameIn.value.trim();
    let bad = false;
    if (!name) { nameIn.classList.add('mp-input--error'); nameMsg.className = 'mp-err'; nameMsg.replaceChildren(icon('alert'), role === 'client' ? 'Add a name freelancers will see' : 'Add the name clients will see'); bad = true; }
    if (role === 'freelancer' && !tags.values().length) { tagErr.append(el('span', { class: 'mp-err' }, icon('alert'), 'Pick at least one skill so clients know what you do')); bad = true; }
    if (bad) { (name ? finish : nameIn).focus(); return; }
    finish.disabled = true; finish.replaceChildren(el('span', { class: 'mp-spinner', style: 'width:16px;height:16px;border-top-color:var(--on-ink)' }), 'Saving…');
    const body = role === 'client' ? { role: 'client', display_name: name, client_type: type, hire_for: tags.values(), finish: true }
      : { role: 'freelancer', display_name: name, skills: tags.values(), bio: bio.value.trim(), finish: true };
    try { S.me = (await api('/api/me', { method: 'PATCH', body })).user; go('/welcome/done'); }
    catch (e) { finish.disabled = false; finish.replaceChildren('Finish setup', icon('arrow-right')); err.append(errBox(e)); }
  });
  const field = (...k) => el('div', { class: 'mp-field' }, ...k);
  mount(authShell(el('div', { class: 'mp-authcard mp-authcard--wide' },
    fromLink ? null : link('/welcome/role', { class: 'mp-back mp-hide-phone' }, icon('arrow-left'), 'Back'),
    el('div', { class: 'mp-authcard__head' }, el('h1', { class: 'mp-t-title' }, role === 'client' ? 'Who’s hiring?' : 'Tell clients about you'),
      el('p', { class: 'mp-muted mp-t-sm' }, role === 'client' ? 'One quick step. This appears on agreements you approve.' : 'One quick step. This shows on agreements you send.')),
    paypalConnected(),
    role === 'client' ? field(el('label', { class: 'mp-label' }, 'Are you hiring as…'), seg) : null,
    field(el('div', { class: 'mp-label-row' }, nameLabel), nameIn, nameMsg),
    field(el('label', { class: 'mp-label' }, role === 'client' ? 'What do you usually hire for?' : 'What do you do?', role === 'client' ? el('span', { class: 'mp-opt' }, '(optional)') : null),
      el('span', { class: 'mp-help' }, role === 'client' ? 'Helps us suggest milestones. Pick any, or choose “Something else” and type your own.' : 'Pick at least one, or add your own.'), tags.node, tagErr),
    bio ? field(el('div', { class: 'mp-label-row' }, el('label', { class: 'mp-label', for: 'bio' }, 'Short bio', el('span', { class: 'mp-opt' }, '(optional)')), bioCount), bio) : null,
    el('div', { class: 'mp-sticky-cta' }, finish), err), { backTo: fromLink ? null : '/welcome/role' }));
}

// ---------------------------------------------------------------- O5 All set
export async function viewDone() {
  const role = S.me.active_role || 'freelancer';
  const token = pendingInvite.get();
  const first = ((role === 'client' ? S.me.name || S.me.display_name : S.me.display_name || S.me.name) || '').split(' ')[0] || 'there';
  let invite = null;
  if (role === 'client' && token) { try { invite = await api(`/api/invites/${encodeURIComponent(token)}`); } catch { /* fall back to Your jobs */ } }
  const row = (ic, label, right) => el('div', { class: 'mp-summary__row' }, el('span', { class: 'mp-row', style: 'color:var(--ink)' }, icon(ic), label), el('span', { class: 'mp-ok', style: 'justify-content:flex-end' }, icon('check'), right));
  const next = role === 'freelancer'
    ? { ic: 'plus', text: 'Paste a client chat and we’ll turn it into milestones. No paperwork.', btn: 'Create your first project', to: () => go('/new') }
    : invite ? { ic: 'file', text: `${invite.freelancer?.name || 'Your freelancer'}’s agreement is waiting for you.`, sub: [invite.project?.title, invite.total_minor ? money(invite.total_minor, invite.currency) : null, invite.parts ? `${invite.parts} parts` : null].filter(Boolean).join(' · '), btn: 'Review the agreement', to: () => acceptInvite(token) }
      : { ic: 'briefcase', text: 'When a freelancer sends you an agreement link, open it and the project appears here.', btn: 'Go to Hired projects', to: () => go('/jobs') };
  const btn = el('button', { class: 'mp-btn mp-btn--primary mp-btn--block', id: 'doneNext', onclick: next.to }, next.btn, icon('arrow-right'));
  mount(authShell(el('div', { class: 'mp-authcard' },
    el('div', { class: 'mp-authcard__head' }, el('span', { class: 'mp-authcard__icon mp-authcard__icon--success' }, icon('check', 'mp-i--lg')),
      el('h1', { class: 'mp-t-title' }, `You’re all set, ${first}`),
      el('p', { class: 'mp-muted mp-t-sm' }, role === 'client' ? `Your client account${S.me.client_type === 'business' && S.me.display_name ? ` for ${S.me.display_name}` : ''} is ready.` : 'All your projects, in one place.')),
    el('div', { class: 'mp-summary' }, row('banknote', 'PayPal', S.me.email || 'Connected'), row(role === 'client' ? 'building' : 'user', role === 'client' ? (S.me.client_type === 'business' ? 'Business details' : 'Your details') : 'Profile', 'Done')),
    el('div', { class: 'mp-next mp-next--stack' }, el('div', { class: 'mp-row', style: 'gap:12px;align-items:flex-start' }, el('span', { class: 'mp-next__icon', style: 'width:32px;height:32px' }, icon(next.ic)),
      el('div', {}, el('div', { class: 'mp-next__label' }, 'Your next step'), el('div', { class: 'mp-next__text' }, next.text), next.sub ? el('div', { class: 'mp-t-sm mp-muted' }, next.sub) : null))),
    el('div', { class: 'mp-sticky-cta' }, btn))));
}

export { loginUrl, myName, toast };

/** Shown right after “Delete account”: the data goes in 15 days unless they log in again before then. */
export function viewDeletionScheduled() {
  let when = null;
  try { when = sessionStorage.getItem('mp_delete_on'); } catch { /* private mode */ }
  const d = when ? new Date(when) : null;
  const known = !!d && !isNaN(d);
  const date = known ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  mount(authShell(el('div', { class: 'mp-authcard' },
    el('div', { class: 'mp-authcard__head' }, el('span', { class: 'mp-authcard__icon' }, icon('clock', 'mp-i--lg')),
      el('h1', { class: 'mp-t-title' }, 'Your account will be deleted'),
      el('p', { class: 'mp-muted mp-t-sm' }, known ? `You’re logged out. On ${date} we delete your profile, your projects and their files for good.` : 'You’re logged out. In 15 days we delete your profile, your projects and their files for good.')),
    alertBox('info', 'undo', el('b', {}, 'Changed your mind? '), `Log in with PayPal before ${known ? date : 'then'} and the deletion stops. Everything will be as you left it.`),
    paypalLoginButton('/#/'), trust())));
}
