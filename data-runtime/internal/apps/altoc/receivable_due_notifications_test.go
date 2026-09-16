package altoc

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestCollectionResponsibleMutationIsExplicitAndExact(t *testing.T) {
	for _, body := range []map[string]any{
		{"collectionResponsibleUid": " owner-1 "},
		{"collectionResponsibleUid": "@all"},
		{"collectionResponsibleUid": "owner\n1"},
		{"collectionResponsibleUid": 42},
	} {
		if err := normalizeCollectionResponsibleMutation(body); err == nil {
			t.Fatalf("invalid responsibility accepted: %#v", body)
		}
	}
	body := map[string]any{"owner_user_id": "contract-owner", "collectionResponsibleUid": "collector-1"}
	if err := normalizeCollectionResponsibleMutation(body); err != nil {
		t.Fatal(err)
	}
	if body["collection_responsible_uid"] != "collector-1" || body["owner_user_id"] != "contract-owner" {
		t.Fatalf("body=%#v", body)
	}
	empty := map[string]any{"collectionResponsibleUid": nil}
	if err := normalizeCollectionResponsibleMutation(empty); err != nil || empty["collection_responsible_uid"] != nil {
		t.Fatalf("empty=%#v err=%v", empty, err)
	}
	// No assignment remains valid; generated and historical plans must not infer one.
	if err := normalizeCollectionResponsibleMutation(map[string]any{"owner_user_id": "owner-1"}); err != nil {
		t.Fatal(err)
	}
}

func TestAltocNotificationDetailAuthorizationSupportsExactDeadLetterGeneration(t *testing.T) {
	a, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()
	operationID := "550e8400-e29b-41d4-a716-446655440099"
	query := url.Values{"current_user": {"u-1"}, "hzy_runtime_actor_purpose": {"notification-detail-authorization"}, "hzy_runtime_tenant_code": {"tenant-a"}, "hzy_runtime_deployment_code": {"deployment-a"}, "hzy_runtime_source_app": {"altoc"}}
	mock.ExpectQuery(`(?s)SELECT d.recipient_uids.*d.closure_state.*i.status.*i.version_no.*d.source_operation_version.*WHERE d.operation_id = \?.*d.notification_id = \?.*d.tenant_code = \?.*d.deployment_code = \?.*d.source_app = \?`).
		WithArgs(operationID, "notification-1", "tenant-a", "deployment-a", "altoc").
		WillReturnRows(sqlmock.NewRows([]string{"recipient_uids", "closure_state", "status", "version_no", "source_operation_version"}).AddRow(`["u-1"]`, nil, "dead_letter", 7, 7))
	result, err := a.authorizeReceivableNotificationDetail(context.Background(), query, map[string]any{"notificationId": "notification-1", "descriptor": map[string]any{"resource": "integration_operation", "id": operationID}})
	if err != nil || len(result) != 4 || result["authorized"] != true || result["reasonCode"] != "allowed" || result["resource"] != "integration_operation" || result["id"] != operationID {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func TestReceivableDueRouteAndCalendarPhaseCursor(t *testing.T) {
	a := &Adapter{}
	_, op, matched, err := a.handleReceivableNotificationRuntime(context.Background(), http.MethodPost, "/v1/altoc/service/notifications:scan-receivable-due", nil, nil)
	if matched || op != "" || err != nil {
		t.Fatalf("legacy path matched=%v op=%q err=%v", matched, op, err)
	}
	asOf := time.Date(2026, 7, 10, 23, 30, 0, 0, time.FixedZone("east", 8*3600))
	for _, tt := range []struct {
		date string
		want string
	}{{"2026-08-09", "D30"}, {"2026-07-17", "D7"}, {"2026-07-11", "D1"}, {"2026-07-10", "D1"}, {"2026-07-09", "expired"}} {
		due, _ := time.Parse("2006-01-02", tt.date)
		if got := altocReceivableDuePhase(asOf, due); got != tt.want {
			t.Fatalf("%s phase=%s want=%s", tt.date, got, tt.want)
		}
	}
	cursor, err := encodeAltocReceivableDueCursor(time.Date(2026, 7, 20, 8, 0, 0, 0, time.UTC), 17)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeAltocReceivableDueCursor(cursor)
	if err != nil || decoded.ID != 17 || decoded.DueAt != "2026-07-20" {
		t.Fatalf("cursor=%#v err=%v", decoded, err)
	}
}

func TestQueryReceivableDueFactsUsesDedicatedResponsibilityAndStrictBalance(t *testing.T) {
	a, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()
	asOf := time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`(?s)FROM receivable_plan.*status IN \('to_receive','partially_received','overdue'\).*GREATEST\(COALESCE\(amount,0\)-COALESCE\(received_amount,0\),0\)>0.*collection_responsible_uid IS NOT NULL.*ORDER BY planned_payment_date`).WithArgs("2026-08-09", 3).
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "name", "responsible", "due"}).AddRow(1, "RP-1", "Plan", "collector-1", time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)).AddRow(2, "RP-2", "Plan", "@all", time.Date(2026, 7, 17, 0, 0, 0, 0, time.UTC)))
	facts, err := a.queryReceivableDueFacts(context.Background(), asOf, nil, 3)
	if err != nil || len(facts) != 1 || facts[0].ResponsibleUID != "collector-1" {
		t.Fatalf("facts=%#v err=%v", facts, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReceivableNotificationDetailIsExactCurrentCollectorOnly(t *testing.T) {
	a, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()
	query := url.Values{"current_user": {"collector-1"}, "hzy_runtime_actor_purpose": {"notification-detail-authorization"}}
	mock.ExpectQuery(`(?s)SELECT id,CASE WHEN status IN.*GREATEST.*collection_responsible_uid=\?.*FROM receivable_plan`).WithArgs("collector-1", "RP-1").WillReturnRows(sqlmock.NewRows([]string{"id", "related"}).AddRow(1, 1))
	result, err := a.authorizeReceivableNotificationDetail(context.Background(), query, map[string]any{"descriptor": map[string]any{"resource": "receivable_plan", "id": "RP-1"}})
	if err != nil || result["authorized"] != true || len(result) != 4 {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	// A former collector is denied immediately after responsibility moves.
	mock.ExpectQuery(`(?s)SELECT id,CASE WHEN status IN.*GREATEST.*collection_responsible_uid=\?.*FROM receivable_plan`).WithArgs("collector-1", "RP-1").WillReturnRows(sqlmock.NewRows([]string{"id", "related"}).AddRow(1, 0))
	result, err = a.authorizeReceivableNotificationDetail(context.Background(), query, map[string]any{"descriptor": map[string]any{"resource": "receivable_plan", "id": "RP-1"}})
	if err != nil || result["authorized"] != false || result["reasonCode"] != "not_authorized" {
		t.Fatalf("former collector result=%#v err=%v", result, err)
	}
	// A plan owner who is not the current collector does not inherit notification detail access.
	ownerQuery := url.Values{"current_user": {"plan-owner"}, "hzy_runtime_actor_purpose": {"notification-detail-authorization"}}
	mock.ExpectQuery(`(?s)SELECT id,CASE WHEN status IN.*GREATEST.*collection_responsible_uid=\?.*FROM receivable_plan`).WithArgs("plan-owner", "RP-1").WillReturnRows(sqlmock.NewRows([]string{"id", "related"}).AddRow(1, 0))
	result, err = a.authorizeReceivableNotificationDetail(context.Background(), ownerQuery, map[string]any{"descriptor": map[string]any{"resource": "receivable_plan", "id": "RP-1"}})
	if err != nil || result["authorized"] != false || result["reasonCode"] != "not_authorized" {
		t.Fatalf("unrelated owner result=%#v err=%v", result, err)
	}
	if _, err := a.authorizeReceivableNotificationDetail(context.Background(), query, map[string]any{"descriptor": map[string]any{"resource": "receivable_plan", "id": "RP-1", "owner": "forged"}}); err == nil {
		t.Fatal("extra descriptor key accepted")
	}
	if _, err := a.authorizeReceivableNotificationDetail(context.Background(), url.Values{"current_user": {"collector-1"}}, map[string]any{"descriptor": map[string]any{"resource": "receivable_plan", "id": "RP-1"}}); err == nil {
		t.Fatal("missing purpose accepted")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReceivableDueAckRecoversPublishSuccessAndRejectsRecipientDrift(t *testing.T) {
	a, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectExec(`(?s)UPDATE altoc_receivable_notification_checkpoint.*JSON_CONTAINS`).WithArgs("notice-1", "collector-1", "v1:event", "collector-1", "notice-1", "collector-1").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT state,notification_id,notified_recipient_uid`).WithArgs("v1:event").WillReturnRows(sqlmock.NewRows([]string{"state", "notification_id", "notified_recipient_uid"}).AddRow("open", "notice-1", "collector-1"))
	result, err := a.acknowledgeReceivableDueNotification(context.Background(), map[string]any{"eventVersion": "v1:event", "notificationId": "notice-1", "recipientUid": "collector-1"})
	if err != nil || result["idempotent"] != true {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	mock.ExpectExec(`(?s)UPDATE altoc_receivable_notification_checkpoint.*JSON_CONTAINS`).WithArgs("notice-2", "outsider", "v1:event-2", "outsider", "notice-2", "outsider").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT state,notification_id,notified_recipient_uid`).WithArgs("v1:event-2").WillReturnError(sql.ErrNoRows)
	_, err = a.acknowledgeReceivableDueNotification(context.Background(), map[string]any{"eventVersion": "v1:event-2", "notificationId": "notice-2", "recipientUid": "outsider"})
	var httpErr httperror.Error
	if err == nil || !errorAsAltoc(err, &httpErr) || httpErr.Code != "altoc_receivable_due_ack_conflict" {
		t.Fatalf("err=%v", err)
	}
}

func TestReceivableDueClosureAckIsCASAndIdempotent(t *testing.T) {
	a, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectExec(`(?s)UPDATE altoc_receivable_notification_checkpoint SET lifecycle_closed_at`).WithArgs("resolved:v1:event", "v1:event", "resolved:v1:event").WillReturnResult(sqlmock.NewResult(0, 1))
	result, err := a.acknowledgeReceivableDueClosure(context.Background(), map[string]any{"eventVersion": "v1:event", "nextVersion": "resolved:v1:event"})
	if err != nil || result["acknowledged"] != true {
		t.Fatalf("result=%#v err=%v", result, err)
	}
}

func errorAsAltoc(err error, target *httperror.Error) bool {
	v, ok := err.(httperror.Error)
	if ok {
		*target = v
	}
	return ok
}
