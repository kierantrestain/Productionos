"use client";
import { createContext, useContext } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type Mode = "system" | "light" | "dark";
export const ThemeModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({ mode: "system", setMode: () => {} });
export const useThemeMode = () => useContext(ThemeModeContext);

const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Mode, string> = { system: "Theme: match system", light: "Theme: light", dark: "Theme: dark" };

/** Cycles system → light → dark. Remembered per browser (cookie, so the server renders the right theme with no flash). */
export function ThemeToggle({ className = "ui-theme-btn", showLabel = false }: { className?: string; showLabel?: boolean }) {
  const { mode, setMode } = useThemeMode();
  const I = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  return (
    <button type="button" className={className} aria-label={`${LABEL[mode]}. Switch to ${NEXT[mode]}.`} title={LABEL[mode]} onClick={() => setMode(NEXT[mode])}>
      <I size={16} />{showLabel && <span>{mode === "system" ? "System" : mode === "light" ? "Light" : "Dark"}</span>}
    </button>
  );
}
