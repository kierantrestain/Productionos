# Interface page report — 75 observed Airtable pages

Every observed page is mapped to a working screen in Production OS. The 48 date-specific S’appening pages (8 hard-coded shoot-day interfaces × 6 pages) are replaced by **one dynamic Shoot-Day Command** (`/schedule/day/:id`) that works for every shoot day, including all 40 legacy shoot-day records once imported.

Verification legend: **Implemented & browser-tested** = covered by Playwright E2E (`tests/e2e`); **Implemented** = screen exists, renders against the real DB (smoke-tested), not individually E2E-asserted. Element-level fidelity to the Airtable layouts was *not* verified (no authorised Airtable UI access from this environment); unpublished/draft Ovation pages beyond the 10 observed remain **unverified**.

| # | Base | Interface | Source page | Production OS screen | Status |
|---:|---|---|---|---|---|
| 1 | Ovation OS | OVATION OS — Executive Command | 01 Executive Command | `/` — Command Centre: live metrics with drill-through, upcoming shoot days, budget health, deliverables | Implemented & browser-tested |
| 2 | Ovation OS | OVATION OS — Executive Command | 02 Slate Pipeline | `/slate?tab=pipeline` — Slate & IP pipeline grid (stage, format, owner, budget, milestones) | Implemented |
| 3 | Ovation OS | OVATION OS — Executive Command | 03 Decision Calendar | `/slate?tab=calendar` — Decision calendar view of IP decision/milestone dates | Implemented |
| 4 | Ovation OS | OVATION OS — Executive Command | 04 Rights Command | `/slate?tab=rights · /rights?tab=rights` — Rights & chain-of-title register; uncleared rights block delivery approval | Implemented |
| 5 | Ovation OS | OVATION OS — Executive Command | 05 Packaging Studio | `/slate?tab=packaging` — Packaging items per show (talent, partners, financiers) | Implemented |
| 6 | Ovation OS | OVATION OS — Executive Command | 06 Work Command | `/operations?tab=tasks` — Tasks with status/priority/assignee, overdue KPI | Implemented |
| 7 | Ovation OS | OVATION OS — Executive Command | 07 Gate Room | `/slate?tab=gates · /approvals` — Greenlight gates decided through role-checked approvals | Implemented |
| 8 | Ovation OS | OVATION OS — Executive Command | 08 Materials Library | `/slate?tab=materials` — Development materials with versions + attachments | Implemented |
| 9 | Ovation OS | OVATION OS — Executive Command | 09 Approvals | `/approvals` — Approvals inbox with authority checks and immutable decision chain | Implemented & browser-tested |
| 10 | Ovation OS | OVATION OS — Executive Command | 10 Automation Health | `/automations` — Workflow registry, run history, event queue (retry), outbox review, integrations | Implemented & browser-tested |
| 11 | S’appening Production | Main production interface | Transport | `/resources?tab=transport (+ Shoot-Day Command → Transport & catering)` | Implemented |
| 12 | S’appening Production | Main production interface | Contracts | `/rights?tab=contracts (gated generate → approve → sign with evidence)` | Implemented |
| 13 | S’appening Production | Main production interface | Shotlist | `/productions/:id?tab=shots + scene breakdown shot-list editor` | Implemented & browser-tested |
| 14 | S’appening Production | Main production interface | Episodes | `/productions/:id?tab=episodes` | Implemented & browser-tested |
| 15 | S’appening Production | Main production interface | Partnerships | `/commercial?tab=sponsors` | Implemented |
| 16 | S’appening Production | Main production interface | Post Production | `/post (board, tasks, cuts & review, deliverables)` | Implemented & browser-tested |
| 17 | S’appening Production | Main production interface | Expenses | `/budgets?tab=expenses (approval routing by amount)` | Implemented |
| 18 | S’appening Production | Main production interface | Locations | `/resources?tab=locations` | Implemented |
| 19 | S’appening Production | Main production interface | Props | `/resources?tab=props` | Implemented |
| 20 | S’appening Production | Main production interface | Equipment | `/resources?tab=equipment` | Implemented |
| 21 | S’appening Production | Main production interface | Cast | `/people?tab=cast` | Implemented |
| 22 | S’appening Production | Main production interface | Distribution | `/commercial?tab=releases · /post?tab=releases` | Implemented |
| 23 | S’appening Production | Main production interface | Scenes | `/productions/:id?tab=scenes + /productions/:id/scenes/:sceneId` | Implemented & browser-tested |
| 24 | S’appening Production | Main production interface | Sponsors | `/commercial?tab=sponsors` | Implemented |
| 25 | S’appening Production | Main production interface | Crew | `/people?tab=crew` | Implemented |
| 26 | S’appening Production | Main production interface | Scenes Calendar | `/schedule (month calendar + stripboard)` | Implemented & browser-tested |
| 27 | S’appening Production | Main production interface | Shoot Days | `/productions/:id?tab=schedule · /schedule/day/:id` | Implemented & browser-tested |
| 28 | S’appening Production | Shoot day Wednesday 18th | Dashboard | `/schedule/day/:id` — Schedule tab + live conflicts panel + day actions (dynamic; replaces “Shoot day Wednesday 18th”) | Implemented & browser-tested |
| 29 | S’appening Production | Shoot day Wednesday 18th | Cast | `/schedule/day/:id` — Cast & guests tab (call/on-set/pickup, confirm, check-in) (dynamic; replaces “Shoot day Wednesday 18th”) | Implemented |
| 30 | S’appening Production | Shoot day Wednesday 18th | Crew | `/schedule/day/:id` — Crew tab (call times, check-in) (dynamic; replaces “Shoot day Wednesday 18th”) | Implemented |
| 31 | S’appening Production | Shoot day Wednesday 18th | Props | `/schedule/day/:id` — Props, wardrobe & kit tab (requirements by scene) (dynamic; replaces “Shoot day Wednesday 18th”) | Implemented |
| 32 | S’appening Production | Shoot day Wednesday 18th | Locations | `/schedule/day/:id` — Locations tab (address, parking, A&E, maps) (dynamic; replaces “Shoot day Wednesday 18th”) | Implemented |
| 33 | S’appening Production | Shoot day Wednesday 18th | Equipment | `/schedule/day/:id` — Props, wardrobe & kit tab (equipment lines) (dynamic; replaces “Shoot day Wednesday 18th”) | Implemented |
| 34 | S’appening Production | Shoot day Sunday 22nd | Dashboard | `/schedule/day/:id` — Schedule tab + live conflicts panel + day actions (dynamic; replaces “Shoot day Sunday 22nd”) | Implemented & browser-tested |
| 35 | S’appening Production | Shoot day Sunday 22nd | Cast | `/schedule/day/:id` — Cast & guests tab (call/on-set/pickup, confirm, check-in) (dynamic; replaces “Shoot day Sunday 22nd”) | Implemented |
| 36 | S’appening Production | Shoot day Sunday 22nd | Crew | `/schedule/day/:id` — Crew tab (call times, check-in) (dynamic; replaces “Shoot day Sunday 22nd”) | Implemented |
| 37 | S’appening Production | Shoot day Sunday 22nd | Props | `/schedule/day/:id` — Props, wardrobe & kit tab (requirements by scene) (dynamic; replaces “Shoot day Sunday 22nd”) | Implemented |
| 38 | S’appening Production | Shoot day Sunday 22nd | Locations | `/schedule/day/:id` — Locations tab (address, parking, A&E, maps) (dynamic; replaces “Shoot day Sunday 22nd”) | Implemented |
| 39 | S’appening Production | Shoot day Sunday 22nd | Equipment | `/schedule/day/:id` — Props, wardrobe & kit tab (equipment lines) (dynamic; replaces “Shoot day Sunday 22nd”) | Implemented |
| 40 | S’appening Production | Shoot day Monday 23rd | Dashboard | `/schedule/day/:id` — Schedule tab + live conflicts panel + day actions (dynamic; replaces “Shoot day Monday 23rd”) | Implemented & browser-tested |
| 41 | S’appening Production | Shoot day Monday 23rd | Cast | `/schedule/day/:id` — Cast & guests tab (call/on-set/pickup, confirm, check-in) (dynamic; replaces “Shoot day Monday 23rd”) | Implemented |
| 42 | S’appening Production | Shoot day Monday 23rd | Crew | `/schedule/day/:id` — Crew tab (call times, check-in) (dynamic; replaces “Shoot day Monday 23rd”) | Implemented |
| 43 | S’appening Production | Shoot day Monday 23rd | Props | `/schedule/day/:id` — Props, wardrobe & kit tab (requirements by scene) (dynamic; replaces “Shoot day Monday 23rd”) | Implemented |
| 44 | S’appening Production | Shoot day Monday 23rd | Locations | `/schedule/day/:id` — Locations tab (address, parking, A&E, maps) (dynamic; replaces “Shoot day Monday 23rd”) | Implemented |
| 45 | S’appening Production | Shoot day Monday 23rd | Equipment | `/schedule/day/:id` — Props, wardrobe & kit tab (equipment lines) (dynamic; replaces “Shoot day Monday 23rd”) | Implemented |
| 46 | S’appening Production | Shoot day Tuesday 24th | Dashboard | `/schedule/day/:id` — Schedule tab + live conflicts panel + day actions (dynamic; replaces “Shoot day Tuesday 24th”) | Implemented & browser-tested |
| 47 | S’appening Production | Shoot day Tuesday 24th | Cast | `/schedule/day/:id` — Cast & guests tab (call/on-set/pickup, confirm, check-in) (dynamic; replaces “Shoot day Tuesday 24th”) | Implemented |
| 48 | S’appening Production | Shoot day Tuesday 24th | Crew | `/schedule/day/:id` — Crew tab (call times, check-in) (dynamic; replaces “Shoot day Tuesday 24th”) | Implemented |
| 49 | S’appening Production | Shoot day Tuesday 24th | Props | `/schedule/day/:id` — Props, wardrobe & kit tab (requirements by scene) (dynamic; replaces “Shoot day Tuesday 24th”) | Implemented |
| 50 | S’appening Production | Shoot day Tuesday 24th | Locations | `/schedule/day/:id` — Locations tab (address, parking, A&E, maps) (dynamic; replaces “Shoot day Tuesday 24th”) | Implemented |
| 51 | S’appening Production | Shoot day Tuesday 24th | Equipment | `/schedule/day/:id` — Props, wardrobe & kit tab (equipment lines) (dynamic; replaces “Shoot day Tuesday 24th”) | Implemented |
| 52 | S’appening Production | Shoot day Wednesday 25th | Dashboard | `/schedule/day/:id` — Schedule tab + live conflicts panel + day actions (dynamic; replaces “Shoot day Wednesday 25th”) | Implemented & browser-tested |
| 53 | S’appening Production | Shoot day Wednesday 25th | Cast | `/schedule/day/:id` — Cast & guests tab (call/on-set/pickup, confirm, check-in) (dynamic; replaces “Shoot day Wednesday 25th”) | Implemented |
| 54 | S’appening Production | Shoot day Wednesday 25th | Crew | `/schedule/day/:id` — Crew tab (call times, check-in) (dynamic; replaces “Shoot day Wednesday 25th”) | Implemented |
| 55 | S’appening Production | Shoot day Wednesday 25th | Props | `/schedule/day/:id` — Props, wardrobe & kit tab (requirements by scene) (dynamic; replaces “Shoot day Wednesday 25th”) | Implemented |
| 56 | S’appening Production | Shoot day Wednesday 25th | Locations | `/schedule/day/:id` — Locations tab (address, parking, A&E, maps) (dynamic; replaces “Shoot day Wednesday 25th”) | Implemented |
| 57 | S’appening Production | Shoot day Wednesday 25th | Equipment | `/schedule/day/:id` — Props, wardrobe & kit tab (equipment lines) (dynamic; replaces “Shoot day Wednesday 25th”) | Implemented |
| 58 | S’appening Production | Shoot day Thursday 26th | Dashboard | `/schedule/day/:id` — Schedule tab + live conflicts panel + day actions (dynamic; replaces “Shoot day Thursday 26th”) | Implemented & browser-tested |
| 59 | S’appening Production | Shoot day Thursday 26th | Cast | `/schedule/day/:id` — Cast & guests tab (call/on-set/pickup, confirm, check-in) (dynamic; replaces “Shoot day Thursday 26th”) | Implemented |
| 60 | S’appening Production | Shoot day Thursday 26th | Crew | `/schedule/day/:id` — Crew tab (call times, check-in) (dynamic; replaces “Shoot day Thursday 26th”) | Implemented |
| 61 | S’appening Production | Shoot day Thursday 26th | Props | `/schedule/day/:id` — Props, wardrobe & kit tab (requirements by scene) (dynamic; replaces “Shoot day Thursday 26th”) | Implemented |
| 62 | S’appening Production | Shoot day Thursday 26th | Locations | `/schedule/day/:id` — Locations tab (address, parking, A&E, maps) (dynamic; replaces “Shoot day Thursday 26th”) | Implemented |
| 63 | S’appening Production | Shoot day Thursday 26th | Equipment | `/schedule/day/:id` — Props, wardrobe & kit tab (equipment lines) (dynamic; replaces “Shoot day Thursday 26th”) | Implemented |
| 64 | S’appening Production | Shoot day Friday 27th | Dashboard | `/schedule/day/:id` — Schedule tab + live conflicts panel + day actions (dynamic; replaces “Shoot day Friday 27th”) | Implemented & browser-tested |
| 65 | S’appening Production | Shoot day Friday 27th | Cast | `/schedule/day/:id` — Cast & guests tab (call/on-set/pickup, confirm, check-in) (dynamic; replaces “Shoot day Friday 27th”) | Implemented |
| 66 | S’appening Production | Shoot day Friday 27th | Crew | `/schedule/day/:id` — Crew tab (call times, check-in) (dynamic; replaces “Shoot day Friday 27th”) | Implemented |
| 67 | S’appening Production | Shoot day Friday 27th | Props | `/schedule/day/:id` — Props, wardrobe & kit tab (requirements by scene) (dynamic; replaces “Shoot day Friday 27th”) | Implemented |
| 68 | S’appening Production | Shoot day Friday 27th | Locations | `/schedule/day/:id` — Locations tab (address, parking, A&E, maps) (dynamic; replaces “Shoot day Friday 27th”) | Implemented |
| 69 | S’appening Production | Shoot day Friday 27th | Equipment | `/schedule/day/:id` — Props, wardrobe & kit tab (equipment lines) (dynamic; replaces “Shoot day Friday 27th”) | Implemented |
| 70 | S’appening Production | Shoot day Saturday 28th | Dashboard | `/schedule/day/:id` — Schedule tab + live conflicts panel + day actions (dynamic; replaces “Shoot day Saturday 28th”) | Implemented & browser-tested |
| 71 | S’appening Production | Shoot day Saturday 28th | Cast | `/schedule/day/:id` — Cast & guests tab (call/on-set/pickup, confirm, check-in) (dynamic; replaces “Shoot day Saturday 28th”) | Implemented |
| 72 | S’appening Production | Shoot day Saturday 28th | Crew | `/schedule/day/:id` — Crew tab (call times, check-in) (dynamic; replaces “Shoot day Saturday 28th”) | Implemented |
| 73 | S’appening Production | Shoot day Saturday 28th | Props | `/schedule/day/:id` — Props, wardrobe & kit tab (requirements by scene) (dynamic; replaces “Shoot day Saturday 28th”) | Implemented |
| 74 | S’appening Production | Shoot day Saturday 28th | Locations | `/schedule/day/:id` — Locations tab (address, parking, A&E, maps) (dynamic; replaces “Shoot day Saturday 28th”) | Implemented |
| 75 | S’appening Production | Shoot day Saturday 28th | Equipment | `/schedule/day/:id` — Props, wardrobe & kit tab (equipment lines) (dynamic; replaces “Shoot day Saturday 28th”) | Implemented |

**Totals:** 75 observed pages → 75 mapped (10 Ovation, 17 S’appening main, 48 day-specific consolidated into 1 dynamic screen). 0 unmapped. Unpublished/draft pages not returned by the original connector: unverified.
