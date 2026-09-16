package altoc

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/apps/finance"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type emptyReceivableFinanceBridge struct{}

func (emptyReceivableFinanceBridge) ContractSummaries(context.Context, url.Values) (finance.DataResult[[]finance.ContractSummary], error) {
	return finance.DataResult[[]finance.ContractSummary]{}, nil
}
func (emptyReceivableFinanceBridge) ContractSummary(context.Context, string) (finance.DataResult[finance.ContractSummary], error) {
	return finance.DataResult[finance.ContractSummary]{}, nil
}
func (emptyReceivableFinanceBridge) Invoices(context.Context, url.Values) (finance.ListResult[map[string]any], error) {
	return finance.ListResult[map[string]any]{Data: []map[string]any{}}, nil
}
func (emptyReceivableFinanceBridge) Receipts(context.Context, url.Values) (finance.ListResult[map[string]any], error) {
	return finance.ListResult[map[string]any]{Data: []map[string]any{}}, nil
}
func (emptyReceivableFinanceBridge) HandleMutation(context.Context, string, string, map[string]any) (finance.DataResult[map[string]any], string, error) {
	return finance.DataResult[map[string]any]{}, "", nil
}

func TestReceivableExactCodeReadAllowsCurrentCollectorDifferentFromOwner(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()
	adapter.SetFinanceBridge(emptyReceivableFinanceBridge{})

	mock.ExpectQuery(`(?s)FROM receivable_plan rp.*WHERE rp\.code = \? AND rp\.deleted_at IS NULL AND \(rp\.owner_user_id = \? OR rp\.collection_responsible_uid = \? OR ct\.owner_user_id = \?\).*LIMIT 1`).
		WithArgs("RP-EXACT-1", "collector-1", "collector-1", "collector-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "owner_user_id", "collection_responsible_uid"}).AddRow(7, "RP-EXACT-1", "plan-owner", "collector-1"))

	plan, err := adapter.getReceivablePlanScoped(context.Background(), "RP-EXACT-1", url.Values{"current_user": {"collector-1"}})
	if err != nil || plan["code"] != "RP-EXACT-1" || plan["owner_user_id"] != "plan-owner" {
		t.Fatalf("plan=%#v err=%v", plan, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReceivableExactCodeReadKeepsExistingOwnerAccess(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()
	adapter.SetFinanceBridge(emptyReceivableFinanceBridge{})

	mock.ExpectQuery(`(?s)FROM receivable_plan rp.*WHERE rp\.code = \? AND rp\.deleted_at IS NULL AND \(rp\.owner_user_id = \? OR rp\.collection_responsible_uid = \? OR ct\.owner_user_id = \?\).*LIMIT 1`).
		WithArgs("RP-EXACT-2", "plan-owner", "plan-owner", "plan-owner").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "owner_user_id", "collection_responsible_uid"}).AddRow(8, "RP-EXACT-2", "plan-owner", "different-collector"))

	plan, err := adapter.getReceivablePlanScoped(context.Background(), "RP-EXACT-2", url.Values{"current_user": {"plan-owner"}})
	if err != nil || plan["code"] != "RP-EXACT-2" || plan["collection_responsible_uid"] != "different-collector" {
		t.Fatalf("plan=%#v err=%v", plan, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReceivableExactCodeReadDeniesFormerCollectorAfterResponsibilityMoves(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()
	adapter.SetFinanceBridge(emptyReceivableFinanceBridge{})

	// The database now stores a different collector, so the current predicate
	// returns no row for the former UID; no notification recipient cache is used.
	mock.ExpectQuery(`(?s)FROM receivable_plan rp.*WHERE rp\.code = \? AND rp\.deleted_at IS NULL AND \(rp\.owner_user_id = \? OR rp\.collection_responsible_uid = \? OR ct\.owner_user_id = \?\).*LIMIT 1`).
		WithArgs("RP-MOVED", "former-collector", "former-collector", "former-collector").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "owner_user_id", "collection_responsible_uid"}))

	plan, err := adapter.getReceivablePlanScoped(context.Background(), "RP-MOVED", url.Values{"current_user": {"former-collector"}})
	if plan != nil {
		t.Fatalf("former collector unexpectedly read plan: %#v", plan)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "record_not_found" {
		t.Fatalf("err=%#v, want record_not_found", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReceivableUpdateDoesNotGrantWriteToCollectorRelation(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)SELECT rp\.id, rp\.status, rp\.amount, rp\.received_amount.*WHERE rp\.code = \? AND rp\.deleted_at IS NULL AND \(rp\.owner_user_id = \? OR ct\.owner_user_id = \?\).*LIMIT 1`).
		WithArgs("RP-WRITE", "collector-only", "collector-only").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "amount", "received_amount"}))

	result, err := adapter.updateReceivablePlan(context.Background(), "RP-WRITE", map[string]any{
		"current_user":        "collector-only",
		"current_user_scopes": []string{"altoc:receivable:edit"},
		"remark":              "must not write by collector relation",
	})
	if result != nil {
		t.Fatalf("collector unexpectedly updated plan: %#v", result)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "record_not_found" {
		t.Fatalf("err=%#v, want record_not_found", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReceivableConfirmDoesNotGrantWriteToCollectorRelation(t *testing.T) {
	adapter, mock, closeDB := newAltocCoverageSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)FROM receivable_plan rp.*WHERE rp\.code = \? AND rp\.deleted_at IS NULL AND \(rp\.owner_user_id = \? OR ct\.owner_user_id = \?\).*LIMIT 1.*FOR UPDATE`).
		WithArgs("RP-CONFIRM", "collector-only", "collector-only").
		WillReturnRows(sqlmock.NewRows([]string{"id", "code", "owner_user_id", "collection_responsible_uid"}))
	mock.ExpectRollback()

	result, err := adapter.confirmReceivablePayment(context.Background(), "RP-CONFIRM", map[string]any{
		"current_user":        "collector-only",
		"current_user_scopes": []string{"altoc:receivable:confirm"},
		"receivedAmount":      100,
		"receivedAt":          "2026-07-10",
	})
	if result != nil {
		t.Fatalf("collector unexpectedly confirmed plan: %#v", result)
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Code != "record_not_found" {
		t.Fatalf("err=%#v, want record_not_found", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
