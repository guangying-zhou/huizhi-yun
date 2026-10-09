package enterpriseapf

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strings"
	"testing"
)

func TestAPFKnowledgeCommandsMySQL(t *testing.T) {
	s, db := ticketsFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "knowledge-agreement"}
	scope := altoc.BasicReadScope{Access: "self"}
	a, e := s.Sales(ctx, "service-agreements-create", SalesInput{Payload: map[string]any{"name": "知识标记", "contract_id": "1", "status": "active", "included_quota": "2", "quota_unit": "ticket"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	who.Key = "knowledge-ticket"
	v, e := s.Sales(ctx, "service-tickets-create", SalesInput{Payload: map[string]any{"title": "知识标记", "ticket_type": "incident", "service_agreement_id": fmt.Sprint(a.(map[string]any)["id"])}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	id := fmt.Sprint(v.(map[string]any)["id"])
	if _, e = db.Exec("UPDATE altoc_service_ticket SET project_code='PROJECT-1',delivery_code='D-1',delivery_asset_code='DA-1',environment_code='ENV-1' WHERE id=?", id); e != nil {
		t.Fatal(e)
	}
	docID := uuid.NewString()
	denied := false
	dependency := false
	ports := KnowledgePorts{Document: func(context.Context, string, string) (map[string]any, error) {
		if dependency {
			return nil, httperror.New(503, "dependency", "暂不可用")
		}
		if denied {
			return nil, httperror.New(403, "denied", "无权")
		}
		return map[string]any{"uuid": docID, "title": "标记知识"}, nil
	}, Assets: func(context.Context, string, string, string, string, string, string) (map[string]any, error) {
		if denied {
			return nil, httperror.New(403, "denied", "无权")
		}
		return map[string]any{"items": []map[string]any{}}, nil
	}}
	who.Key = "knowledge-link"
	input := SalesInput{ID: id, Payload: map[string]any{"documentUuid": docID, "expectedVersion": float64(1), "assetsDeployment": "assets-test", "codocsDeployment": "codocs-test", "assetsAuthorization": "signed-private"}}
	out, e := s.Knowledge(ctx, "service-ticket-knowledge-link", input, who, scope, ports)
	if e != nil {
		t.Fatal(e)
	}
	replay, e := s.Knowledge(ctx, "service-ticket-knowledge-link", input, who, scope, ports)
	if e != nil {
		t.Fatal(e)
	}
	first := out.(map[string]any)["frozen"].([]map[string]any)
	again := replay.(map[string]any)["frozen"].([]map[string]any)
	if len(first) != 2 || first[0]["operationId"] != again[0]["operationId"] {
		t.Fatal("replay changed frozen command", out, replay)
	}
	var n int
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_integration_operation WHERE operation_code LIKE 'enterprise.%.knowledge-link.v1'").Scan(&n); e != nil || n != 2 {
		t.Fatal(n, e)
	}
	denied = true
	if _, e = s.Knowledge(ctx, "service-ticket-knowledge-link", input, who, scope, ports); httperrorStatus(e) != 403 {
		t.Fatal("revoked replay accepted", e)
	}
	read, e := s.Knowledge(ctx, "service-ticket-knowledge-view", SalesInput{ID: id, Payload: map[string]any{"assetsAuthorization": "signed-private"}}, who, scope, ports)
	if e != nil || fmt.Sprint(read) != "map[access:denied]" {
		t.Fatal("denied read leaked metadata", read, e)
	}
	denied = false
	dependency = true
	if _, e = s.Knowledge(ctx, "service-ticket-knowledge-view", SalesInput{ID: id, Payload: map[string]any{"assetsAuthorization": "signed-private"}}, who, scope, ports); httperrorStatus(e) != 503 {
		t.Fatal("dependency masked", e)
	}
	dependency = false
	receipts := []integrationoperation.ReceiptEvidence{}
	for _, f := range first {
		kind := "document"
		if f["targetApp"] == "assets" {
			kind = "delivery_document"
		}
		receipts = append(receipts, integrationoperation.ReceiptEvidence{ReceiptID: uuid.NewString(), OperationID: fmt.Sprint(f["operationId"]), OperationCode: fmt.Sprint(f["operationCode"]), IdempotencyKey: fmt.Sprint(f["idempotencyKey"]), CommandSchemaVersion: "v1", CommandSHA256: fmt.Sprint(f["commandSha256"]), TargetBizType: kind, TargetBizCode: docID, ResponseSummarySHA256: strings.Repeat("a", 64)})
	}
	checkpoint := func(rs []integrationoperation.ReceiptEvidence) SalesInput {
		raw, _ := json.Marshal(rs)
		return SalesInput{ID: id, Payload: map[string]any{"assetsAuthorization": "signed-private", "checkpoint": string(raw)}}
	}
	bad := append([]integrationoperation.ReceiptEvidence{}, receipts...)
	bad[0].CommandSHA256 = strings.Repeat("b", 64)
	if _, e = s.Knowledge(ctx, "service-ticket-knowledge-resume", checkpoint(bad), who, scope, ports); httperrorStatus(e) != 409 {
		t.Fatal("tampered checkpoint accepted", e)
	}
	if _, e = s.Knowledge(ctx, "service-ticket-knowledge-resume", checkpoint(receipts), who, scope, ports); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Knowledge(ctx, "service-ticket-knowledge-resume", checkpoint(receipts), who, scope, ports); e != nil {
		t.Fatal("checkpoint replay", e)
	}
	var status string
	if e = db.QueryRow("SELECT ops_knowledge_status FROM altoc_service_ticket WHERE id=?", id).Scan(&status); e != nil || status != "linked" {
		t.Fatal(status, e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_integration_operation WHERE status='succeeded' AND operation_code LIKE 'enterprise.%.knowledge-link.v1'").Scan(&n); e != nil || n != 2 {
		t.Fatal(n, e)
	}
	// Count/paging only after independent document ACL, with no leaked count.
	hidden := uuid.NewString()
	if _, e = db.Exec("INSERT INTO altoc_document_link(entity_type,entity_id,document_uuid,created_by) VALUES('customer',1,?,'person'),('customer',1,?,'person')", docID, hidden); e != nil {
		t.Fatal(e)
	}
	readPorts := ports
	readPorts.Document = func(_ context.Context, u, _ string) (map[string]any, error) {
		if u == hidden {
			return nil, httperror.New(403, "denied", "无权")
		}
		return map[string]any{"uuid": u, "title": "有权知识"}, nil
	}
	readPorts.Assets = func(_ context.Context, c, _, _, _, _, _ string) (map[string]any, error) {
		if c != "CUSTOMER" {
			t.Fatal("customer authority lost", c)
		}
		return map[string]any{"items": []map[string]any{{"deliveryAssetCode": "DA-1"}}}, nil
	}
	summaryInput := SalesInput{ID: "1", Payload: map[string]any{"page": float64(1), "pageSize": float64(1)}}
	visible, e := s.Knowledge(ctx, "customer-documents-page", summaryInput, who, scope, readPorts)
	if e != nil || visible.(map[string]any)["total"] != 1 {
		t.Fatal("visible count", visible, e)
	}
	summaryInput.Payload["assetsAuthorization"] = "private"
	visible, e = s.Knowledge(ctx, "customer-assets-summary", summaryInput, who, scope, readPorts)
	if e != nil || visible.(map[string]any)["total"] != 1 {
		t.Fatal("asset summary", visible, e)
	}
	// Fail the second frozen insert: first insert, receipt and pending projection
	// must all roll back in the same business transaction.
	who.Key = "knowledge-ticket-rollback"
	second, e := s.Sales(ctx, "service-tickets-create", SalesInput{Payload: map[string]any{"title": "回滚标记", "ticket_type": "incident", "service_agreement_id": fmt.Sprint(a.(map[string]any)["id"])}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	secondID := fmt.Sprint(second.(map[string]any)["id"])
	if _, e = db.Exec("UPDATE altoc_service_ticket SET project_code='PROJECT-1',delivery_code='D-1',delivery_asset_code='DA-1',environment_code='ENV-1' WHERE id=?", secondID); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec("CREATE TRIGGER apf16e_fault BEFORE INSERT ON altoc_integration_operation FOR EACH ROW BEGIN IF NEW.target_app='assets' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated'; END IF; END"); e != nil {
		t.Fatal(e)
	}
	who.Key = "knowledge-rollback"
	input.ID = secondID
	if _, e = s.Knowledge(ctx, "service-ticket-knowledge-link", input, who, scope, ports); e == nil {
		t.Fatal("partial freeze committed")
	}
	if e = db.QueryRow("SELECT ops_knowledge_status FROM altoc_service_ticket WHERE id=?", secondID).Scan(&status); e != nil || status != "idle" {
		t.Fatal("pending escaped rollback", status, e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_integration_operation WHERE operation_code LIKE 'enterprise.%.knowledge-link.v1'").Scan(&n); e != nil || n != 2 {
		t.Fatal("frozen operation escaped rollback", n, e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_service_command_receipt WHERE idempotency_key='knowledge-rollback'").Scan(&n); e != nil || n != 0 {
		t.Fatal("receipt escaped rollback", n, e)
	}
	if _, e = db.Exec("DROP TRIGGER apf16e_fault"); e != nil {
		t.Fatal(e)
	}

}
