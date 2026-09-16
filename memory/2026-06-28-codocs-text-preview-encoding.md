# Codocs project cabinet text preview encoding

Date: 2026-06-28

## Symptom

Aims/Codocs project cabinet text preview still displayed mojibake for Chinese text, while downloading the same TXT file and opening it with desktop software displayed Chinese normally.

## Root Cause

The first preview fix decoded text with runtime `TextDecoder('utf-8')` and only attempted `TextDecoder('gb18030')` when replacement characters appeared. That is not robust enough for production Workers:

- Browser/desktop editors auto-detect GBK/GB18030/UTF-16, but the preview service did not.
- Cloudflare Workers may not provide reliable non-UTF-8 `TextDecoder` support for GB18030/GBK.
- Some mojibake text does not contain `\uFFFD`, so replacement-character-only detection misses it.

The file bytes are valid; only the server-side preview decoding was insufficient.

## Fix

- Added `codocs/server/utils/textPreviewEncoding.ts`.
- Added direct `iconv-lite` dependency for deterministic GB18030/UTF-16 decoding in Worker bundles.
- Project cabinet text preview now decodes from raw OSS bytes through the new utility.
- Added regression tests for UTF-8, GB18030, UTF-8 BOM, and UTF-16LE BOM.

## Validation

- `codocs`: `node --test --experimental-strip-types "test/textPreviewEncoding.test.ts"`
- `codocs`: `pnpm lint`
- `codocs`: filtered `pnpm typecheck` output showed no `textPreviewEncoding`, `preview-url`, `project-cabinet`, or `iconv` errors
- `codocs`: `git diff --check`
- root: `git diff --check`

## Status

DONE_WITH_CONCERNS. The exact production file was not downloaded locally, but byte-level tests cover the likely GB18030/UTF-16 cases and the preview path now uses deterministic decoding instead of relying on runtime `TextDecoder` support.
