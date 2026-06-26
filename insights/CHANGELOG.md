# Changelog

All notable changes to this project will be documented in this file.

The format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and semantic versioning (pre-1.0 phase: minor versions represent milestones, patch for fixes).

## [0.5.0] - 2025-09-29 (First Milestone)

### Added
- feat(media): optimize image metadata retrieval using ListObjectsV2; fallback to HEAD; fix zero size issue
- feat(content-dashboard): tri-state website status (draft-only / published / unpublished-changes) & unified activity labels
- feat(editor): add leave confirmation when draft is saved but not published
- feat(editor): prompt on breadcrumb navigation when unsaved changes exist

### Changed
- refactor: unify site config and tenant navigation
- refactor: unify domain list handling and remove r2PublicUrl
- refactor: header/layout refinements (Preview/Header CSS variables, theme scoping, layout spacing)
- refactor: membership admin role logic (with revert + refinement cycle)
- chore: simplify to system-only color mode, remove persistence + neutralize legacy plugins
- chore(env): standardize env vars; remove deprecated PLATFORM_ROOT_DOMAINS / NUXT_PUBLIC_PLATFORM_URL / NUXT_PUBLIC_R2_PUBLIC_URL

### Fixed
- fix(editor): block navigation until user confirms unsaved changes modal
- fix(auth): keep tenant subdomain on login/logout
- fix(tenant): correct dev subdomain resolution & headers; update business URL logic; menu trigger label/logo
- fix(auth/menu): preserve OWNER/ADMIN role on auto-join for custom domains
- fix(auth): custom-domain OAuth redirect role-aware & relay improvements
- fix(worker): bypass non-platform domains to avoid recursion
- fix: hydrate businesses with active custom domains
- fix: media file size zero issue (resolved via metadata strategy)

### Removed
- remove legacy color mode server files
- remove obsolete r2PublicUrl references

### Documentation
- docs: env cleanup + storage URL standardization
- docs: add progress log (Plan A domain + env simplification)

### Highlights
- Multi-tenant domain & auth unification (Plan A)
- Environment simplification & validation script
- Stable tri-state publication model mapped to R2 directory presence
- Accurate media metrics with efficient listing
- Editor UX safeguards (unsaved changes + unpublished draft cues)

### Backward Incompatibilities
- Removed deprecated env variables; `NUXT_PUBLIC_STORAGE_URL` must be set.
- Publication state expanded from 2 → 3 states; dependent automation must adapt.

### Next
- Custom domain login E2E validation
- Media delete / thumbnails / manifest caching
- Content version history & diff
- Initial commerce (catalog/cart/order) schema groundwork

---

[0.5.0]: https://github.com/GuangyingZhou/repoinsight/releases/tag/v0.5.0
