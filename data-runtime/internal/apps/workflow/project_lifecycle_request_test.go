package workflow

import (
	"context"
	"encoding/json"
	"github.com/DATA-DOG/go-sqlmock"
	"strings"
	"testing"
)

func TestProjectLifecycleWorkflowCreationReplaysFrozenRequest(t *testing.T) {
	for _, kind := range []string{"new", "replay", "wrong-actor", "changed-form"} {
		t.Run(kind, func(t *testing.T) {
			a, m, done := newWorkflowRuntimeSQLMockAdapter(t)
			defer done()
			m.ExpectBegin()
			tx, _ := a.db.BeginTx(context.Background(), nil)
			requestNo := "PLC-" + strings.Repeat("a", 64)
			form := map[string]any{"requestNo": requestNo, "projectId": "7", "actionCode": "finish", "requestedBy": "U1", "comment": "reason"}
			request := CreateInstanceRequest{ActionDefID: 5, BizID: "7", CurrentUser: "U1", FormData: form}
			m.ExpectQuery("SELECT id FROM flow_action_defs").WithArgs(int64(5)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(5))
			rows := sqlmock.NewRows([]string{"id", "no", "actor", "biz", "form"})
			if kind != "new" {
				stored := map[string]any{}
				for key, value := range form {
					stored[key] = value
				}
				actor := "U1"
				if kind == "wrong-actor" {
					actor = "U2"
				}
				if kind == "changed-form" {
					stored["comment"] = "other"
				}
				raw, _ := json.Marshal(stored)
				rows.AddRow(44, "WF44", actor, "7", string(raw))
			}
			m.ExpectQuery("SELECT id,instance_no,initiator_uid,biz_id").WithArgs("finish", requestNo).WillReturnRows(rows)
			out, err := replayProjectLifecycleRequest(context.Background(), tx, &actionDefRecord{ID: 5, AppCode: "aims", ResourceCode: "projects", ActionCode: "finish"}, request)
			switch kind {
			case "new":
				if err != nil || out != nil {
					t.Fatalf("%v %v", out, err)
				}
			case "replay":
				if err != nil || out == nil || out.Data.(map[string]any)["instance_id"] != int64(44) {
					t.Fatalf("%v %v", out, err)
				}
			default:
				if err == nil {
					t.Fatal("mismatched intent accepted")
				}
			}
			m.ExpectRollback()
			_ = tx.Rollback()
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestFrozenLifecycleCreationDoesNotChangeLegacyStandaloneRequests(t *testing.T) {
	action := &actionDefRecord{AppCode: "aims", ResourceCode: "projects", ActionCode: "pause"}
	if isFrozenProjectLifecycleRequest(action, CreateInstanceRequest{FormData: map[string]any{"reason": "legacy"}}) {
		t.Fatal("legacy request entered frozen Host lane")
	}
	if !isFrozenProjectLifecycleRequest(action, CreateInstanceRequest{FormData: map[string]any{"requestNo": "PLC-" + strings.Repeat("a", 64)}}) {
		t.Fatal("frozen Host request not recognized")
	}
	action.ActionCode = "initiation"
	if isFrozenProjectLifecycleRequest(action, CreateInstanceRequest{FormData: map[string]any{"requestNo": "PLC-" + strings.Repeat("a", 64)}}) {
		t.Fatal("adjacent action entered lifecycle lane")
	}
}
