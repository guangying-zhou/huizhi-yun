package codocs

import (
	"context"
	"database/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/url"
	"strings"
	"testing"
)

func knowledgeBody(t *testing.T) (url.Values, map[string]any) {
	t.Helper()
	cmd := map[string]any{"actorUid": "owner", "action": "link", "ticketCode": "T-1", "documentUuid": uuid.NewString(), "customerCode": "C-1", "contractCode": "CT-1", "projectCode": "P-1", "deliveryCode": "D-1", "deliveryAssetCode": "A-1", "environmentCode": "E-1", "targetDeployment": "codocs-test"}
	hash, e := integrationoperation.ValidateAndDigestCommand(cmd)
	if e != nil {
		t.Fatal(e)
	}
	body := map[string]any{"serviceCommand": map[string]any{"targetApp": "codocs", "operationId": uuid.NewString(), "operationCode": "enterprise.codocs.knowledge-link.v1", "requiredCapability": "codocs:knowledge-link:create", "idempotencyKey": "knowledge:1", "commandSchemaVersion": "v1", "commandSha256": hash, "command": cmd}, integrationoperation.TrustedServiceCommandTenantKey: "C000001", integrationoperation.TrustedServiceCommandSourceDeploymentKey: "enterprise-test", integrationoperation.TrustedServiceCommandTargetDeploymentKey: "codocs-test", integrationoperation.TrustedServiceCommandSourceAppKey: "enterprise", integrationoperation.TrustedServiceCommandTargetAppKey: "codocs", integrationoperation.TrustedServiceCommandSourceClientKey: "enterprise.runtime"}
	q := url.Values{"hzy_runtime_source_app": {"codocs"}, "hzy_runtime_tenant_code": {"C000001"}, "hzy_runtime_deployment_code": {"codocs-test"}, "current_user": {"owner"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_actor_purpose": {"service-command"}, "current_user_scopes": {"codocs:knowledge-link:create"}}
	return q, body
}
func TestEnterpriseKnowledgeLinkAtomicNoACLGrantAndReplay(t *testing.T) {
	db, m, e := sqlmock.New()
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	a := &Adapter{db: db}
	q, b := knowledgeBody(t)
	env := b["serviceCommand"].(map[string]any)
	doc := env["command"].(map[string]any)["documentUuid"].(string)
	columns := []string{"receipt_id", "operation_id", "required_capability", "command_schema_version", "command_sha256", "status", "target_biz_type", "target_biz_code", "response_http_status", "response_summary_sha256", "version_no"}
	m.ExpectBegin()
	m.ExpectQuery("SELECT \\* FROM documents.*FOR UPDATE").WithArgs(doc).WillReturnRows(documentReadRows(1, doc, "owner", "personal", "", 0, 1))
	m.ExpectQuery("(?s)SELECT.*FROM service_command_receipt").WillReturnRows(sqlmock.NewRows(columns))
	m.ExpectExec("(?s)INSERT INTO service_command_receipt").WillReturnResult(sqlmock.NewResult(1, 1))
	for _, source := range opsKnowledgeSources(env["command"].(map[string]any)) {
		m.ExpectExec("(?s)INSERT INTO document_relations").WithArgs(int64(1), doc, "service:enterprise:ops-knowledge", "ops_knowledge", source.SourceType, source.SourceID, 0, 0, 0, sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(1, 1))
	}
	m.ExpectExec("(?s)UPDATE service_command_receipt.*SET status = 'succeeded'").WillReturnResult(sqlmock.NewResult(1, 1))
	m.ExpectCommit()
	first, e := a.enterpriseKnowledgeLink(context.Background(), q, b)
	if e != nil {
		t.Fatal(e)
	}
	m.ExpectBegin()
	m.ExpectQuery("SELECT \\* FROM documents.*FOR UPDATE").WithArgs(doc).WillReturnRows(documentReadRows(1, doc, "owner", "personal", "", 0, 1))
	m.ExpectQuery("(?s)SELECT.*FROM service_command_receipt").WillReturnRows(sqlmock.NewRows(columns).AddRow(first["receiptId"], env["operationId"], env["requiredCapability"], "v1", env["commandSha256"], "succeeded", "document", doc, 200, strings.Repeat("a", 64), int64(2)))
	m.ExpectExec("(?s)UPDATE service_command_receipt.*last_request_id").WillReturnResult(sqlmock.NewResult(0, 1))
	m.ExpectCommit()
	replay, e := a.enterpriseKnowledgeLink(context.Background(), q, b)
	if e != nil || replay["receiptId"] != first["receiptId"] || replay["idempotent"] != true {
		t.Fatal("replay changed receipt", replay, e)
	}
	// Revoke owner and share; no receipt query/writes may occur before rejection.
	m.ExpectBegin()
	m.ExpectQuery("SELECT \\* FROM documents.*FOR UPDATE").WithArgs(doc).WillReturnRows(documentReadRows(1, doc, "other", "personal", "", 0, 1))
	m.ExpectQuery("(?s)SELECT permission.*FROM document_shares.*FOR UPDATE").WillReturnError(sql.ErrNoRows)
	m.ExpectQuery("(?s)SELECT TABLE_NAME.*information_schema.TABLES").WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}))
	m.ExpectRollback()
	if _, e = a.enterpriseKnowledgeLink(context.Background(), q, b); e == nil {
		t.Fatal("revoked replay accepted")
	}
	if e = m.ExpectationsWereMet(); e != nil {
		t.Fatal(e)
	}
}
