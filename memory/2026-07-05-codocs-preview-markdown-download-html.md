# Codocs preview Markdown download saved Console HTML

## DEBUG REPORT

- **Symptom:** Codocs document preview downloaded `download.html` when downloading a Markdown document. The same document downloaded normally from the editor page.
- **Root cause:** Preview/list pages created an `<a>` element with `href="/api/documents/${uuid}/download"`. When Codocs is served under the Console origin/base path, that root-relative URL targets Console `/api/...` instead of Codocs `/codocs/api/...`; the browser receives the Console Nuxt SPA shell and saves it as `download.html`. The editor page did not reproduce because it exports the current editor Markdown from a local Blob instead of calling the download endpoint.
- **Fix:** Added `app/composables/useDocumentDownload.ts`, which builds download URLs through `useAppUrls().resolveCurrentAppUrl(...)` and encodes the document UUID. Replaced duplicated root-relative download functions in personal, department, project, favorites, and recent document pages with the app-aware helper.
- **Evidence:** `/Users/gavin/Downloads/download.html` was the Console Nuxt shell (`appCode:"console"`). `node --test test/documentDownloadUrl.test.ts` passed. Targeted ESLint on modified files passed.
- **Regression test:** `codocs/test/documentDownloadUrl.test.ts` verifies the helper uses `resolveCurrentAppUrl` and preview/list pages no longer hard-code root-relative document download hrefs.
- **Related:** File cabinet direct downloads still contain root-relative `/api/cabinet/...` links; they were outside this Markdown document bug but may need the same app-aware treatment if cabinet downloads are reported under base-path deployment.
- **Status:** DONE_WITH_CONCERNS. Full `pnpm typecheck` still fails on pre-existing Milkdown/@vueuse missing type declarations and implicit `any` errors outside the changed files.
