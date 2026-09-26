package unified

import "context"

// Acceptance is append-only in its owning writer. Its succeeded receipt and
// paired audit bind the exact frozen version/scope revision and actor. This is
// historical existence proof, not permission to ignore a conflicting live ID.
func acceptanceHistoryProof(ctx context.Context, q querier, schema string, id, version, scope, reviewedRevision int64, actor string) (bool, error) {
	ready, e := hasTables(ctx, q, schema, "product_command_receipts", "product_activity_logs")
	if e != nil || !ready {
		return false, e
	}
	rows, e := q.QueryContext(ctx, `SELECT 1 FROM `+qualified(schema, "product_command_receipts")+` r JOIN `+qualified(schema, "product_activity_logs")+` a ON BINARY a.product_code=BINARY r.product_code AND BINARY a.actor_uid=BINARY r.actor_uid AND BINARY a.request_id=BINARY r.idempotency_key WHERE r.action='product_versions:accept' AND r.status='succeeded' AND r.request_hash REGEXP '^[0-9a-f]{64}$' AND r.actor_uid=? AND JSON_EXTRACT(r.result_json,'$.acceptance_id')=? AND JSON_EXTRACT(r.result_json,'$.version_id')=? AND JSON_EXTRACT(r.result_json,'$.scope_revision')=? AND JSON_EXTRACT(r.result_json,'$.revision')=? AND JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.accepted_by'))=r.actor_uid AND JSON_UNQUOTE(JSON_EXTRACT(r.result_json,'$.product_code'))=r.product_code AND a.object_type='version' AND a.action='accept' AND a.object_id=? AND a.revision=? AND a.changes=r.result_json LIMIT 1`, actor, id, version, scope, reviewedRevision+1, stringID(version), reviewedRevision+1)
	if e != nil {
		return false, e
	}
	defer rows.Close()
	return rows.Next(), rows.Err()
}
