"use client";
import Link from "next/link";
import { Theme } from "@astryxdesign/core/theme";
import { LinkProvider } from "@astryxdesign/core/Link";
import { bangOnTheme } from "@/themes/bangon";

export function Providers({ children }: { children: React.ReactNode }) {
  return <Theme theme={bangOnTheme}><LinkProvider component={Link}>{children}</LinkProvider></Theme>;
}
