// Milestone Agent. S5 STUB: deterministic only. S6 replaces the internals and keeps this export signature.
// The agent only ever sees milestone, proposal and payment state, never chat, revision notes or change requests.
import * as db from './db.js';

export async function runAgent(event, milestoneId, _opts = {}) {
  const d = db.load();
  const m = d.milestones.find((x) => x.id === milestoneId);
  if (!m) throw new db.AppError('NOT_FOUND', 'Milestone not found', 404);
  const steps = [];
  if (event === 'milestone.submitted') {
    let p = d.proposals.find((x) => x.milestone_id === m.id && x.action === 'release' && x.status === 'pending');
    if (!p) {
      p = {
        id: db.id('prop'), project_id: m.project_id, milestone_id: m.id, action: 'release', status: 'pending',
        reason: `Work submitted for ${m.label}; client to review`, approved_by: null, created_at: new Date().toISOString(),
      };
      d.proposals.push(p);
    }
    steps.push({ tool: 'propose_release', args: { milestone_id: m.id }, result: { proposal_id: p.id }, ok: true });
  }
  const run = {
    id: db.id('run'), project_id: m.project_id, event, milestone_id: m.id, mode: 'fallback', steps, at: new Date().toISOString(),
  };
  d.agent_runs.push(run);
  db.save();
  return run;
}
