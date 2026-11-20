/**
 * The one Bang On OS theme: Astryx neutral + blue action accent and a calm light working surface.
 * Every screen (workspace, bases, builder, published apps, Production Suite) reads these tokens.
 * Tuples are [light, dark].
 */
import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

export const bangOnTheme = defineTheme({
  name: "bang-on",
  extends: neutralTheme,
  tokens: {
    "--color-accent": ["#1f63e8", "#4c8dff"],
    "--color-background-body": ["#f6f7f9", "#0f1115"],
  },
});
