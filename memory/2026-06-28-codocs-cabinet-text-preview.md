# Codocs cabinet text preview mojibake

Date: 2026-06-28

## Symptom

Aims project-document text preview displayed Chinese correctly after server-side decoding, but Codocs personal/department file cabinet text preview still showed mojibake.

## Root Cause

Aims uses the project-cabinet service preview path, which had been changed to return decoded text content. Codocs personal and department file cabinets still used their older `/api/cabinet/{uuid}/preview` and `/api/dept-cabinet/{uuid}/preview` paths. For text/code extensions those APIs returned an OSS signed URL with `preview_type=direct`, and the frontend rendered it in an iframe. Browser charset detection on the object storage response caused Chinese text to be decoded incorrectly.

## Fix

- Added shared `server/utils/cabinetTextPreview.ts` to read OSS bytes and decode text using `textPreviewEncoding`.
- Changed personal cabinet preview to return `preview_type=text`, `content`, `encoding`, and `truncated` for TXT/CSV/JSON/XML/HTML/CSS/source text.
- Changed department cabinet preview the same way.
- Changed project-cabinet service preview to reuse the shared cabinet text preview helper.
- Updated personal and department cabinet pages to render text previews with `<pre>` instead of iframe.
- Updated Codocs API spec for file cabinet preview behavior.

## Validation

- `codocs`: `node --test --experimental-strip-types "test/textPreviewEncoding.test.ts"`
- `codocs`: `pnpm lint`
- `codocs`: filtered `pnpm typecheck` output showed no cabinet preview/text encoding related errors
- `codocs`: `git diff --check`
- root: `git diff --check`

## Status

DONE_WITH_CONCERNS. The production UI should now use decoded text content once Codocs is redeployed. Browser validation against the logged-in production file was not run from this session.
