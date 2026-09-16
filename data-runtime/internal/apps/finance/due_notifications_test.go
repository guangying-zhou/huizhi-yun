package finance

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

func TestFinanceDueResponsibilityRequiresExactPairAndUID(t *testing.T) {
	for _, body := range []jsonBody{
		{"issuanceResponsibleUid": "owner-1"},
		{"issuanceResponsibleUid": " owner-1 ", "issuanceDueAt": "2026-08-01T12:00:00Z"},
		{"issuanceResponsibleUid": "@all", "issuanceDueAt": "2026-08-01T12:00:00Z"},
		{"issuanceResponsibleUid": "owner\n1", "issuanceDueAt": "2026-08-01T12:00:00Z"},
	} {
		if err := normalizeFinanceDueResponsibilityMutation(http.MethodPost, "/v1/finance/invoice-requests", body); err == nil {
			t.Fatalf("invalid responsibility accepted: %#v", body)
		}
	}
	body := jsonBody{"issuanceResponsibleUid": "owner-1", "issuanceDueAt": "2026-08-01T12:00:00+08:00"}
	if err := normalizeFinanceDueResponsibilityMutation(http.MethodPost, "/v1/finance/invoice-requests", body); err != nil {
		t.Fatal(err)
	}
	if body["issuanceDueAt"] != "2026-08-01 04:00:00" {
		t.Fatalf("due normalization=%#v", body["issuanceDueAt"])
	}
}

func TestInvoiceRequestDirectCreateCannotForgeApprovedOrIssued(t *testing.T) {
	adapter := &Adapter{}
	for _, status := range []string{"approved", "issued", "pending_approval"} {
		_, _, err := adapter.HandleMutationWithQuery(context.Background(), http.MethodPost, "/v1/finance/invoice-requests", nil, map[string]any{
			"requestedAmount": "10.00", "status": status,
		})
		if err == nil {
			t.Fatalf("direct create status %q was accepted", status)
		}
	}
}

func TestApproveInvoiceRequestOnlyMarksApproved(t *testing.T) {
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	tx, err := adapter.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectExec(`(?s)UPDATE invoice_request.*SET status = 'approved'.*approved_at`).
		WithArgs("wf-1", "approver-1", int64(7)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectRollback()
	err = adapter.approveInvoiceRequest(context.Background(), tx, map[string]any{"id": int64(7)}, approvalOptions{WorkflowInstanceID: "wf-1", Operator: "approver-1"})
	if err != nil {
		t.Fatal(err)
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueInvoiceRequestRejectsUnapprovedAndUntrustedBrowserActor(t *testing.T) {
	for _, test := range []struct {
		name string
		row  *sqlmock.Rows
		body jsonBody
		code string
	}{
		{name: "draft", row: sqlmock.NewRows([]string{"id", "code", "status"}).AddRow(1, "IR-1", "draft"), body: jsonBody{"current_user": "issuer-1"}, code: "invalid_status"},
		{name: "browser actor", row: sqlmock.NewRows([]string{"id", "code", "status", "requested_amount", "invoice_medium"}).AddRow(1, "IR-1", "approved", "10.00", "electronic"), body: jsonBody{"invoiceNo": "N-1", "invoiceFileUrl": "https://files.test/a.pdf", "issuedBy": "forged", "updatedBy": "forged"}, code: "trusted_actor_required"},
	} {
		t.Run(test.name, func(t *testing.T) {
			adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
			defer closeDB()
			mock.ExpectBegin()
			mock.ExpectQuery(`(?s)SELECT \*.*FROM invoice_request.*FOR UPDATE`).WithArgs("IR-1").WillReturnRows(test.row)
			mock.ExpectRollback()
			_, err := adapter.IssueInvoiceRequest(context.Background(), "IR-1", test.body)
			httpErr, ok := err.(httperror.Error)
			if !ok || httpErr.Code != test.code {
				t.Fatalf("error=%#v, want %s", err, test.code)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAssignInvoiceIssuanceIsLockedIdempotentAndApprovedOnly(t *testing.T) {
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \* FROM invoice_request.*FOR UPDATE`).WithArgs("IR-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "status", "issued_invoice_id", "issuance_responsible_uid", "issuance_due_at"}).
			AddRow(1, "IR-1", "approved", nil, "issuer-1", "2026-08-01 12:00:00"))
	mock.ExpectCommit()
	result, err := adapter.AssignInvoiceIssuance(context.Background(), "IR-1", jsonBody{
		"current_user": "manager-1", "issuanceResponsibleUid": "issuer-1", "issuanceDueAt": "2026-08-01 12:00:00",
	})
	if err != nil || result.Data["idempotent"] != true {
		t.Fatalf("result=%#v err=%v", result.Data, err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT \* FROM invoice_request.*FOR UPDATE`).WithArgs("IR-2").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "status", "issued_invoice_id"}).AddRow(2, "IR-2", "draft", nil))
	mock.ExpectRollback()
	_, err = adapter.AssignInvoiceIssuance(context.Background(), "IR-2", jsonBody{
		"current_user": "manager-1", "issuanceResponsibleUid": "issuer-1", "issuanceDueAt": "2026-08-01 12:00:00",
	})
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "invalid_status" {
		t.Fatalf("error=%#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestFinanceDuePhaseAndCursorContract(t *testing.T) {
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		due  time.Time
		want string
	}{
		{asOf.Add(30 * 24 * time.Hour), "D30"},
		{asOf.Add(7 * 24 * time.Hour), "D7"},
		{asOf.Add(24 * time.Hour), "D1"},
		{asOf, "expired"},
	} {
		if got := financeDuePhase(asOf, test.due); got != test.want {
			t.Fatalf("phase=%q want=%q", got, test.want)
		}
	}
	cursor, err := encodeFinanceDueCursor(asOf, 17)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeFinanceDueCursor(cursor)
	if err != nil || decoded.ID != 17 || decoded.DueAt != asOf.Format(time.RFC3339) {
		t.Fatalf("decoded=%#v err=%v", decoded, err)
	}
}

func TestQueryFinanceDueFactsUsesExactActionableConditions(t *testing.T) {
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery(`(?s)FROM invoice_request.*status='approved'.*issued_invoice_id IS NULL.*issuance_due_at<=\?.*ORDER BY issuance_due_at`).
		WithArgs(asOf.AddDate(0, 0, 30), 3).
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "name", "responsible_uid", "due_at"}).
			AddRow(1, "IR-1", "Customer", "issuer-1", asOf.Add(24*time.Hour)))
	facts, err := adapter.queryFinanceDueFacts(context.Background(), financeInvoiceIssuanceDueStream, asOf, nil, 3)
	if err != nil || len(facts) != 1 || facts[0].SourceType != "invoice_request" || facts[0].Code != "IR-1" {
		t.Fatalf("invoice facts=%#v err=%v", facts, err)
	}
	mock.ExpectQuery(`(?s)FROM finance_receipt r.*status IN \('confirmed','partially_reconciled'\).*finance_reconciliation.*reconciliation_due_at<=\?.*ORDER BY r.reconciliation_due_at`).
		WithArgs(asOf.AddDate(0, 0, 30), 3).
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "name", "responsible_uid", "due_at"}).
			AddRow(2, "RCV-1", "Customer", "reconciler-1", asOf.Add(7*24*time.Hour)))
	facts, err = adapter.queryFinanceDueFacts(context.Background(), financeReceiptReconciliationDueStream, asOf, nil, 3)
	if err != nil || len(facts) != 1 || facts[0].SourceType != "finance_receipt" || facts[0].Code != "RCV-1" {
		t.Fatalf("receipt facts=%#v err=%v", facts, err)
	}
}

func TestFinanceNotificationDetailAuthorizationIsExactCurrentResponsibleOnly(t *testing.T) {
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()
	query := url.Values{"current_user": {"issuer-1"}, "hzy_runtime_actor_purpose": {financeNotificationDetailActorPurpose}}
	mock.ExpectQuery(`(?s)SELECT id,CASE WHEN status='approved'.*issuance_responsible_uid=\?.*FROM invoice_request`).
		WithArgs("issuer-1", "IR-1").WillReturnRows(sqlmock.NewRows([]string{"id", "related"}).AddRow(1, 1))
	result, err := adapter.AuthorizeNotificationDetail(context.Background(), query, map[string]any{"descriptor": map[string]any{"resource": "invoice_request", "id": "IR-1"}})
	if err != nil || result["authorized"] != true || result["reasonCode"] != "allowed" || len(result) != 4 {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if _, err := adapter.AuthorizeNotificationDetail(context.Background(), query, map[string]any{"descriptor": map[string]any{"resource": "invoice_request", "id": "IR-1", "actor": "forged"}}); err == nil {
		t.Fatal("descriptor with extra field was accepted")
	}
	if _, err := adapter.AuthorizeNotificationDetail(context.Background(), url.Values{"current_user": {"issuer-1"}}, map[string]any{"descriptor": map[string]any{"resource": "invoice_request", "id": "IR-1"}}); err == nil {
		t.Fatal("missing purpose was accepted")
	}
}

func TestFinanceDueAckRecoversPublishSuccessAndRejectsRecipientDrift(t *testing.T) {
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectExec(`(?s)UPDATE finance_notification_checkpoint.*JSON_CONTAINS`).
		WithArgs("notice-1", "owner-1", "v1:event", "owner-1", "notice-1", "owner-1").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT state,notification_id,notified_recipient_uid`).WithArgs("v1:event").
		WillReturnRows(sqlmock.NewRows([]string{"state", "notification_id", "notified_recipient_uid"}).AddRow("open", "notice-1", "owner-1"))
	result, err := adapter.acknowledgeFinanceDueNotification(context.Background(), map[string]any{"eventVersion": "v1:event", "notificationId": "notice-1", "recipientUid": "owner-1"})
	if err != nil || result["idempotent"] != true {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	mock.ExpectExec(`(?s)UPDATE finance_notification_checkpoint.*JSON_CONTAINS`).
		WithArgs("notice-2", "outsider", "v1:event-2", "outsider", "notice-2", "outsider").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT state,notification_id,notified_recipient_uid`).WithArgs("v1:event-2").WillReturnError(sql.ErrNoRows)
	if _, err := adapter.acknowledgeFinanceDueNotification(context.Background(), map[string]any{"eventVersion": "v1:event-2", "notificationId": "notice-2", "recipientUid": "outsider"}); err == nil {
		t.Fatal("recipient outside checkpoint evidence was accepted")
	}
}
