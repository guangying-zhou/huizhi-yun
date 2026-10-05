package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
	"unsafe"

	_ "github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
)

func TestMySQLProductFeedbackFreezeAtomic(t *testing.T) {
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("dedicated MySQL socket not configured")
	}
	if !strings.HasPrefix(socket, "/tmp/hzy-product-center.") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-test socket")
	}
	admin, err := sql.Open("mysql", "root@unix("+socket+")/?parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("hzy_altoc_feedback_%d", time.Now().UnixNano())
	if _, err := admin.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE " + name)
	db, err := sql.Open("mysql", "root@unix("+socket+")/"+name+"?parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(statement string) {
		t.Helper()
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	// Minimal source fixtures; target operation, audit and new binding use canonical DDL.
	exec(`CREATE TABLE customer(id BIGINT PRIMARY KEY, deleted_at DATETIME NULL)`)
	exec(`CREATE TABLE service_ticket(id BIGINT PRIMARY KEY,code VARCHAR(30),customer_id BIGINT,product_code VARCHAR(64),ticket_type VARCHAR(30),title VARCHAR(200),description TEXT,owner_user_id VARCHAR(50),deleted_at DATETIME NULL)`)
	schema, err := os.ReadFile("../../../../altoc/docs/altoc_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"integration_operation", "integration_operation_attempt", "integration_operation_dead_letter_actionable", "audit_log", "service_ticket_product_feedback", "product_feedback_status_projection", "product_feedback_progress_projection", "service_command_receipt"} {
		expression := regexp.MustCompile(`(?s)CREATE TABLE (?:IF NOT EXISTS )?` + table + ` \(.*?\) ENGINE=.*?;`)
		ddl := expression.FindString(string(schema))
		if ddl == "" {
			t.Fatalf("missing canonical %s", table)
		}
		exec(ddl)
	}
	migration, err := os.ReadFile("../../../../altoc/docs/migrations/046_service_ticket_product_feedback.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(string(migration))
	exec(`INSERT INTO customer VALUES (1,NULL)`)
	exec(`INSERT INTO service_ticket VALUES (1,'ST-1',1,'P1','requirement','Feature','Details','dispatcher-user',NULL)`)
	compatAdapter := &compat.Adapter{}
	field := reflect.ValueOf(compatAdapter).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	adapter := &Adapter{Adapter: compatAdapter}
	body := trustedIntegrationOperationRuntimeBody()
	body["current_user_scopes"] = []string{"altoc:service_ticket:edit"}
	_, digest, err := altocProductFeedbackSnapshot(map[string]any{"code": "ST-1", "product_code": "P1", "ticket_type": "requirement", "title": "Feature", "description": "Details"})
	if err != nil {
		t.Fatal(err)
	}
	body["expectedSourceSha256"] = digest
	query := url.Values{}
	for key, value := range body {
		if text, ok := value.(string); ok {
			query.Set(key, text)
		}
	}
	query.Set("current_user_scopes", "altoc:service_ticket:edit")
	preview, err := adapter.readServiceTicketProductFeedback(context.Background(), "ST-1", query)
	if err != nil {
		t.Fatal(err)
	}
	if preview["submitted"] != false || preview["expectedSourceSha256"] != digest {
		t.Fatal("preview does not match frozen source")
	}

	apply := func() (map[string]any, error) {
		return adapter.freezeServiceTicketProductFeedback(context.Background(), "ST-1", body)
	}
	exec(`CREATE TRIGGER fail_feedback_audit BEFORE INSERT ON audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected failure'`)
	if _, err := apply(); err == nil {
		t.Fatal("expected audit failure")
	}
	for _, table := range []string{"integration_operation", "service_ticket_product_feedback", "audit_log"} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 0 {
			t.Fatalf("rollback left %s records", table)
		}
	}
	exec(`DROP TRIGGER fail_feedback_audit`)
	first, err := apply()
	if err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE service_ticket SET title='Changed after submission',product_code='P2' WHERE id=1`)
	replay, err := apply()
	if err != nil {
		t.Fatal(err)
	}
	view, err := adapter.readServiceTicketProductFeedback(context.Background(), "ST-1", query)
	if err != nil {
		t.Fatal(err)
	}
	if view["submitted"] != true || view["requestBizId"] != first["requestBizId"] || view["productCode"] != "P1" {
		t.Fatal("status lost frozen binding")
	}
	if _, leaked := view["description"]; leaked {
		t.Fatal("status leaked changed source text")
	}
	if replay["created"] != false || replay["requestBizId"] != first["requestBizId"] || replay["productCode"] != "P1" {
		t.Fatal("replay changed frozen identity")
	}
	var title, actor, schemaVersion string
	if err := db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.title')),original_actor_uid,command_schema_version FROM integration_operation`).Scan(&title, &actor, &schemaVersion); err != nil {
		t.Fatal(err)
	}
	if title != "Feature" || actor != "dispatcher-user" || schemaVersion != altocProductFeedbackSchema {
		t.Fatal("frozen command changed")
	}

	exec(`INSERT INTO service_ticket VALUES (2,'ST-2',1,'P1','requirement','Second','Details','dispatcher-user',NULL)`)
	for _, column := range []string{"submission_id", "request_biz_id", "operation_id"} {
		values := map[string]string{"submission_id": "UUID()", "request_biz_id": "UUID()", "operation_id": "UUID()"}
		values[column] = column
		statement := "INSERT INTO service_ticket_product_feedback(ticket_id,submission_id,request_biz_id,product_code,operation_id,source_sha256,original_actor_uid) SELECT 2," + values["submission_id"] + "," + values["request_biz_id"] + ",product_code," + values["operation_id"] + ",source_sha256,original_actor_uid FROM service_ticket_product_feedback WHERE ticket_id=1"
		if _, err := db.Exec(statement); err == nil {
			t.Fatalf("duplicate %s accepted", column)
		}
	}
	for _, invalid := range []struct {
		ticket         int
		product, actor string
	}{{999, "P1", "pm"}, {2, "", "pm"}, {2, "P1", ""}} {
		if _, err := db.Exec(`INSERT INTO service_ticket_product_feedback(ticket_id,submission_id,request_biz_id,product_code,operation_id,source_sha256,original_actor_uid) VALUES (?,UUID(),UUID(),?,UUID(),?,?)`, invalid.ticket, invalid.product, digest, invalid.actor); err == nil {
			t.Fatal("invalid source binding accepted")
		}
	}

	workerBody := trustedIntegrationOperationRuntimeBody()
	key := first["operationKey"].(string)
	claimed, err := adapter.claimIntegrationOperation(context.Background(), key, workerBody)
	if err != nil || claimed == nil {
		t.Fatalf("claim failed: %v", err)
	}
	workerBody["operationId"] = claimed["operationId"]
	workerBody["fencingToken"] = claimed["fencingToken"]
	workerBody["httpStatus"] = 200
	workerBody["targetReceiptId"] = "123e4567-e89b-42d3-a456-426614174099"
	workerBody["receiptOperationId"] = claimed["operationId"]
	workerBody["receiptOperationCode"] = altocProductFeedbackOperation
	workerBody["receiptIdempotencyKey"] = key
	workerBody["receiptCommandSchemaVersion"] = altocProductFeedbackSchema
	workerBody["receiptCommandSha256"] = claimed["commandSha256"]
	workerBody["targetBizType"] = "product_request"
	workerBody["targetBizCode"] = "123e4567-e89b-42d3-a456-426614174098"
	workerBody["responseSummarySha256"] = strings.Repeat("a", 64)
	if _, err := adapter.succeedIntegrationOperation(context.Background(), key, workerBody); err == nil {
		t.Fatal("wrong target receipt accepted")
	}
	workerBody["targetBizCode"] = first["requestBizId"]
	workerBody["receiptCommandSchemaVersion"] = "v1"
	if _, err := adapter.succeedIntegrationOperation(context.Background(), key, workerBody); err == nil {
		t.Fatal("wrong schema receipt accepted")
	}
	workerBody["receiptCommandSchemaVersion"] = altocProductFeedbackSchema
	if _, err := adapter.succeedIntegrationOperation(context.Background(), key, workerBody); err != nil {
		t.Fatal(err)
	}
	statusView, err := adapter.readServiceTicketProductFeedback(context.Background(), "ST-1", query)
	if err != nil || statusView["status"] != "succeeded" {
		t.Fatalf("receipt checkpoint not visible: %v %v", statusView, err)
	}

	projection := ProductFeedbackStatus{TicketCode: "ST-1", ProductCode: "P1", RequestBizID: first["requestBizId"].(string), CanonicalRequestBizID: first["requestBizId"].(string), DecisionStatus: "accepted", SourceRevision: 3}
	project := func(commit bool) (bool, error) {
		tx, err := db.BeginTx(context.Background(), nil)
		if err != nil {
			return false, err
		}
		defer tx.Rollback()
		applied, err := applyProductFeedbackStatusTx(context.Background(), tx, projection)
		if err != nil {
			return false, err
		}
		if commit {
			err = tx.Commit()
		}
		return applied, err
	}
	if applied, err := project(false); err != nil || !applied {
		t.Fatalf("projection failed: %v", err)
	}
	var projectionCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_feedback_status_projection`).Scan(&projectionCount); err != nil || projectionCount != 0 {
		t.Fatal("projection escaped receipt rollback")
	}
	if applied, err := project(true); err != nil || !applied {
		t.Fatalf("projection commit failed: %v", err)
	}
	if applied, err := project(true); err != nil || applied {
		t.Fatal("same revision replay was not idempotent")
	}
	projection.DecisionStatus = "rejected"
	if _, err := project(true); err == nil {
		t.Fatal("same revision changed decision")
	}
	projection.SourceRevision = 2
	if applied, err := project(true); err != nil || applied {
		t.Fatal("old revision overwrote current decision")
	}
	projection.SourceRevision = 4
	projection.DecisionStatus = "merged"
	projection.CanonicalRequestBizID = "123e4567-e89b-42d3-a456-426614174097"
	if applied, err := project(true); err != nil || !applied {
		t.Fatalf("merge projection failed: %v", err)
	}
	projection.ProductCode = "P2"
	projection.SourceRevision = 5
	if _, err := project(true); err == nil {
		t.Fatal("current ticket product replaced frozen feedback product")
	}
	var originalRequest string
	if err := db.QueryRow(`SELECT request_biz_id FROM service_ticket_product_feedback WHERE ticket_id=1`).Scan(&originalRequest); err != nil || originalRequest != first["requestBizId"] {
		t.Fatal("merge replaced original source identity")
	}

	projection.ProductCode = "P1"
	projection.SourceRevision = 6
	encoded, _ := json.Marshal(projection)
	var statusMap map[string]any
	if err := json.Unmarshal(encoded, &statusMap); err != nil {
		t.Fatal(err)
	}
	statusHash, err := integrationoperation.ValidateAndDigestCommand(statusMap)
	if err != nil {
		t.Fatal(err)
	}
	statusReceipt := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: "TENANT-TRUSTED", DeploymentCode: "DEPLOYMENT-TRUSTED", SourceApp: "aims", ServiceClientID: "aims.runtime", RequestID: "status-request"}, SourceDeploymentCode: "AIMS", TargetDeploymentCode: "DEPLOYMENT-TRUSTED", TargetApp: "altoc", OperationID: "123e4567-e89b-42d3-a456-426614174096", OperationCode: productFeedbackStatusOperation, RequiredCapability: productFeedbackStatusCapability, IdempotencyKey: "feedback-status:6", CommandSchemaVersion: productFeedbackStatusSchema, CommandSHA256: statusHash, Command: encoded}

	exec(`CREATE TRIGGER fail_status_update BEFORE UPDATE ON product_feedback_status_projection FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected status failure'`)
	if _, err := receiveProductFeedbackStatus(context.Background(), db, statusReceipt); err == nil {
		t.Fatal("projection failure ignored")
	}
	var receiptCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM service_command_receipt`).Scan(&receiptCount); err != nil || receiptCount != 0 {
		t.Fatal("failed projection left a receipt")
	}
	exec(`DROP TRIGGER fail_status_update`)
	received, err := receiveProductFeedbackStatus(context.Background(), db, statusReceipt)
	if err != nil {
		t.Fatal(err)
	}
	repeated, err := receiveProductFeedbackStatus(context.Background(), db, statusReceipt)
	if err != nil {
		t.Fatal(err)
	}
	if !repeated.Existing || repeated.ReceiptID != received.ReceiptID {
		t.Fatal("status receipt replay identity changed")
	}
	decisionView, err := adapter.readServiceTicketProductFeedback(context.Background(), "ST-1", query)
	if err != nil {
		t.Fatal(err)
	}
	if decisionView["decisionStatus"] != "merged" || decisionView["canonicalRequestBizId"] != projection.CanonicalRequestBizID || decisionView["sourceRevision"] != uint64(6) {
		t.Fatal("latest product decision not exposed")
	}

	testFeedbackProgressProjection(t, db, adapter, projection.RequestBizID, query)

	routeQuery := url.Values{"scope": {productFeedbackStatusCapability}, "runtime_source_app": {"altoc"}, "tenant": {"TENANT-TRUSTED"}, "deployment": {"DEPLOYMENT-TRUSTED"}}
	for key, value := range map[string]string{
		integrationoperation.TrustedServiceCommandTenantKey:           "TENANT-TRUSTED",
		integrationoperation.TrustedServiceCommandSourceDeploymentKey: "AIMS",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "DEPLOYMENT-TRUSTED",
		integrationoperation.TrustedServiceCommandSourceAppKey:        "aims",
		integrationoperation.TrustedServiceCommandTargetAppKey:        "altoc",
		integrationoperation.TrustedServiceCommandSourceClientKey:     "aims.runtime",
		integrationoperation.TrustedRequestIDKey:                      "status-route",
	} {
		routeQuery.Set(key, value)
	}
	routeBody := map[string]any{"serviceCommand": map[string]any{"operationId": statusReceipt.OperationID, "operationCode": statusReceipt.OperationCode, "targetApp": "altoc", "requiredCapability": statusReceipt.RequiredCapability, "idempotencyKey": statusReceipt.IdempotencyKey, "commandSchemaVersion": statusReceipt.CommandSchemaVersion, "commandSha256": statusReceipt.CommandSHA256, "command": statusMap}}
	// Server middleware injects verified service-command context into the body.
	for key, values := range routeQuery {
		if strings.HasPrefix(key, "hzy_runtime_") {
			routeBody[key] = values[0]
		}
	}
	routeResponse, _, err := adapter.HandleRuntime(context.Background(), "POST", "/v1/altoc/internal/product-feedback:status", routeQuery, routeBody)
	if err != nil {
		t.Fatal(err)
	}
	responseJSON, err := json.Marshal(routeResponse)
	if err != nil {
		t.Fatal(err)
	}
	var responseEnvelope struct {
		Data struct {
			ReceiptID  string `json:"receiptId"`
			Idempotent bool   `json:"idempotent"`
		} `json:"data"`
	}
	if err := json.Unmarshal(responseJSON, &responseEnvelope); err != nil {
		t.Fatal(err)
	}
	if responseEnvelope.Data.ReceiptID != received.ReceiptID || !responseEnvelope.Data.Idempotent {
		t.Fatalf("Runtime lost existing status receipt: %s", responseJSON)
	}

	statusMap["sourceRevision"] = float64(7)
	nextHash, err := integrationoperation.ValidateAndDigestCommand(statusMap)
	if err != nil {
		t.Fatal(err)
	}
	nextEnvelope := routeBody["serviceCommand"].(map[string]any)
	nextEnvelope["operationId"] = "123e4567-e89b-42d3-a456-426614174095"
	nextEnvelope["idempotencyKey"] = "feedback-status:7"
	nextEnvelope["commandSha256"] = nextHash
	if _, _, err := adapter.HandleRuntime(context.Background(), "POST", "/v1/altoc/internal/product-feedback:status", routeQuery, routeBody); err != nil {
		t.Fatal(err)
	}
	var latest uint64
	if err := db.QueryRow(`SELECT source_revision FROM product_feedback_status_projection WHERE ticket_id=1`).Scan(&latest); err != nil || latest != 7 {
		t.Fatal("Runtime fresh status command was not applied")
	}
	exec(`UPDATE service_ticket SET owner_user_id='another-user' WHERE id=1`)
	if _, err := apply(); err == nil {
		t.Fatal("revoked owner read existing binding")
	}
	if _, err := adapter.readServiceTicketProductFeedback(context.Background(), "ST-1", query); err == nil {
		t.Fatal("revoked owner read feedback status")
	}

	for _, table := range []string{"integration_operation", "service_ticket_product_feedback", "audit_log"} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatalf("unexpected %s count %d", table, n)
		}
	}
}
