package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
)

func TestCompletionCallbackCurrentRoundMySQL(t *testing.T) {
	socket := os.Getenv("HZY_WORKFLOW_COMPLETION_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = socket
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	for _, statement := range []string{"CREATE DATABASE hzy_workflow_completion_fixture", "USE hzy_workflow_completion_fixture", "CREATE TABLE flow_actions (id BIGINT PRIMARY KEY, instance_id BIGINT, actor_uid VARCHAR(50), action VARCHAR(30))", "INSERT INTO flow_actions VALUES (1,7,'OLD','approve'),(2,7,'U1','resubmit'),(3,7,'U1','approve'),(4,7,'U2','approve'),(5,8,'OTHER','approve')"} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	defer db.Exec("DROP DATABASE hzy_workflow_completion_fixture")
	if _, err := db.Exec("INSERT INTO flow_actions VALUES (6,7,'REJECTOR','reject')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO flow_actions VALUES (7,7,'U1','withdraw'),(8,7,'OTHER','withdraw')"); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	callback := WorkflowCallback{URL: aimsCompletionWorkflowCallback, Payload: map[string]any{"status": "approved"}}
	err = bindCompletionApprovalEvidence(context.Background(), tx, &callback, map[string]any{"id": int64(7), "initiator_uid": "U1"}, 4)
	if err != nil || !reflect.DeepEqual(callback.Payload["approval_actor_uids"], []string{"U1", "U2"}) || !reflect.DeepEqual(callback.Payload["non_self_approval_actor_uids"], []string{"U2"}) {
		t.Fatalf("current-round evidence: %#v %v", callback.Payload, err)
	}
	if err := bindCompletionApprovalEvidence(context.Background(), tx, &callback, map[string]any{"id": int64(7), "initiator_uid": "U1"}, 1); err == nil {
		t.Fatal("old terminal action accepted")
	}
	rejected := WorkflowCallback{URL: aimsCompletionWorkflowCallback, Payload: map[string]any{"status": "rejected"}}
	if err := bindCompletionApprovalEvidence(context.Background(), tx, &rejected, map[string]any{"id": int64(7), "initiator_uid": "U1"}, 6); err != nil || rejected.Payload["approval_operator_uid"] != "REJECTOR" || !reflect.DeepEqual(rejected.Payload["approval_actor_uids"], []string{"REJECTOR"}) {
		t.Fatalf("rejection evidence: %#v %v", rejected.Payload, err)
	}
	unsupported := WorkflowCallback{URL: aimsCompletionWorkflowCallback, Payload: map[string]any{"status": "cancelled"}}
	if err := bindCompletionCancellationEvidence(context.Background(), tx, &callback, map[string]any{"id": int64(7), "initiator_uid": "U1"}, 7); err == nil {
		t.Fatal("withdrawal evidence bound to approved callback")
	}
	if err := bindCompletionCancellationEvidence(context.Background(), tx, &unsupported, map[string]any{"id": int64(7), "initiator_uid": "U1"}, 7); err != nil || unsupported.Payload["cancellation_actor_uid"] != "U1" {
		t.Fatalf("withdraw evidence: %#v %v", unsupported.Payload, err)
	}
	for _, action := range []int64{4, 8, 99} {
		if err := bindCompletionCancellationEvidence(context.Background(), tx, &unsupported, map[string]any{"id": int64(7), "initiator_uid": "U1"}, action); err == nil {
			t.Fatalf("invalid withdraw action %d accepted", action)
		}
	}
	if err := bindCompletionApprovalEvidence(context.Background(), tx, &unsupported, map[string]any{"id": int64(7), "initiator_uid": "U1"}, 6); err == nil {
		t.Fatal("unsupported terminal evidence accepted")
	}
	_ = tx.Rollback()
	if _, err := db.Exec("CREATE TABLE flow_instances (id BIGINT PRIMARY KEY, instance_no VARCHAR(50), app_code VARCHAR(30), resource_code VARCHAR(30), action_code VARCHAR(30), biz_id VARCHAR(100), initiator_uid VARCHAR(50), form_data JSON)"); err != nil {
		t.Fatal(err)
	}
	command := completionCommandFixture()
	form, _ := json.Marshal(command["formData"])
	insert := "INSERT INTO flow_instances VALUES (?, 'WF-1', 'aims', 'tasks', 'complete', '2', 'U1', ?)"
	if _, err := db.Exec(insert, 11, string(form)); err != nil {
		t.Fatal(err)
	}
	a := &Adapter{db: db}
	if id, number, err := a.restoreCompletionInstance(context.Background(), command, 1, 2, "U1"); err != nil || id != 11 || number != "WF-1" {
		t.Fatalf("unique replay: %d %q %v", id, number, err)
	}
	if _, _, err := a.restoreCompletionInstance(context.Background(), command, 1, 2, "OTHER"); err == nil {
		t.Fatal("wrong actor restored")
	}
	if _, _, err := a.restoreCompletionInstance(context.Background(), command, 9, 2, "U1"); err == nil {
		t.Fatal("wrong request restored")
	}
	if _, _, err := a.restoreCompletionInstance(context.Background(), command, 1, 9, "U1"); err == nil {
		t.Fatal("wrong work item restored")
	}
	for _, field := range []string{"projectId", "snapshotSha256"} {
		changed := completionCommandFixture()
		if field == "projectId" {
			changed[field] = float64(9)
		} else {
			changed[field] = strings.Repeat("b", 64)
		}
		if _, _, err := a.restoreCompletionInstance(context.Background(), changed, 1, 2, "U1"); err == nil {
			t.Fatalf("wrong %s restored", field)
		}
	}
	if _, err := db.Exec(insert, 12, string(form)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.restoreCompletionInstance(context.Background(), command, 1, 2, "U1"); err == nil {
		t.Fatal("ambiguous replay accepted")
	}
	matter := matterCompletionCommandFixture()
	matterForm, _ := json.Marshal(matter["formData"])
	if _, err := db.Exec(insert, 13, string(matterForm)); err != nil {
		t.Fatal(err)
	}
	if id, _, err := a.restoreCompletionInstance(context.Background(), matter, 1, 2, "U1"); err != nil || id != 13 {
		t.Fatal("matter replay did not select its own kind", id, err)
	}
}
