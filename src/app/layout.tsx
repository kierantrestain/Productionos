import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "Bang On OS", template: "%s · Bang On OS" },
  description: "Bang On OS — build the systems your business runs on: bases, views, automations and apps.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#141412" }, { color: "#f6f5f3" }] };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const c = (await cookies()).get("theme")?.value;
  const mode = c === "light" || c === "dark" ? c : "system";
  return <html lang="en-GB" data-theme={mode === "system" ? undefined : mode}><body><Providers initialMode={mode}>{children}</Providers></body></html>;
}
