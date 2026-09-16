package finance

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// 走查 ISSUE-B-002：生产 payment_request 缺 reject_reason 列，而四张审批表共用
// applyApprovalResultTx 的驳回分支。硬写该列会抛 MySQL 1054，经 writeError 兜底
// 成 500 internal_error 且被判为可重试，导致 Workflow 回调无限重投。
//
// 迁移补列是主修复；这里锁住失败降级行为，保证同类漂移不再让驳回整体失败。

func TestRejectWritesReasonWhenColumnExists(t *testing.T) {
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

	mock.ExpectQuery(`SELECT \* FROM payment_request WHERE code = \?`).
		WithArgs("PAY-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "applicant_user_id"}).AddRow(7, "pending_approval", "u1"))
	mock.ExpectQuery(`SELECT COLUMN_NAME`).
		WithArgs("payment_request").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).
			AddRow("id").AddRow("status").AddRow("rejected_at").
			AddRow("reject_reason").AddRow("workflow_instance_id").AddRow("updated_by"))
	mock.ExpectExec(regexp.QuoteMeta("reject_reason = ?")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE external_approval_instance`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	adapter := &Adapter{db: db}
	reason := "金额超预算"
	if err := adapter.applyApprovalResultTx(
		context.Background(), tx, approvalTargets["payment_request"], "PAY-1", "rejected",
		approvalOptions{Operator: "u2", RejectReason: &reason, ApprovalActorUIDs: []string{"u2"}},
	); err != nil {
		t.Fatalf("reject with column present should succeed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRejectDegradesWhenRejectReasonColumnMissing(t *testing.T) {
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

	mock.ExpectQuery(`SELECT \* FROM payment_request WHERE code = \?`).
		WithArgs("PAY-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "applicant_user_id"}).AddRow(7, "pending_approval", "u1"))
	// 生产漂移现状：列集合里没有 reject_reason。
	mock.ExpectQuery(`SELECT COLUMN_NAME`).
		WithArgs("payment_request").
		WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).
			AddRow("id").AddRow("status").AddRow("rejected_at").
			AddRow("workflow_instance_id").AddRow("updated_by"))
	// 关键断言：SET 子句里不得出现 reject_reason，且驳回本身仍要执行成功。
	mock.ExpectExec(`UPDATE payment_request SET status = 'rejected'.*WHERE id = \?`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE external_approval_instance`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	adapter := &Adapter{db: db}
	reason := "金额超预算"
	if err := adapter.applyApprovalResultTx(
		context.Background(), tx, approvalTargets["payment_request"], "PAY-1", "rejected",
		approvalOptions{Operator: "u2", RejectReason: &reason, ApprovalActorUIDs: []string{"u2"}},
	); err != nil {
		t.Fatalf("reject must still succeed when reject_reason is missing, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// 四张审批表都走同一段 SQL，任意一张缺列都会命中同一条路径。
func TestRejectColumnGuardCoversAllApprovalTables(t *testing.T) {
	for _, target := range []string{"invoice_request", "expense_claim", "project_expense_request", "payment_request"} {
		t.Run(target, func(t *testing.T) {
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

			applicantColumn := "applicant_user_id"
			if target == "invoice_request" {
				applicantColumn = "requested_by"
			}
			mock.ExpectQuery(`SELECT \* FROM ` + target + ` WHERE code = \?`).
				WithArgs("C-1").
				WillReturnRows(sqlmock.NewRows([]string{"id", "status", applicantColumn}).AddRow(1, "pending_approval", "u1"))
			mock.ExpectQuery(`SELECT COLUMN_NAME`).
				WithArgs(target).
				WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).
					AddRow("id").AddRow("status").AddRow("rejected_at").AddRow("workflow_instance_id").AddRow("updated_by"))
			mock.ExpectExec(`UPDATE ` + target + ` SET status = 'rejected'`).
				WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectExec(`UPDATE external_approval_instance`).
				WillReturnResult(sqlmock.NewResult(0, 1))

			adapter := &Adapter{db: db}
			reason := "r"
			if err := adapter.applyApprovalResultTx(
				context.Background(), tx, approvalTargets[target], "C-1", "rejected",
				approvalOptions{Operator: "u2", RejectReason: &reason, ApprovalActorUIDs: []string{"u2"}},
			); err != nil {
				t.Fatalf("%s reject should degrade instead of failing, got %v", target, err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
