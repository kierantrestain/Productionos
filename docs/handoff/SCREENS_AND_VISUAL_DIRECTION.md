# Product screens and UX direction

## Visual reference and intent
Inspired by the interaction density, crisp hierarchy and accessible components of **Meta Astryx** (`https://github.com/meta/astryx`, docs `https://astryx.atmeta.com`). Check React/version compatibility and licensing at build time. The application should be a distinct Bang On product, not an Airtable skin or exact copy of any competitor. Prefer a neutral professional palette, restrained accent for actionable states, clear typography, 8pt grid, responsive tables, searchable command/search, keyboard shortcuts where appropriate, accessible focus and high contrast. Do not make every screen a generic dashboard card grid. A coordinator working on a shoot day must find the next action in seconds.

## Main navigation
**Home; Slate; Productions; Schedule; People; Resources; Budgets; Post; Rights & Contracts; Commercial; Reports; Automations.** Use role-aware visibility and contextual sidebars. Inside a selected production use tabs: Overview, Episodes/Segments, Scenes & Shots, Calendar, Crew & Cast, Locations/Assets, Money, Post, Documents.

## Screen requirements

1. **Command Centre:** real KPI definitions and data lineage, active productions, production/day blockers, overdue approvals, due deliverables, scheduled filming, budget variance. Drill down, no fake metrics.
2. **Slate / IP:** show cards/list, stage gates, key documents, treatments, format bible references, rights status, owner, upcoming milestones, linked approvals.
3. **Productions:** context page that binds episodes (or production units), status, budget, contacts, exact schedule and latest delivery; multiple production formats.
4. **Scenes / Segments:** spreadsheet-like fast editing, filters, grouping, saved views, scene/segment drawer, linked cast/crew/requirements, inline notes; batch actions with undo.
5. **Shot list:** ordered shot blocks, shot type/framing/movement/priority, director notes, attachments, duplication guard, printable export, optional card/board layouts.
6. **Schedule:** drag/reschedule with conflict feedback; calendar day/week and stripboard; auto-calculated estimated timing; production timezone; resource conflicts; locked issued callsheets.
7. **Shoot-Day Command:** high-contrast tablet-friendly date header, current/next scene, call times, cast and crew checklist, location travel, kit/props/wardrobe, releases, weather entered/authorised if relevant, known blockers, attachments, one-click verified callsheet PDF generation and safe dispatch review. No eight one-off hard-coded screens.
8. **People / Assets:** searchable people, engagement history, booking availability, contracts, roles, rate permissions, resource checkout/check-in.
9. **Finance:** track estimate/approved/commitment/spend/forecast and cash impact, line-level variance and controlled approvals. Never expose restricted values to crew.
10. **Post / Delivery:** media refs, versioned edits, owner, stage, comments/timecode, contractual delivery requirements, sign-off, release schedule.
11. **Rights & Commercial:** chain of title status and signed evidence, licence windows/territories, obligations, talent consent, brand deliverables, sponsorship pipeline.
12. **Workflow Health:** event rules, draft/active/paused, last runs, retries, failed sends, human decision checkpoints; automation specs are not live actions until deployed/tested.

## Responsive and practical UX testing
- 1440/1280 desktop: production office workflow, large grid views and bulk editing.
- 1024/tablet landscape: on-set crew, touch-friendly buttons, no hover dependencies.
- 390/mobile: cast call times and exact location/parking/navigation, no sensitive fields.
- Keyboard, screen-reader labels, reduced motion, understandable errors, zero accidental sends.
- Test realistic density (79 scenes and 70 shots) rather than only empty states.

## Do not conflate products
No full screenplay-writing editor in this app. SWDR can eventually provide an approved revision, with a pinned script revision ID and scene breakdown sync. Mimic OS remains its own Codex-built product and may connect later through a documented, authenticated read/write API if approved.
