package altoc

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProductFeedbackFreeze(t *testing.T) {
	for _, scenario := range []string{"changed", "replay", "binding-failure", "success", "denied"} {
		t.Run(scenario, func(t *testing.T) {
			adapter, mock, cleanup := newAltocCoverageSQLMockAdapter(t)
			defer cleanup()
			body := trustedIntegrationOperationRuntimeBody()
			body["current_user_scopes"] = []string{"altoc:service_ticket:edit"}
			ticket := map[string]any{"code": "ST-1", "product_code": "P1", "ticket_type": "requirement", "title": "Feature", "description": "Details"}
			_, digest, err := altocProductFeedbackSnapshot(ticket)
			if err != nil {
				t.Fatal(err)
			}
			body["expectedSourceSha256"] = digest
			if scenario == "changed" {
				body["expectedSourceSha256"] = strings.Repeat("0", 64)
			}
			owner := "dispatcher-user"
			if scenario == "denied" {
				owner = "another-user"
			}
			mock.ExpectBegin()
			mock.ExpectQuery(`SELECT st\.\* FROM service_ticket`).WithArgs("ST-1").WillReturnRows(sqlmock.NewRows([]string{"id", "code", "product_code", "ticket_type", "title", "description", "owner_user_id"}).AddRow(1, "ST-1", "P1", "requirement", "Feature", "Details", owner))
			if scenario != "denied" {
				query := mock.ExpectQuery(`SELECT f.submission_id`).WithArgs("TENANT-TRUSTED", "DEPLOYMENT-TRUSTED", altocProductFeedbackOperation, 1)
				if scenario == "replay" {
					query.WillReturnRows(sqlmock.NewRows([]string{"submission_id", "request_biz_id", "product_code", "operation_id", "status"}).AddRow("submission", "request", "P1", "operation", "pending"))
				} else {
					query.WillReturnError(sql.ErrNoRows)
				}
			}
			if scenario == "success" || scenario == "binding-failure" {
				mock.ExpectExec(`INSERT INTO integration_operation`).WillReturnResult(sqlmock.NewResult(1, 1))
				binding := mock.ExpectExec(`INSERT INTO service_ticket_product_feedback`)
				if scenario == "binding-failure" {
					binding.WillReturnError(errors.New("injected failure"))
				} else {
					binding.WillReturnResult(sqlmock.NewResult(1, 1))
					mock.ExpectQuery(`SELECT COLUMN_NAME`).WithArgs("audit_log").WillReturnRows(sqlmock.NewRows([]string{"COLUMN_NAME"}).AddRow("entity_type").AddRow("entity_id").AddRow("action").AddRow("old_value").AddRow("new_value").AddRow("operator_id"))
					mock.ExpectExec("INSERT INTO `audit_log`").WillReturnResult(sqlmock.NewResult(1, 1))
				}
			}
			success := scenario == "success" || scenario == "replay"
			if success {
				mock.ExpectCommit()
			} else {
				mock.ExpectRollback()
			}
			result, err := adapter.freezeServiceTicketProductFeedback(context.Background(), "ST-1", body)
			if success && err != nil {
				t.Fatal(err)
			}
			if !success && err == nil {
				t.Fatal("expected rejection")
			}
			if success && result["created"] != (scenario == "success") {
				t.Fatal("incorrect creation flag")
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
