package assets

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestAssetsDuePhaseAndCursorContract(t *testing.T) {
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		due   time.Time
		phase string
	}{{time.Date(2026, 8, 9, 23, 59, 59, 0, time.UTC), "D30"}, {asOf.Add(6 * 24 * time.Hour), "D7"}, {asOf.Add(12 * time.Hour), "D1"}, {asOf.Add(-time.Second), "expired"}} {
		if got := assetsDuePhase(asOf, tc.due); got != tc.phase {
			t.Fatalf("phase got %q want %q", got, tc.phase)
		}
	}
	encoded, err := encodeAssetsDueCursor(asOf, 42)
	if err != nil {
		t.Fatal(err)
	}
	cursor, err := decodeAssetsDueCursor(encoded)
	if err != nil || cursor.ID != 42 || cursor.DueAt != asOf.Format(time.RFC3339) {
		t.Fatalf("cursor round trip: %#v err=%v", cursor, err)
	}
	if _, err := decodeAssetsDueCursor("not-a-cursor"); err == nil {
		t.Fatal("invalid cursor accepted")
	}
}

func TestAssetsDueCandidateContractKeepsActionableKeyAcrossPhase(t *testing.T) {
	publicID := "public-1"
	fact := assetsDueFact{ID: 7, SourceType: "asset_item", Code: "AST-7", Name: "Resource", PublicID: &publicID,
		DueAt: time.Date(2026, 7, 20, 23, 59, 59, 0, time.UTC), Recipients: []string{"owner", "custodian", "user"}}
	d30 := buildAssetsDueCandidate(assetsDueResource, "D30", fact, 2)
	d7 := buildAssetsDueCandidate(assetsDueResource, "D7", fact, 2)
	if d30.SourceType != "asset_item" || d30.SourceID != 7 || d30.SourceCode != "AST-7" || d30.SourceName != "Resource" || d30.PublicID == nil || *d30.PublicID != publicID {
		t.Fatalf("candidate source contract: %#v", d30)
	}
	if d30.ActionableKey != d7.ActionableKey || d30.EventVersion == d7.EventVersion || d30.IdempotencyKey == d7.IdempotencyKey {
		t.Fatalf("phase contract d30=%#v d7=%#v", d30, d7)
	}
	for index, want := range []string{"owner", "custodian", "user"} {
		if d30.RecipientCandidates[index] != want {
			t.Fatalf("recipient chain reordered: %#v", d30.RecipientCandidates)
		}
	}
}

func TestQueryAssetsDueFactsOnlyReturnsDirectResourceRelations(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	expires := time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`(?s)FROM asset_items ai.*JOIN asset_resource_details.*ai.asset_category = 'resource'.*ai.status = 'active'.*ORDER BY ard.expires_at ASC, ai.id ASC`).
		WithArgs("2026-08-09", 3).
		WillReturnRows(sqlmock.NewRows([]string{"id", "public_id", "asset_code", "asset_name", "expires_at", "owner_uid", "custodian_uid", "user_uid"}).
			AddRow(int64(1), "pub-1", "AST-1", "Resource", expires, "owner", "custodian", "owner"))
	facts, err := adapter.queryAssetsDueFacts(context.Background(), assetsDueResource, time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC), nil, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(facts) != 1 || facts[0].PublicID == nil || *facts[0].PublicID != "pub-1" || len(facts[0].Recipients) != 2 || facts[0].Recipients[0] != "owner" || facts[0].Recipients[1] != "custodian" {
		t.Fatalf("unexpected direct recipients: %#v", facts)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestQueryAssetsDueFactsIPAddsOnlyLinkedProductOwners(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	expires := time.Date(2026, 7, 20, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`(?s)FROM ip_assets ip.*ip.status = 'active'.*ORDER BY ip.expires_at ASC, ip.id ASC`).
		WithArgs("2026-08-09", 3).
		WillReturnRows(sqlmock.NewRows([]string{"id", "ip_code", "ip_name", "expires_at", "owner_uid"}).
			AddRow(int64(9), "IP-9", "Patent", expires, "ip-owner"))
	mock.ExpectQuery(`(?s)FROM ip_asset_products iap.*JOIN product_assets p.*iap.ip_asset_id IN \(\?\)`).
		WithArgs(int64(9)).
		WillReturnRows(sqlmock.NewRows([]string{"ip_asset_id", "business_owner_uid", "technical_owner_uid"}).
			AddRow(int64(9), "business", "technical"))
	facts, err := adapter.queryAssetsDueFacts(context.Background(), assetsDueIP, time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC), nil, 3)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"ip-owner", "technical", "business"}
	if len(facts) != 1 || len(facts[0].Recipients) != len(want) {
		t.Fatalf("unexpected facts: %#v", facts)
	}
	for index := range want {
		if facts[0].Recipients[index] != want[index] {
			t.Fatalf("recipients got %#v want %#v", facts[0].Recipients, want)
		}
	}
}

func TestQueryAssetsDueFactsDeliveryUsesOnlyExplicitResponsibleUID(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	dueAt := time.Date(2026, 7, 20, 15, 30, 0, 0, time.UTC)
	mock.ExpectQuery(`(?s)FROM customer_delivery_assets cda.*cda.status IN.*cda.warranty_end_at IS NOT NULL.*ORDER BY cda.warranty_end_at ASC, cda.id ASC`).
		WithArgs("2026-08-09 12:00:00", 3).
		WillReturnRows(sqlmock.NewRows([]string{"id", "delivery_asset_code", "product_name", "warranty_end_at", "responsible_uid"}).
			AddRow(int64(12), "CDA-12", "Customer license", dueAt, "delivery-owner"))
	facts, err := adapter.queryAssetsDueFacts(context.Background(), assetsDueDeliveryWarranty, time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC), nil, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(facts) != 1 || facts[0].SourceType != "customer_delivery_asset" || !facts[0].DueAt.Equal(dueAt) || len(facts[0].Recipients) != 1 || facts[0].Recipients[0] != "delivery-owner" {
		t.Fatalf("unexpected delivery due facts: %#v", facts)
	}
}

func TestAcknowledgeAssetsDueNotificationRequiresCandidateAndIsRecoverable(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectExec(`(?s)UPDATE assets_notification_checkpoint.*JSON_CONTAINS`).
		WithArgs("notice-1", "owner", "v1:event", "owner", "notice-1", "owner").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT state, notification_id, notified_recipient_uid`).WithArgs("v1:event").
		WillReturnRows(sqlmock.NewRows([]string{"state", "notification_id", "notified_recipient_uid"}).AddRow("open", "notice-1", "owner"))
	result, err := adapter.acknowledgeAssetsDueNotification(context.Background(), map[string]any{"eventVersion": "v1:event", "notificationId": "notice-1", "recipientUid": "owner"})
	if err != nil || result["idempotent"] != true {
		t.Fatalf("ack loss recovery result=%#v err=%v", result, err)
	}

	mock.ExpectExec(`(?s)UPDATE assets_notification_checkpoint.*JSON_CONTAINS`).
		WithArgs("notice-2", "outsider", "v1:event-2", "outsider", "notice-2", "outsider").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT state, notification_id, notified_recipient_uid`).WithArgs("v1:event-2").WillReturnError(sql.ErrNoRows)
	if _, err := adapter.acknowledgeAssetsDueNotification(context.Background(), map[string]any{"eventVersion": "v1:event-2", "notificationId": "notice-2", "recipientUid": "outsider"}); err == nil {
		t.Fatal("recipient outside candidate evidence accepted")
	}
}
