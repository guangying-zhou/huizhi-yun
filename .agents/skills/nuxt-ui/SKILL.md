---
name: nuxt-ui
description: "Use for substantial @nuxt/ui v4 component or theme work, or uncertain component APIs. Skip simple copy and class edits."
---

# Nuxt UI

Project-local guidance for using `@nuxt/ui` v4 in 汇智云 modules. This skill can be used directly without loading another skill or requiring a separate design approval; the root [CLAUDE.md](../../../CLAUDE.md) owns project constraints and execution/validation requirements.

## When To Use

Use this skill only when the task involves meaningful Nuxt UI decisions:

- Adding or refactoring Nuxt UI components.
- Building forms, tables, modals, slideovers, dropdowns, tabs, navigation, dashboards, or settings pages.
- Customizing theme tokens, semantic colors, variants, or the `ui` prop.
- Fixing errors caused by Nuxt UI component props, slots, events, or generated classes.

Do not use this skill for small text edits, copy changes, icon swaps, single-class tweaks, or backend-only work.

## Reference Selection

- Reuse known project patterns; inspect local component usage when context is missing.
- For uncertain APIs, choose available generated `.nuxt/ui/<component>.ts` types, Nuxt UI MCP metadata, or official documentation according to the question. These are alternatives, not mandatory sequential steps.
- Use `references/components.md` for component discovery; do not pre-load it when the component is already known.

## Core Rules

- Keep `UApp` in the app shell; do not add duplicate wrappers inside pages.
- Use Nuxt UI semantic colors and tokens: `primary`, `secondary`, `success`, `warning`, `error`, `info`, `neutral`. Styling tokens include `text-default`, `bg-elevated`, and `border-muted`. The underlying palette may be named `gray`; the v4 component color is `neutral`.
- Avoid raw Tailwind palette colors such as `text-gray-500`, `bg-blue-600`, `text-red-500` unless preserving existing code during a tiny local edit.
- Prefer Nuxt UI components for standard controls and surfaces: buttons, forms, inputs, selects, tables, tabs, modals, dropdowns, pagination, alerts, empty states.
- Verify slot names when customizing `ui`, using the relevant generated theme types or component documentation. Missing MCP metadata is not a blocker.
- Use lucide/Iconify names in `i-{collection}-{name}` format.

## Project Fit

- Operational modules should feel dense, clear, and work-focused.
- Avoid marketing-style hero layouts for business application screens.
- Match the current module's layout and navigation conventions before introducing new structure.
- Choose browser interactions and viewport coverage under the root Frontend requirements. Use an available suitable browser tool; ordinary verification does not require a full QA workflow or another tool-choice approval.
- References are general API examples, not instructions to replace project wrappers. In Foundation-enabled modules use `useConfirm()` for destructive confirmations; do not create a duplicate ConfirmModal from an example. Honor documented module migration boundaries.
