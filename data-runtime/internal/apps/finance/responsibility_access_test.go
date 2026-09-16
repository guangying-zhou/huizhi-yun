package finance

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestFinanceResponsibilityListAndDetailUseCurrentDirectResponsibility(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u-current")
	query.Set("current_user_invoice_request_access", financeResponsibilityAccessRelation)
	where := []string{"deleted_at IS NULL"}
	args := []any{}

	applyFinanceResponsibilityListAccess(&where, &args, query, "invoice_request")
	if len(where) != 2 || where[1] != "issuance_responsible_uid = ?" || len(args) != 1 || args[0] != "u-current" {
		t.Fatalf("unexpected responsibility list filter: where=%#v args=%#v", where, args)
	}
	detailWhere, detailArgs := financeResponsibilityDetailWhere(query, "invoice_request")
	if detailWhere != "issuance_responsible_uid = ?" || len(detailArgs) != 1 || detailArgs[0] != "u-current" {
		t.Fatalf("unexpected responsibility detail filter: where=%q args=%#v", detailWhere, detailArgs)
	}
}

func TestFinanceResponsibilityTransferRevokesPreviousResponsible(t *testing.T) {
	recordAfterTransfer := map[string]any{"reconciliation_responsible_uid": "u-new"}
	oldActor := jsonBody{
		"current_user":                "u-old",
		"current_user_receipt_access": financeResponsibilityAccessRelation,
	}
	newActor := jsonBody{
		"current_user":                "u-new",
		"current_user_receipt_access": financeResponsibilityAccessRelation,
	}

	assertResponsibilityForbidden(t, requireFinanceResponsibilityBodyAccess(oldActor, recordAfterTransfer, financeReceiptResponsibilityTarget))
	if err := requireFinanceResponsibilityBodyAccess(newActor, recordAfterTransfer, financeReceiptResponsibilityTarget); err != nil {
		t.Fatalf("new direct responsible should be allowed, got %v", err)
	}
}

func TestFinanceResponsibilityTrustedGlobalOrAdminAccessAllowsAnyRecord(t *testing.T) {
	record := map[string]any{"issuance_responsible_uid": "another-user"}
	for _, actor := range []string{"global-user", "admin-user"} {
		body := jsonBody{
			"current_user":                        actor,
			"current_user_invoice_request_access": financeResponsibilityAccessAll,
		}
		if err := requireFinanceResponsibilityBodyAccess(body, record, financeInvoiceRequestResponsibilityTarget); err != nil {
			t.Fatalf("trusted all access for %s should pass, got %v", actor, err)
		}
	}

	query := url.Values{"current_user": {"global-user"}, "current_user_receipt_access": {financeResponsibilityAccessAll}}
	if where, args := financeResponsibilityDetailWhere(query, "finance_receipt"); where != "" || len(args) != 0 {
		t.Fatalf("trusted all access should not add a detail filter, got %q %#v", where, args)
	}
}

func TestFinanceResponsibilityNoneFailsClosed(t *testing.T) {
	query := url.Values{"current_user": {"u1"}, "current_user_receipt_access": {financeResponsibilityAccessNone}}
	where, args := financeResponsibilityDetailWhere(query, "finance_receipt")
	if where != "1 = 0" || len(args) != 0 {
		t.Fatalf("none detail access must return an empty set, got %q %#v", where, args)
	}
	assertResponsibilityForbidden(t, requireFinanceResponsibilityBodyAccess(jsonBody{
		"current_user":                "u1",
		"current_user_receipt_access": financeResponsibilityAccessNone,
	}, map[string]any{"reconciliation_responsible_uid": "u1"}, financeReceiptResponsibilityTarget))
}

func TestCreateReconciliationAllowsCurrentResponsible(t *testing.T) {
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id, code, customer_code, contract_code, project_code, receivable_plan_code, received_amount, reconciliation_responsible_uid FROM finance_receipt WHERE deleted_at IS NULL AND code = \? FOR UPDATE`).
		WithArgs("RCPT-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "code", "customer_code", "contract_code", "project_code", "receivable_plan_code", "received_amount", "reconciliation_responsible_uid",
		}).AddRow(int64(9), "RCPT-1", "", "", "", "", "100.00", "u-current"))
	mock.ExpectQuery(`SELECT COALESCE\(SUM\(reconciled_amount\), 0\) AS amount FROM finance_reconciliation`).
		WithArgs(int64(9), "active").
		WillReturnRows(sqlmock.NewRows([]string{"amount"}).AddRow("0.00"))
	mock.ExpectExec(`(?s)INSERT INTO finance_reconciliation`).
		WithArgs("REC-1", int64(9), nil, "", "", "", "", "10.00", "2026-07-10 12:00:00", "contract_receivable", nil).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`(?s)SELECT.*receipt.received_amount.*FROM finance_receipt receipt.*WHERE receipt.id = \?`).
		WithArgs(int64(9)).
		WillReturnRows(sqlmock.NewRows([]string{"received_amount", "reconciled_amount"}).AddRow("100.00", "10.00"))
	mock.ExpectExec(`(?s)UPDATE finance_receipt.*SET reconciled_amount = \?, unreconciled_amount = \?, status = \?`).
		WithArgs("10.00", "90.00", "partially_reconciled", int64(9)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT \* FROM finance_reconciliation WHERE code = \?`).
		WithArgs("REC-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "receipt_id", "reconciled_amount", "status"}).AddRow(int64(1), "REC-1", int64(9), "10.00", "active"))
	mock.ExpectCommit()

	result, err := adapter.CreateReconciliation(context.Background(), jsonBody{
		"code":                        "REC-1",
		"receiptCode":                 "RCPT-1",
		"reconciledAmount":            "10.00",
		"reconciledAt":                "2026-07-10 12:00:00",
		"current_user":                "u-current",
		"current_user_receipt_access": financeResponsibilityAccessRelation,
	})
	if err != nil {
		t.Fatalf("current reconciliation responsible should complete reconciliation: %v", err)
	}
	if result.Data == nil || result.Data["code"] != "REC-1" {
		t.Fatalf("unexpected reconciliation result: %#v", result.Data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCreateReconciliationRejectsPreviousResponsibleAfterTransfer(t *testing.T) {
	adapter, mock, closeDB := newFinanceSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id, code, customer_code, contract_code, project_code, receivable_plan_code, received_amount, reconciliation_responsible_uid FROM finance_receipt WHERE deleted_at IS NULL AND code = \? FOR UPDATE`).
		WithArgs("RCPT-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "code", "customer_code", "contract_code", "project_code", "receivable_plan_code", "received_amount", "reconciliation_responsible_uid",
		}).AddRow(int64(9), "RCPT-1", "", "", "", "", "100.00", "u-new"))
	mock.ExpectRollback()

	_, err := adapter.CreateReconciliation(context.Background(), jsonBody{
		"code":                        "REC-2",
		"receiptCode":                 "RCPT-1",
		"reconciledAmount":            "10.00",
		"current_user":                "u-old",
		"current_user_receipt_access": financeResponsibilityAccessRelation,
	})
	assertResponsibilityForbidden(t, err)
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func assertResponsibilityForbidden(t *testing.T, err error) {
	t.Helper()
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_responsibility_scope_denied" {
		t.Fatalf("expected finance responsibility forbidden error, got %#v", err)
	}
}
