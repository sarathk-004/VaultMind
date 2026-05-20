import type { GraphNode, GraphEdge, NoteContent } from "./vaultmind-types"

/**
 * Simulated Notion workspace — every node has rich content so citations open
 * a real preview drawer when clicked.
 */
export const WORKSPACE: Record<string, GraphNode> = {
  "roadmap-q1": { id: "roadmap-q1", label: "Roadmap Q1 2026", type: "page" },
  "product-strategy": { id: "product-strategy", label: "Product Strategy", type: "page" },
  "design-system-v3": { id: "design-system-v3", label: "Design System v3", type: "page" },
  "engineering-wiki": { id: "engineering-wiki", label: "Engineering Wiki", type: "page" },
  "api-documentation": { id: "api-documentation", label: "API Documentation", type: "page" },
  "onboarding-guide": { id: "onboarding-guide", label: "Onboarding Guide", type: "page" },
  "security-policies": { id: "security-policies", label: "Security & Policies", type: "page" },
  "brand-guidelines": { id: "brand-guidelines", label: "Brand Guidelines", type: "page" },
  "analytics-dashboard": { id: "analytics-dashboard", label: "Analytics Dashboard", type: "page" },
  "go-to-market-plan": { id: "go-to-market-plan", label: "Go-to-Market Plan", type: "page" },

  "team-okrs": { id: "team-okrs", label: "Team OKRs", type: "database" },
  "bug-tracker": { id: "bug-tracker", label: "Bug Tracker", type: "database" },
  "customer-feedback": { id: "customer-feedback", label: "Customer Feedback", type: "database" },
  "content-calendar": { id: "content-calendar", label: "Content Calendar", type: "database" },
  "feature-requests": { id: "feature-requests", label: "Feature Requests", type: "database" },
  "hiring-pipeline": { id: "hiring-pipeline", label: "Hiring Pipeline", type: "database" },
  "sprint-board": { id: "sprint-board", label: "Sprint Board", type: "database" },

  "task-ship-2-4": { id: "task-ship-2-4", label: "Ship Release 2.4", type: "task" },
  "task-review-pr-284": { id: "task-review-pr-284", label: "Review PR #284", type: "task" },
  "task-update-docs": { id: "task-update-docs", label: "Update API Docs", type: "task" },
  "task-prep-launch": { id: "task-prep-launch", label: "Prep Launch Email", type: "task" },
  "task-fix-auth-bug": { id: "task-fix-auth-bug", label: "Fix Auth Bug", type: "task" },
  "task-design-review": { id: "task-design-review", label: "Design Review Q1", type: "task" },
  "task-refactor-api": { id: "task-refactor-api", label: "Refactor API Layer", type: "task" },

  "note-standup-0315": { id: "note-standup-0315", label: "Standup 03/15", type: "note" },
  "note-sprint-retro": { id: "note-sprint-retro", label: "Sprint Retro", type: "note" },
  "note-brainstorm": { id: "note-brainstorm", label: "Brainstorm Session", type: "note" },
  "note-1-1-sam": { id: "note-1-1-sam", label: "1:1 with Sam", type: "note" },
  "note-design-critique": { id: "note-design-critique", label: "Design Critique", type: "note" },
  "note-qa-findings": { id: "note-qa-findings", label: "QA Findings", type: "note" },
  "note-planning-meeting": { id: "note-planning-meeting", label: "Planning Meeting", type: "note" },
}

/**
 * Realistic note/page content for each workspace node.
 * Citations open a drawer that renders this content.
 */
export const NOTE_CONTENT: Record<string, NoteContent> = {
  "roadmap-q1": {
    id: "roadmap-q1",
    title: "Roadmap Q1 2026",
    type: "page",
    relatedNodes: ["product-strategy", "team-okrs", "task-ship-2-4", "sprint-board"],
    content:
      "## Q1 2026 Roadmap\n\n**Theme**: Foundation & Velocity\n\n### Priorities\n1. Ship Release 2.4 with auth improvements\n2. Refactor the API layer for v3\n3. Launch design system v3 across product surfaces\n4. Reduce bug backlog by 40%\n\n### Milestones\n- Jan 18 — Internal beta\n- Feb 04 — Public beta opens\n- Mar 12 — GA + launch email\n\n### Risks\n- Auth refactor depends on PR #284 landing\n- Hiring two senior engineers blocks API work",
  },
  "product-strategy": {
    id: "product-strategy",
    title: "Product Strategy",
    type: "page",
    relatedNodes: ["roadmap-q1", "go-to-market-plan", "customer-feedback", "analytics-dashboard"],
    content:
      "## North Star\nHelp knowledge teams find, connect and act on what they already know.\n\n### Pillars\n- **Find**: Search that understands your vault\n- **Connect**: Surface non-obvious links\n- **Act**: Turn insights into next steps\n\n### Bets for 2026\n1. AI-native search becomes the default surface\n2. Graph-of-knowledge UX wins over list-of-results\n3. Integrations > features",
  },
  "design-system-v3": {
    id: "design-system-v3",
    title: "Design System v3",
    type: "page",
    relatedNodes: ["brand-guidelines", "task-design-review", "note-design-critique", "engineering-wiki"],
    content:
      "## Design System v3\n\nMigrating from Radix primitives to a unified token-first system.\n\n### Tokens\n- Color: 5-token palette, semantic-only\n- Spacing: 4px scale\n- Radius: 4 / 6 / 8 / 12\n\n### Components shipped\n- Button, Input, Dialog, Tabs, Tooltip, Toast\n\n### Open questions\n- Do we deprecate `Card` in favor of `Surface`?\n- Should density be a global token?",
  },
  "engineering-wiki": {
    id: "engineering-wiki",
    title: "Engineering Wiki",
    type: "page",
    relatedNodes: ["api-documentation", "security-policies", "task-refactor-api", "onboarding-guide"],
    content:
      "## Engineering Wiki\n\nThe canonical home for technical decisions.\n\n### Sections\n- Architecture decision records (ADRs)\n- Runbooks for on-call\n- Service catalog\n- Style guides per language\n\n### Recent ADRs\n- ADR-042: Adopt Postgres logical replication\n- ADR-043: Migrate auth to OAuth-only\n- ADR-044: SSE for live updates instead of WebSockets",
  },
  "api-documentation": {
    id: "api-documentation",
    title: "API Documentation",
    type: "page",
    relatedNodes: ["engineering-wiki", "task-update-docs", "task-refactor-api"],
    content:
      "## API Documentation\n\nv2 reference for all public endpoints.\n\n### Endpoints\n- `POST /v2/search` — semantic search\n- `POST /v2/connect` — graph traversal\n- `GET /v2/page/:id` — fetch a page\n\n### Deprecations\n- v1 endpoints sunset on Apr 30, 2026.\n\n### Notes\nUpdate examples for the new pagination cursor format.",
  },
  "onboarding-guide": {
    id: "onboarding-guide",
    title: "Onboarding Guide",
    type: "page",
    relatedNodes: ["engineering-wiki", "hiring-pipeline", "security-policies"],
    content:
      "## Welcome to the team\n\n### Week 1\n- Read the engineering wiki and product strategy\n- Pair with a buddy on a small bug fix\n- Attend the Friday demo\n\n### Week 2\n- Own a feature flag rollout\n- Submit your first ADR draft\n\n### Tools\n- GitHub, Notion, Linear, 1Password, Datadog",
  },
  "security-policies": {
    id: "security-policies",
    title: "Security & Policies",
    type: "page",
    relatedNodes: ["engineering-wiki", "onboarding-guide", "task-fix-auth-bug"],
    content:
      "## Security Policies\n\n### Access\n- All production access via SSO + MFA\n- Break-glass procedure documented in PagerDuty\n\n### Data\n- PII at rest: AES-256\n- PII in transit: TLS 1.3 only\n\n### Incident response\n- P0 → page on-call within 5 minutes\n- Post-mortems are blameless and required within 5 days",
  },
  "brand-guidelines": {
    id: "brand-guidelines",
    title: "Brand Guidelines",
    type: "page",
    relatedNodes: ["design-system-v3", "go-to-market-plan", "content-calendar"],
    content:
      "## Brand Guidelines\n\n### Voice\nClear, confident, calm. We help, we don't hype.\n\n### Color\nPrimary brand color is a single deep blue. Never use gradients in product UI.\n\n### Typography\nGeist for everything. Display weight 600, body 400.\n\n### Logo\nMinimum clear-space = 1x logo height.",
  },
  "analytics-dashboard": {
    id: "analytics-dashboard",
    title: "Analytics Dashboard",
    type: "page",
    relatedNodes: ["product-strategy", "customer-feedback", "team-okrs"],
    content:
      "## Analytics Dashboard\n\n### KPIs (last 7 days)\n- WAU: 12,840 (+4.2%)\n- Activation: 38.1% (+1.1pp)\n- Day-7 retention: 41.7% (-0.3pp)\n\n### Notable\n- Search → graph conversion is up\n- Free → Pro conversion stalled; investigate pricing page",
  },
  "go-to-market-plan": {
    id: "go-to-market-plan",
    title: "Go-to-Market Plan",
    type: "page",
    relatedNodes: ["product-strategy", "task-prep-launch", "content-calendar", "brand-guidelines"],
    content:
      "## GTM Plan — Release 2.4\n\n### Audiences\n- Power users on free plan\n- Knowledge teams 10–200 people\n\n### Channels\n- Launch email to ~58k\n- Product Hunt + HN\n- Customer briefings (top 25 accounts)\n\n### Success metrics\n- 1.5k new signups in week 1\n- 8% free → pro on the launch cohort",
  },
  "team-okrs": {
    id: "team-okrs",
    title: "Team OKRs",
    type: "database",
    relatedNodes: ["roadmap-q1", "analytics-dashboard", "product-strategy"],
    content:
      "## Team OKRs — Q1 2026\n\n### O1: Make search the most-loved surface\n- KR1: Search → graph conversion ≥ 25%\n- KR2: Median latency < 600ms\n- KR3: NPS for search ≥ 55\n\n### O2: Reduce engineering friction\n- KR1: API v3 cut over for 80% of traffic\n- KR2: Build time < 3 minutes\n- KR3: P0 incidents ≤ 2",
  },
  "bug-tracker": {
    id: "bug-tracker",
    title: "Bug Tracker",
    type: "database",
    relatedNodes: ["task-fix-auth-bug", "note-qa-findings", "sprint-board"],
    content:
      "## Bug Tracker\n\n### Open P0 / P1\n- BUG-1284 — Auth token refresh fails on Safari (P0)\n- BUG-1278 — Graph layout overlaps for 50+ nodes (P1)\n- BUG-1271 — Stale citations after edit (P1)\n\n### This sprint\n12 closed · 4 open · 2 in review",
  },
  "customer-feedback": {
    id: "customer-feedback",
    title: "Customer Feedback",
    type: "database",
    relatedNodes: ["product-strategy", "feature-requests", "analytics-dashboard"],
    content:
      "## Customer Feedback\n\n### Themes (last 30 days)\n1. **Graph density** — users want to control how many nodes show\n2. **Citations** — wish they linked to the exact paragraph\n3. **Mobile** — needs to be useful on phone\n4. **Workspaces** — multi-vault support requested 14 times\n\n### Quote of the week\n_\"Graphyne is the first AI tool that respects what I already wrote.\"_ — Priya, Stripe",
  },
  "content-calendar": {
    id: "content-calendar",
    title: "Content Calendar",
    type: "database",
    relatedNodes: ["go-to-market-plan", "brand-guidelines", "task-prep-launch"],
    content:
      "## Content Calendar — Mar / Apr\n\n### Mar 18 — Blog: Why graphs beat lists for AI memory\n### Mar 25 — Customer story: How Linear uses Graphyne\n### Apr 02 — Launch post for Release 2.4\n### Apr 09 — Tutorial: Connecting your vault to MCP\n### Apr 16 — Webinar: Knowledge ops for engineering teams",
  },
  "feature-requests": {
    id: "feature-requests",
    title: "Feature Requests",
    type: "database",
    relatedNodes: ["customer-feedback", "roadmap-q1", "product-strategy"],
    content:
      "## Feature Requests (top voted)\n\n1. Multi-vault workspaces (142 votes)\n2. Inline citations with paragraph anchors (98)\n3. Mobile app (87)\n4. Slack export of answers (54)\n5. Custom node types (33)\n\nNext review: Mar 21 with PM + Eng leads.",
  },
  "hiring-pipeline": {
    id: "hiring-pipeline",
    title: "Hiring Pipeline",
    type: "database",
    relatedNodes: ["onboarding-guide", "team-okrs"],
    content:
      "## Hiring Pipeline\n\n### Open roles\n- Sr. Backend Engineer (2)\n- Design Engineer (1)\n- Founding DevRel (1)\n\n### Stage breakdown\n- Phone screen: 7\n- Onsite: 4\n- Offer: 1 (verbal)\n\n### Notes\nMarch is heavy on onsites; please volunteer for interview slots.",
  },
  "sprint-board": {
    id: "sprint-board",
    title: "Sprint Board",
    type: "database",
    relatedNodes: ["roadmap-q1", "bug-tracker", "task-ship-2-4", "task-review-pr-284", "note-standup-0315"],
    content:
      "## Sprint 23 (Mar 11 – Mar 22)\n\n### In progress\n- Ship Release 2.4\n- Refactor API Layer\n- Fix Auth Bug (BUG-1284)\n\n### In review\n- PR #284 — Token refresh on Safari\n\n### Done\n- Update API Docs\n- Design Review Q1",
  },
  "task-ship-2-4": {
    id: "task-ship-2-4",
    title: "Ship Release 2.4",
    type: "task",
    relatedNodes: ["roadmap-q1", "sprint-board", "task-prep-launch", "go-to-market-plan"],
    content:
      "## Ship Release 2.4\n\n**Owner**: @rita\n**Due**: Apr 02\n**Status**: In progress\n\n### Checklist\n- [x] Code freeze\n- [x] QA pass on staging\n- [ ] Final sign-off from security\n- [ ] Launch email queued\n- [ ] Product Hunt assets uploaded\n\n### Dependencies\nBlocks on PR #284 landing and the auth bug fix.",
  },
  "task-review-pr-284": {
    id: "task-review-pr-284",
    title: "Review PR #284",
    type: "task",
    relatedNodes: ["sprint-board", "task-fix-auth-bug", "engineering-wiki"],
    content:
      "## Review PR #284\n\n**Author**: @kenji\n**Reviewer**: @rita\n**Status**: Awaiting review (2 days)\n\n### Summary\nFixes Safari token refresh by switching from `localStorage` to a same-site cookie + service-worker proxy.\n\n### Risks\nTouches the auth path; needs careful rollout via feature flag.",
  },
  "task-update-docs": {
    id: "task-update-docs",
    title: "Update API Docs",
    type: "task",
    relatedNodes: ["api-documentation", "engineering-wiki"],
    content:
      "## Update API Docs\n\n**Owner**: @sam\n**Status**: Done — published Mar 14\n\n### Changes\n- Added `/v2/connect` examples\n- Documented new pagination cursor\n- Marked v1 endpoints as deprecated",
  },
  "task-prep-launch": {
    id: "task-prep-launch",
    title: "Prep Launch Email",
    type: "task",
    relatedNodes: ["go-to-market-plan", "content-calendar", "task-ship-2-4"],
    content:
      "## Prep Launch Email\n\n**Owner**: @marin\n**Due**: Mar 30\n**Status**: Draft v2\n\n### TODO\n- [x] Draft copy\n- [x] Hero image\n- [ ] Legal review\n- [ ] Schedule send for Apr 02 09:00 PT",
  },
  "task-fix-auth-bug": {
    id: "task-fix-auth-bug",
    title: "Fix Auth Bug",
    type: "task",
    relatedNodes: ["bug-tracker", "task-review-pr-284", "security-policies"],
    content:
      "## Fix Auth Bug (BUG-1284)\n\n**Severity**: P0\n**Owner**: @kenji\n**Status**: Fix in PR #284\n\n### Repro\n1. Open Graphyne on Safari 17\n2. Wait > 60 minutes\n3. Refresh — user is signed out\n\n### Root cause\nThird-party cookie blocking breaks the silent refresh flow.",
  },
  "task-design-review": {
    id: "task-design-review",
    title: "Design Review Q1",
    type: "task",
    relatedNodes: ["design-system-v3", "note-design-critique", "brand-guidelines"],
    content:
      "## Design Review Q1\n\n**Owner**: @ana\n**Status**: Complete (Mar 12)\n\n### Outcomes\n- Approved v3 token rollout\n- Density token deferred to Q2\n- Marketing site to follow product on color tokens",
  },
  "task-refactor-api": {
    id: "task-refactor-api",
    title: "Refactor API Layer",
    type: "task",
    relatedNodes: ["api-documentation", "engineering-wiki", "roadmap-q1"],
    content:
      "## Refactor API Layer\n\n**Owner**: @kenji\n**Due**: end of Q1\n**Status**: 60% complete\n\n### Plan\n1. Extract route handlers into a thin layer\n2. Move validation to a shared schema package\n3. Cut over `/search` and `/connect` first\n\n### Risk\nNeeds the new ADR (043) ratified before the cutover.",
  },
  "note-standup-0315": {
    id: "note-standup-0315",
    title: "Standup 03/15",
    type: "note",
    relatedNodes: ["sprint-board", "task-ship-2-4", "task-fix-auth-bug"],
    content:
      "## Standup — Mar 15\n\n**Attendees**: Rita, Kenji, Sam, Ana, Marin\n\n### Updates\n- Rita: pushing on 2.4 sign-off; blocked on security review\n- Kenji: PR #284 needs another reviewer\n- Sam: API docs published, moving to onboarding refresh\n- Ana: design system v3 audit in progress\n- Marin: launch email v2 ready for legal\n\n### Blockers\nSecurity review for 2.4. Reaching out to @priya.",
  },
  "note-sprint-retro": {
    id: "note-sprint-retro",
    title: "Sprint Retro",
    type: "note",
    relatedNodes: ["sprint-board", "team-okrs", "bug-tracker"],
    content:
      "## Sprint 22 Retro\n\n### Went well\n- API docs shipped on time\n- Faster review cycle (mean 4h)\n\n### Didn't go well\n- Auth bug discovered late in cycle\n- Standup dragged past 15 min twice\n\n### Try next sprint\n- Pre-flight QA on Safari\n- Hard 15-min cap on standups",
  },
  "note-brainstorm": {
    id: "note-brainstorm",
    title: "Brainstorm Session",
    type: "note",
    relatedNodes: ["product-strategy", "feature-requests", "customer-feedback"],
    content:
      "## Brainstorm — March\n\n### Theme\nWhat would 'graph-native search' look like in 18 months?\n\n### Ideas\n- Persistent saved subgraphs you can re-query\n- Inline answer + graph in any Notion page\n- Voice-driven traversal (\"jump to anything Sam wrote\")\n- Slack thread → ephemeral graph",
  },
  "note-1-1-sam": {
    id: "note-1-1-sam",
    title: "1:1 with Sam",
    type: "note",
    relatedNodes: ["task-update-docs", "onboarding-guide"],
    content:
      "## 1:1 with Sam — Mar 14\n\n### Topics\n- API docs are done; great work\n- Wants to own onboarding refresh next\n- Career: leaning toward staff IC track; we'll map the next step in April\n\n### Action items\n- [ ] Pair Sam with @priya on onboarding kickoff\n- [ ] Draft staff-IC ladder doc for April review",
  },
  "note-design-critique": {
    id: "note-design-critique",
    title: "Design Critique",
    type: "note",
    relatedNodes: ["design-system-v3", "task-design-review", "brand-guidelines"],
    content:
      "## Design Critique — Mar 11\n\n### Reviewed\n- Graph empty state\n- Citation chip variants\n- Mobile chat input\n\n### Decisions\n- Empty state copy: \"Your knowledge graph will appear here\" (approved)\n- Citation chips: type-color outline, dot indicator (approved)\n- Mobile input: stack intent buttons below textarea on < 640px",
  },
  "note-qa-findings": {
    id: "note-qa-findings",
    title: "QA Findings",
    type: "note",
    relatedNodes: ["bug-tracker", "task-fix-auth-bug", "sprint-board"],
    content:
      "## QA Findings — Release 2.4 candidate\n\n### Critical\n- Auth refresh fails on Safari (BUG-1284) — fix in PR #284\n\n### High\n- Graph node labels overflow at zoom 50%\n- Tab order skips intent selector\n\n### Low\n- Tooltip on Send button shows for 50ms longer than spec",
  },
  "note-planning-meeting": {
    id: "note-planning-meeting",
    title: "Planning Meeting",
    type: "note",
    relatedNodes: ["roadmap-q1", "team-okrs", "sprint-board", "feature-requests"],
    content:
      "## Planning Meeting — Q1 close-out\n\n### Confirmed for sprint 24\n- Mobile responsive pass\n- Graph density slider (top feature request)\n- Inline citation anchors (top-2 feature request)\n\n### Deferred\n- Slack export\n- Custom node types\n\n### Owner assignments\n- Mobile: @ana\n- Density slider: @kenji\n- Citation anchors: @rita",
  },
}

/**
 * Hand-authored full workspace edges — the "shape" of the vault before any query.
 */
export const WORKSPACE_EDGES: GraphEdge[] = [
  // Strategy hub
  { from: "product-strategy", to: "roadmap-q1", relation: "drives" },
  { from: "product-strategy", to: "go-to-market-plan", relation: "drives" },
  { from: "product-strategy", to: "analytics-dashboard", relation: "tracked by" },
  { from: "product-strategy", to: "customer-feedback", relation: "informed by" },
  { from: "product-strategy", to: "feature-requests", relation: "informed by" },

  // Roadmap dependencies
  { from: "roadmap-q1", to: "team-okrs", relation: "measured by" },
  { from: "roadmap-q1", to: "sprint-board", relation: "executed via" },
  { from: "roadmap-q1", to: "task-ship-2-4", relation: "milestone" },
  { from: "roadmap-q1", to: "task-refactor-api", relation: "milestone" },
  { from: "roadmap-q1", to: "design-system-v3", relation: "milestone" },

  // GTM
  { from: "go-to-market-plan", to: "task-prep-launch", relation: "depends on" },
  { from: "go-to-market-plan", to: "content-calendar", relation: "uses" },
  { from: "go-to-market-plan", to: "brand-guidelines", relation: "follows" },

  // Engineering hub
  { from: "engineering-wiki", to: "api-documentation", relation: "links to" },
  { from: "engineering-wiki", to: "security-policies", relation: "links to" },
  { from: "engineering-wiki", to: "onboarding-guide", relation: "links to" },
  { from: "engineering-wiki", to: "task-refactor-api", relation: "tracks" },

  // API
  { from: "api-documentation", to: "task-update-docs", relation: "tracked by" },
  { from: "api-documentation", to: "task-refactor-api", relation: "evolves with" },

  // Design
  { from: "design-system-v3", to: "brand-guidelines", relation: "extends" },
  { from: "design-system-v3", to: "task-design-review", relation: "tracked by" },
  { from: "design-system-v3", to: "note-design-critique", relation: "discussed in" },

  // Sprint / bugs / tasks
  { from: "sprint-board", to: "task-ship-2-4", relation: "contains" },
  { from: "sprint-board", to: "task-review-pr-284", relation: "contains" },
  { from: "sprint-board", to: "task-fix-auth-bug", relation: "contains" },
  { from: "sprint-board", to: "note-standup-0315", relation: "documented in" },
  { from: "sprint-board", to: "note-sprint-retro", relation: "reviewed in" },

  { from: "bug-tracker", to: "task-fix-auth-bug", relation: "tracks" },
  { from: "bug-tracker", to: "note-qa-findings", relation: "captured by" },

  { from: "task-fix-auth-bug", to: "task-review-pr-284", relation: "fixed by" },
  { from: "task-fix-auth-bug", to: "security-policies", relation: "informs" },
  { from: "task-ship-2-4", to: "task-prep-launch", relation: "blocks" },
  { from: "task-ship-2-4", to: "task-review-pr-284", relation: "depends on" },

  // People notes
  { from: "note-1-1-sam", to: "task-update-docs", relation: "discussed" },
  { from: "note-1-1-sam", to: "onboarding-guide", relation: "next step" },

  // Brainstorm + planning
  { from: "note-brainstorm", to: "feature-requests", relation: "fed into" },
  { from: "note-brainstorm", to: "product-strategy", relation: "fed into" },
  { from: "note-planning-meeting", to: "roadmap-q1", relation: "shapes" },
  { from: "note-planning-meeting", to: "feature-requests", relation: "prioritized" },
  { from: "note-planning-meeting", to: "team-okrs", relation: "informs" },

  // Hiring
  { from: "hiring-pipeline", to: "onboarding-guide", relation: "feeds" },
  { from: "hiring-pipeline", to: "team-okrs", relation: "supports" },

  // Customer signals
  { from: "customer-feedback", to: "feature-requests", relation: "creates" },
  { from: "customer-feedback", to: "analytics-dashboard", relation: "validated by" },
]

export const ALL_NODE_IDS = Object.keys(WORKSPACE)

export function getFullWorkspaceGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: ALL_NODE_IDS.map(id => WORKSPACE[id]),
    edges: WORKSPACE_EDGES,
  }
}
