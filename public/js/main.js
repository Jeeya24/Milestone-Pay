// Boot and hash routing. The journey follows the Milestone Pay design system: O1–O5 onboarding, 01–10 app screens.
import { S, el, api, go, mount, appShell, back, errBox, emptyState, skeleton, stopPoll, homeRole, link } from './core.js';
import { viewWelcome, viewContinue, viewLoggedOut, viewInviteLanding, acceptInvite, viewRole, viewSetup, viewDone, pendingInvite } from './onboarding.js';
import { viewProjects, viewNew, viewAgreement, viewSubmit, viewActivity, viewChanges } from './freelancer.js';
import { projectOverview } from './project.js';
import { viewJobs, viewClientProject, viewReview, viewRevision, viewRequestChange } from './client.js';
import { viewSettings } from './settings.js';

let legacyChecked = false;
/** Users from before onboarding existed who already have projects skip it. */
async function needsOnboarding() {
  if (S.me.onboarded) return false;
  if (!legacyChecked) {
    legacyChecked = true;
    try {
      const p = await api('/api/projects'); S.projects = p;
      const mine = p.projects;
      if (mine.length) {
        const role = mine.some((x) => x.my_role === 'freelancer') ? 'freelancer' : 'client';
        S.me = (await api('/api/me', { method: 'PATCH', body: { role, ...(role === 'freelancer' ? { skills: S.me.skills?.length ? S.me.skills : ['Freelance work'] } : {}), finish: true } })).user;
        return false;
      }
    } catch { /* fall through to onboarding */ }
  }
  return !S.me.onboarded;
}

async function loadProject(pid, role) {
  mount(appShell(role || homeRole(), skeleton()));
  try { return await api(`/api/projects/${pid}`); }
  catch (e) {
    mount(appShell(homeRole(), back('/', 'Home'), e.status === 404
      ? emptyState({ ic: 'flag', title: 'Project not found', text: 'It doesn’t exist, or it belongs to someone else.' })
      : errBox(e)));
    return null;
  }
}

async function route() {
  stopPoll();
  document.querySelectorAll('.mp-overlay').forEach((n) => n.remove());
  const h = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  let m;
  // ---- logged out
  if (!S.me) {
    if (h === '/') return viewWelcome();
    if (h === '/start') return viewContinue('start', '/#/');
    if (h === '/login') return viewContinue('login', '/#/');
    if (h === '/logged-out') return viewLoggedOut();
    if ((m = /^\/invite\/([\w-]+)$/.exec(h))) return viewInviteLanding(m[1]);
    return viewContinue('login', `/#${h}`);
  }
  // ---- logged in
  if ((m = /^\/invite\/([\w-]+)$/.exec(h))) return acceptInvite(m[1]);
  if ((m = /^\/welcome\/(role|freelancer|client|done)$/.exec(h))) {
    return m[1] === 'role' ? viewRole() : m[1] === 'done' ? viewDone() : viewSetup(m[1]);
  }
  if (await needsOnboarding()) return go(pendingInvite.get() ? '/welcome/client' : '/welcome/role');
  if (['/', '/start', '/login', '/logged-out'].includes(h)) return go(homeRole() === 'client' ? '/jobs' : '/projects');
  if (h === '/projects') return viewProjects();
  if (h === '/jobs') return viewJobs();
  if (h === '/new') return viewNew();
  if (h === '/settings') return viewSettings();
  if ((m = /^\/p\/([\w-]+)(?:\/(agreement|changes|change|activity|project|m\/([\w-]+)(\/changes)?))?$/.exec(h))) {
    const [, pid, sub, mid, mchanges] = m;
    const d = await loadProject(pid);
    if (!d) return;
    const role = d.my_role;
    if (role === 'client') {
      if (mid && mchanges) return viewRevision(d, mid);
      if (mid) return viewReview(d, mid);
      if (sub === 'change') return viewRequestChange(d);
      if (sub === 'project' || sub === 'agreement' && d.agreement?.status === 'approved') return projectOverview(d, 'client');
      return viewClientProject(d);
    }
    if (mid) return viewSubmit(d, mid);
    if (sub === 'changes' || sub === 'change') return viewChanges(d);
    if (sub === 'activity') return viewActivity(d);
    if (sub === 'agreement') return viewAgreement(d, { fromProject: d.agreement?.status === 'approved' });
    if (!d.agreement || d.agreement.status !== 'approved') return viewAgreement(d);
    return projectOverview(d, 'freelancer');
  }
  mount(appShell(homeRole(), emptyState({ ic: 'flag', title: 'Page not found', text: 'This link doesn’t go anywhere.', actions: [link('/', { class: 'mp-btn mp-btn--primary' }, 'Go home')] })));
}

(async function boot() {
  try { S.cfg = await api('/api/config', { noLoginRedirect: true }); } catch { S.cfg = { currency: 'USD' }; }
  try { S.me = (await api('/api/session', { noLoginRedirect: true })).user; } catch { S.me = null; }
  window.addEventListener('hashchange', route);
  route();
})();

export { el };
