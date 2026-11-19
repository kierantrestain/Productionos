/**
 * Production blueprints. A blueprint describes STRUCTURE only — terminology, running order,
 * budget categories (no amounts), deliverables, post pipeline and kickoff tasks. No cast, crew,
 * figures or creative content are invented. Orgs can save their own blueprints from any production.
 */
export interface Blueprint {
  key: string;
  name: string;
  description: string;
  kind: string;
  usesEpisodes: boolean;
  terms: { unit: string; units: string; item: string; items: string };
  defaults: { units: number; itemKind: string; generalCall: string };
  /** Created for every unit (or once for standalone productions). */
  runningOrder: { title: string; kind: string; mins: number }[];
  budget: { code: string; category: string }[];
  deliverables: { title: string; spec?: string; perUnit: boolean }[];
  post: { kind: string; title: string; perUnit: boolean }[];
  /** dueOffsetDays is relative to the production start date (negative = before). */
  tasks: { title: string; priority: "low" | "normal" | "high" | "urgent"; dueOffsetDays?: number }[];
}

const ATL = [{ code: "100", category: "Story, rights & development" }, { code: "200", category: "Producers & direction" }, { code: "300", category: "Cast / talent" }];
const BTL = [{ code: "400", category: "Production crew" }, { code: "500", category: "Camera, lighting & grip" }, { code: "550", category: "Sound" }, { code: "600", category: "Art, props & wardrobe" }, { code: "650", category: "Hair & make-up" }, { code: "700", category: "Locations & studio" }, { code: "750", category: "Travel, transport & catering" }];
const POST_B = [{ code: "800", category: "Editorial & post-production" }, { code: "850", category: "Music & clearances" }, { code: "900", category: "Insurance, legal & finance" }, { code: "950", category: "Contingency" }];
const STD_TASKS: Blueprint["tasks"] = [
  { title: "Confirm insurance and production legal entity", priority: "high", dueOffsetDays: -42 },
  { title: "Lock budget v1 and submit for approval", priority: "high", dueOffsetDays: -35 },
  { title: "Risk assessment & health and safety plan", priority: "high", dueOffsetDays: -14 },
  { title: "Issue first call sheet", priority: "normal", dueOffsetDays: -2 },
];
const MASTER = (spec = "Broadcast master to delivery spec"): Blueprint["deliverables"][number] => ({ title: "Programme master", spec, perUnit: true });

export const BLUEPRINTS: Blueprint[] = [
  {
    key: "feature_film", name: "Feature film", description: "Scripted single feature: scene breakdown, shoot schedule, full post and festival/distribution deliverables.",
    kind: "film", usesEpisodes: false, terms: { unit: "Film", units: "Films", item: "Scene", items: "Scenes" },
    defaults: { units: 1, itemKind: "scene", generalCall: "07:00" }, runningOrder: [],
    budget: [...ATL, ...BTL, { code: "760", category: "VFX" }, ...POST_B],
    deliverables: [{ title: "DCP", spec: "SMPTE DCP, 5.1", perUnit: false }, { title: "ProRes 4444 XQ master", perUnit: false }, { title: "M&E stems", perUnit: false }, { title: "Subtitle files (SRT/STL)", perUnit: false }, { title: "Chain-of-title & E&O documents", perUnit: false }],
    post: [{ kind: "ingest", title: "Dailies & ingest", perUnit: false }, { kind: "edit", title: "Director's cut", perUnit: false }, { kind: "vfx", title: "VFX turnover", perUnit: false }, { kind: "grade", title: "Grade", perUnit: false }, { kind: "sound", title: "Sound mix", perUnit: false }, { kind: "qc", title: "Final QC", perUnit: false }],
    tasks: [...STD_TASKS, { title: "Script lock & breakdown", priority: "high", dueOffsetDays: -49 }, { title: "Casting sign-off", priority: "high", dueOffsetDays: -28 }],
  },
  {
    key: "scripted_series", name: "Scripted series", description: "Episodic drama or comedy: episodes with scene breakdowns, block shooting and per-episode delivery.",
    kind: "series", usesEpisodes: true, terms: { unit: "Episode", units: "Episodes", item: "Scene", items: "Scenes" },
    defaults: { units: 6, itemKind: "scene", generalCall: "07:00" }, runningOrder: [],
    budget: [...ATL, ...BTL, ...POST_B],
    deliverables: [MASTER(), { title: "Textless elements", perUnit: true }, { title: "Subtitles / access services", perUnit: true }, { title: "Music cue sheet", perUnit: true }],
    post: [{ kind: "edit", title: "Offline edit", perUnit: true }, { kind: "online", title: "Online & grade", perUnit: true }, { kind: "sound", title: "Dub", perUnit: true }, { kind: "qc", title: "QC", perUnit: true }],
    tasks: [...STD_TASKS, { title: "Block 1 scripts locked", priority: "high", dueOffsetDays: -42 }],
  },
  {
    key: "documentary", name: "Documentary", description: "Single or series factual: interviews, actuality, archive clearances and contributor releases.",
    kind: "documentary", usesEpisodes: true, terms: { unit: "Episode", units: "Episodes", item: "Sequence", items: "Sequences" },
    defaults: { units: 1, itemKind: "interview", generalCall: "08:00" },
    runningOrder: [{ title: "Opening sequence", kind: "segment", mins: 3 }, { title: "Contributor interview", kind: "interview", mins: 60 }, { title: "Actuality / observational", kind: "segment", mins: 120 }, { title: "Archive sequence", kind: "vt", mins: 5 }],
    budget: [...ATL.slice(0, 2), { code: "300", category: "Contributors & presenter" }, ...BTL.slice(0, 3), { code: "700", category: "Travel & locations" }, { code: "820", category: "Archive & footage licensing" }, ...POST_B],
    deliverables: [MASTER(), { title: "Archive & music clearance log", perUnit: true }, { title: "Contributor release pack", perUnit: true }],
    post: [{ kind: "ingest", title: "Logging & transcripts", perUnit: true }, { kind: "edit", title: "Edit", perUnit: true }, { kind: "graphics", title: "Graphics & captions", perUnit: true }, { kind: "sound", title: "Mix", perUnit: true }, { kind: "qc", title: "Compliance & QC", perUnit: true }],
    tasks: [...STD_TASKS, { title: "Contributor release forms collected", priority: "high", dueOffsetDays: 0 }, { title: "Archive research & licensing plan", priority: "normal", dueOffsetDays: -21 }],
  },
  {
    key: "commercial", name: "Commercial / branded content", description: "Standalone ad or branded film: shot-based segments, agency approvals, cut-downs and usage rights.",
    kind: "commercial", usesEpisodes: false, terms: { unit: "Spot", units: "Spots", item: "Shot set-up", items: "Shot set-ups" },
    defaults: { units: 1, itemKind: "segment", generalCall: "06:30" },
    runningOrder: [{ title: "Hero product shot", kind: "segment", mins: 90 }, { title: "Lifestyle sequence", kind: "segment", mins: 120 }, { title: "End frame / packshot", kind: "segment", mins: 45 }],
    budget: [{ code: "100", category: "Creative & director" }, { code: "300", category: "Talent & usage" }, ...BTL, { code: "800", category: "Edit, grade & finishing" }, { code: "850", category: "Music licence" }, { code: "950", category: "Contingency & markup" }],
    deliverables: [{ title: "Hero film (master)", perUnit: false }, { title: "Cut-downs 30s / 15s / 6s", perUnit: false }, { title: "Social formats 9:16, 1:1", perUnit: false }, { title: "Clock-numbered broadcast files", perUnit: false }],
    post: [{ kind: "edit", title: "Offline & agency review", perUnit: false }, { kind: "grade", title: "Grade", perUnit: false }, { kind: "online", title: "Finishing & versioning", perUnit: false }],
    tasks: [{ title: "Agency / client brief signed off", priority: "high", dueOffsetDays: -21 }, { title: "Pre-production meeting (PPM)", priority: "high", dueOffsetDays: -5 }, { title: "Talent usage terms confirmed", priority: "high", dueOffsetDays: -7 }, ...STD_TASKS.slice(2)],
  },
  {
    key: "music_video", name: "Music video", description: "Performance and narrative set-ups against a track, label approvals and platform deliverables.",
    kind: "commercial", usesEpisodes: false, terms: { unit: "Video", units: "Videos", item: "Set-up", items: "Set-ups" },
    defaults: { units: 1, itemKind: "performance", generalCall: "08:00" },
    runningOrder: [{ title: "Full performance pass — wide", kind: "performance", mins: 60 }, { title: "Performance coverage — close", kind: "performance", mins: 60 }, { title: "Narrative set-up", kind: "segment", mins: 120 }],
    budget: [{ code: "100", category: "Director & creative" }, { code: "300", category: "Artist & dancers" }, ...BTL.slice(1), { code: "800", category: "Edit, grade & VFX" }, { code: "950", category: "Contingency" }],
    deliverables: [{ title: "Master video (4K)", perUnit: false }, { title: "Vertical edit 9:16", perUnit: false }, { title: "Clean / explicit versions", perUnit: false }],
    post: [{ kind: "edit", title: "Edit to track", perUnit: false }, { kind: "grade", title: "Grade", perUnit: false }],
    tasks: [{ title: "Label treatment approval", priority: "high", dueOffsetDays: -14 }, ...STD_TASKS.slice(2)],
  },
  {
    key: "gameshow", name: "Studio gameshow", description: "Recurring episodes with a fixed running order of rounds, contestants, graphics cues and multi-camera plans.",
    kind: "gameshow", usesEpisodes: true, terms: { unit: "Episode", units: "Episodes", item: "Round", items: "Running order" },
    defaults: { units: 10, itemKind: "round", generalCall: "08:00" },
    runningOrder: [{ title: "Cold open & titles", kind: "titles", mins: 5 }, { title: "Round 1", kind: "round", mins: 25 }, { title: "Round 2", kind: "round", mins: 25 }, { title: "Ad break reset", kind: "ad_break", mins: 10 }, { title: "Final round", kind: "round", mins: 30 }, { title: "Winner & credits", kind: "link", mins: 5 }],
    budget: [{ code: "100", category: "Format licence & development" }, { code: "200", category: "Producers & director" }, { code: "300", category: "Host & contestants (prizes)" }, { code: "400", category: "Studio crew" }, { code: "500", category: "Studio & facilities" }, { code: "600", category: "Set, graphics & game software" }, ...POST_B],
    deliverables: [MASTER(), { title: "Prize fulfilment & compliance log", perUnit: true }, { title: "Clips package", perUnit: true }],
    post: [{ kind: "edit", title: "Episode edit", perUnit: true }, { kind: "graphics", title: "Graphics & score overlays", perUnit: true }, { kind: "sound", title: "Dub", perUnit: true }, { kind: "qc", title: "Compliance & QC", perUnit: true }],
    tasks: [{ title: "Contestant casting & vetting", priority: "high", dueOffsetDays: -28 }, { title: "Question writing & verification", priority: "high", dueOffsetDays: -14 }, { title: "Studio rehearsal & game software test", priority: "high", dueOffsetDays: -2 }, ...STD_TASKS],
  },
  {
    key: "panel_show", name: "Panel / chat show", description: "Studio episodes with guests, segments, VTs and audience; recurring weekly production.",
    kind: "panel_show", usesEpisodes: true, terms: { unit: "Episode", units: "Episodes", item: "Segment", items: "Running order" },
    defaults: { units: 8, itemKind: "segment", generalCall: "10:00" },
    runningOrder: [{ title: "Titles & host intro", kind: "titles", mins: 3 }, { title: "Guest introductions", kind: "segment", mins: 5 }, { title: "Topic 1", kind: "segment", mins: 12 }, { title: "VT insert", kind: "vt", mins: 3 }, { title: "Topic 2", kind: "segment", mins: 12 }, { title: "Closing round & goodbyes", kind: "link", mins: 5 }],
    budget: [{ code: "200", category: "Producers & director" }, { code: "300", category: "Host & guest fees" }, { code: "400", category: "Studio crew" }, { code: "500", category: "Studio & audience" }, { code: "600", category: "Set & graphics" }, ...POST_B],
    deliverables: [MASTER(), { title: "Social clips", perUnit: true }],
    post: [{ kind: "edit", title: "Episode edit", perUnit: true }, { kind: "qc", title: "Compliance & QC", perUnit: true }],
    tasks: [{ title: "Guest bookings confirmed", priority: "high", dueOffsetDays: -7 }, { title: "Audience tickets released", priority: "normal", dueOffsetDays: -14 }, ...STD_TASKS],
  },
  {
    key: "podcast", name: "Podcast / audio series", description: "Recorded episodes with guests, segments and audio-first post; optional video.",
    kind: "podcast", usesEpisodes: true, terms: { unit: "Episode", units: "Episodes", item: "Segment", items: "Segments" },
    defaults: { units: 12, itemKind: "segment", generalCall: "10:00" },
    runningOrder: [{ title: "Intro", kind: "titles", mins: 2 }, { title: "Main conversation", kind: "interview", mins: 45 }, { title: "Listener questions", kind: "segment", mins: 10 }, { title: "Outro & credits", kind: "link", mins: 2 }],
    budget: [{ code: "300", category: "Host & guest fees" }, { code: "500", category: "Studio & equipment" }, { code: "800", category: "Editing & mastering" }, { code: "850", category: "Music & clearances" }, { code: "900", category: "Distribution & marketing" }],
    deliverables: [{ title: "Mastered audio (-16 LUFS)", perUnit: true }, { title: "Show notes & transcript", perUnit: true }, { title: "Video version / clips", perUnit: true }],
    post: [{ kind: "edit", title: "Audio edit", perUnit: true }, { kind: "sound", title: "Mix & master", perUnit: true }],
    tasks: [{ title: "Guest release forms", priority: "high", dueOffsetDays: 0 }],
  },
  {
    key: "live_event", name: "Live event / broadcast", description: "Live or as-live multi-camera show with rehearsals, timed running order and transmission.",
    kind: "studio_unscripted", usesEpisodes: false, terms: { unit: "Show", units: "Shows", item: "Item", items: "Running order" },
    defaults: { units: 1, itemKind: "segment", generalCall: "07:00" },
    runningOrder: [{ title: "Pre-show / warm-up", kind: "link", mins: 15 }, { title: "Opening titles", kind: "titles", mins: 2 }, { title: "Performance 1", kind: "performance", mins: 5 }, { title: "Presenter link", kind: "link", mins: 2 }, { title: "Performance 2", kind: "performance", mins: 5 }, { title: "Close & credits", kind: "titles", mins: 2 }],
    budget: [{ code: "200", category: "Producers & direction" }, { code: "300", category: "Talent & performers" }, { code: "400", category: "Crew" }, { code: "500", category: "OB / studio facilities" }, { code: "550", category: "Sound & comms" }, { code: "600", category: "Staging, set & lighting" }, { code: "900", category: "Insurance & licences" }, { code: "950", category: "Contingency" }],
    deliverables: [{ title: "Transmission recording", perUnit: false }, { title: "Highlights package", perUnit: false }],
    post: [{ kind: "edit", title: "Highlights edit", perUnit: false }],
    tasks: [{ title: "Technical recce", priority: "high", dueOffsetDays: -21 }, { title: "Camera rehearsal", priority: "high", dueOffsetDays: -1 }, { title: "Event licence & safety sign-off", priority: "urgent", dueOffsetDays: -14 }],
  },
  {
    key: "corporate", name: "Corporate / explainer video", description: "Interviews, b-roll and graphics for a client, with review rounds and multiple formats.",
    kind: "commercial", usesEpisodes: false, terms: { unit: "Video", units: "Videos", item: "Set-up", items: "Set-ups" },
    defaults: { units: 1, itemKind: "interview", generalCall: "08:30" },
    runningOrder: [{ title: "Interview — subject 1", kind: "interview", mins: 45 }, { title: "Interview — subject 2", kind: "interview", mins: 45 }, { title: "B-roll", kind: "segment", mins: 90 }],
    budget: [{ code: "200", category: "Producer & director" }, { code: "400", category: "Crew" }, { code: "500", category: "Equipment" }, { code: "800", category: "Edit & motion graphics" }, { code: "950", category: "Contingency" }],
    deliverables: [{ title: "Master edit", perUnit: false }, { title: "Social cut-downs", perUnit: false }, { title: "Captions file", perUnit: false }],
    post: [{ kind: "edit", title: "Edit & client review", perUnit: false }, { kind: "graphics", title: "Motion graphics", perUnit: false }],
    tasks: [{ title: "Client brief & sign-off", priority: "high", dueOffsetDays: -14 }, { title: "Interviewee releases", priority: "high", dueOffsetDays: 0 }],
  },
  {
    key: "reality", name: "Reality / factual entertainment", description: "Observational series with contributors, story producing, multi-crew filming and heavy post.",
    kind: "series", usesEpisodes: true, terms: { unit: "Episode", units: "Episodes", item: "Story beat", items: "Story beats" },
    defaults: { units: 8, itemKind: "segment", generalCall: "08:00" },
    runningOrder: [{ title: "Opening story beat", kind: "segment", mins: 60 }, { title: "Contributor interview (ITH)", kind: "interview", mins: 45 }, { title: "Challenge / set piece", kind: "segment", mins: 120 }],
    budget: [{ code: "200", category: "Exec, series & story producers" }, { code: "300", category: "Contributors & welfare" }, ...BTL.slice(0, 3), { code: "750", category: "Travel & accommodation" }, ...POST_B],
    deliverables: [MASTER(), { title: "Duty of care & welfare log", perUnit: true }],
    post: [{ kind: "ingest", title: "Logging", perUnit: true }, { kind: "edit", title: "Story edit", perUnit: true }, { kind: "sound", title: "Dub", perUnit: true }, { kind: "qc", title: "Compliance & QC", perUnit: true }],
    tasks: [{ title: "Contributor psychological assessment & welfare plan", priority: "urgent", dueOffsetDays: -21 }, ...STD_TASKS],
  },
  {
    key: "blank", name: "Blank production", description: "Start from nothing — choose whether it has episodes and build your own structure.",
    kind: "series", usesEpisodes: true, terms: { unit: "Episode", units: "Episodes", item: "Scene", items: "Scenes" },
    defaults: { units: 0, itemKind: "scene", generalCall: "08:00" }, runningOrder: [], budget: [], deliverables: [], post: [], tasks: [],
  },
];

export const blueprint = (key: string) => BLUEPRINTS.find((b) => b.key === key);
