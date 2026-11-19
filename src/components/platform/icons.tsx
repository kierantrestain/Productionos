"use client";
import {
  AtSign, Barcode, Bot, Box, Briefcase, Calendar, CalendarClock, CheckSquare, Circle, Clapperboard, Clock, Database, FileText, Film, Hash, Handshake,
  Heart, Kanban, Link2, List, ListChecks, Map, MousePointerClick, Package, PartyPopper, Paperclip, Percent, Phone, PoundSterling, Rocket, Search, Sigma,
  Sparkles, Star, Table2, Text, Timer, TrendingUp, User, Users, Grid3x3, LayoutGrid, GanttChart, FormInput, Rows3, ArrowUpRight, Calculator, Fingerprint, Type,
  type LucideIcon,
} from "lucide-react";
import type { FieldType } from "@/lib/platform/fields";

export const FIELD_ICONS: Record<FieldType, LucideIcon> = {
  singleLineText: Type, longText: Text, number: Hash, currency: PoundSterling, percent: Percent, rating: Star, checkbox: CheckSquare,
  singleSelect: Circle, multipleSelects: ListChecks, date: Calendar, dateTime: CalendarClock, duration: Timer, email: AtSign, url: Link2, phone: Phone,
  link: ArrowUpRight, lookup: Search, rollup: Sigma, count: Calculator, formula: FileText, attachment: Paperclip, user: User, autonumber: Fingerprint,
  createdTime: Clock, lastModifiedTime: Clock, createdBy: User, lastModifiedBy: User, aiText: Sparkles, barcode: Barcode, button: MousePointerClick,
};

export const VIEW_ICONS: Record<string, LucideIcon> = { grid: Grid3x3, kanban: Kanban, calendar: Calendar, gallery: LayoutGrid, form: FormInput, timeline: GanttChart, list: Rows3 };
export const VIEW_LABELS: Record<string, string> = { grid: "Grid", kanban: "Kanban", calendar: "Calendar", gallery: "Gallery", form: "Form", timeline: "Timeline", list: "List" };

export const BASE_ICONS: Record<string, LucideIcon> = {
  grid: Table2, clapperboard: Clapperboard, handshake: Handshake, kanban: Kanban, calendar: Calendar, users: Users, package: Package, party: PartyPopper,
  map: Map, briefcase: Briefcase, rocket: Rocket, heart: Heart, star: Star, film: Film, database: Database, box: Box, list: List, trending: TrendingUp, bot: Bot,
};
export function BaseIcon({ name, size = 22 }: { name: string; size?: number }) {
  const I = BASE_ICONS[name] ?? Table2;
  return <I size={size} strokeWidth={1.8} aria-hidden />;
}
export function FieldIcon({ type, size = 14 }: { type: FieldType; size?: number }) {
  const I = FIELD_ICONS[type] ?? Type;
  return <I size={size} strokeWidth={2} aria-hidden />;
}
