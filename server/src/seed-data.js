/* ============================================================
 *  Seed data for the Kanban API.
 *  Mirrors the prototype's data.js so the API returns the same
 *  content the frontend was built against. Used by the in-memory
 *  store (default) and by `npm run seed` to load Postgres.
 * ========================================================== */

const days = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

const agents = [
  // password_hash / token_hash are filled by `npm run seed` (see scripts/seed.js).
  { id: 'adam',   name: 'Adam',   kind: 'human', role: 'Owner',            color: '#D97757', initials: 'AD', password: 'changeme', is_admin: true },
  { id: 'claude', name: 'Claude', kind: 'agent', role: 'Build agent',      color: '#6E59C7', initials: 'CL', token: 'agt_live_9f3c_REPLACE_ME', is_admin: false },
  { id: 'atlas',  name: 'Atlas',  kind: 'agent', role: 'Infra agent',      color: '#2F7D63', initials: 'AT', token: 'agt_live_4b8e_REPLACE_ME', is_admin: false },
  { id: 'nova',   name: 'Nova',   kind: 'agent', role: 'Frontend agent',   color: '#2A6FB5', initials: 'NV', token: 'agt_live_1c20_REPLACE_ME', is_admin: false },
  { id: 'scout',  name: 'Scout',  kind: 'agent', role: 'QA / review agent',color: '#B5852A', initials: 'SC', token: 'agt_live_77aa_REPLACE_ME', is_admin: false },
];

// Per-project grants for seeded agents (claude, atlas, nova, scout get write on all projects).
// adam is admin so has implicit access to everything.
const agentPermissions = [
  { agent_id: 'claude', project_id: 'aws',    access: 'write' },
  { agent_id: 'claude', project_id: 'mobile', access: 'write' },
  { agent_id: 'claude', project_id: 'data',   access: 'write' },
  { agent_id: 'atlas',  project_id: 'aws',    access: 'write' },
  { agent_id: 'atlas',  project_id: 'mobile', access: 'write' },
  { agent_id: 'atlas',  project_id: 'data',   access: 'write' },
  { agent_id: 'nova',   project_id: 'aws',    access: 'write' },
  { agent_id: 'nova',   project_id: 'mobile', access: 'write' },
  { agent_id: 'nova',   project_id: 'data',   access: 'write' },
  { agent_id: 'scout',  project_id: 'aws',    access: 'write' },
  { agent_id: 'scout',  project_id: 'mobile', access: 'write' },
  { agent_id: 'scout',  project_id: 'data',   access: 'write' },
];

const projects = [
  { id: 'aws',    name: 'AWS Command Centre',  key: 'AWS',  color: '#D97757', description: 'Foundation infra, IAM, state backend & networking.' },
  { id: 'mobile', name: 'Mobile App Relaunch', key: 'MOB',  color: '#2A6FB5', description: 'New onboarding, design refresh & offline mode.' },
  { id: 'data',   name: 'Data Platform',       key: 'DATA', color: '#2F7D63', description: 'Ingestion pipelines, warehouse & dashboards.' },
];

const epics = [
  { id: 'FOUND', project_id: 'aws',    title: 'AWS Foundation Setup' },
  { id: 'NET',   project_id: 'aws',    title: 'Networking & VPC' },
  { id: 'SEC',   project_id: 'aws',    title: 'Security & Compliance' },
  { id: 'ONB',   project_id: 'mobile', title: 'Onboarding Redesign' },
  { id: 'OFFLINE', project_id: 'mobile', title: 'Offline Mode' },
  { id: 'DESIGN', project_id: 'mobile', title: 'Design System v2' },
  { id: 'INGEST', project_id: 'data',  title: 'Ingestion Pipelines' },
  { id: 'WARE',  project_id: 'data',   title: 'Warehouse & Modeling' },
  { id: 'DASH',  project_id: 'data',   title: 'Dashboards & Reporting' },
];

const stories = [
  { id: 'FOUND-S01', epic_id: 'FOUND', title: 'Bootstrap IAM Admin' },
  { id: 'FOUND-S02', epic_id: 'FOUND', title: 'Terraform State Backend' },
  { id: 'FOUND-S03', epic_id: 'FOUND', title: 'Budget & Cost Alerts' },
  { id: 'NET-S01',   epic_id: 'NET',   title: 'Foundation VPC' },
  { id: 'NET-S02',   epic_id: 'NET',   title: 'Private subnets & NAT' },
  { id: 'SEC-S01',   epic_id: 'SEC',   title: 'CloudTrail & GuardDuty' },
  { id: 'ONB-S01',   epic_id: 'ONB',   title: 'Welcome flow' },
  { id: 'ONB-S02',   epic_id: 'ONB',   title: 'Account creation' },
  { id: 'OFFLINE-S01', epic_id: 'OFFLINE', title: 'Local cache layer' },
  { id: 'DESIGN-S01', epic_id: 'DESIGN', title: 'Token migration' },
  { id: 'INGEST-S01', epic_id: 'INGEST', title: 'Source connectors' },
  { id: 'INGEST-S02', epic_id: 'INGEST', title: 'Stream processing' },
  { id: 'WARE-S01',  epic_id: 'WARE',   title: 'dbt models' },
  { id: 'DASH-S01',  epic_id: 'DASH',   title: 'Exec dashboard' },
];

// Abridged but representative task set. `project_id` is derived from the
// story's epic; spawned cards set it directly with story_id = null.
const tasks = [
  { id: 'AWS-101', project_id: 'aws', story_id: 'FOUND-S01', title: 'Create initial IAM admin user (one-time bootstrap)', status: 'done', priority: 'critical', assignee_id: 'adam', branch: null, merge_state: 'none', deps: [] },
  { id: 'AWS-102', project_id: 'aws', story_id: 'FOUND-S01', title: 'Enable MFA on root account', status: 'todo', priority: 'critical', assignee_id: 'adam', branch: null, merge_state: 'none', deps: [] },
  { id: 'AWS-103', project_id: 'aws', story_id: 'FOUND-S01', title: 'Write Terraform for IAM password policy', status: 'done', priority: 'high', assignee_id: 'claude', branch: 'feat/iam-password-policy', merge_state: 'merged', deps: [] },
  { id: 'AWS-104', project_id: 'aws', story_id: 'FOUND-S02', title: 'Provision S3 state bucket with versioning', status: 'done', priority: 'critical', assignee_id: 'atlas', branch: 'feat/s3-tfstate-backend', merge_state: 'merged', deps: ['AWS-101'] },
  { id: 'AWS-105', project_id: 'aws', story_id: 'FOUND-S02', title: 'DynamoDB lock table for state locking', status: 'in_progress', priority: 'high', assignee_id: 'atlas', branch: 'feat/dynamodb-lock-table', merge_state: 'pr', deps: ['AWS-104'] },
  { id: 'AWS-201', project_id: 'aws', story_id: 'NET-S01', title: 'Foundation VPC with /16 CIDR', status: 'in_progress', priority: 'high', assignee_id: 'atlas', branch: 'feat/foundation-vpc', merge_state: 'dev', deps: ['AWS-104'] },
  { id: 'MOB-101', project_id: 'mobile', story_id: 'ONB-S01', title: 'Design new 3-step welcome carousel', status: 'done', priority: 'high', assignee_id: 'nova', branch: 'design/welcome-carousel', merge_state: 'merged', deps: [] },
  { id: 'MOB-102', project_id: 'mobile', story_id: 'ONB-S01', title: 'Implement welcome carousel (RN)', status: 'in_progress', priority: 'high', assignee_id: 'nova', branch: 'feat/welcome-carousel-rn', merge_state: 'dev', deps: ['MOB-101'] },
  { id: 'MOB-201', project_id: 'mobile', story_id: 'OFFLINE-S01', title: 'Local SQLite cache layer', status: 'todo', priority: 'high', assignee_id: 'claude', branch: null, merge_state: 'none', deps: [] },
  { id: 'DATA-101', project_id: 'data', story_id: 'INGEST-S01', title: 'Stripe source connector', status: 'done', priority: 'high', assignee_id: 'claude', branch: 'feat/stripe-connector', merge_state: 'merged', deps: [] },
  { id: 'DATA-102', project_id: 'data', story_id: 'INGEST-S01', title: 'Postgres CDC connector', status: 'in_progress', priority: 'critical', assignee_id: 'atlas', branch: 'feat/pg-cdc-connector', merge_state: 'pr', deps: ['DATA-101'] },
  { id: 'DATA-202', project_id: 'data', story_id: 'WARE-S01', title: 'Revenue mart with MRR logic', status: 'backlog', priority: 'high', assignee_id: null, branch: null, merge_state: 'none', deps: [] },
];

const requests = [
  { id: 'REQ-101', from_project_id: 'data', to_project_id: 'aws', title: 'Provision RDS read-replica for the analytics warehouse', description: 'Warehouse modelling needs a read-only replica of the app primary.', priority: 'high', requested_by: 'claude', assignee_id: null, linked_task_id: 'DATA-202', spawned_task_id: null, status: 'incoming' },
  { id: 'REQ-102', from_project_id: 'mobile', to_project_id: 'data', title: 'Expose /events ingestion endpoint for offline sync', description: 'Offline mode needs a documented batch endpoint to flush queued events.', priority: 'critical', requested_by: 'nova', assignee_id: 'atlas', linked_task_id: 'MOB-201', spawned_task_id: null, status: 'accepted' },
  { id: 'REQ-104', from_project_id: 'data', to_project_id: 'aws', title: 'Open security-group egress for warehouse → S3', description: 'Need 443 egress from the warehouse subnet to the staging bucket VPC endpoint.', priority: 'medium', requested_by: 'claude', assignee_id: 'atlas', linked_task_id: 'DATA-102', spawned_task_id: null, status: 'done' },
];

const comments = [
  { task_id: 'AWS-105', author_id: 'atlas', body: 'Created the table as PAY_PER_REQUEST with LockID as the partition key. Running a test apply to confirm the lock acquires/releases cleanly.', created_at: days(2) },
  { task_id: 'AWS-105', author_id: 'adam',  body: 'Nice. Once it is confirmed, point the backend block at it and re-init.', created_at: days(1) },
  { task_id: 'DATA-102', author_id: 'atlas', body: 'Replication slot is live and consuming. ~400ms lag under load. Raised REQ-104 for the SG egress I need to finish this.', created_at: days(1) },
];

module.exports = { days, agents, agentPermissions, projects, epics, stories, tasks, requests, comments };
