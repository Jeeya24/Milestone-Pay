// Who may touch a project. Roles live in project_members (one freelancer, one client per project).
// Non-members get 404 (ids never leak); members with the wrong role get 403 WRONG_ROLE.
import * as db from './db.js';

const D = () => db.load();
const notFound = () => new db.AppError('NOT_FOUND', 'Not found', 404);

const FINDERS = {
  project: (id) => D().projects.find((x) => x.id === id && x.source !== 'lab')?.id,
  agreement: (id) => D().agreements.find((x) => x.id === id)?.project_id,
  milestone: (id) => D().milestones.find((x) => x.id === id && !x.source)?.project_id,
  // The milestone decides the project (a proposal's own project_id is informational).
  proposal: (id) => D().milestones.find((m) => m.id === D().proposals.find((x) => x.id === id)?.milestone_id)?.project_id,
  change_request: (id) => D().change_requests.find((x) => x.id === id)?.project_id,
  deliverable: (id) => D().deliverables.find((x) => x.id === id)?.project_id,
};

export function projectIdFor(kind, id) {
  if (typeof id !== 'string' || !id) return null;
  return FINDERS[kind]?.(id) ?? null;
}

export const membersOf = (projectId) => D().project_members.filter((m) => m.project_id === projectId);
export const memberWithRole = (projectId, role) => membersOf(projectId).find((m) => m.role === role) ?? null;

export function roleOf(userId, projectId) {
  return membersOf(projectId).find((m) => m.user_id === userId)?.role ?? null;
}

export function addMember(projectId, userId, role) {
  if (memberWithRole(projectId, role)) throw new db.AppError('CLIENT_TAKEN', 'This project already has a client.', 409);
  D().project_members.push({ project_id: projectId, user_id: userId, role, at: new Date().toISOString() });
  db.save();
}

/**
 * Route guard. kind names the object in req.params.id (or idFrom(req) for body ids); role, when given, is required.
 * Sets req.projectId, req.role and req.actorUserId (who acts: the user, or the demo client under Judge act-as).
 */
export function need(kind, role = null, idFrom = (req) => req.params.id) {
  return (req, _res, next) => {
    let projectId = projectIdFor(kind, idFrom(req));
    // A deleted project is in its 15-day restore window: nobody can open or act on it (see routes.js).
    if (projectId && D().projects.find((x) => x.id === projectId)?.deleted_at) projectId = null;
    let r = projectId && roleOf(req.user.id, projectId);
    if (!r) return next(notFound());
    let actor = req.user.id;
    if (req.get('x-act-as') === 'client' && r === 'freelancer') {
      const p = D().projects.find((x) => x.id === projectId);
      const client = memberWithRole(projectId, 'client');
      if (p?.is_demo && client) { r = 'client'; actor = client.user_id; }
    }
    if (role && r !== role) return next(new db.AppError('WRONG_ROLE', `Only the ${role} can do this.`, 403));
    req.projectId = projectId;
    req.role = r;
    req.actorUserId = actor;
    next();
  };
}
