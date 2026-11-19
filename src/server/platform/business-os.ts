/**
 * Business OS template pack — an original implementation of the canonical business domain model
 * (sales-to-cash, delivery, sales operations, client success, people, marketing, education).
 * It encodes structure, relationships, derived values and safe rules only. No third-party source
 * records, code or credentials. Example rows are fictional and prefixed “Example”.
 *
 * Rules carried over deliberately — and where the legacy source was wrong, fixed:
 *  • Instalment due dates are calendar-aware (monthly = calendar month, quarterly = 3 calendar months),
 *    and the nth date uses the nth offset (legacy source multiplied the 5th/6th offsets by 3 — a bug).
 *  • Final instalment absorbs rounding so the schedule always sums to the plan total.
 *  • A payment is not an invoice: receipts settle invoices through allocations; outstanding =
 *    invoice amount − allocated receipts; net collected = payments − refunds.
 *  • Commission = basis amount × rule rate, with the rule (rate, basis) chosen per deal. Earned →
 *    approved → payable → paid / reversed are separate states. Legacy rates are seeded only as
 *    clearly-labelled examples for the finance owner to confirm; the unexplained 0.96 haircut is
 *    NOT applied.
 *  • Discounts over 15% flag “Needs approval”; project progress guards against zero tasks.
 */
import type { BaseSpec, SpecField, SpecTable } from "./spec";

const sel = (...names: string[]) => names;
const stage = (pairs: [string, string][]) => pairs.map(([name, color]) => ({ name, color }));

/** Instalment N due date: calendar-aware recurrence from the first due date (fixes the legacy ×3 bug). */
function instalmentDue(n: number): SpecField {
  const k = n - 1;
  return {
    name: `Instalment ${n} due`, type: "formula",
    formula: `IF({Instalments} >= ${n}, DATETIME_FORMAT(SWITCH({Frequency}, "Weekly", DATEADD({First due date}, ${7 * k}, "days"), "Fortnightly", DATEADD({First due date}, ${14 * k}, "days"), "Quarterly", DATEADD({First due date}, ${3 * k}, "months"), DATEADD({First due date}, ${k}, "months"))), BLANK())`,
  };
}

const CATALOGUE: SpecTable[] = [
  // ───────── CRM ─────────
  { name: "Accounts", description: "Companies and organisations — prospects, clients and partners. A client is an account status, not a separate list.", fields: [
    { name: "Account", type: "singleLineText" },
    { name: "Type", type: "singleSelect", choices: stage([["Prospect", "gray"], ["Client", "green"], ["Partner", "blue"], ["Former client", "orange"]]) },
    { name: "Industry", type: "singleLineText" }, { name: "Website", type: "url" },
    { name: "Contacts", type: "link", linkTo: "Contacts", inverseName: "Account" },
    { name: "Open deals", type: "count", via: "Opportunities" },
    { name: "Invoiced", type: "rollup", via: "Invoices", target: "Amount", fn: "sum" },
    { name: "Outstanding", type: "rollup", via: "Invoices", target: "Outstanding", fn: "sum" },
    { name: "Notes", type: "longText" },
  ], records: [{ Account: "Example: Northwind Studio", Type: "Client", Industry: "Creative agency" }, { Account: "Example: Harbour Fitness", Type: "Prospect", Industry: "Health & fitness" }] },
  { name: "Contacts", description: "People at accounts.", fields: [
    { name: "Name", type: "singleLineText" }, { name: "Email", type: "email" }, { name: "Phone", type: "phone" }, { name: "Job title", type: "singleLineText" },
    { name: "Lifecycle", type: "singleSelect", choices: stage([["Lead", "gray"], ["Marketing qualified", "cyan"], ["Sales qualified", "blue"], ["Customer", "green"]]) },
  ], records: [{ Name: "Example: Alex Morgan", Email: "alex@example.com", "Job title": "Founder", Lifecycle: "Customer", Account: "Example: Northwind Studio" }, { Name: "Example: Priya Shah", Email: "priya@example.com", Lifecycle: "Sales qualified", Account: "Example: Harbour Fitness" }] },
  { name: "Opportunities", description: "Deals through the pipeline: new → qualified → contacted → meeting booked → proposal sent → negotiation → won / lost / disqualified.", fields: [
    { name: "Deal", type: "singleLineText" },
    { name: "Account", type: "link", linkTo: "Accounts", inverseName: "Opportunities", singleRecord: true },
    { name: "Primary contact", type: "link", linkTo: "Contacts", inverseName: "Opportunities", singleRecord: true },
    { name: "Stage", type: "singleSelect", choices: stage([["New", "gray"], ["Qualified", "cyan"], ["Contacted", "blue"], ["Meeting booked", "teal"], ["Proposal sent", "purple"], ["Negotiation", "yellow"], ["Won", "green"], ["Lost", "red"], ["Disqualified", "orange"]]) },
    { name: "Source", type: "singleSelect", choices: sel("Referral", "Inbound", "Outbound", "Lead magnet", "Partner", "Event", "Paid ads") },
    { name: "Owner", type: "user" },
    { name: "Offer", type: "link", linkTo: "Offers", inverseName: "Opportunities", singleRecord: true },
    { name: "Expected value", type: "currency" }, { name: "Probability", type: "percent" },
    { name: "Weighted value", type: "formula", formula: "ROUND({Expected value} * {Probability}, 2)" },
    { name: "Expected close", type: "date" }, { name: "Next step", type: "singleLineText" },
    { name: "Lost reason", type: "singleSelect", choices: sel("Price", "Timing", "No fit", "Competitor", "No response") },
    { name: "Campaign", type: "link", linkTo: "Campaigns", inverseName: "Opportunities", singleRecord: true },
    { name: "Ready to win", type: "formula", formula: "IF(AND({Account}, {Offer}, {Expected value} > 0, {Owner}), \"Ready\", \"Needs account, offer, value and owner\")" },
  ], records: [
    { Deal: "Example: Northwind retainer renewal", Account: "Example: Northwind Studio", "Primary contact": "Example: Alex Morgan", Stage: "Won", Source: "Referral", Offer: "Example: Growth retainer", "Expected value": 12000, Probability: 1, "Expected close": "2027-01-15" },
    { Deal: "Example: Harbour Fitness launch", Account: "Example: Harbour Fitness", "Primary contact": "Example: Priya Shah", Stage: "Proposal sent", Source: "Inbound", Offer: "Example: Launch sprint", "Expected value": 6500, Probability: 0.5, "Expected close": "2027-02-28" },
  ], views: [{ name: "Pipeline", type: "kanban", kanbanBy: "Stage" }, { name: "Closing calendar", type: "calendar", dateField: "Expected close" }, { name: "New enquiry", type: "form" }] },
  { name: "Meetings", description: "Sales and client meetings, including setter → closer handovers.", fields: [
    { name: "Meeting", type: "singleLineText" },
    { name: "Opportunity", type: "link", linkTo: "Opportunities", inverseName: "Meetings", singleRecord: true },
    { name: "Type", type: "singleSelect", choices: sel("Setter call", "Closer call", "Discovery", "Kickoff", "Check-in", "Review") },
    { name: "When", type: "dateTime" },
    { name: "Outcome", type: "singleSelect", choices: stage([["Booked", "gray"], ["Held", "blue"], ["No-show", "red"], ["Rescheduled", "yellow"], ["Progressed", "green"]]) },
    { name: "Setter", type: "user" }, { name: "Closer", type: "user" }, { name: "Notes", type: "longText" },
  ], records: [{ Meeting: "Example: Harbour discovery call", Opportunity: "Example: Harbour Fitness launch", Type: "Discovery", When: "2027-02-03T10:00:00.000Z", Outcome: "Progressed" }], views: [{ name: "Diary", type: "calendar", dateField: "When" }] },

  // ───────── Commercial ─────────
  { name: "Offers", description: "Packages, retainers and programmes you sell.", fields: [
    { name: "Offer", type: "singleLineText" },
    { name: "Type", type: "singleSelect", choices: sel("Package", "Retainer", "Programme", "Product", "Membership") },
    { name: "Price", type: "currency" },
    { name: "Billing", type: "singleSelect", choices: sel("One-off", "Monthly", "Quarterly", "Instalments") },
    { name: "Creates a project", type: "checkbox" }, { name: "Active", type: "checkbox" },
    { name: "Won deals", type: "count", via: "Opportunities" },
    { name: "Description", type: "longText" },
  ], records: [{ Offer: "Example: Growth retainer", Type: "Retainer", Price: 1000, Billing: "Monthly", "Creates a project": true, Active: true }, { Offer: "Example: Launch sprint", Type: "Package", Price: 6500, Billing: "Instalments", "Creates a project": true, Active: true }] },
  { name: "Proposals", description: "Versioned quotes. Discounts over 15% need approval before sending.", fields: [
    { name: "Proposal", type: "singleLineText" },
    { name: "Opportunity", type: "link", linkTo: "Opportunities", inverseName: "Proposals", singleRecord: true },
    { name: "Offer", type: "link", linkTo: "Offers", inverseName: "Proposals", singleRecord: true },
    { name: "Version", type: "number" }, { name: "Quoted value", type: "currency" }, { name: "Discount", type: "percent" },
    { name: "Net value", type: "formula", formula: "ROUND({Quoted value} * (1 - {Discount}), 2)" },
    { name: "Approval", type: "formula", formula: "IF({Discount} > 0.15, \"Needs approval\", \"Within policy\")" },
    { name: "Status", type: "singleSelect", choices: stage([["Draft", "gray"], ["Awaiting approval", "yellow"], ["Approved", "cyan"], ["Sent", "blue"], ["Accepted", "green"], ["Declined", "red"], ["Expired", "orange"]]) },
    { name: "Valid until", type: "date" },
  ], records: [{ Proposal: "Example: Harbour launch v1", Opportunity: "Example: Harbour Fitness launch", Offer: "Example: Launch sprint", Version: 1, "Quoted value": 6500, Discount: 0.1, Status: "Sent", "Valid until": "2027-03-15" }], views: [{ name: "By status", type: "kanban", kanbanBy: "Status" }] },
  { name: "Agreements", description: "Contracts. Signed agreements are kept for the record and never cascade-deleted.", fields: [
    { name: "Agreement", type: "singleLineText" },
    { name: "Account", type: "link", linkTo: "Accounts", inverseName: "Agreements", singleRecord: true },
    { name: "Proposal", type: "link", linkTo: "Proposals", inverseName: "Agreements", singleRecord: true },
    { name: "Status", type: "singleSelect", choices: stage([["Draft", "gray"], ["Out for signature", "yellow"], ["Signed", "green"], ["Ended", "purple"], ["Terminated", "red"]]) },
    { name: "Signed on", type: "date" }, { name: "Start", type: "date" }, { name: "End", type: "date" },
  ], records: [{ Agreement: "Example: Northwind retainer 2027", Account: "Example: Northwind Studio", Status: "Signed", "Signed on": "2027-01-14", Start: "2027-02-01", End: "2028-01-31" }] },

  // ───────── Clients ─────────
  { name: "Engagements", description: "Active client relationships — onboarding to renewal or offboarding.", fields: [
    { name: "Engagement", type: "singleLineText" },
    { name: "Account", type: "link", linkTo: "Accounts", inverseName: "Engagements", singleRecord: true },
    { name: "Offer", type: "link", linkTo: "Offers", inverseName: "Engagements", singleRecord: true },
    { name: "Agreement", type: "link", linkTo: "Agreements", inverseName: "Engagements", singleRecord: true },
    { name: "Source deal", type: "link", linkTo: "Opportunities", inverseName: "Engagements", singleRecord: true },
    { name: "Status", type: "singleSelect", choices: stage([["Onboarding", "cyan"], ["Active", "green"], ["Paused", "yellow"], ["Offboarding", "orange"], ["Completed", "purple"], ["Churned", "red"]]) },
    { name: "Success manager", type: "user" },
    { name: "Health", type: "singleSelect", choices: stage([["Healthy", "green"], ["Watch", "yellow"], ["At risk", "red"]]) },
    { name: "Start", type: "date" }, { name: "Renewal date", type: "date" },
    { name: "Days to renewal", type: "formula", formula: "IF({Renewal date}, DATETIME_DIFF({Renewal date}, TODAY(), \"days\"), BLANK())" },
    { name: "Wins", type: "count", via: "Client wins" },
  ], records: [{ Engagement: "Example: Northwind growth retainer", Account: "Example: Northwind Studio", Offer: "Example: Growth retainer", Agreement: "Example: Northwind retainer 2027", "Source deal": "Example: Northwind retainer renewal", Status: "Active", Health: "Healthy", Start: "2027-02-01", "Renewal date": "2028-01-31" }], views: [{ name: "Client board", type: "kanban", kanbanBy: "Status" }] },
  { name: "Client wins", fields: [
    { name: "Win", type: "singleLineText" }, { name: "Engagement", type: "link", linkTo: "Engagements", inverseName: "Client wins", singleRecord: true },
    { name: "Date", type: "date" }, { name: "Story", type: "longText" }, { name: "Can share publicly", type: "checkbox" },
  ] },
  { name: "Pause requests", description: "requested → reviewing → approved / declined → resolved. Pausing never stops billing automatically.", fields: [
    { name: "Request", type: "singleLineText" }, { name: "Engagement", type: "link", linkTo: "Engagements", inverseName: "Pause requests", singleRecord: true },
    { name: "Status", type: "singleSelect", choices: stage([["Requested", "gray"], ["Reviewing", "yellow"], ["Approved", "green"], ["Declined", "red"], ["Resolved", "purple"]]) },
    { name: "From", type: "date" }, { name: "To", type: "date" }, { name: "Reason", type: "longText" },
    { name: "Billing review", type: "singleSelect", choices: sel("Not needed", "Pending finance", "Billing paused (approved)", "Billing continues") },
  ] },

  // ───────── Finance ─────────
  { name: "Payment plans", description: "Instalment schedules with calendar-aware due dates; the final instalment absorbs rounding.", fields: [
    { name: "Plan", type: "singleLineText" },
    { name: "Engagement", type: "link", linkTo: "Engagements", inverseName: "Payment plans", singleRecord: true },
    { name: "Total", type: "currency" }, { name: "Instalments", type: "number" },
    { name: "Frequency", type: "singleSelect", choices: sel("Weekly", "Fortnightly", "Monthly", "Quarterly") },
    { name: "First due date", type: "date" },
    { name: "Instalment amount", type: "formula", formula: "IF({Instalments} > 0, ROUNDDOWN({Total} / {Instalments}, 2), BLANK())" },
    { name: "Final instalment", type: "formula", formula: "IF({Instalments} > 0, ROUND({Total} - ROUNDDOWN({Total} / {Instalments}, 2) * ({Instalments} - 1), 2), BLANK())" },
    instalmentDue(2), instalmentDue(3), instalmentDue(4), instalmentDue(5), instalmentDue(6),
  ], records: [{ Plan: "Example: Launch sprint — 3 payments", Total: 6500, Instalments: 3, Frequency: "Monthly", "First due date": "2027-03-01" }] },
  { name: "Invoices", description: "Invoices are settled by payment allocations. Outstanding = amount − allocated receipts.", fields: [
    { name: "Invoice", type: "singleLineText" },
    { name: "Account", type: "link", linkTo: "Accounts", inverseName: "Invoices", singleRecord: true },
    { name: "Engagement", type: "link", linkTo: "Engagements", inverseName: "Invoices", singleRecord: true },
    { name: "Amount", type: "currency" }, { name: "Issued", type: "date" }, { name: "Due", type: "date" },
    { name: "Status", type: "singleSelect", choices: stage([["Draft", "gray"], ["Approved", "cyan"], ["Issued", "blue"], ["Part paid", "yellow"], ["Paid", "green"], ["Void", "red"]]) },
    { name: "Received", type: "rollup", via: "Allocations", target: "Amount", fn: "sum" },
    { name: "Outstanding", type: "formula", formula: "IF({Status} = \"Void\", 0, ROUND({Amount} - {Received}, 2))" },
    { name: "Overdue", type: "formula", formula: "IF(AND({Outstanding} > 0, {Due}, IS_BEFORE({Due}, TODAY()), {Status} != \"Void\", {Status} != \"Draft\"), \"Overdue\", \"\")" },
  ], records: [
    { Invoice: "Example: INV-1001", Account: "Example: Northwind Studio", Engagement: "Example: Northwind growth retainer", Amount: 1000, Issued: "2027-02-01", Due: "2027-02-15", Status: "Paid" },
    { Invoice: "Example: INV-1002", Account: "Example: Northwind Studio", Engagement: "Example: Northwind growth retainer", Amount: 1000, Issued: "2027-03-01", Due: "2027-03-15", Status: "Part paid" },
  ], views: [{ name: "Due dates", type: "calendar", dateField: "Due" }] },
  { name: "Payments", description: "Money actually received. One payment can settle several invoices.", fields: [
    { name: "Payment", type: "singleLineText" },
    { name: "Account", type: "link", linkTo: "Accounts", inverseName: "Payments", singleRecord: true },
    { name: "Amount", type: "currency" }, { name: "Received on", type: "date" },
    { name: "Method", type: "singleSelect", choices: sel("Bank transfer", "Card", "Direct debit", "Cash", "Other") },
    { name: "Provider reference", type: "singleLineText", description: "Unique per provider — used to ignore duplicate webhooks." },
    { name: "Allocated", type: "rollup", via: "Allocations", target: "Amount", fn: "sum" },
    { name: "Unallocated", type: "formula", formula: "ROUND({Amount} - {Allocated}, 2)" },
    { name: "Refunded", type: "rollup", via: "Refunds", target: "Amount", fn: "sum" },
    { name: "Net collected", type: "formula", formula: "ROUND({Amount} - {Refunded}, 2)" },
  ], records: [{ Payment: "Example: PAY-5001", Account: "Example: Northwind Studio", Amount: 1500, "Received on": "2027-03-05", Method: "Bank transfer", "Provider reference": "example-txn-001" }] },
  { name: "Allocations", description: "Links a payment to the invoice(s) it settles.", fields: [
    { name: "Allocation", type: "singleLineText" },
    { name: "Payment", type: "link", linkTo: "Payments", inverseName: "Allocations", singleRecord: true },
    { name: "Invoice", type: "link", linkTo: "Invoices", inverseName: "Allocations", singleRecord: true },
    { name: "Amount", type: "currency" },
  ], records: [
    { Allocation: "Example: PAY-5001 → INV-1001", Payment: "Example: PAY-5001", Invoice: "Example: INV-1001", Amount: 1000 },
    { Allocation: "Example: PAY-5001 → INV-1002", Payment: "Example: PAY-5001", Invoice: "Example: INV-1002", Amount: 500 },
  ] },
  { name: "Refunds", fields: [
    { name: "Refund", type: "singleLineText" }, { name: "Payment", type: "link", linkTo: "Payments", inverseName: "Refunds", singleRecord: true },
    { name: "Amount", type: "currency" }, { name: "Date", type: "date" },
    { name: "Status", type: "singleSelect", choices: stage([["Requested", "gray"], ["Approved", "cyan"], ["Processed", "green"], ["Declined", "red"]]) },
    { name: "Reason", type: "longText" },
  ] },
  { name: "Expenses", fields: [
    { name: "Expense", type: "singleLineText" }, { name: "Project", type: "link", linkTo: "Projects", inverseName: "Expenses", singleRecord: true },
    { name: "Amount", type: "currency" }, { name: "Date", type: "date" },
    { name: "Category", type: "singleSelect", choices: sel("Software", "Contractors", "Travel", "Ads", "Equipment", "Other") },
    { name: "Billable", type: "checkbox" }, { name: "Status", type: "singleSelect", choices: sel("Submitted", "Approved", "Reimbursed", "Rejected") },
  ] },

  // ───────── Delivery ─────────
  { name: "Projects", description: "Delivery for an engagement. Progress = done tasks ÷ tasks (0 when there are no tasks).", fields: [
    { name: "Project", type: "singleLineText" },
    { name: "Engagement", type: "link", linkTo: "Engagements", inverseName: "Projects", singleRecord: true },
    { name: "Status", type: "singleSelect", choices: stage([["Planning", "gray"], ["Active", "blue"], ["At risk", "red"], ["On hold", "yellow"], ["Done", "green"]]) },
    { name: "Owner", type: "user" }, { name: "Start", type: "date" }, { name: "Due", type: "date" }, { name: "Budget", type: "currency" },
    { name: "Tasks", type: "link", linkTo: "Tasks", inverseName: "Project" },
    { name: "Task count", type: "count", via: "Tasks" },
    { name: "Done tasks", type: "rollup", via: "Tasks", target: "Is done", fn: "sum" },
    { name: "Progress", type: "formula", formula: "IF({Task count} > 0, ROUND({Done tasks} / {Task count}, 2), 0)" },
    { name: "Hours logged", type: "rollup", via: "Time entries", target: "Hours", fn: "sum" },
    { name: "Spend", type: "rollup", via: "Expenses", target: "Amount", fn: "sum" },
    { name: "Budget remaining", type: "formula", formula: "ROUND({Budget} - {Spend}, 2)" },
  ], records: [{ Project: "Example: Northwind Q1 campaign", Engagement: "Example: Northwind growth retainer", Status: "Active", Start: "2027-02-01", Due: "2027-03-31", Budget: 3000 }], views: [{ name: "Timeline", type: "timeline", dateField: "Start" }] },
  { name: "Tasks", fields: [
    { name: "Task", type: "singleLineText" },
    { name: "Status", type: "singleSelect", choices: stage([["To do", "gray"], ["In progress", "blue"], ["Blocked", "red"], ["Done", "green"]]) },
    { name: "Assignee", type: "user" },
    { name: "Priority", type: "singleSelect", choices: stage([["Low", "gray"], ["Medium", "yellow"], ["High", "orange"], ["Urgent", "red"]]) },
    { name: "Due", type: "date" },
    { name: "Is done", type: "formula", formula: "IF({Status} = \"Done\", 1, 0)" },
    { name: "Overdue", type: "formula", formula: "IF(AND({Due}, {Status} != \"Done\", IS_BEFORE({Due}, TODAY())), \"Overdue\", \"\")" },
    { name: "Notes", type: "longText" },
  ], records: [
    { Task: "Example: Campaign brief", Status: "Done", Priority: "High", Due: "2027-02-05", Project: "Example: Northwind Q1 campaign" },
    { Task: "Example: Creative concepts", Status: "In progress", Priority: "Medium", Due: "2027-02-20", Project: "Example: Northwind Q1 campaign" },
  ], views: [{ name: "Board", type: "kanban", kanbanBy: "Status" }, { name: "Due dates", type: "calendar", dateField: "Due" }] },
  { name: "Time entries", fields: [
    { name: "Entry", type: "singleLineText" }, { name: "Project", type: "link", linkTo: "Projects", inverseName: "Time entries", singleRecord: true },
    { name: "Person", type: "user" }, { name: "Date", type: "date" }, { name: "Hours", type: "number", options: { precision: 2 } }, { name: "Billable", type: "checkbox" },
  ], records: [{ Entry: "Example: Brief workshop", Project: "Example: Northwind Q1 campaign", Date: "2027-02-04", Hours: 3, Billable: true }] },
  { name: "Risks", fields: [
    { name: "Risk", type: "singleLineText" }, { name: "Project", type: "link", linkTo: "Projects", inverseName: "Risks", singleRecord: true },
    { name: "Severity", type: "singleSelect", choices: stage([["Low", "gray"], ["Medium", "yellow"], ["High", "orange"], ["Critical", "red"]]) },
    { name: "Status", type: "singleSelect", choices: sel("Open", "Mitigating", "Closed") }, { name: "Mitigation", type: "longText" },
  ] },

  // ───────── Sales operations ─────────
  { name: "Commission rules", description: "Versioned by effective date. The finance owner must confirm rate and basis before payouts.", fields: [
    { name: "Rule", type: "singleLineText" },
    { name: "Role", type: "singleSelect", choices: sel("Setter", "Closer", "DM setter", "Account manager") },
    { name: "Rate", type: "percent", options: { precision: 1 } },
    { name: "Basis", type: "singleSelect", choices: sel("Contracted value", "Invoiced", "Cash collected", "Net collected") },
    { name: "Effective from", type: "date" }, { name: "Confirmed by finance", type: "checkbox" },
  ], records: [
    { Rule: "Example: Setter 4% (unconfirmed legacy rate)", Role: "Setter", Rate: 0.04, Basis: "Cash collected", "Effective from": "2027-01-01" },
    { Rule: "Example: Closer 10% (unconfirmed legacy rate)", Role: "Closer", Rate: 0.1, Basis: "Cash collected", "Effective from": "2027-01-01" },
    { Rule: "Example: DM setter 3% (unconfirmed legacy rate)", Role: "DM setter", Rate: 0.03, Basis: "Cash collected", "Effective from": "2027-01-01" },
  ] },
  { name: "Commissions", description: "earned → approved → payable → paid, or reversed (clawback on refund). Never recalculated when deal ownership changes.", fields: [
    { name: "Commission", type: "singleLineText" },
    { name: "Deal", type: "link", linkTo: "Opportunities", inverseName: "Commissions", singleRecord: true },
    { name: "Rule", type: "link", linkTo: "Commission rules", inverseName: "Commissions", singleRecord: true },
    { name: "Earner", type: "user" },
    { name: "Rate", type: "rollup", via: "Rule", target: "Rate", fn: "max" },
    { name: "Basis amount", type: "currency" },
    { name: "Commission amount", type: "formula", formula: "ROUND({Basis amount} * {Rate}, 2)" },
    { name: "Status", type: "singleSelect", choices: stage([["Earned", "cyan"], ["Approved", "blue"], ["Payable", "yellow"], ["Paid", "green"], ["Reversed", "red"]]) },
    { name: "Payroll batch", type: "singleLineText" },
  ], records: [{ Commission: "Example: Northwind renewal — closer", Deal: "Example: Northwind retainer renewal", Rule: "Example: Closer 10% (unconfirmed legacy rate)", "Basis amount": 1500, Status: "Earned" }], views: [{ name: "By status", type: "kanban", kanbanBy: "Status" }] },

  // ───────── People / HR ─────────
  { name: "Team", description: "Restrict the sensitive fields with field permissions before adding personal data.", fields: [
    { name: "Name", type: "singleLineText" },
    { name: "Role", type: "singleLineText" },
    { name: "Department", type: "singleSelect", choices: sel("Leadership", "Sales", "Delivery", "Client success", "Marketing", "Operations", "Finance") },
    { name: "Employment", type: "singleSelect", choices: sel("Employee", "Contractor", "Freelancer") },
    { name: "Start date", type: "date" }, { name: "Work email", type: "email" },
    { name: "Right to work checked", type: "checkbox" },
    { name: "Leave days taken", type: "rollup", via: "Leave requests", target: "Days", fn: "sum" },
  ], records: [{ Name: "Example: Sam Lee", Role: "Account manager", Department: "Client success", Employment: "Employee", "Start date": "2026-06-01" }] },
  { name: "Leave requests", fields: [
    { name: "Request", type: "singleLineText" }, { name: "Team member", type: "link", linkTo: "Team", inverseName: "Leave requests", singleRecord: true },
    { name: "Type", type: "singleSelect", choices: sel("Annual leave", "Sick", "Parental", "Unpaid", "Other") },
    { name: "Start", type: "date" }, { name: "End", type: "date" },
    { name: "Days", type: "formula", formula: "IF(AND({Start}, {End}), WORKDAY_DIFF({Start}, {End}), 0)" },
    { name: "Status", type: "singleSelect", choices: stage([["Requested", "gray"], ["Approved", "green"], ["Declined", "red"]]) },
  ], views: [{ name: "Leave calendar", type: "calendar", dateField: "Start" }] },
  { name: "Requisitions", fields: [
    { name: "Role", type: "singleLineText" },
    { name: "Department", type: "singleSelect", choices: sel("Sales", "Delivery", "Client success", "Marketing", "Operations", "Finance") },
    { name: "Status", type: "singleSelect", choices: stage([["Draft", "gray"], ["Open", "green"], ["On hold", "yellow"], ["Filled", "purple"], ["Cancelled", "red"]]) },
    { name: "Hiring manager", type: "user" },
    { name: "Applicants", type: "count", via: "Candidates" },
  ], records: [{ Role: "Example: Sales closer", Department: "Sales", Status: "Open" }] },
  { name: "Candidates", description: "Right-to-work must be verified before an offer is accepted.", fields: [
    { name: "Name", type: "singleLineText" },
    { name: "Requisition", type: "link", linkTo: "Requisitions", inverseName: "Candidates", singleRecord: true },
    { name: "Stage", type: "singleSelect", choices: stage([["Applied", "gray"], ["Screen", "cyan"], ["Interview", "blue"], ["Offer", "yellow"], ["Hired", "green"], ["Rejected", "red"]]) },
    { name: "Email", type: "email" }, { name: "Score", type: "rating" }, { name: "Right to work verified", type: "checkbox" },
    { name: "Offer check", type: "formula", formula: "IF(AND({Stage} = \"Offer\", NOT({Right to work verified})), \"Verify right to work first\", \"\")" },
    { name: "CV", type: "attachment" }, { name: "Notes", type: "longText" },
  ], views: [{ name: "Hiring pipeline", type: "kanban", kanbanBy: "Stage" }, { name: "Apply", type: "form" }] },

  // ───────── Marketing ─────────
  { name: "Campaigns", description: "Spend and the pipeline it actually produced — no invented ROI.", fields: [
    { name: "Campaign", type: "singleLineText" },
    { name: "Channel", type: "singleSelect", choices: sel("Paid social", "Search", "Email", "Content", "Events", "Partnerships", "Lead magnet") },
    { name: "Start", type: "date" }, { name: "End", type: "date" }, { name: "Spend", type: "currency" },
    { name: "Deals", type: "count", via: "Opportunities" },
    { name: "Pipeline value", type: "rollup", via: "Opportunities", target: "Expected value", fn: "sum" },
    { name: "Cost per deal", type: "formula", formula: "IF({Deals} > 0, ROUND({Spend} / {Deals}, 2), BLANK())" },
  ], records: [{ Campaign: "Example: Spring lead magnet", Channel: "Lead magnet", Start: "2027-02-01", End: "2027-03-31", Spend: 800 }] },

  // ───────── Education / coaching ─────────
  { name: "Programmes", fields: [
    { name: "Programme", type: "singleLineText" },
    { name: "Format", type: "singleSelect", choices: sel("1:1 coaching", "Group cohort", "Self-paced course", "Membership", "Workshop series") },
    { name: "Weeks", type: "number" }, { name: "Offer", type: "link", linkTo: "Offers", inverseName: "Programmes", singleRecord: true },
    { name: "Enrolled", type: "count", via: "Enrollments" },
  ], records: [{ Programme: "Example: 12-week accelerator", Format: "Group cohort", Weeks: 12 }] },
  { name: "Enrollments", fields: [
    { name: "Enrollment", type: "singleLineText" },
    { name: "Programme", type: "link", linkTo: "Programmes", inverseName: "Enrollments", singleRecord: true },
    { name: "Engagement", type: "link", linkTo: "Engagements", inverseName: "Enrollments", singleRecord: true },
    { name: "Status", type: "singleSelect", choices: stage([["Enrolled", "blue"], ["Active", "green"], ["Paused", "yellow"], ["Completed", "purple"], ["Withdrawn", "red"]]) },
    { name: "Start", type: "date" }, { name: "Progress", type: "percent" },
  ] },
  { name: "Sessions", fields: [
    { name: "Session", type: "singleLineText" },
    { name: "Engagement", type: "link", linkTo: "Engagements", inverseName: "Sessions", singleRecord: true },
    { name: "Type", type: "singleSelect", choices: sel("1:1", "Group call", "Workshop", "Review") },
    { name: "When", type: "dateTime" }, { name: "Attended", type: "checkbox" }, { name: "Notes", type: "longText" },
  ], views: [{ name: "Schedule", type: "calendar", dateField: "When" }] },
];

const CORE = ["Accounts", "Contacts", "Opportunities", "Meetings", "Offers", "Proposals", "Agreements", "Engagements", "Payment plans", "Invoices", "Payments", "Allocations", "Refunds", "Projects", "Tasks", "Team"];
export const BUSINESS_PACKS: Record<string, { name: string; description: string; icon: string; color: string; tables: string[] }> = {
  business: { name: "Business OS", icon: "briefcase", color: "blue", tables: CATALOGUE.map((t) => t.name),
    description: "The full operating system: CRM pipeline, offers and proposals, agreements, clients, payment plans, invoices and allocated payments, delivery, commissions, HR, marketing and programmes — all linked." },
  agency: { name: "Agency & consulting OS", icon: "handshake", color: "purple", tables: [...CORE, "Client wins", "Expenses", "Time entries", "Risks", "Campaigns", "Requisitions", "Candidates", "Leave requests"],
    description: "Sales-to-cash plus project delivery: time tracking, budgets vs spend, risks, retainers and receivables." },
  coaching: { name: "Coaching & education OS", icon: "star", color: "pink", tables: [...CORE, "Programmes", "Enrollments", "Sessions", "Client wins", "Pause requests", "Campaigns"],
    description: "Programmes, cohorts, enrollments and sessions, client wins and pause requests, with instalment payment plans." },
  sales: { name: "Sales operations OS", icon: "trending", color: "orange", tables: [...CORE, "Commission rules", "Commissions", "Campaigns", "Requisitions", "Candidates"],
    description: "Setter → closer pipeline, meetings, versioned commission rules and a commission ledger from earned to paid." },
};

/**
 * Build a pack spec from the catalogue. Fields that depend on tables outside the pack are dropped,
 * iteratively: links to excluded tables, then rollups/counts through dropped links, then formulas
 * referencing dropped fields. Seed values for dropped fields are removed too.
 */
export function businessSpec(key: string): BaseSpec {
  const pack = BUSINESS_PACKS[key];
  const include = new Set(pack.tables);
  const tables = CATALOGUE.filter((t) => include.has(t.name)).map((t) => ({ ...t, fields: [...t.fields], records: t.records?.map((r) => ({ ...r })), views: t.views ? [...t.views] : undefined }));
  // Inverse link names available on each table (declared on the other side).
  const inverses = (tname: string) => tables.flatMap((o) => o.fields.filter((f) => f.type === "link" && f.linkTo === tname).map((f) => f.inverseName ?? o.name));
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of tables) {
      const names = new Set([...t.fields.map((f) => f.name), ...inverses(t.name)]);
      const keep = t.fields.filter((f) => {
        if (f.type === "link") return include.has(f.linkTo!);
        if (f.type === "rollup" || f.type === "count") return names.has(f.via!);
        if (f.type === "formula") return [...(f.formula ?? "").matchAll(/\{([^}]+)\}/g)].every((m) => names.has(m[1]));
        return true;
      });
      if (keep.length !== t.fields.length) { t.fields = keep; changed = true; }
    }
  }
  for (const t of tables) {
    const names = new Set([...t.fields.map((f) => f.name), ...inverses(t.name)]);
    t.records = t.records?.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => names.has(k))));
  }
  return { name: pack.name, icon: pack.icon, color: pack.color, description: pack.description, templateKey: key, tables };
}
