/**
 * The two-state theme toggle's decisions (plan #266, D1/D2/D10), kept pure so they can be tested.
 *
 * Storage is Starlight's own (0.42.8): key `starlight-theme`; only "light" or "dark" is a stored theme, and anything
 * else (including the "" Starlight writes for "auto") means "follow the system". A click flips between those two
 * modes. The same rule is inlined in ThemeProvider.astro, which must run before first paint and so cannot import this.
 * Behaviour reference: GMT's apps/dox/src/components/ThemeSelect.astro at b15b3899.
 */

export type Theme = "light" | "dark";

/** What `nextStored` returns: a theme to store, or "" for "store nothing" (follow the system). */
export type Stored = Theme | "";

export const STORAGE_KEY = "starlight-theme";

const isTheme = (value: string | null): value is Theme =>
  value === "light" || value === "dark";

/** The value to store after a click: the opposite of the system while following it, nothing while a theme is set. */
export function nextStored(stored: string | null, system: Theme): Stored {
  if (isTheme(stored)) return "";
  return system === "light" ? "dark" : "light";
}

/** The theme to put on `<html>`: the stored one, or the system's when nothing (valid) is stored. */
export function resolve(stored: string | null, system: Theme): Theme {
  return isTheme(stored) ? stored : system;
}
