package productcenter

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func requireSameJSONValue(t *testing.T, left, right []byte) {
	t.Helper()
	var leftValue, rightValue any
	if err := json.Unmarshal(left, &leftValue); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(right, &rightValue); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(leftValue, rightValue) {
		t.Fatalf("JSON results differ: left=%s right=%s", left, right)
	}
}

// This models a client losing the first HTTP response after the owning
// transaction committed: the second call has only the original command
// identity and payload, and must recover the persisted result.
func TestMySQLVersionCreateReplaysCommittedResultAfterResponseLoss(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-RETRY")
	ctx := context.Background()
	identity := CommandIdentity{ProductCode: "P-RETRY", ActorUID: "pm", Action: "product_versions:create", IdempotencyKey: "version-create-response-lost"}
	input := ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v1.0", Name: "首个版本", PlanningMode: "simple"}
	permit := func() AuthorizationPermit {
		value := workspacePermit(t, db, "P-RETRY", "pm", "edit")
		value.Resource = "product_versions"
		return value
	}

	first, err := CreateProductCenterVersion(ctx, db, identity, permit(), input)
	if err != nil {
		t.Fatal(err)
	}
	// Deliberately discard first as an HTTP layer would when its response is
	// lost, then rebuild authorization facts and retry the same command.
	replay, err := CreateProductCenterVersion(ctx, db, identity, permit(), input)
	if err != nil {
		t.Fatal(err)
	}
	if first.Replayed || !replay.Replayed || first.ReceiptID != replay.ReceiptID {
		t.Fatalf("committed result was not replayed: first=%+v replay=%+v", first, replay)
	}
	requireSameJSONValue(t, first.Value, replay.Value)
	var versions, receipts int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_versions WHERE product_code='P-RETRY'`).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts WHERE product_code='P-RETRY' AND action='product_versions:create' AND actor_uid='pm' AND idempotency_key='version-create-response-lost'`).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if versions != 1 || receipts != 1 {
		t.Fatalf("retry duplicated durable state: versions=%d receipts=%d", versions, receipts)
	}

	different := input
	different.Name = "同键篡改版本"
	if _, err := CreateProductCenterVersion(ctx, db, identity, permit(), different); err == nil {
		t.Fatal("same key with a different payload was accepted")
	} else {
		requireProductRule(t, err, "idempotency_payload_mismatch")
	}
	var stored json.RawMessage
	if err := db.QueryRow(`SELECT result_json FROM product_command_receipts WHERE product_code='P-RETRY' AND action='product_versions:create' AND actor_uid='pm' AND idempotency_key='version-create-response-lost'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	requireSameJSONValue(t, stored, first.Value)
}
