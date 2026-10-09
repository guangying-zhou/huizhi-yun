package workflow

import (
	"context"
	"encoding/json"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestWorkflowDecisionTxCoreDoesNotOwnTransaction(t *testing.T) {
	for _, reject := range []bool{false, true} {
		db, m, _ := sqlmock.New()
		a := NewWithDB(db)
		m.ExpectBegin()
		tx, _ := db.Begin()
		m.ExpectQuery("SELECT .*FROM flow_tasks").WithArgs("1").WillReturnRows(sqlmock.NewRows([]string{"id", "assignee_uid", "status"}).AddRow(1, "Other", "pending"))
		var err error
		if reject {
			_, _, err = a.rejectTaskTx(context.Background(), tx, "1", map[string]any{"current_user": "Actor", "comment": "退回"})
		} else {
			_, _, err = a.approveTaskTx(context.Background(), tx, "1", map[string]any{"current_user": "Actor", "comment": "退回"})
		}
		if err == nil {
			t.Fatal("assignee check lost")
		}
		// No core rollback: the caller still controls the transaction.
		m.ExpectRollback()
		if err := tx.Rollback(); err != nil {
			t.Fatal(err)
		}
		if err := m.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}

func TestWorkflowCallerTxRequiresExplicitReceiptMapping(t *testing.T) {
	db, m, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	m.ExpectBegin()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := NewWithDB(db).executeAimsCompletionApprovalTx(context.Background(), tx, nil, nil); err == nil {
		t.Fatal("caller tx fell back to unprefixed receipt")
	}
	m.ExpectRollback()
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAimsCompletionBodyCloneKeepsNestedInputAndNumber(t *testing.T) {
	body := map[string]any{"serviceCommand": map[string]any{"command": map[string]any{"id": json.Number("9007199254740993"), "nested": map[string]any{"original": "value"}, "array": []any{map[string]any{"key": "value"}}}}}
	before, _ := json.Marshal(body)
	clone, err := cloneAimsCompletionBody(body)
	if err != nil {
		t.Fatal(err)
	}
	command := clone["serviceCommand"].(map[string]any)["command"].(map[string]any)
	if command["id"].(json.Number).String() != "9007199254740993" {
		t.Fatal("number lost precision")
	}
	command["nested"].(map[string]any)["original"] = "changed"
	command["array"].([]any)[0].(map[string]any)["key"] = "changed"
	after, _ := json.Marshal(body)
	if string(before) != string(after) {
		t.Fatal("clone modified input")
	}
}
