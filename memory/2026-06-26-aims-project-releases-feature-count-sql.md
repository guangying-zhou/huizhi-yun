# AIMS project releases feature count SQL error

Date: 2026-06-26
Status: done

## Symptom

The AIMS project release page `GET /aims/api/v1/projects/33/releases` returned 502 in the browser. The UI toast showed:

`Error 1054 (42S22): Unknown column 'features.feature_count' in 'field list'`

## Root Cause

The AIMS Nuxt app proxies `/api/v1/**` business requests to tenant-runtime/data-runtime. The failing SQL is in `data-runtime/internal/apps/aims/product_versions.go`.

`listProjectReleases` selected:

- `COALESCE(features.feature_count, 0) AS feature_count`
- `COALESCE(features.delivered_feature_count, 0) AS delivered_feature_count`

but the query did not define a `features` derived table or join. MySQL therefore raised error 1054 for `features.feature_count`.

This was a query construction omission, not a missing database migration. The `product_version_features` table exists in the AIMS schema, and other version queries already join the same aggregate.

## Fix

- Added the missing `LEFT JOIN (...) features ON features.version_id = pv.id` aggregate to the project releases list query.
- Extracted the query into `projectReleasesListQuery` so the critical SQL shape can be regression-tested.
- Added a regression test that asserts the query includes the feature aggregate and the WHERE clause appears after the JOIN.

## Evidence

Validation commands:

- `go test ./internal/apps/aims`: pass.
- `go test ./...`: pass.

## Regression Test

`data-runtime/internal/apps/aims/product_versions_test.go`

`TestProjectReleasesListQueryIncludesFeatureAggregate`
