package aims

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"testing"
	"time"
)

func TestOnboardRequiresSignedActorAndExactCapabilityBeforeDatabase(t *testing.T) {
	var adapter Adapter
	valid := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:products:onboard"}}
	for _, path := range []string{"/v1/aims/internal/products/P-1/onboard", "/v1/aims/internal/product-line-onboard"} {
		for _, key := range []string{"hzy_runtime_actor_delegated", "hzy_runtime_source_app", "hzy_runtime_tenant_code", "hzy_runtime_deployment_code", "hzy_runtime_service_client_id", "current_user_scopes"} {
			q := url.Values{}
			for k, v := range valid {
				q[k] = append([]string(nil), v...)
			}
			q.Del(key)
			_, _, handled, err := adapter.handleProductOnboardRuntime(context.Background(), http.MethodPost, path, q, nil)
			var e httperror.Error
			if !handled || !errors.As(err, &e) || e.Status != 403 {
				t.Fatalf("%s: %v", key, err)
			}
		}
	}
}

func TestOnboardRuntimeReturnsStandardEnvelopeForAuthorizedReplay(t *testing.T) {
	a, m, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()
	input := productcenter.OnboardInput{ManagerUID: "pm", Reason: "create"}
	raw, _ := json.Marshal(input)
	digest := sha256.Sum256(raw)
	now := time.Now().UnixMilli()
	deadline := now + 15000
	m.ExpectBegin()
	m.ExpectQuery(`SELECT id FROM product_catalog_control`).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
	// Only the module-ownership guard remains; a unified line no longer blocks
	// products it never took in.
	m.ExpectQuery(`SELECT COUNT`).WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(0))
	m.ExpectExec(`INSERT INTO product_workspaces`).WillReturnResult(sqlmock.NewResult(0, 0))
	m.ExpectQuery(`SELECT biz_id FROM product_workspaces`).WithArgs("P-1").WillReturnRows(sqlmock.NewRows([]string{"biz_id"}).AddRow("existing"))
	m.ExpectQuery(`SELECT CAST`).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	m.ExpectExec(`INSERT INTO product_command_receipts`).WillReturnResult(sqlmock.NewResult(0, 0))
	m.ExpectQuery(`SELECT id,request_hash`).WithArgs("P-1", "products:onboard", "u1", "key").WillReturnRows(sqlmock.NewRows([]string{"id", "hash", "status", "result", "execution"}).AddRow(1, hex.EncodeToString(digest[:]), "succeeded", `{"product_code":"P-1"}`, "old"))
	m.ExpectCommit()
	q := url.Values{"current_user": {"u1"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims.write aims:products:onboard"}}
	body := map[string]any{"input": input, "idempotency_key": "key", "authorization": productcenter.OnboardPermit{ProductCode: "P-1", ActorUID: "u1", Resource: "products", Action: "onboard", ExpiresAt: deadline}, "source": productcenter.OnboardSourceEvidence{ProductCode: "P-1", Watermark: "epoch:1", Onboardable: true, ExpiresAt: deadline}, "directory": productcenter.MemberDirectoryEvidence{ActiveUIDs: []string{"pm"}, ExpiresAt: deadline}}
	value, operation, err := a.HandleRuntime(context.Background(), http.MethodPost, "/v1/aims/internal/products/P-1/onboard", q, body)
	if err != nil {
		t.Fatal(err)
	}
	envelope, ok := value.(map[string]any)
	if !ok || envelope["code"] != 0 || operation != "aims.products.onboard" {
		t.Fatalf("bad envelope %#v", value)
	}
	result, ok := envelope["data"].(productcenter.CommandResult)
	if !ok || !result.Replayed {
		t.Fatalf("bad result %#v", envelope["data"])
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestProductLineConflictsAreHTTP409(t *testing.T) {
	for _, code := range []string{"product_line_already_managed", "product_line_has_managed_products", "product_line_source_changed", "product_managed_by_line", "product_component_source_bound"} {
		var e httperror.Error
		if !errors.As(productRuntimeError(&productcenter.RuleError{Code: code, Message: "conflict"}), &e) || e.Status != 409 {
			t.Fatalf("%s wrong status", code)
		}
	}
}
