package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/url"
	"os"
	"strings"
	"testing"
)

// Reuses the actual frozen submission fixture from the feedback integration test.
func testFeedbackProgressProjection(t *testing.T, db *sql.DB, adapter *Adapter, requestID string, actorQuery url.Values) {
	t.Helper()
	migration, err := os.ReadFile("../../../../altoc/docs/migrations/048_product_feedback_progress_projection.sql")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := db.Exec(string(migration)); err != nil {
			t.Fatal(err)
		}
	}
	raw, _ := json.Marshal(feedbackProgressFixture())
	input, err := parseProductFeedbackProgress(raw)
	if err != nil {
		t.Fatal(err)
	}
	input.RequestBizID = requestID
	apply := func(commit bool) (bool, error) {
		tx, err := db.BeginTx(context.Background(), nil)
		if err != nil {
			return false, err
		}
		defer tx.Rollback()
		changed, err := applyProductFeedbackProgressTx(context.Background(), tx, input)
		if err != nil {
			return changed, err
		}
		if commit {
			err = tx.Commit()
		}
		return changed, err
	}
	if changed, err := apply(false); err != nil || !changed {
		t.Fatalf("rollback write: %v", err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_feedback_progress_projection`).Scan(&count); err != nil || count != 0 {
		t.Fatal("progress escaped caller transaction")
	}
	if changed, err := apply(true); err != nil || !changed {
		t.Fatalf("first progress: %v", err)
	}
	if changed, err := apply(true); err != nil || changed {
		t.Fatalf("replay: %v", err)
	}
	input.SourceRevision = 6
	input.CanonicalDecisionStatus = "evaluating"
	if changed, err := apply(true); err != nil || changed {
		t.Fatalf("old progress: %v", err)
	}
	input.SourceRevision = 7
	if _, err := apply(true); err == nil {
		t.Fatal("same-revision conflict accepted")
	}
	input.SourceRevision = 8
	input.Versions = []ProductFeedbackVersionProgress{}
	if changed, err := apply(true); err != nil || !changed {
		t.Fatalf("clear version evidence: %v", err)
	}
	input.ProductCode = "P2"
	input.SourceRevision = 9
	if _, err := apply(true); err == nil {
		t.Fatal("wrong source product accepted")
	}
	var revision uint64
	var stored []byte
	if err := db.QueryRow(`SELECT source_revision,snapshot_json FROM product_feedback_progress_projection WHERE ticket_id=1`).Scan(&revision, &stored); err != nil {
		t.Fatal(err)
	}
	snapshot, err := parseProductFeedbackProgress(stored)
	if err != nil || revision != 8 || len(snapshot.Versions) != 0 || snapshot.CanonicalDecisionStatus != "evaluating" {
		t.Fatalf("stored progress: %#v %v", snapshot, err)
	}
	// Existing v1 projection remains untouched by the new progress transaction.
	if err := db.QueryRow(`SELECT source_revision FROM product_feedback_status_projection WHERE ticket_id=1`).Scan(&revision); err != nil || revision != 6 {
		t.Fatal("progress changed legacy decision projection")
	}
	input.ProductCode = "P1"
	raw, err = json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var command map[string]any
	if err := json.Unmarshal(raw, &command); err != nil {
		t.Fatal(err)
	}
	hash, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	receipt := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: "TENANT-TRUSTED", DeploymentCode: "DEPLOYMENT-TRUSTED", SourceApp: "aims", ServiceClientID: "aims.runtime", RequestID: "progress-request"}, SourceDeploymentCode: "AIMS", TargetDeploymentCode: "DEPLOYMENT-TRUSTED", TargetApp: "altoc", OperationID: "123e4567-e89b-42d3-a456-426614174085", OperationCode: productFeedbackProgressOperation, RequiredCapability: productFeedbackProgressCapability, IdempotencyKey: "feedback-progress:9", CommandSchemaVersion: productFeedbackProgressSchema, CommandSHA256: hash, Command: raw}
	if _, err := db.Exec(`CREATE TRIGGER fail_progress BEFORE UPDATE ON product_feedback_progress_projection FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected progress failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err := receiveProductFeedbackProgress(context.Background(), db, receipt); err == nil {
		t.Fatal("projection failure ignored")
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM service_command_receipt WHERE operation_code=?`, productFeedbackProgressOperation).Scan(&count); err != nil || count != 0 {
		t.Fatal("failed progress left receipt")
	}
	if _, err := db.Exec(`DROP TRIGGER fail_progress`); err != nil {
		t.Fatal(err)
	}
	received, err := receiveProductFeedbackProgress(context.Background(), db, receipt)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := receiveProductFeedbackProgress(context.Background(), db, receipt)
	if err != nil || !repeated.Existing || repeated.ReceiptID != received.ReceiptID {
		t.Fatalf("receipt replay: %#v %v", repeated, err)
	}
	if _, err := db.Exec(`UPDATE service_ticket SET deleted_at=NOW() WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	if _, err := receiveProductFeedbackProgress(context.Background(), db, receipt); err == nil {
		t.Fatal("deleted source replay accepted")
	}
	if _, err := db.Exec(`UPDATE service_ticket SET deleted_at=NULL WHERE id=1`); err != nil {
		t.Fatal(err)
	}

	query := url.Values{"scope": {productFeedbackProgressCapability}, "runtime_source_app": {"altoc"}, "tenant": {"TENANT-TRUSTED"}, "deployment": {"DEPLOYMENT-TRUSTED"}}
	for key, value := range map[string]string{
		integrationoperation.TrustedServiceCommandTenantKey:           "TENANT-TRUSTED",
		integrationoperation.TrustedServiceCommandSourceDeploymentKey: "AIMS",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "DEPLOYMENT-TRUSTED",
		integrationoperation.TrustedServiceCommandSourceAppKey:        "aims",
		integrationoperation.TrustedServiceCommandTargetAppKey:        "altoc",
		integrationoperation.TrustedServiceCommandSourceClientKey:     "aims.runtime",
		integrationoperation.TrustedRequestIDKey:                      "progress-route",
	} {
		query.Set(key, value)
	}
	body := map[string]any{"serviceCommand": map[string]any{"operationId": receipt.OperationID, "operationCode": receipt.OperationCode, "targetApp": "altoc", "requiredCapability": receipt.RequiredCapability, "idempotencyKey": receipt.IdempotencyKey, "commandSchemaVersion": receipt.CommandSchemaVersion, "commandSha256": receipt.CommandSHA256, "command": command}}
	for key, values := range query {
		if strings.HasPrefix(key, "hzy_runtime_") {
			body[key] = values[0]
		}
	}
	response, _, err := adapter.HandleRuntime(context.Background(), "POST", "/v1/altoc/internal/product-feedback:progress", query, body)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	var envelope struct {
		Data struct {
			ReceiptID  string `json:"receiptId"`
			Idempotent bool   `json:"idempotent"`
		} `json:"data"`
	}
	if err := json.Unmarshal(encoded, &envelope); err != nil || envelope.Data.ReceiptID != received.ReceiptID || !envelope.Data.Idempotent {
		t.Fatalf("runtime receipt: %s %v", encoded, err)
	}
	for key, value := range map[string]string{"scope": productFeedbackStatusCapability, "tenant": "OTHER", "deployment": "OTHER", "runtime_source_app": "aims"} {
		original := query.Get(key)
		query.Set(key, value)
		if _, _, err := adapter.HandleRuntime(context.Background(), "POST", "/v1/altoc/internal/product-feedback:progress", query, body); err == nil {
			t.Fatalf("wrong %s accepted", key)
		}
		query.Set(key, original)
	}

	view, err := adapter.readServiceTicketProductFeedback(context.Background(), "ST-1", actorQuery)
	if err != nil || view["canonicalDecisionStatus"] != "evaluating" || view["sourceRevision"] != uint64(9) || view["progressPending"] != false {
		t.Fatalf("progress read: %#v %v", view, err)
	}
	if _, err := db.Exec(`UPDATE product_feedback_status_projection SET source_revision=10 WHERE ticket_id=1`); err != nil {
		t.Fatal(err)
	}
	stale, err := adapter.readServiceTicketProductFeedback(context.Background(), "ST-1", actorQuery)
	if err != nil || stale["progressPending"] != true || stale["versions"] != nil || stale["canonicalDecisionStatus"] != nil {
		t.Fatalf("stale progress presented as current: %#v %v", stale, err)
	}
	if _, err := db.Exec(`UPDATE product_feedback_status_projection SET source_revision=6 WHERE ticket_id=1`); err != nil {
		t.Fatal(err)
	}

}
