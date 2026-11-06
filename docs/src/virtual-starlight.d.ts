/**
 * Ambient types for the `virtual:starlight/*` modules that Header.astro imports. Astro's generated `.astro/types.d.ts` does not
 * declare them for a consuming project, so `astro check` cannot resolve them; the build can (Astro's Vite plugin provides them). Copied from GMT's
 * apps/dox/src/virtual-starlight.d.ts at commit b15b3899, plus `user-config`.
 *
 * Header.astro imports the components by these virtual paths, not from `@astrojs/starlight/components/X.astro`, so it
 * composes this site's overrides (SocialIcons, ThemeSelect, SiteTitle) as Starlight's own Header does.
 */
declare module "virtual:starlight/user-config" {
  const config: import("@astrojs/starlight/types").StarlightConfig;
  export default config;
}
declare module "virtual:starlight/components/LanguageSelect" {
  const LanguageSelect: typeof import("@astrojs/starlight/components/LanguageSelect.astro").default;
  export default LanguageSelect;
}
declare module "virtual:starlight/components/Search" {
  const Search: typeof import("@astrojs/starlight/components/Search.astro").default;
  export default Search;
}
declare module "virtual:starlight/components/SiteTitle" {
  const SiteTitle: typeof import("@astrojs/starlight/components/SiteTitle.astro").default;
  export default SiteTitle;
}
declare module "virtual:starlight/components/SocialIcons" {
  const SocialIcons: typeof import("@astrojs/starlight/components/SocialIcons.astro").default;
  export default SocialIcons;
}
declare module "virtual:starlight/components/ThemeSelect" {
  const ThemeSelect: typeof import("@astrojs/starlight/components/ThemeSelect.astro").default;
  export default ThemeSelect;
}
