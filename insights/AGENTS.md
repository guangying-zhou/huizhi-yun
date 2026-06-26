# Repository Guidelines

## Project Structure & Module Organization

- `app/`: Nuxt app code (Vue components, pages, layouts, middleware, composables, stores, assets).
- `server/`: Nitro server code.
  - `server/api/`: file-based API routes (e.g., `server/api/auth/logout.get.ts`).
  - `server/database/`: Drizzle migrations and DB helpers.
  - `server/services/`, `server/utils/`, `server/validations/`: backend modules.
- `workers/`: Cloudflare Worker proxy scripts and per-brand Wrangler configs.
- `tests/`: Vitest unit tests (TypeScript).
- `public/`: static assets served as-is.
- `docs/`: operational docs (Caddy dev proxy, multi-tenant auth, custom domains, worker routing).

## Build, Test, and Development Commands

- `pnpm install`: install dependencies (repo uses `pnpm`).
- `pnpm dev`: run Nuxt dev server using `.env.dev`.
- `pnpm build:cf` / `pnpm build:i` / `pnpm build:s`: production builds for different env/brands.
- `pnpm preview`: locally preview a production build (`.env.prod`).
- `pnpm lint`: run ESLint (Nuxt ESLint config).
- `pnpm typecheck`: run `nuxt typecheck`.
- `pnpm test`: run Vitest once (`vitest --run`).
- `pnpm check:env`: validate env vars against `.env.example`.
- DB (Drizzle): `pnpm db:generate`, `pnpm db:deploy`, `pnpm db:studio`.
- Workers: `pnpm dev:worker:repoinsight` / `pnpm deploy:workers` (Wrangler configs in `workers/`).

## Coding Style & Naming Conventions

- Indentation: 2 spaces; LF line endings (see `.editorconfig`).
- Prefer TypeScript for new code; keep modules ESM.
- Vue components: `PascalCase.vue`; composables: `useThing.ts`.
- API routes: `server/api/<path>.<method>.(ts|js)` where `<method>` is `get|post|put|...`.

## Testing Guidelines

- Framework: Vitest. Put new tests under `tests/**/*.test.ts`.
- Prefer small, deterministic tests for utilities and routing logic; add/adjust tests when modifying behavior.

## Commit & Pull Request Guidelines

- Commits: short, imperative subject lines (common verbs: “Add”, “Refactor”, “Fix”, “Update”, “Improve”); `fix:` prefix is acceptable.
- PRs: include a clear description, testing notes (e.g., `pnpm lint && pnpm test`), and screenshots for UI changes. Call out any env var or deploy/worker changes and update `docs/` when behavior changes.

## Security & Configuration Tips

- Start from `.env.example`; keep secrets out of git; validate locally with `pnpm check:env`.

## Agent-Specific Notes

- Host/multi-tenant routing changes should usually touch `server/utils/hostClassifier.ts` and add/update `tests/hostClassifier.test.ts`.
