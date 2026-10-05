package aims

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestEnterpriseCompletionReplayUsesRegisteredOutboxTables(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	tables, err := iop.NewOutboxTables("`aims_integration_operation`", "`aims_integration_operation_attempt`", "`aims_service_command_receipt`", "`aims_integration_operation_dead_letter_actionable`")
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE `aims_integration_operation_dead_letter_actionable`").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("UPDATE `aims_integration_operation`").
		WillReturnResult(sqlmock.NewResult(0, 1))
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	result, err := replayEnterpriseCompletionOperation(context.Background(), db, tx,
		iop.TrustedContext{OutboxTables: &tables}, iop.ReplayInput{
			TenantCode: "C000001", DeploymentCode: "C000001-test-aims", SourceApp: "aims",
			OperationID: "86c512e0-4ff6-40b2-8040-b30fab5b0fc7", ExpectedVersion: 3,
			ActorUID: "manager-1", Reason: "local workflow binding repaired", Now: time.Now().UTC(),
		})
	if err != nil || result.Status != iop.StatusPending || result.Version != 4 {
		t.Fatalf("mapped replay = %#v, %v", result, err)
	}
	mock.ExpectRollback()
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCompletionReplayErrorOnlyMapsStaleVersionToConflict(t *testing.T) {
	conflict := completionReplayError(iop.ErrReplayRejected)
	httpErr, ok := conflict.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "completion_replay_rejected" {
		t.Fatalf("stale replay = %#v, want 409", conflict)
	}
	missingTable := errors.New("table missing")
	if got := completionReplayError(missingTable); !errors.Is(got, missingTable) {
		t.Fatalf("storage failure was converted to conflict: %v", got)
	}
}
