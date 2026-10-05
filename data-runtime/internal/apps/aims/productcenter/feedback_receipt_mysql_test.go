package productcenter

import (
	"context"
	"encoding/json"
	"os"
	"regexp"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestMySQLFeedbackReceiptReplay(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-RECEIPT")
	schema, err := os.ReadFile("../../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	ddl := regexp.MustCompile(`(?s)CREATE TABLE IF NOT EXISTS service_command_receipt \(.*?ENGINE=InnoDB.*?;`).FindString(string(schema))
	if ddl == "" {
		t.Fatal("missing receipt schema")
	}
	if _, err = db.Exec(ddl); err != nil {
		t.Fatal(err)
	}
	command := map[string]any{"actorUid": "pm", "productCode": "P-RECEIPT", "ticketCode": "ST-1", "requestBizId": "00000000-0000-4000-8000-000000000001", "title": "反馈", "description": "说明", "action": "create"}
	payload, _ := json.Marshal(command)
	hash, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	input := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: "TENANT", DeploymentCode: "AIMS", SourceApp: "altoc", ServiceClientID: "altoc.runtime", RequestID: "request"}, SourceDeploymentCode: "ALTOC", TargetDeploymentCode: "AIMS", TargetApp: "aims", OperationID: "00000000-0000-4000-8000-000000000002", OperationCode: "altoc.aims.product-request.create-from-feedback.v1", RequiredCapability: "aims:product-request:create-from-feedback", IdempotencyKey: "feedback:1", CommandSchemaVersion: "product-feedback-create.v1", CommandSHA256: hash, Command: payload, OriginalActorUID: "pm"}
	apply := func() (integrationoperation.ReceiptExecutionResult, error) {
		permit := workspacePermit(t, db, "P-RECEIPT", "pm", "create")
		permit.Resource = "product_requests"
		return ReceiveFeedbackWithReceipt(context.Background(), db, input, permit)
	}
	if _, err = db.Exec(`CREATE TRIGGER fail_feedback_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = apply(); err == nil {
		t.Fatal("audit failure ignored")
	}
	for _, table := range []string{"product_requests", "product_request_sources", "product_feedback_bindings", "service_command_receipt"} {
		var n int
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Fatalf("atomic rollback %s %d %v", table, n, err)
		}
	}
	if _, err = db.Exec(`DROP TRIGGER fail_feedback_audit`); err != nil {
		t.Fatal(err)
	}
	first, err := apply()
	if err != nil {
		t.Fatal(err)
	}
	replay, err := apply()
	if err != nil || !replay.Existing || first.ReceiptID != replay.ReceiptID {
		t.Fatalf("receipt replay %+v %v", replay, err)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM service_command_receipt`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("receipt count %d %v", count, err)
	}
	command["title"] = "changed command"
	input.Command, _ = json.Marshal(command)
	input.CommandSHA256, err = integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = apply(); err == nil {
		t.Fatal("same identity accepted different command")
	}
	input.Command = payload
	input.CommandSHA256 = hash
	if _, err = db.Exec(`UPDATE product_requests SET title='产品经理修订' WHERE biz_id=?`, command["requestBizId"]); err != nil {
		t.Fatal(err)
	}
	if _, err = apply(); err != nil {
		t.Fatal(err)
	}
	var title string
	if err = db.QueryRow(`SELECT title FROM product_requests WHERE biz_id=?`, command["requestBizId"]).Scan(&title); err != nil || title != "产品经理修订" {
		t.Fatalf("replay overwrote product edits: %s %v", title, err)
	}
	if _, err = db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-RECEIPT','pm','manager','active',UTC_TIMESTAMP(3)-INTERVAL 1 DAY,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}
	stale := workspacePermit(t, db, "P-RECEIPT", "pm", "create")
	stale.Resource = "product_requests"
	if _, err = db.Exec(`UPDATE product_members SET status='inactive' WHERE product_code='P-RECEIPT' AND uid='pm'`); err != nil {
		t.Fatal(err)
	}
	if _, err = ReceiveFeedbackWithReceipt(context.Background(), db, input, stale); err == nil {
		t.Fatal("revoked actor replayed with old permit")
	}
	input.OriginalActorUID = "other"
	if _, err = apply(); err == nil {
		t.Fatal("accepted different original actor")
	}
}
