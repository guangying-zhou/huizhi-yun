package assets

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestServiceDeliveryPackageRequiresCustomerScope(t *testing.T) {
	_, err := (&Adapter{}).serviceDeliveryPackage(context.Background(), url.Values{})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "customer_code_required" {
		t.Fatalf("error = %#v, want 400 customer_code_required", err)
	}
}

func TestServiceDeliveryFormalAssetsUsesExactCustomerContractProjectScope(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT \*\s+FROM customer_delivery_assets\s+WHERE customer_code = \? AND deleted_at IS NULL AND contract_code = \? AND project_code = \?`).
		WithArgs("CU-1", "CT-1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_code", "customer_code", "contract_code", "project_code", "product_code"}).
			AddRow(int64(10), "CDA-1", "CU-1", "CT-1", "PRJ-1", "PROD-1"))
	mock.ExpectQuery(`(?s)FROM customer_delivery_asset_environment_rel rel\s+INNER JOIN asset_environments env.*WHERE rel.delivery_asset_id = \?.*rel.status = 'active'`).
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"relation_type", "environment_code", "environment_name", "status"}).
			AddRow("primary", "ENV-1", "生产环境", "active"))

	assets, err := adapter.serviceDeliveryFormalAssets(context.Background(), "CU-1", "CT-1", "PRJ-1")
	if err != nil {
		t.Fatalf("serviceDeliveryFormalAssets: %v", err)
	}
	if len(assets) != 1 || assets[0]["delivery_asset_code"] != "CDA-1" {
		t.Fatalf("assets = %#v", assets)
	}
	environments, ok := assets[0]["environments"].([]map[string]any)
	if !ok || len(environments) != 1 || environments[0]["environment_code"] != "ENV-1" {
		t.Fatalf("environments = %#v", assets[0]["environments"])
	}
	if _, leaksContent := environments[0]["content"]; leaksContent {
		t.Fatalf("formal package must not return Codocs content: %#v", environments[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestLinkDeliveryDocumentWritesLinkAndEventAtomically(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	for _, column := range []string{"artifact_type", "source_context"} {
		mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*information_schema\.COLUMNS`).
			WithArgs("asset_documents", column).
			WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	}
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT id, customer_code, contract_code, project_code.*FROM asset_delivery_views.*WHERE delivery_code = \?.*FOR UPDATE`).
		WithArgs("DLV-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "customer_code", "contract_code", "project_code"}).
			AddRow(int64(20), "CU-1", "CT-1", "PRJ-1"))
	mock.ExpectQuery(`(?s)SELECT cda.id.*FROM customer_delivery_assets cda.*customer_delivery_asset_environment_rel.*asset_environments.*cda.delivery_asset_code = \?.*env.environment_code = \?.*cda.customer_code = \?.*cda.contract_code = \?.*cda.project_code = \?.*FOR UPDATE`).
		WithArgs("CDA-1", "ENV-1", "CU-1", "CT-1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(30)))
	mock.ExpectQuery(`(?s)SELECT id.*FROM asset_documents.*object_type = 'delivery_view'.*object_id = \?.*document_id = \?.*FOR UPDATE`).
		WithArgs(int64(20), "DOC-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec(`(?s)INSERT INTO asset_documents.*ON DUPLICATE KEY UPDATE`).
		WithArgs("delivery_view", int64(20), "DOC-1", "ops", "ops_knowledge", sqlmock.AnyArg(), nil, "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO asset_events`).
		WithArgs("delivery_view", int64(20), "document_linked", sqlmock.AnyArg(), "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := adapter.linkDeliveryDocument(context.Background(), "DLV-1", map[string]any{
		"documentUuid":      "DOC-1",
		"artifactType":      "ops_knowledge",
		"sourceApp":         "altoc",
		"deliveryAssetCode": "CDA-1",
		"environmentCode":   "ENV-1",
	}, "u1")
	if err != nil {
		t.Fatalf("linkDeliveryDocument: %v", err)
	}
	if result["idempotent"] != false || result["document_uuid"] != "DOC-1" {
		t.Fatalf("result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestLinkDeliveryDocumentRollsBackWhenEventWriteFails(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	for _, column := range []string{"artifact_type", "source_context"} {
		mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*information_schema\.COLUMNS`).
			WithArgs("asset_documents", column).
			WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	}
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)FROM asset_delivery_views.*WHERE delivery_code = \?.*FOR UPDATE`).
		WithArgs("DLV-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "customer_code", "contract_code", "project_code"}).AddRow(int64(20), "CU-1", "CT-1", "PRJ-1"))
	mock.ExpectQuery(`(?s)FROM customer_delivery_assets cda.*FOR UPDATE`).
		WithArgs("CDA-1", "ENV-1", "CU-1", "CT-1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(30)))
	mock.ExpectQuery(`(?s)FROM asset_documents.*FOR UPDATE`).
		WithArgs(int64(20), "DOC-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec(`(?s)INSERT INTO asset_documents`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO asset_events`).WillReturnError(errors.New("event failed"))
	mock.ExpectRollback()

	_, err := adapter.linkDeliveryDocument(context.Background(), "DLV-1", map[string]any{
		"documentUuid":      "DOC-1",
		"artifactType":      "ops_knowledge",
		"deliveryAssetCode": "CDA-1",
		"environmentCode":   "ENV-1",
	}, "u1")
	if err == nil {
		t.Fatal("expected event failure")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestLinkServiceDeliveryDocumentRejectsWrongTrustedSourceApp(t *testing.T) {
	body := serviceDeliveryCommandBody(t, "aims", "assets:write")
	_, err := (&Adapter{}).linkServiceDeliveryDocument(context.Background(), "DLV-1", body)
	assertAssetsHTTPError(t, err, http.StatusForbidden, "service_command_source_forbidden")
}

func TestLinkServiceDeliveryDocumentRejectsWrongFrozenCapability(t *testing.T) {
	body := serviceDeliveryCommandBody(t, "altoc", "assets:admin")
	_, err := (&Adapter{}).linkServiceDeliveryDocument(context.Background(), "DLV-1", body)
	assertAssetsHTTPError(t, err, http.StatusConflict, "idempotency_payload_mismatch")
}

func serviceDeliveryCommandBody(t *testing.T, sourceApp string, capability string) map[string]any {
	t.Helper()
	command := map[string]any{
		"deliveryCode":      "DLV-1",
		"deliveryAssetCode": "CDA-1",
		"environmentCode":   "ENV-1",
		"documentUuid":      "DOC-1",
		"ticketCode":        "ST-1",
	}
	digest, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatalf("ValidateAndDigestCommand: %v", err)
	}
	return map[string]any{
		integrationoperation.TrustedServiceCommandTenantKey:           "TENANT-A",
		integrationoperation.TrustedServiceCommandSourceDeploymentKey: "ALTOC-DEPLOYMENT",
		integrationoperation.TrustedServiceCommandTargetDeploymentKey: "ASSETS-DEPLOYMENT",
		integrationoperation.TrustedServiceCommandSourceAppKey:        sourceApp,
		integrationoperation.TrustedServiceCommandTargetAppKey:        "assets",
		integrationoperation.TrustedServiceCommandSourceClientKey:     sourceApp + ".runtime",
		integrationoperation.TrustedRequestIDKey:                      "REQ-1",
		integrationoperation.ServiceCommandEnvelopeKey: map[string]any{
			"operationId":          "550e8400-e29b-41d4-a716-446655440000",
			"targetApp":            "assets",
			"operationCode":        "altoc.ops-knowledge.assets-link.v1",
			"requiredCapability":   capability,
			"idempotencyKey":       "altoc:ticket:ST-1:ops-knowledge:DOC-1:assets-link",
			"commandSchemaVersion": "v1",
			"commandSha256":        digest,
			"correlationId":        "altoc:ticket:ST-1:ops-knowledge:DOC-1",
			"command":              command,
		},
	}
}

func assertAssetsHTTPError(t *testing.T, err error, wantStatus int, wantCode string) {
	t.Helper()
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != wantStatus || httpErr.Code != wantCode {
		t.Fatalf("error = %#v, want %d/%s", err, wantStatus, wantCode)
	}
}
