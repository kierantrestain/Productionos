/**
 * Template catalogue. Each template is a BaseSpec: real relational structure (links, lookups, rollups,
 * formulas, kanban/calendar/form views) plus a few clearly-marked example records.
 */
import type { BaseSpec } from "./spec";
import { invalid } from "../errors";
import { BUSINESS_PACKS, businessSpec } from "./business-os";

export interface TemplateMeta { key: string; name: string; description: string; category: string; icon: string; color: string }

const T: Record<string, TemplateMeta & { spec: () => BaseSpec }> = {
  production: {
    key: "production", name: "Production OS", category: "Media & production", icon: "clapperboard", color: "red",
    description: "Productions, episodes, scenes, shot lists, shoot days, cast & crew, locations, kit, budget and deliverables — fully linked.",
    spec: () => ({ name: "Production OS", icon: "clapperboard", color: "red", tables: [
      { name: "Productions", fields: [
        { name: "Title", type: "singleLineText" }, { name: "Format", type: "singleSelect", choices: ["Series", "Film", "Documentary", "Gameshow", "Commercial", "Podcast", "Live event"] },
        { name: "Stage", type: "singleSelect", choices: [{ name: "Development", color: "gray" }, { name: "Pre-production", color: "yellow" }, { name: "Shooting", color: "red" }, { name: "Post", color: "purple" }, { name: "Delivered", color: "green" }] },
        { name: "Start", type: "date" }, { name: "Delivery date", type: "date" },
        { name: "Episodes", type: "link", linkTo: "Episodes", inverseName: "Production" },
        { name: "Budget lines", type: "link", linkTo: "Budget", inverseName: "Production" },
        { name: "Approved budget", type: "rollup", via: "Budget lines", target: "Approved", fn: "sum" },
        { name: "Actual spend", type: "rollup", via: "Budget lines", target: "Actual", fn: "sum" },
        { name: "Variance", type: "formula", formula: "{Approved budget} - {Actual spend}" },
        { name: "Days to delivery", type: "formula", formula: "IF({Delivery date}, DATETIME_DIFF({Delivery date}, TODAY(), 'days'), BLANK())" },
      ], records: [{ Title: "Example: Night Shift S1", Format: "Series", Stage: "Pre-production", Start: "2027-03-01", "Delivery date": "2027-07-31" }],
        views: [{ name: "By stage", type: "kanban", kanbanBy: "Stage" }] },
      { name: "Episodes", fields: [
        { name: "Title", type: "singleLineText" }, { name: "Number", type: "number" },
        { name: "Status", type: "singleSelect", choices: ["Scripting", "Prep", "Shooting", "Edit", "Delivered"] },
        { name: "Scenes", type: "link", linkTo: "Scenes", inverseName: "Episode" },
        { name: "Scene count", type: "count", via: "Scenes" }, { name: "Delivery", type: "date" },
      ], records: [{ Title: "Pilot", Number: 1, Status: "Prep", Production: "Example: Night Shift S1" }] },
      { name: "Scenes", fields: [
        { name: "Scene", type: "singleLineText" }, { name: "Heading", type: "singleLineText" },
        { name: "INT/EXT", type: "singleSelect", choices: ["INT", "EXT", "INT/EXT"] }, { name: "Day/Night", type: "singleSelect", choices: ["DAY", "NIGHT"] },
        { name: "Pages (8ths)", type: "number" }, { name: "Status", type: "singleSelect", choices: ["Draft", "Ready", "Scheduled", "Shot", "In post"] },
        { name: "Location", type: "link", linkTo: "Locations", inverseName: "Scenes" }, { name: "Cast", type: "link", linkTo: "People", inverseName: "Scenes" },
        { name: "Kit", type: "link", linkTo: "Kit", inverseName: "Scenes" }, { name: "Shoot day", type: "link", linkTo: "Shoot days", inverseName: "Scenes", singleRecord: true },
        { name: "Shots", type: "link", linkTo: "Shots", inverseName: "Scene" }, { name: "Shot count", type: "count", via: "Shots" },
        { name: "Director notes", type: "longText" },
      ], records: [{ Scene: "1", Heading: "Café opens", "INT/EXT": "INT", "Day/Night": "NIGHT", "Pages (8ths)": 12, Status: "Ready", Episode: "Pilot", Location: "Example Café" }],
        views: [{ name: "Stripboard", type: "kanban", kanbanBy: "Status" }] },
      { name: "Shots", fields: [{ name: "Shot", type: "singleLineText" }, { name: "Type", type: "singleSelect", choices: ["WS", "MS", "CU", "ECU", "OTS", "POV", "Insert"] }, { name: "Movement", type: "singleSelect", choices: ["Static", "Pan", "Dolly", "Handheld", "Gimbal", "Crane"] }, { name: "Description", type: "longText" }, { name: "Done", type: "checkbox" }] },
      { name: "Shoot days", fields: [{ name: "Day", type: "singleLineText" }, { name: "Date", type: "date" }, { name: "Call time", type: "singleLineText" }, { name: "Unit base", type: "link", linkTo: "Locations", inverseName: "Unit base for" }, { name: "Scene count", type: "count", via: "Scenes" }, { name: "Pages", type: "rollup", via: "Scenes", target: "Pages (8ths)", fn: "sum" }],
        views: [{ name: "Calendar", type: "calendar", dateField: "Date" }] },
      { name: "People", fields: [{ name: "Name", type: "singleLineText" }, { name: "Role", type: "singleSelect", choices: ["Cast", "Crew", "Contributor", "Client"] }, { name: "Department", type: "singleLineText" }, { name: "Email", type: "email" }, { name: "Phone", type: "phone" }, { name: "Day rate", type: "currency" }, { name: "Contract signed", type: "checkbox" }] },
      { name: "Locations", fields: [{ name: "Name", type: "singleLineText" }, { name: "Address", type: "longText" }, { name: "Status", type: "singleSelect", choices: ["Scouted", "Hold", "Confirmed"] }, { name: "Parking", type: "longText" }, { name: "Nearest A&E", type: "singleLineText" }], records: [{ Name: "Example Café", Status: "Confirmed" }] },
      { name: "Kit", fields: [{ name: "Item", type: "singleLineText" }, { name: "Kind", type: "singleSelect", choices: ["Prop", "Wardrobe", "Equipment", "Set"] }, { name: "Quantity", type: "number" }, { name: "Status", type: "singleSelect", choices: ["Available", "Booked", "Checked out", "Maintenance"] }] },
      { name: "Budget", fields: [{ name: "Line", type: "singleLineText" }, { name: "Code", type: "singleLineText" }, { name: "Estimate", type: "currency" }, { name: "Approved", type: "currency" }, { name: "Actual", type: "currency" }, { name: "Variance", type: "formula", formula: "{Approved} - {Actual}" }],
        records: [{ Line: "Camera & lighting", Code: "500", Estimate: 0, Approved: 0, Actual: 0, Production: "Example: Night Shift S1" }] },
      { name: "Deliverables", fields: [{ name: "Deliverable", type: "singleLineText" }, { name: "Episode", type: "link", linkTo: "Episodes", inverseName: "Deliverables" }, { name: "Due", type: "date" }, { name: "Status", type: "singleSelect", choices: ["Pending", "In progress", "QC", "Approved", "Delivered"] }, { name: "Spec", type: "longText" }],
        views: [{ name: "Board", type: "kanban", kanbanBy: "Status" }] },
    ] }),
  },
  crm: {
    key: "crm", name: "Sales CRM", category: "Sales", icon: "handshake", color: "blue",
    description: "Companies, contacts and deals with pipeline stages, weighted value and next steps.",
    spec: () => ({ name: "Sales CRM", icon: "handshake", color: "blue", tables: [
      { name: "Deals", fields: [{ name: "Deal", type: "singleLineText" }, { name: "Company", type: "link", linkTo: "Companies", inverseName: "Deals", singleRecord: true }, { name: "Stage", type: "singleSelect", choices: [{ name: "Lead", color: "gray" }, { name: "Qualified", color: "blue" }, { name: "Proposal", color: "yellow" }, { name: "Negotiation", color: "orange" }, { name: "Won", color: "green" }, { name: "Lost", color: "red" }] }, { name: "Value", type: "currency" }, { name: "Probability", type: "percent" }, { name: "Weighted value", type: "formula", formula: "{Value} * {Probability}" }, { name: "Owner", type: "user" }, { name: "Close date", type: "date" }, { name: "Next step", type: "longText" }],
        records: [{ Deal: "Example: Brand partnership", Stage: "Proposal", Value: 25000, Probability: 0.4, Company: "Example Ltd" }], views: [{ name: "Pipeline", type: "kanban", kanbanBy: "Stage" }, { name: "Closing calendar", type: "calendar", dateField: "Close date" }] },
      { name: "Companies", fields: [{ name: "Name", type: "singleLineText" }, { name: "Website", type: "url" }, { name: "Industry", type: "singleSelect", choices: ["Media", "Retail", "Tech", "Finance", "Other"] }, { name: "Contacts", type: "link", linkTo: "Contacts", inverseName: "Company" }, { name: "Pipeline value", type: "rollup", via: "Deals", target: "Value", fn: "sum" }], records: [{ Name: "Example Ltd", Industry: "Media" }] },
      { name: "Contacts", fields: [{ name: "Name", type: "singleLineText" }, { name: "Email", type: "email" }, { name: "Phone", type: "phone" }, { name: "Title", type: "singleLineText" }] },
    ] }),
  },
  projects: {
    key: "projects", name: "Project tracker", category: "Operations", icon: "kanban", color: "green",
    description: "Projects, tasks, owners, priorities and timelines with progress roll-ups.",
    spec: () => ({ name: "Project tracker", icon: "kanban", color: "green", tables: [
      { name: "Projects", fields: [{ name: "Project", type: "singleLineText" }, { name: "Status", type: "singleSelect", choices: [{ name: "Planning", color: "gray" }, { name: "Active", color: "blue" }, { name: "At risk", color: "red" }, { name: "Done", color: "green" }] }, { name: "Start", type: "date" }, { name: "End", type: "date" }, { name: "Tasks", type: "link", linkTo: "Tasks", inverseName: "Project" }, { name: "Task count", type: "count", via: "Tasks" }, { name: "Done tasks", type: "rollup", via: "Tasks", target: "Done", fn: "sum" }, { name: "Progress", type: "formula", formula: "IF({Task count} > 0, {Done tasks} / {Task count}, 0)" }],
        records: [{ Project: "Example: Website relaunch", Status: "Active", Start: "2027-01-10", End: "2027-03-31" }], views: [{ name: "Timeline", type: "timeline", dateField: "Start" }] },
      { name: "Tasks", fields: [{ name: "Task", type: "singleLineText" }, { name: "Assignee", type: "user" }, { name: "Priority", type: "singleSelect", choices: [{ name: "Low", color: "gray" }, { name: "Medium", color: "yellow" }, { name: "High", color: "orange" }, { name: "Urgent", color: "red" }] }, { name: "Due", type: "date" }, { name: "Done", type: "checkbox" }, { name: "Notes", type: "longText" }],
        records: [{ Task: "Draft sitemap", Priority: "High", Project: "Example: Website relaunch" }, { Task: "Design homepage", Priority: "Medium", Project: "Example: Website relaunch", Done: true }], views: [{ name: "By priority", type: "kanban", kanbanBy: "Priority" }, { name: "Due dates", type: "calendar", dateField: "Due" }] },
    ] }),
  },
  content: {
    key: "content", name: "Content calendar", category: "Marketing", icon: "calendar", color: "pink",
    description: "Plan, produce and publish content across channels with approvals and assets.",
    spec: () => ({ name: "Content calendar", icon: "calendar", color: "pink", tables: [
      { name: "Content", fields: [{ name: "Title", type: "singleLineText" }, { name: "Channel", type: "multipleSelects", choices: ["YouTube", "Instagram", "TikTok", "LinkedIn", "Blog", "Newsletter"] }, { name: "Status", type: "singleSelect", choices: [{ name: "Idea", color: "gray" }, { name: "Scripting", color: "yellow" }, { name: "Filming", color: "orange" }, { name: "Editing", color: "purple" }, { name: "Scheduled", color: "blue" }, { name: "Published", color: "green" }] }, { name: "Publish date", type: "date" }, { name: "Owner", type: "user" }, { name: "Assets", type: "attachment" }, { name: "Hook", type: "longText" }, { name: "Approved", type: "checkbox" }],
        records: [{ Title: "Example: Behind the scenes reel", Channel: ["Instagram", "TikTok"], Status: "Editing", "Publish date": "2027-02-14" }], views: [{ name: "Pipeline", type: "kanban", kanbanBy: "Status" }, { name: "Calendar", type: "calendar", dateField: "Publish date" }, { name: "Content requests", type: "form" }] },
    ] }),
  },
  recruiting: {
    key: "recruiting", name: "Hiring pipeline", category: "People", icon: "users", color: "purple",
    description: "Roles, candidates, interview stages and scorecards.",
    spec: () => ({ name: "Hiring pipeline", icon: "users", color: "purple", tables: [
      { name: "Candidates", fields: [{ name: "Name", type: "singleLineText" }, { name: "Role", type: "link", linkTo: "Roles", inverseName: "Candidates", singleRecord: true }, { name: "Stage", type: "singleSelect", choices: ["Applied", "Screen", "Interview", "Offer", "Hired", "Rejected"] }, { name: "Email", type: "email" }, { name: "CV", type: "attachment" }, { name: "Score", type: "rating", options: { max: 5 } }, { name: "Notes", type: "longText" }],
        views: [{ name: "Pipeline", type: "kanban", kanbanBy: "Stage" }, { name: "Apply", type: "form" }] },
      { name: "Roles", fields: [{ name: "Role", type: "singleLineText" }, { name: "Department", type: "singleSelect", choices: ["Production", "Post", "Commercial", "Operations"] }, { name: "Open", type: "checkbox" }, { name: "Applicants", type: "count", via: "Candidates" }], records: [{ Role: "Example: Production coordinator", Department: "Production", Open: true }] },
    ] }),
  },
  inventory: {
    key: "inventory", name: "Inventory & assets", category: "Operations", icon: "package", color: "orange",
    description: "Track equipment, stock levels, suppliers and check-outs.",
    spec: () => ({ name: "Inventory & assets", icon: "package", color: "orange", tables: [
      { name: "Items", fields: [{ name: "Item", type: "singleLineText" }, { name: "Category", type: "singleSelect", choices: ["Camera", "Lighting", "Sound", "Grip", "IT"] }, { name: "Quantity", type: "number" }, { name: "Reorder level", type: "number" }, { name: "Needs reorder", type: "formula", formula: "IF({Quantity} <= {Reorder level}, \"Reorder\", \"OK\")" }, { name: "Supplier", type: "link", linkTo: "Suppliers", inverseName: "Items", singleRecord: true }, { name: "Unit cost", type: "currency" }, { name: "Stock value", type: "formula", formula: "{Quantity} * {Unit cost}" }, { name: "Barcode", type: "barcode" }] },
      { name: "Suppliers", fields: [{ name: "Name", type: "singleLineText" }, { name: "Email", type: "email" }, { name: "Phone", type: "phone" }, { name: "Stock value", type: "rollup", via: "Items", target: "Stock value", fn: "sum" }] },
    ] }),
  },
  events: {
    key: "events", name: "Event planning", category: "Operations", icon: "party", color: "teal",
    description: "Events, run of show, vendors, budget and guest RSVPs.",
    spec: () => ({ name: "Event planning", icon: "party", color: "teal", tables: [
      { name: "Events", fields: [{ name: "Event", type: "singleLineText" }, { name: "Date", type: "dateTime" }, { name: "Venue", type: "singleLineText" }, { name: "Status", type: "singleSelect", choices: ["Planning", "Confirmed", "Live", "Wrapped"] }, { name: "Guests", type: "link", linkTo: "Guests", inverseName: "Event" }, { name: "Guest count", type: "count", via: "Guests" }, { name: "Budget", type: "currency" }], views: [{ name: "Calendar", type: "calendar", dateField: "Date" }] },
      { name: "Guests", fields: [{ name: "Name", type: "singleLineText" }, { name: "Email", type: "email" }, { name: "RSVP", type: "singleSelect", choices: [{ name: "Invited", color: "gray" }, { name: "Yes", color: "green" }, { name: "No", color: "red" }, { name: "Maybe", color: "yellow" }] }, { name: "Dietary", type: "singleLineText" }], views: [{ name: "RSVP form", type: "form" }] },
    ] }),
  },
  roadmap: {
    key: "roadmap", name: "Product roadmap", category: "Product", icon: "map", color: "cyan",
    description: "Features, releases, effort vs impact scoring and feedback.",
    spec: () => ({ name: "Product roadmap", icon: "map", color: "cyan", tables: [
      { name: "Features", fields: [{ name: "Feature", type: "singleLineText" }, { name: "Status", type: "singleSelect", choices: ["Backlog", "Next", "Now", "Shipped"] }, { name: "Impact", type: "rating", options: { max: 5 } }, { name: "Effort", type: "rating", options: { max: 5 } }, { name: "Score", type: "formula", formula: "ROUND({Impact} / MAX({Effort}, 1), 2)" }, { name: "Release", type: "link", linkTo: "Releases", inverseName: "Features", singleRecord: true }, { name: "Spec", type: "longText" }], views: [{ name: "Board", type: "kanban", kanbanBy: "Status" }] },
      { name: "Releases", fields: [{ name: "Release", type: "singleLineText" }, { name: "Date", type: "date" }, { name: "Feature count", type: "count", via: "Features" }], views: [{ name: "Timeline", type: "timeline", dateField: "Date" }] },
    ] }),
  },
};

for (const [key, p] of Object.entries(BUSINESS_PACKS)) T[key] = { key, name: p.name, description: p.description, category: "Business OS", icon: p.icon, color: p.color, spec: () => businessSpec(key) };

export const TEMPLATES: TemplateMeta[] = Object.values(T).map(({ spec: _s, ...m }) => m);
export function templateSpec(key: string): BaseSpec {
  const t = T[key]; if (!t) throw invalid("Unknown template");
  return { ...t.spec(), templateKey: key };
}
