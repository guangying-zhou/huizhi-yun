---
name: nuxt-ui
description: "Use for non-trivial @nuxt/ui v4 work in this Nuxt workspace: adding or refactoring components, forms, tables, modals, navigation, dashboards, theme tokens, or when a Nuxt UI component API is uncertain. Do not trigger for simple text, spacing, class, or one-line style edits."
---

# Nuxt UI

Project-local guidance for using `@nuxt/ui` v4 in 汇智云 modules.

## When To Use

Use this skill only when the task involves meaningful Nuxt UI decisions:

- Adding or refactoring Nuxt UI components.
- Building forms, tables, modals, slideovers, dropdowns, tabs, navigation, dashboards, or settings pages.
- Customizing theme tokens, semantic colors, variants, or the `ui` prop.
- Fixing errors caused by Nuxt UI component props, slots, events, or generated classes.

Do not use this skill for small text edits, copy changes, icon swaps, single-class tweaks, or backend-only work.

## Workflow

1. Read the local component usage first with `rg` in the target module.
2. Prefer existing project patterns over generic examples.
3. If a component API is uncertain, inspect `.nuxt/ui/<component>.ts` or use Nuxt UI MCP metadata before loading full docs.
4. Use full Nuxt UI docs/examples only when local code and metadata are insufficient.
5. For component discovery, use `references/components.md`; do not pre-load it for tasks where the component is already known.

## Core Rules

- Keep `UApp` in the app shell; do not add duplicate wrappers inside pages.
- Use Nuxt UI semantic colors and tokens: `primary`, `success`, `warning`, `error`, `info`, `gray`, `text-default`, `bg-elevated`, `border-muted`.
- Avoid raw Tailwind palette colors such as `text-gray-500`, `bg-blue-600`, `text-red-500` unless preserving existing code during a tiny local edit.
- Prefer Nuxt UI components for standard controls and surfaces: buttons, forms, inputs, selects, tables, tabs, modals, dropdowns, pagination, alerts, empty states.
- Use generated theme files for slot names when customizing `ui`.
- Prefer `get_component_metadata` over full component docs when only props/slots/events are needed.
- Use lucide/Iconify names in `i-{collection}-{name}` format.

## Project Fit

- Operational modules should feel dense, clear, and work-focused.
- Avoid marketing-style hero layouts for business application screens.
- Match the current module's layout and navigation conventions before introducing new structure.
- After significant UI changes, verify with Browser/Chrome rather than gstack unless the user asks for report-style QA.
