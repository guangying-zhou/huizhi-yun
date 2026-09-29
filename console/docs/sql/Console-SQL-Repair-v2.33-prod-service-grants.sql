-- Company-summary and six legacy Codocs OSS rows use the same reviewed
-- plan/reviewHash and drift checks. OSS JSON retains source, integrationCodes,
-- usageTypes and every other prior field; the planner fills only missing binds.
-- name: revoke
UPDATE service_client_grants SET status='revoked',updated_at=UTC_TIMESTAMP()
WHERE id=? AND status='active'
-- name: bind
UPDATE service_client_grants SET scope_json=CAST(? AS JSON),updated_at=UTC_TIMESTAMP()
WHERE id=? AND status='active'
