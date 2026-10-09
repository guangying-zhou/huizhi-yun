package assets

import (
	"context"
	"encoding/json"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestEnterpriseAssetKnowledgeReplaysOnlyAfterCurrentScopeAndDeliveryFacts(t *testing.T) {
	a, m, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	cmd := map[string]any{"actorUid": "person", "action": "link", "ticketCode": "T-1", "documentUuid": uuid.NewString(), "customerCode": "C-1", "contractCode": "CT-1", "projectCode": "P-1", "deliveryCode": "D-1", "deliveryAssetCode": "A-1", "environmentCode": "E-1", "targetDeployment": "assets-test"}
	digest, e := integrationoperation.ValidateAndDigestCommand(cmd)
	if e != nil {
		t.Fatal(e)
	}
	opid := uuid.NewString()
	receiptID := uuid.NewString()
	cap := "assets:asset-link:create"
	body := map[string]any{"serviceCommand": map[string]any{"targetApp": "assets", "operationId": opid, "operationCode": "enterprise.assets.knowledge-link.v1", "requiredCapability": cap, "idempotencyKey": "knowledge:1", "commandSchemaVersion": "v1", "commandSha256": digest, "command": cmd}, integrationoperation.TrustedServiceCommandTenantKey: "C000001", integrationoperation.TrustedServiceCommandSourceDeploymentKey: "enterprise-test", integrationoperation.TrustedServiceCommandTargetDeploymentKey: "assets-test", integrationoperation.TrustedServiceCommandSourceAppKey: "enterprise", integrationoperation.TrustedServiceCommandTargetAppKey: "assets", integrationoperation.TrustedServiceCommandSourceClientKey: "enterprise.runtime"}
	raw, _ := json.Marshal(map[string]any{"actorUid": "person", "action": "edit", "expiresAt": time.Now().Add(10 * time.Second).UnixMilli(), "delivery": map[string]string{assetsObjectAccessQueryKey: "all"}, "environment": map[string]string{assetsObjectAccessQueryKey: "all"}})
	body["knowledgeAuthorization"] = string(raw)
	q := url.Values{"hzy_runtime_source_app": {"assets"}, "hzy_runtime_tenant_code": {"C000001"}, "hzy_runtime_deployment_code": {"assets-test"}, "current_user": {"person"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_actor_purpose": {"service-command"}, "current_user_scopes": {cap}}
	m.ExpectBegin()
	m.ExpectQuery("SELECT id,customer_code.*FROM asset_delivery_views.*FOR UPDATE").WithArgs("D-1").WillReturnRows(sqlmock.NewRows([]string{"id", "customer_code", "contract_code", "project_code"}).AddRow(1, "C-1", "CT-1", "P-1"))
	m.ExpectQuery("SELECT .*FROM customer_delivery_asset_environment_rel.*FOR UPDATE").WithArgs("C-1", "A-1", "E-1").WillReturnRows(sqlmock.NewRows([]string{"asset", "environment", "customer", "contract", "project"}).AddRow("A-1", "E-1", "C-1", "CT-1", "P-1"))
	m.ExpectQuery("(?s)SELECT.*FROM service_command_receipt").WillReturnRows(sqlmock.NewRows([]string{"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no"}).AddRow(receiptID, opid, cap, "v1", digest, "succeeded", "delivery_document", cmd["documentUuid"], 200, strings.Repeat("a", 64), 2))
	m.ExpectExec("(?s)UPDATE service_command_receipt.*last_request_id").WillReturnResult(sqlmock.NewResult(0, 1))
	m.ExpectCommit()
	r, e := a.enterpriseKnowledgeLink(context.Background(), q, body)
	if e != nil || r["receiptId"] != receiptID || r["idempotent"] != true {
		t.Fatal(r, e)
	}
	m.ExpectBegin()
	m.ExpectQuery("SELECT id,customer_code.*FROM asset_delivery_views.*FOR UPDATE").WithArgs("D-1").WillReturnRows(sqlmock.NewRows([]string{"id", "customer_code", "contract_code", "project_code"}).AddRow(1, "C-OTHER", "CT-1", "P-1"))
	m.ExpectRollback()
	if _, e = a.enterpriseKnowledgeLink(context.Background(), q, body); e == nil {
		t.Fatal("changed delivery replay accepted")
	}
	raw, _ = json.Marshal(map[string]any{"actorUid": "person", "action": "edit", "expiresAt": time.Now().Add(-time.Second).UnixMilli()})
	body["knowledgeAuthorization"] = string(raw)
	if _, e = a.enterpriseKnowledgeLink(context.Background(), q, body); e == nil {
		t.Fatal("expired replay accepted")
	}
	if e = m.ExpectationsWereMet(); e != nil {
		t.Fatal(e)
	}
}
