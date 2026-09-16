# DingTalk graduation date normalization

## Status

Fixed in the working tree on 2026-09-04.

## Symptom

The People DingTalk HR-source job reported `graduationDate` coverage of 76 observed,
25 provided, and 51 invalid, while spot checks in DingTalk showed populated values.
Other private profile fields were classified normally.

## Root cause

The new Smart HR roster adapter treated dates as valid only when the API value was
a numeric millisecond timestamp or started with strict `YYYY-MM-DD`. DingTalk's
roster field contract returns `fieldValueList.value` as a string, and graduation
time can carry text formatting or month precision. Values such as `2012/6/30`,
`2012年6月30日`, and `2012年6月` therefore reached the coverage counter as
`invalid` even though they were valid HR facts.

This was introduced by the current uncommitted Smart HR private-facts work, not by
an existing repository commit. The same precision mismatch also existed in the
People Runtime validator and the employee profile date input, so fixing only the
Connector would still have discarded or hidden month-precision values downstream.

## Fix

- Normalize slash, dot, Chinese年月日, and ISO-style roster dates to ISO text.
- Accept `YYYY-MM` only for graduation time; birth date still requires a real day.
- Preserve month precision instead of inventing a first or last day.
- Allow `graduation_date` to be `YYYY-MM` or `YYYY-MM-DD` in People Runtime.
- Render month-precision graduation values with a month input in the employee UI.
- Document the cross-runtime date precision contract.

## Regression coverage

- The Connector test was first run red because the old function had no precision
  parameter and could not accept the new cases.
- Provider tests cover slash dates, Chinese dates, graduation months, invalid
  calendar dates, and rejection of month-only birth dates.
- The full DingTalk provider flow now uses a Chinese month value and asserts the
  normalized `2012-06` output.
- People Runtime tests assert that graduation months are stored while birth months
  remain invalid, including a mocked DingTalk private-fact upsert.
- People UI tests assert the month/date input selection.

## Validation

- `notification-runtime`: `go test ./...`
- `data-runtime`: `go test ./...`
- `people`: `pnpm run lint && pnpm run typecheck && pnpm run test` (111 tests)

All passed. The People validation emitted only the existing Node engine warning:
the repository requests Node 24.18.x while the local shell used Node 25.8.1.

## Release note

Both Connector Runtime and Data Runtime/People must be updated before rerunning the
HR-source sync. Historical job coverage is immutable; a new sync should reclassify
recognized graduation values and populate the private facts.
