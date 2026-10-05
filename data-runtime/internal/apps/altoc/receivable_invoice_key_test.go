package altoc

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// 走查 ISSUE-B-006：回款计划开票申请原本用每计划固定的
// `...:invoice-request:v1` 作幂等键，而申请金额默认取会随到账变化的
// unreceived_amount，前端又不传 Idempotency-Key。结果第二次申请必然失败：
// 金额变了撞 409 payload mismatch，金额没变则静默返回旧记录。
// 而 runtime 与前端都明确允许 partially_received 再次申请开票（分次开票）。
//
// 新行为：序号只在 operation 终结后递进。

func trustedInvoiceKeyBody() map[string]any {
	return map[string]any{
		integrationoperation.TrustedTenantCodeKey:      "C000001",
		integrationoperation.TrustedDeploymentCodeKey:  "C000001-agent",
		integrationoperation.TrustedSourceAppKey:       "altoc",
		integrationoperation.TrustedServiceClientIDKey: "altoc.runtime",
		integrationoperation.TrustedRequestIDKey:       "req-1",
	}
}

func settledCountRows(n int) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"c"}).AddRow(n)
}

func TestInvoiceRequestKeyReusesLegacyKeyForFirstRequest(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}

	mock.ExpectQuery(`SELECT COUNT\(\*\)`).WillReturnRows(settledCountRows(0))
	// 已存在历史固定键记录时必须复用，避免把在途申请当成新申请重复投递。
	mock.ExpectQuery(`SELECT 1 FROM integration_operation`).
		WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))

	key, err := nextReceivableInvoiceRequestKeyTx(context.Background(), tx, trustedInvoiceKeyBody(), "RP-1")
	if err != nil {
		t.Fatal(err)
	}
	if key != "altoc:receivable:RP-1:invoice-request:v1" {
		t.Fatalf("expected legacy key reuse, got %q", key)
	}
}

func TestInvoiceRequestKeyStartsAtOneWhenNothingExists(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}

	mock.ExpectQuery(`SELECT COUNT\(\*\)`).WillReturnRows(settledCountRows(0))
	mock.ExpectQuery(`SELECT 1 FROM integration_operation`).WillReturnError(sql.ErrNoRows)

	key, err := nextReceivableInvoiceRequestKeyTx(context.Background(), tx, trustedInvoiceKeyBody(), "RP-1")
	if err != nil {
		t.Fatal(err)
	}
	if key != "altoc:receivable:RP-1:invoice-request:1" {
		t.Fatalf("expected first sequence key, got %q", key)
	}
}

// 在途申请不计入序号：重复点击仍然落在同一个键上，是幂等重放而不是第二张申请。
func TestInvoiceRequestKeyIgnoresInFlightOperations(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}

	// COUNT 只统计终态，pending/processing 的那条不在其中，因此仍是 0。
	mock.ExpectQuery(`status IN \('succeeded','failed_permanent','dead_letter','cancelled'\)`).
		WillReturnRows(settledCountRows(0))
	mock.ExpectQuery(`SELECT 1 FROM integration_operation`).WillReturnError(sql.ErrNoRows)

	key, err := nextReceivableInvoiceRequestKeyTx(context.Background(), tx, trustedInvoiceKeyBody(), "RP-1")
	if err != nil {
		t.Fatal(err)
	}
	if key != "altoc:receivable:RP-1:invoice-request:1" {
		t.Fatalf("in-flight operation must not advance the sequence, got %q", key)
	}
}

// 已终结后递进：分次开票、以及永久失败后改正重试，都能发出新的申请。
func TestInvoiceRequestKeyAdvancesAfterSettledOperations(t *testing.T) {
	for _, tc := range []struct {
		settled int
		want    string
	}{
		{settled: 1, want: "altoc:receivable:RP-1:invoice-request:2"},
		{settled: 3, want: "altoc:receivable:RP-1:invoice-request:4"},
	} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		mock.ExpectBegin()
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		mock.ExpectQuery(`SELECT COUNT\(\*\)`).WillReturnRows(settledCountRows(tc.settled))

		key, err := nextReceivableInvoiceRequestKeyTx(context.Background(), tx, trustedInvoiceKeyBody(), "RP-1")
		if err != nil {
			t.Fatal(err)
		}
		if key != tc.want {
			t.Fatalf("settled=%d expected %q, got %q", tc.settled, tc.want, key)
		}
		db.Close()
	}
}

func TestInvoiceRequestKeyRequiresTrustedContext(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}

	if _, err := nextReceivableInvoiceRequestKeyTx(context.Background(), tx, map[string]any{}, "RP-1"); err == nil {
		t.Fatal("missing trusted context must not derive an idempotency key")
	}
}
