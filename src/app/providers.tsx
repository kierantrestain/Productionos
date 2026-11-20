"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Theme } from "@astryxdesign/core/theme";
import { LinkProvider } from "@astryxdesign/core/Link";
import { bangOnTheme } from "@/themes/bangon";
import { DialogHost } from "@/components/ui/dialogs";
import { ThemeModeContext, type Mode } from "@/components/ui/theme-toggle";

export function Providers({ children, initialMode = "system" }: { children: React.ReactNode; initialMode?: Mode }) {
  const [mode, set] = useState<Mode>(initialMode);
  const setMode = useCallback((m: Mode) => { set(m); document.cookie = `theme=${m}; path=/; max-age=31536000; samesite=lax`; }, []);
  return (
    <ThemeModeContext.Provider value={{ mode, setMode }}>
      <Theme theme={bangOnTheme} mode={mode}><LinkProvider component={Link}>{children}<DialogHost /></LinkProvider></Theme>
    </ThemeModeContext.Provider>
  );
}
