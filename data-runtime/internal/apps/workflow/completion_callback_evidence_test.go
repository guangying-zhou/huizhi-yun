package workflow

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"reflect"
	"testing"
)

func TestCompletionCallbackEvidenceUsesCurrentRoundAndTerminalActor(t *testing.T) {
	for _, missing := range []bool{false, true} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		mock.ExpectBegin()
		tx, err := db.Begin()
		if err != nil {
			t.Fatal(err)
		}
		rows := sqlmock.NewRows([]string{"id", "actor_uid", "action"}).AddRow(4, "U1", "approve")
		if !missing {
			rows.AddRow(5, "U2", "approve")
		}
		mock.ExpectQuery(`(?s)SELECT id, actor_uid, action FROM flow_actions.*action =.*id > COALESCE.*MAX\(previous.id\).*previous.action = 'resubmit'.*ORDER BY id`).WithArgs(int64(1), "approve", int64(1)).WillReturnRows(rows)
		callback := WorkflowCallback{URL: aimsCompletionWorkflowCallback, Payload: map[string]any{"status": "approved"}}
		err = bindCompletionApprovalEvidence(context.Background(), tx, &callback, map[string]any{"id": int64(1), "initiator_uid": "U1"}, 5)
		if missing {
			if err == nil {
				t.Fatal("missing terminal actor accepted")
			}
		} else if err != nil || callback.Payload["approval_operator_uid"] != "U2" || !reflect.DeepEqual(callback.Payload["non_self_approval_actor_uids"], []string{"U2"}) || !reflect.DeepEqual(callback.Payload["approval_actor_uids"], []string{"U1", "U2"}) {
			t.Fatalf("wrong evidence: %#v %v", callback.Payload, err)
		}
		mock.ExpectRollback()
		_ = tx.Rollback()
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		_ = db.Close()
	}
}
