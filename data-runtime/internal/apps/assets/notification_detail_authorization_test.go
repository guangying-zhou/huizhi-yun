package assets

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestAssetsNotificationDetailAuthorizationUsesCurrentDirectRelationAndEchoesDescriptor(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)SELECT ai.id,.*FROM asset_items ai.*WHERE ai.asset_code=\?`).
		WithArgs("owner-1", "AST-001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "related"}).AddRow(int64(7), 1))

	query := url.Values{"current_user": {"owner-1"}, "hzy_runtime_actor_purpose": {assetsNotificationDetailActorPurpose}}
	result, operation, handled, err := adapter.handleNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost,
		"/v1/assets/notification-details/authorize", query, map[string]any{"descriptor": map[string]any{"resource": "asset_item", "id": "AST-001"}})
	if err != nil || !handled || operation != "assets.notification_details.authorize" {
		t.Fatalf("unexpected route result handled=%v operation=%q err=%v", handled, operation, err)
	}
	response := result.(map[string]any)
	if response["authorized"] != true || response["resource"] != "asset_item" || response["id"] != "AST-001" {
		t.Fatalf("unexpected response: %#v", response)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAssetsNotificationDetailAuthorizationIPProductOwnerAndNotFound(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)SELECT ip.id,.*FROM ip_assets ip.*WHERE ip.ip_code=\?`).
		WithArgs("tech-1", "tech-1", "IP-001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "related"}).AddRow(int64(9), 1))
	mock.ExpectQuery(`(?s)SELECT ip.id,.*FROM ip_assets ip.*WHERE ip.ip_code=\?`).
		WithArgs("tech-1", "tech-1", "IP-MISSING").WillReturnError(sql.ErrNoRows)
	query := url.Values{"current_user": {"tech-1"}, "hzy_runtime_actor_purpose": {assetsNotificationDetailActorPurpose}}
	for _, tc := range []struct {
		id         string
		authorized bool
		reason     string
	}{{"IP-001", true, "allowed"}, {"IP-MISSING", false, "not_found"}} {
		result, _, _, err := adapter.handleNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost,
			"/v1/assets/notification-details/authorize", query, map[string]any{"descriptor": map[string]any{"resource": "ip_asset", "id": tc.id}})
		if err != nil {
			t.Fatalf("authorize %s: %v", tc.id, err)
		}
		response := result.(map[string]any)
		if response["authorized"] != tc.authorized || response["reasonCode"] != tc.reason || response["id"] != tc.id {
			t.Fatalf("unexpected %s response: %#v", tc.id, response)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAssetsNotificationDetailAuthorizationFailsClosed(t *testing.T) {
	adapter, _, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	_, _, handled, err := adapter.handleNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost,
		"/v1/assets/notification-details/authorize", url.Values{"current_user": {"owner-1"}},
		map[string]any{"descriptor": map[string]any{"resource": "asset_item", "id": "AST-001"}})
	if !handled || err == nil {
		t.Fatal("missing trusted purpose must fail closed")
	}
	_, _, _, err = adapter.handleNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost,
		"/v1/assets/notification-details/authorize",
		url.Values{"current_user": {"owner-1"}, "hzy_runtime_actor_purpose": {assetsNotificationDetailActorPurpose}},
		map[string]any{"descriptor": map[string]any{"resource": "asset_item", "id": "AST-001", "extra": true}})
	if err == nil {
		t.Fatal("descriptor with extra fields must be rejected")
	}
}

func TestAssetsNotificationDetailAuthorizationRejectsNonRelation(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)SELECT ai.id,.*FROM asset_items ai.*WHERE ai.asset_code=\?`).
		WithArgs("outsider", "AST-001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "related"}).AddRow(int64(7), 0))
	query := url.Values{"current_user": {"outsider"}, "hzy_runtime_actor_purpose": {assetsNotificationDetailActorPurpose}}
	result, _, _, err := adapter.handleNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost,
		"/v1/assets/notification-details/authorize", query, map[string]any{"descriptor": map[string]any{"resource": "asset_item", "id": "AST-001"}})
	if err != nil {
		t.Fatal(err)
	}
	response := result.(map[string]any)
	if response["authorized"] != false || response["reasonCode"] != "not_authorized" || response["resource"] != "asset_item" || response["id"] != "AST-001" {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestAssetsNotificationDetailAuthorizationCustomerDeliveryUsesCurrentResponsibleUID(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)SELECT cda.id,.*cda.responsible_uid=\?.*FROM customer_delivery_assets cda.*WHERE cda.delivery_asset_code=\?`).
		WithArgs("delivery-owner", "CDA-001").
		WillReturnRows(sqlmock.NewRows([]string{"id", "related"}).AddRow(int64(11), 1))
	query := url.Values{"current_user": {"delivery-owner"}, "hzy_runtime_actor_purpose": {assetsNotificationDetailActorPurpose}}
	result, _, handled, err := adapter.handleNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost,
		"/v1/assets/notification-details/authorize", query, map[string]any{"descriptor": map[string]any{"resource": "customer_delivery_asset", "id": "CDA-001"}})
	if err != nil || !handled {
		t.Fatalf("authorize delivery handled=%v err=%v", handled, err)
	}
	response := result.(map[string]any)
	if response["authorized"] != true || response["resource"] != "customer_delivery_asset" || response["id"] != "CDA-001" {
		t.Fatalf("unexpected delivery response: %#v", response)
	}
}

func TestAssetsNotificationDetailAuthorizationRejectsTransferredRelations(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	query := url.Values{"current_user": {"old-owner"}, "hzy_runtime_actor_purpose": {assetsNotificationDetailActorPurpose}}
	for _, test := range []struct {
		resource string
		code     string
		pattern  string
		args     []driver.Value
	}{
		{"asset_item", "AST-001", `(?s)SELECT ai.id,.*FROM asset_items ai.*WHERE ai.asset_code=\?`, []driver.Value{"old-owner", "AST-001"}},
		{"ip_asset", "IP-001", `(?s)SELECT ip.id,.*FROM ip_assets ip.*WHERE ip.ip_code=\?`, []driver.Value{"old-owner", "old-owner", "IP-001"}},
		{"offboarding_recovery_case", "AOR-001", `(?s)SELECT c.id,.*recovery_responsible_uid=\?.*FROM asset_offboarding_recovery_cases`, []driver.Value{"old-owner", "AOR-001"}},
	} {
		mock.ExpectQuery(test.pattern).WithArgs(test.args...).WillReturnRows(sqlmock.NewRows([]string{"id", "related"}).AddRow(1, 0))
		result, _, _, err := adapter.handleNotificationDetailAuthorizationRuntime(context.Background(), http.MethodPost,
			"/v1/assets/notification-details/authorize", query, map[string]any{"descriptor": map[string]any{"resource": test.resource, "id": test.code}})
		if err != nil || result.(map[string]any)["authorized"] != false {
			t.Fatalf("resource=%s result=%#v err=%v", test.resource, result, err)
		}
	}
}
