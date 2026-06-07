/* ============================================================
   Kanban ticketing — mock data
   Cards = tasks. Tasks belong to a Story -> Epic -> Project.
   Exposed on window.SEED for the app to clone into state.
   ============================================================ */
(function () {
  // ---- People: human owner + named agents -------------------
  const AGENTS = [
    { id: "adam",  name: "Adam",  kind: "human", role: "Owner",          color: "#D97757", initials: "AD" },
    { id: "claude",name: "Claude",kind: "agent", role: "Build agent",    color: "#6E59C7", initials: "CL", token: "agt_live_9f3c…a21" },
    { id: "atlas", name: "Atlas", kind: "agent", role: "Infra agent",    color: "#2F7D63", initials: "AT", token: "agt_live_4b8e…77d" },
    { id: "nova",  name: "Nova",  kind: "agent", role: "Frontend agent", color: "#2A6FB5", initials: "NV", token: "agt_live_1c20…e90" },
    { id: "scout", name: "Scout", kind: "agent", role: "QA / review agent", color: "#B5852A", initials: "SC", token: "agt_live_77aa…3f1" },
  ];

  // ---- Projects ---------------------------------------------
  const PROJECTS = [
    { id: "aws",    name: "AWS Command Centre", key: "AWS",  color: "#D97757", desc: "Foundation infra, IAM, state backend & networking." },
    { id: "mobile", name: "Mobile App Relaunch", key: "MOB", color: "#2A6FB5", desc: "New onboarding, design refresh & offline mode." },
    { id: "data",   name: "Data Platform",       key: "DATA",color: "#2F7D63", desc: "Ingestion pipelines, warehouse & dashboards." },
  ];

  // ---- Epics -------------------------------------------------
  const EPICS = [
    { id: "FOUND",  projectId: "aws",    title: "AWS Foundation Setup" },
    { id: "NET",    projectId: "aws",    title: "Networking & VPC" },
    { id: "SEC",    projectId: "aws",    title: "Security & Compliance" },
    { id: "ONB",    projectId: "mobile", title: "Onboarding Redesign" },
    { id: "OFFLINE",projectId: "mobile", title: "Offline Mode" },
    { id: "DESIGN", projectId: "mobile", title: "Design System v2" },
    { id: "INGEST", projectId: "data",   title: "Ingestion Pipelines" },
    { id: "WARE",   projectId: "data",   title: "Warehouse & Modeling" },
    { id: "DASH",   projectId: "data",   title: "Dashboards & Reporting" },
  ];

  // ---- Stories -----------------------------------------------
  const STORIES = [
    { id: "FOUND-S01", epicId: "FOUND", title: "Bootstrap IAM Admin" },
    { id: "FOUND-S02", epicId: "FOUND", title: "Terraform State Backend" },
    { id: "FOUND-S03", epicId: "FOUND", title: "Budget & Cost Alerts" },
    { id: "NET-S01",   epicId: "NET",   title: "Foundation VPC" },
    { id: "NET-S02",   epicId: "NET",   title: "Private subnets & NAT" },
    { id: "SEC-S01",   epicId: "SEC",   title: "CloudTrail & GuardDuty" },
    { id: "ONB-S01",   epicId: "ONB",   title: "Welcome flow" },
    { id: "ONB-S02",   epicId: "ONB",   title: "Account creation" },
    { id: "OFFLINE-S01", epicId: "OFFLINE", title: "Local cache layer" },
    { id: "DESIGN-S01", epicId: "DESIGN", title: "Token migration" },
    { id: "INGEST-S01", epicId: "INGEST", title: "Source connectors" },
    { id: "INGEST-S02", epicId: "INGEST", title: "Stream processing" },
    { id: "WARE-S01",   epicId: "WARE",  title: "dbt models" },
    { id: "DASH-S01",   epicId: "DASH",  title: "Exec dashboard" },
  ];

  // helper for activity timestamps
  const days = (n) => {
    const d = new Date("2026-04-25T09:00:00");
    d.setDate(d.getDate() - n);
    return d.toISOString();
  };

  // ---- Tasks (the cards) -------------------------------------
  // status: backlog | todo | in_progress | done
  // priority: critical | high | medium | low
  const TASKS = [
    // ===== AWS / FOUND =====
    { id: "AWS-101", storyId: "FOUND-S01", title: "Create initial IAM admin user (one-time bootstrap)",
      desc: "Manually create IAM admin user via console for first-run bootstrap, then hand off to Terraform.",
      status: "done", priority: "critical", assignee: "adam", deps: [],
      notes: "User command-centre-admin created with AdministratorAccess.",
      activity: [
        { ts: days(9), who: "adam", text: "created this ticket" },
        { ts: days(9), who: "adam", text: "moved Backlog → Done" },
      ] },
    { id: "AWS-102", storyId: "FOUND-S01", title: "Enable MFA on root account",
      desc: "Log into the root account and enable a virtual MFA device. Store recovery codes in the vault.",
      status: "todo", priority: "critical", assignee: "adam", deps: [],
      notes: "RECOMMENDED: blocks the security sign-off until done.",
      activity: [{ ts: days(8), who: "claude", text: "created this ticket" }] },
    { id: "AWS-103", storyId: "FOUND-S01", title: "Write Terraform for IAM password policy",
      desc: "14 char minimum, complexity requirements, 90-day rotation. Output to iam.tf.",
      status: "done", priority: "high", assignee: "claude", deps: [],
      notes: "iam.tf — applied cleanly, no drift.",
      activity: [
        { ts: days(9), who: "claude", text: "created this ticket" },
        { ts: days(8), who: "claude", text: "moved To Do → In Progress" },
        { ts: days(8), who: "claude", text: "moved In Progress → Done" },
      ] },
    { id: "AWS-104", storyId: "FOUND-S02", title: "Provision S3 state bucket with versioning",
      desc: "Encrypted S3 bucket for Terraform remote state. Block public access, enable versioning.",
      status: "done", priority: "critical", assignee: "atlas", deps: ["AWS-101"],
      notes: "Bucket aws-cc-tfstate created in eu-west-2.",
      activity: [{ ts: days(7), who: "atlas", text: "moved In Progress → Done" }] },
    { id: "AWS-105", storyId: "FOUND-S02", title: "DynamoDB lock table for state locking",
      desc: "On-demand DynamoDB table tf-state-lock with LockID partition key.",
      status: "in_progress", priority: "high", assignee: "atlas", deps: ["AWS-104"],
      notes: "Apply pending review.",
      activity: [{ ts: days(2), who: "atlas", text: "moved To Do → In Progress" }] },
    { id: "AWS-106", storyId: "FOUND-S03", title: "Configure monthly budget alert ($500)",
      desc: "AWS Budgets alert at 80% and 100% of a $500 monthly threshold, email to ops.",
      status: "todo", priority: "medium", assignee: "atlas", deps: [],
      notes: "",
      activity: [{ ts: days(3), who: "atlas", text: "created this ticket" }] },
    { id: "AWS-107", storyId: "FOUND-S03", title: "Cost anomaly detection monitor",
      desc: "Enable AWS Cost Anomaly Detection with daily granularity.",
      status: "backlog", priority: "low", assignee: null, deps: ["AWS-106"],
      notes: "",
      activity: [{ ts: days(3), who: "claude", text: "created this ticket" }] },
    // ===== AWS / NET =====
    { id: "AWS-201", storyId: "NET-S01", title: "Foundation VPC with /16 CIDR",
      desc: "Single VPC 10.0.0.0/16 across two AZs, DNS hostnames enabled.",
      status: "in_progress", priority: "high", assignee: "atlas", deps: ["AWS-104"],
      notes: "Module wired, plan looks clean.",
      activity: [{ ts: days(1), who: "atlas", text: "moved To Do → In Progress" }] },
    { id: "AWS-202", storyId: "NET-S02", title: "Private subnets + single NAT gateway",
      desc: "Two private subnets, one NAT gateway to keep costs down for the foundation env.",
      status: "todo", priority: "medium", assignee: "atlas", deps: ["AWS-201"],
      notes: "Blocked by VPC.",
      activity: [{ ts: days(1), who: "atlas", text: "created this ticket" }] },
    { id: "AWS-203", storyId: "NET-S02", title: "Route tables & associations",
      desc: "Public/private route tables, associate subnets, default routes to IGW/NAT.",
      status: "backlog", priority: "medium", assignee: null, deps: ["AWS-202"],
      notes: "",
      activity: [{ ts: days(1), who: "claude", text: "created this ticket" }] },
    // ===== AWS / SEC =====
    { id: "AWS-301", storyId: "SEC-S01", title: "Enable CloudTrail org trail",
      desc: "Multi-region CloudTrail logging to a dedicated, locked S3 bucket.",
      status: "backlog", priority: "high", assignee: null, deps: ["AWS-104"],
      notes: "",
      activity: [{ ts: days(2), who: "scout", text: "created this ticket" }] },
    { id: "AWS-302", storyId: "SEC-S01", title: "Turn on GuardDuty",
      desc: "Enable GuardDuty in the home region with findings to SNS.",
      status: "backlog", priority: "medium", assignee: null, deps: ["AWS-301"],
      notes: "",
      activity: [{ ts: days(2), who: "scout", text: "created this ticket" }] },

    // ===== MOBILE / ONB =====
    { id: "MOB-101", storyId: "ONB-S01", title: "Design new 3-step welcome carousel",
      desc: "Three illustrated panels with progress dots and skip affordance.",
      status: "done", priority: "high", assignee: "nova", deps: [],
      notes: "Shipped to design review, approved.",
      activity: [{ ts: days(6), who: "nova", text: "moved In Progress → Done" }] },
    { id: "MOB-102", storyId: "ONB-S01", title: "Implement welcome carousel (RN)",
      desc: "Build the carousel in React Native with swipe gestures and reduced-motion support.",
      status: "in_progress", priority: "high", assignee: "nova", deps: ["MOB-101"],
      notes: "Gesture handling 80% done.",
      activity: [{ ts: days(1), who: "nova", text: "moved To Do → In Progress" }] },
    { id: "MOB-103", storyId: "ONB-S02", title: "Email + OTP account creation",
      desc: "Email capture, 6-digit OTP verification screen, resend timer.",
      status: "todo", priority: "critical", assignee: "nova", deps: [],
      notes: "Waiting on auth endpoint.",
      activity: [{ ts: days(2), who: "nova", text: "created this ticket" }] },
    { id: "MOB-104", storyId: "ONB-S02", title: "Social sign-in (Apple + Google)",
      desc: "Native Sign in with Apple and Google one-tap.",
      status: "backlog", priority: "medium", assignee: null, deps: ["MOB-103"],
      notes: "",
      activity: [{ ts: days(4), who: "claude", text: "created this ticket" }] },
    // ===== MOBILE / OFFLINE =====
    { id: "MOB-201", storyId: "OFFLINE-S01", title: "Local SQLite cache layer",
      desc: "Persist core entities locally and reconcile on reconnect.",
      status: "todo", priority: "high", assignee: "claude", deps: [],
      notes: "",
      activity: [{ ts: days(3), who: "claude", text: "created this ticket" }] },
    { id: "MOB-202", storyId: "OFFLINE-S01", title: "Conflict resolution strategy",
      desc: "Last-write-wins with a per-field merge for notes. Document edge cases.",
      status: "backlog", priority: "medium", assignee: null, deps: ["MOB-201"],
      notes: "",
      activity: [{ ts: days(3), who: "claude", text: "created this ticket" }] },
    // ===== MOBILE / DESIGN =====
    { id: "MOB-301", storyId: "DESIGN-S01", title: "Migrate color tokens to v2 scale",
      desc: "Replace legacy hex with semantic tokens across the component library.",
      status: "in_progress", priority: "medium", assignee: "nova", deps: [],
      notes: "~60% of components migrated.",
      activity: [{ ts: days(1), who: "nova", text: "moved To Do → In Progress" }] },
    { id: "MOB-302", storyId: "DESIGN-S01", title: "Dark mode audit",
      desc: "Verify contrast ratios for all surfaces in dark mode.",
      status: "backlog", priority: "low", assignee: "scout", deps: ["MOB-301"],
      notes: "",
      activity: [{ ts: days(2), who: "scout", text: "created this ticket" }] },

    // ===== DATA / INGEST =====
    { id: "DATA-101", storyId: "INGEST-S01", title: "Stripe source connector",
      desc: "Incremental sync of charges, customers and subscriptions via Fivetran.",
      status: "done", priority: "high", assignee: "claude", deps: [],
      notes: "Backfilled 18 months.",
      activity: [{ ts: days(7), who: "claude", text: "moved In Progress → Done" }] },
    { id: "DATA-102", storyId: "INGEST-S01", title: "Postgres CDC connector",
      desc: "Change-data-capture from the app primary using logical replication.",
      status: "in_progress", priority: "critical", assignee: "atlas", deps: ["DATA-101"],
      notes: "Replication slot configured, validating lag.",
      activity: [{ ts: days(1), who: "atlas", text: "moved To Do → In Progress" }] },
    { id: "DATA-103", storyId: "INGEST-S02", title: "Kafka topic for clickstream",
      desc: "Provision MSK topic and schema registry entry for web events.",
      status: "todo", priority: "high", assignee: "atlas", deps: ["DATA-102"],
      notes: "",
      activity: [{ ts: days(2), who: "atlas", text: "created this ticket" }] },
    { id: "DATA-104", storyId: "INGEST-S02", title: "Dead-letter queue + alerting",
      desc: "Route malformed events to a DLQ and page on threshold breach.",
      status: "backlog", priority: "medium", assignee: null, deps: ["DATA-103"],
      notes: "",
      activity: [{ ts: days(2), who: "scout", text: "created this ticket" }] },
    // ===== DATA / WARE =====
    { id: "DATA-201", storyId: "WARE-S01", title: "Staging models for Stripe",
      desc: "dbt staging layer with tests on primary keys and not-null.",
      status: "todo", priority: "medium", assignee: "claude", deps: ["DATA-101"],
      notes: "",
      activity: [{ ts: days(3), who: "claude", text: "created this ticket" }] },
    { id: "DATA-202", storyId: "WARE-S01", title: "Revenue mart with MRR logic",
      desc: "Build fct_mrr with upgrade/downgrade/churn movement classification.",
      status: "backlog", priority: "high", assignee: null, deps: ["DATA-201"],
      notes: "",
      activity: [{ ts: days(3), who: "claude", text: "created this ticket" }] },
    // ===== DATA / DASH =====
    { id: "DATA-301", storyId: "DASH-S01", title: "Exec KPI dashboard",
      desc: "MRR, active users, churn and runway tiles with weekly trend.",
      status: "backlog", priority: "high", assignee: "nova", deps: ["DATA-202"],
      notes: "",
      activity: [{ ts: days(4), who: "nova", text: "created this ticket" }] },
  ];

  // ---- Cross-team requests (the shared inbox) ----------------
  // A team raises a request against ANOTHER team's project. It sits in
  // both teams' inbox: "incoming" for the assigned team, "outgoing" for
  // the requestor. status: incoming | accepted | in_progress | done | declined
  const REQUESTS = [
    { id: "REQ-101", fromProject: "data", toProject: "aws",
      title: "Provision RDS read-replica for the analytics warehouse",
      desc: "Warehouse modelling needs a read-only replica of the app primary so dbt runs don't hit production. Eu-west-2, db.r6g.large is fine.",
      priority: "high", requestedBy: "claude", assignee: null,
      linkedTaskId: "DATA-202", spawnedTaskId: null, status: "incoming",
      createdAt: days(2),
      activity: [{ ts: days(2), who: "claude", text: "raised this request to AWS Command Centre" }] },
    { id: "REQ-102", fromProject: "mobile", toProject: "data",
      title: "Expose /events ingestion endpoint for offline sync",
      desc: "Offline mode needs a documented batch endpoint to flush queued events on reconnect. Looking for auth scheme + rate limits.",
      priority: "critical", requestedBy: "nova", assignee: "atlas",
      linkedTaskId: "MOB-201", spawnedTaskId: null, status: "accepted",
      createdAt: days(4),
      activity: [
        { ts: days(4), who: "nova", text: "raised this request to Data Platform" },
        { ts: days(3), who: "atlas", text: "accepted the request" },
      ] },
    { id: "REQ-103", fromProject: "aws", toProject: "mobile",
      title: "Confirm the IAM scopes the mobile client needs",
      desc: "Finalising least-privilege policy. Need the exact API actions the app calls so we don't over-grant.",
      priority: "medium", requestedBy: "atlas", assignee: "nova",
      linkedTaskId: "AWS-301", spawnedTaskId: null, status: "in_progress",
      createdAt: days(3),
      activity: [
        { ts: days(3), who: "atlas", text: "raised this request to Mobile App Relaunch" },
        { ts: days(2), who: "nova", text: "accepted the request" },
        { ts: days(1), who: "nova", text: "moved to In Progress" },
      ] },
    { id: "REQ-104", fromProject: "data", toProject: "aws",
      title: "Open security-group egress for warehouse → S3",
      desc: "Need 443 egress from the warehouse subnet to the staging bucket VPC endpoint.",
      priority: "medium", requestedBy: "claude", assignee: "atlas",
      linkedTaskId: "DATA-103", spawnedTaskId: null, status: "done",
      createdAt: days(6),
      activity: [
        { ts: days(6), who: "claude", text: "raised this request to AWS Command Centre" },
        { ts: days(5), who: "atlas", text: "accepted the request" },
        { ts: days(5), who: "atlas", text: "marked the request done" },
      ] },
  ];

  window.SEED = { AGENTS, PROJECTS, EPICS, STORIES, TASKS, REQUESTS };

  // ---- Messages: agents log what they actually did -----------
  // Distinct from `notes` (the description) and `activity` (auto system log).
  const COMMENTS = {
    "AWS-105": [
      { who: "atlas", ts: days(2), text: "Created the table as PAY_PER_REQUEST with LockID as the partition key. Running a test `terraform apply` to confirm the lock acquires and releases cleanly — looking good so far." },
      { who: "adam",  ts: days(1), text: "Nice. Once it's confirmed, point the backend block at it and re-init." },
    ],
    "AWS-201": [
      { who: "atlas", ts: days(1), text: "VPC + two AZ subnets are planned out. Holding the apply until the budget alert (AWS-106) lands so we don't surprise the bill with the NAT gateway." },
    ],
    "AWS-103": [
      { who: "claude", ts: days(8), text: "Applied iam.tf — 14-char min, complexity on, 90-day rotation. No drift on a second plan. Marking done." },
    ],
    "MOB-102": [
      { who: "nova", ts: days(1), text: "Swipe gestures + progress dots are in. Still need the reduced-motion path — will gate the auto-advance behind prefers-reduced-motion next session." },
    ],
    "DATA-102": [
      { who: "atlas", ts: days(1), text: "Replication slot is live and consuming. Seeing ~400ms lag under load which is acceptable for now. Raised REQ-104 for the SG egress I need to finish this." },
    ],
  };
  TASKS.forEach((t) => { t.comments = COMMENTS[t.id] ? [...COMMENTS[t.id]] : []; });

  // ---- Git: branch + merge lifecycle -------------------------
  window.MERGE_STATES = [
    { id: "none",   label: "No branch",       short: "",        color: "#9a938a" },
    { id: "dev",    label: "In development",  short: "dev",     color: "#6E8CB5" },
    { id: "pr",     label: "PR open",         short: "PR",      color: "#B5852A" },
    { id: "merged", label: "Merged to main",  short: "merged",  color: "#2F7D63" },
  ];
  const GIT = {
    "AWS-103": ["feat/iam-password-policy", "merged"],
    "AWS-104": ["feat/s3-tfstate-backend", "merged"],
    "AWS-105": ["feat/dynamodb-lock-table", "pr"],
    "AWS-201": ["feat/foundation-vpc", "dev"],
    "MOB-101": ["design/welcome-carousel", "merged"],
    "MOB-102": ["feat/welcome-carousel-rn", "dev"],
    "MOB-301": ["chore/color-tokens-v2", "dev"],
    "DATA-101": ["feat/stripe-connector", "merged"],
    "DATA-102": ["feat/pg-cdc-connector", "pr"],
  };
  TASKS.forEach((t) => {
    const g = GIT[t.id];
    t.branch = g ? g[0] : null;
    t.mergeState = g ? g[1] : "none";
  });

  window.REQUEST_STATES = [
    { id: "incoming",    label: "New", color: "#6E8CB5" },
    { id: "accepted",    label: "Accepted", color: "#B5852A" },
    { id: "in_progress", label: "In Progress", color: "#D97757" },
    { id: "done",        label: "Done", color: "#2F7D63" },
    { id: "declined",    label: "Declined", color: "#9a938a" },
  ];

  // ---- Shared constants -------------------------------------
  window.COLUMNS = [
    { id: "backlog",     label: "Backlog" },
    { id: "todo",        label: "To Do" },
    { id: "in_progress", label: "In Progress" },
    { id: "done",        label: "Done" },
  ];
  window.PRIORITIES = [
    { id: "critical", label: "Critical", rank: 0, color: "#C2453B" },
    { id: "high",     label: "High",     rank: 1, color: "#D97757" },
    { id: "medium",   label: "Medium",   rank: 2, color: "#B5852A" },
    { id: "low",      label: "Low",      rank: 3, color: "#7C8B86" },
  ];
})();
