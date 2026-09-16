# Codocs shared document direct page leave did not save

- Date: 2026-07-03
- Area: `codocs`
- Status: fixed with targeted validation

## Symptom

Editing a shared/collaborative document and leaving with the document page `X` button saved the modified content. Editing the same document and leaving the page directly, such as browser navigation or tab close, did not persist the latest content.

## Root Cause

The direct page leave path used `flushDocumentOnExit()` in `app/pages/documents/[uuid].vue`. That path preferred `navigator.sendBeacon(url, blob)`.

`navigator.sendBeacon()` always sends a `POST` request, but the Codocs document update endpoint is `PUT /api/documents/:uuid` (`server/api/documents/[uuid]/index.put.ts`). Because the beacon request did not use `PUT`, it did not hit the update API. The explicit page `X` path used the normal awaited save flow, which sends `PUT`, so it saved correctly.

## Fix

Changed the direct page leave flush to use:

```ts
fetch(url, {
  method: 'PUT',
  body,
  headers: { 'Content-Type': 'application/json' },
  credentials: 'same-origin',
  keepalive: true
})
```

This preserves the unload-safe intent while matching the existing update endpoint method.

## Validation

From `/Users/gavin/Dev/huizhi-yun/codocs`:

- `node --test test/documentPreviewFlush.test.ts`
- `pnpm exec eslint 'app/pages/documents/[uuid].vue' test/documentPreviewFlush.test.ts`
- `git diff --check -- 'app/pages/documents/[uuid].vue' test/documentPreviewFlush.test.ts`

All passed.
