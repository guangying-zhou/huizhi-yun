package aims

import (
	"context"
	"encoding/json"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/url"
	"strings"
	"testing"
	"time"
)

func lifecycleSnapshotJSON(action string) string {
	from, to, _ := projectLifecycleTransition(action)
	raw, _ := json.Marshal(projectLifecycleSnapshot{ProjectID: "7", Action: action, From: from, To: to, Actor: "manager", Comment: "reason", Version: strings.Repeat("a", 64)})
	return string(raw)
}
func lifecycleRequestIdentity() EnterpriseProjectUpdateIdentity {
	return EnterpriseProjectUpdateIdentity{Tenant: "T1", ActorUID: "manager", IdempotencyKey: "intent-7", CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, Masks: []int{65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
}
func expectLifecycleManager(mock sqlmock.Sqlmock, actor, leader, role, state string, managers int) {
	mock.ExpectQuery("SELECT project_code,COALESCE").WithArgs("7").WillReturnRows(sqlmock.NewRows([]string{"code", "dept", "leader", "creator"}).AddRow("P7", "D1", leader, leader))
	mock.ExpectQuery("SELECT role FROM aims_project_members").WithArgs("7", actor).WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow(role))
	mock.ExpectQuery("SELECT lifecycle_status,COALESCE").WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"state", "leader", "code"}).AddRow(state, leader, "P7"))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM aims_project_members").WithArgs("7", actor).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(managers))
}
func TestProjectLifecycleRequestReplayAndBinding(t *testing.T) {
	for _, test := range []struct {
		name, action, state, bound string
		bind                       bool
		input                      map[string]any
		wantError                  bool
	}{
		{name: "same intent request replay", action: "pause", state: "active", input: map[string]any{"comment": "reason", "expectedVersion": strings.Repeat("a", 64)}},
		{name: "bind once", action: "pause", state: "active", bind: true, input: map[string]any{"requestNo": "PLC-test", "instanceId": "44"}},
		{name: "bind replay", action: "pause", state: "paused", bound: "44", bind: true, input: map[string]any{"requestNo": "PLC-test", "instanceId": "44"}},
		{name: "wrong instance", action: "pause", state: "active", bound: "45", bind: true, input: map[string]any{"requestNo": "PLC-test", "instanceId": "44"}, wantError: true},
		{name: "wrong request", action: "pause", state: "active", bind: true, input: map[string]any{"requestNo": "PLC-other", "instanceId": "44"}, wantError: true},
		{name: "changed intent", action: "pause", state: "active", input: map[string]any{"comment": "different", "expectedVersion": strings.Repeat("a", 64)}, wantError: true},
		{name: "state changed", action: "pause", state: "completed", input: map[string]any{"comment": "reason", "expectedVersion": strings.Repeat("a", 64)}, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			m.ExpectBegin()
			tx, err := a.DB().BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			expectLifecycleManager(m, "manager", "manager", "manager", test.state, 1)
			var bound any
			if test.bound != "" {
				bound = test.bound
			}
			m.ExpectQuery("SELECT request_no,CAST\\(snapshot_json AS CHAR\\)").WillReturnRows(sqlmock.NewRows([]string{"request", "snapshot", "status", "instance"}).AddRow("PLC-test", lifecycleSnapshotJSON(test.action), "pending", bound))
			if test.bind && test.bound == "" && !test.wantError {
				m.ExpectExec("UPDATE approval_records SET workflow_instance_id").WithArgs("44", "PLC-test", int64(7)).WillReturnResult(sqlmock.NewResult(0, 1))
			}
			test.input["actionCode"] = test.action
			result, err := requestProjectLifecycleTx(context.Background(), tx, lifecycleRequestIdentity(), "7", test.input, test.bind)
			if (err != nil) != test.wantError {
				t.Fatalf("result=%v err=%v", result, err)
			}
			m.ExpectRollback()
			_ = tx.Rollback()
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestProjectLifecycleRequestRequiresCurrentManagerAndScope(t *testing.T) {
	for _, missingScope := range []bool{true, false} {
		a, m, done := newAimsSQLMockAdapter(t)
		m.ExpectBegin()
		tx, _ := a.DB().BeginTx(context.Background(), nil)
		identity := lifecycleRequestIdentity()
		if missingScope {
			identity.CommandScope = nil
		} else {
			expectLifecycleManager(m, "manager", "someone", "member", "active", 0)
		}
		_, err := requestProjectLifecycleTx(context.Background(), tx, identity, "7", map[string]any{"actionCode": "finish"}, false)
		if err == nil {
			t.Fatal("unauthorized request accepted")
		}
		m.ExpectRollback()
		_ = tx.Rollback()
		if err = m.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		done()
	}
}
func lifecycleCallback(action, status string) map[string]any {
	return map[string]any{"event": "flow_completed", "app_code": "aims", "resource_code": "projects", "action_code": action, "biz_id": "7", "instance_id": "44", "status": status, "form_data": map[string]any{"requestNo": "PLC-test", "projectId": "7", "actionCode": action}}
}
func TestProjectLifecycleCallbackBoundFinalization(t *testing.T) {
	for _, test := range []struct {
		name, action, status, state, current, bound string
		wantError, replay                           bool
	}{
		{name: "pause approved", action: "pause", status: "approved", state: "active", current: "pending", bound: "44"},
		{name: "resume approved", action: "resume", status: "approved", state: "paused", current: "pending", bound: "44"},
		{name: "finish completed not archived", action: "finish", status: "approved", state: "active", current: "pending", bound: "44"},
		{name: "rejected does not advance", action: "finish", status: "rejected", state: "active", current: "pending", bound: "44"},
		{name: "cancelled does not advance", action: "pause", status: "cancelled", state: "active", current: "pending", bound: "44"},
		{name: "approved replay", action: "pause", status: "approved", state: "paused", current: "approved", bound: "44", replay: true},
		{name: "wrong instance", action: "pause", status: "approved", state: "active", current: "pending", bound: "45", wantError: true},
		{name: "unbound forged approved", action: "pause", status: "approved", state: "active", current: "pending", wantError: true},
		{name: "state changed", action: "pause", status: "approved", state: "completed", current: "pending", bound: "44", wantError: true},
		{name: "rejected cannot become approved", action: "pause", status: "approved", state: "active", current: "rejected", bound: "44", wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			bindProjectCallbackMock(t, a)
			m.ExpectBegin()
			expectProjectCallbackFence(m, 1)
			m.ExpectQuery("SELECT lifecycle_status FROM aims_projects").WithArgs("7").WillReturnRows(sqlmock.NewRows([]string{"state"}).AddRow(test.state))
			var bound any
			if test.bound != "" {
				bound = test.bound
			}
			m.ExpectQuery("SELECT CAST\\(snapshot_json AS CHAR\\),status,workflow_instance_id").WithArgs("PLC-test", "7").WillReturnRows(sqlmock.NewRows([]string{"snapshot", "status", "instance"}).AddRow(lifecycleSnapshotJSON(test.action), test.current, bound))
			_, to, _ := projectLifecycleTransition(test.action)
			if !test.wantError && !test.replay {
				if test.status == "approved" {
					m.ExpectExec("UPDATE aims_projects SET lifecycle_status").WithArgs(to, "7").WillReturnResult(sqlmock.NewResult(0, 1))
					m.ExpectQuery("(?s)SELECT to_status.*FROM project_lifecycle_events").WithArgs("7").WillReturnRows(sqlmock.NewRows([]string{"state"}).AddRow(test.state))
					m.ExpectExec("(?s)INSERT INTO project_lifecycle_events").WithArgs("7", test.state, to, "workflow").WillReturnResult(sqlmock.NewResult(1, 1))
				}
				m.ExpectExec("UPDATE approval_records SET status").WithArgs(test.status, "PLC-test", "7").WillReturnResult(sqlmock.NewResult(0, 1))
				m.ExpectCommit()
			} else {
				m.ExpectRollback()
			}
			result, err := a.applyProjectLifecycleWorkflowCallback(context.Background(), url.Values{"workflow_callback_verified": {"1"}}, lifecycleCallback(test.action, test.status))
			if (err != nil) != test.wantError {
				t.Fatalf("result=%v err=%v", result, err)
			}
			if test.replay && result["alreadyApplied"] != true {
				t.Fatal("not idempotent")
			}
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestProjectLifecycleCallbackRejectsUntrustedAndCrossBusiness(t *testing.T) {
	for _, kind := range []string{"untrusted", "cross-project", "wrong-action", "browser-status"} {
		t.Run(kind, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			bindProjectCallbackMock(t, a)
			body := lifecycleCallback("pause", "approved")
			q := url.Values{"workflow_callback_verified": {"1"}}
			switch kind {
			case "untrusted":
				q = url.Values{}
			case "cross-project":
				body["biz_id"] = "8"
			case "wrong-action":
				body["action_code"] = "resume"
			case "browser-status":
				body["status"] = "completed"
			}
			if _, err := a.applyProjectLifecycleWorkflowCallback(context.Background(), q, body); err == nil {
				t.Fatal("invalid callback accepted")
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProjectLifecycleNewRequestFreezesCurrentVersion(t *testing.T) {
	for _, action := range []string{"pause", "resume", "finish"} {
		t.Run(action, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			m.ExpectQuery("SELECT name,short_name").WithArgs("7").WillReturnRows(versionTestRows())
			_, version, err := a.EnterpriseProjectEditableSnapshot(context.Background(), "7")
			if err != nil {
				t.Fatal(err)
			}
			m.ExpectBegin()
			tx, _ := a.DB().BeginTx(context.Background(), nil)
			from, to, _ := projectLifecycleTransition(action)
			expectLifecycleManager(m, "manager", "manager", "manager", from, 1)
			m.ExpectQuery("SELECT request_no,CAST\\(snapshot_json AS CHAR\\)").WillReturnRows(sqlmock.NewRows([]string{"request", "snapshot", "status", "instance"}))
			m.ExpectQuery("SELECT name,short_name").WithArgs("7").WillReturnRows(versionTestRows())
			m.ExpectQuery("SELECT COUNT\\(\\*\\) FROM approval_records").WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
			m.ExpectExec("INSERT INTO approval_records").WithArgs(sqlmock.AnyArg(), int64(7), int64(7), "P7", from+"→"+to, "项目生命周期审批", "manager", "reason", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(1, 1))
			out, err := requestProjectLifecycleTx(context.Background(), tx, lifecycleRequestIdentity(), "7", map[string]any{"actionCode": action, "comment": "reason", "expectedVersion": version}, false)
			if err != nil {
				t.Fatal(err)
			}
			snapshot := out["snapshot"].(projectLifecycleSnapshot)
			if snapshot.Version != version || snapshot.To != to || out["status"] != "pending" {
				t.Fatalf("invalid freeze %v", out)
			}
			m.ExpectRollback()
			_ = tx.Rollback()
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProjectLifecycleCallbackRejectsDifferentFrozenBusiness(t *testing.T) {
	for _, kind := range []string{"project", "action"} {
		t.Run(kind, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			bindProjectCallbackMock(t, a)
			m.ExpectBegin()
			expectProjectCallbackFence(m, 1)
			m.ExpectQuery("SELECT lifecycle_status FROM aims_projects").WithArgs("7").WillReturnRows(sqlmock.NewRows([]string{"state"}).AddRow("active"))
			var snapshot projectLifecycleSnapshot
			_ = json.Unmarshal([]byte(lifecycleSnapshotJSON("pause")), &snapshot)
			if kind == "project" {
				snapshot.ProjectID = "8"
			} else {
				snapshot.Action = "finish"
				snapshot.To = "completed"
			}
			raw, _ := json.Marshal(snapshot)
			m.ExpectQuery("SELECT CAST\\(snapshot_json AS CHAR\\),status,workflow_instance_id").WithArgs("PLC-test", "7").WillReturnRows(sqlmock.NewRows([]string{"snapshot", "status", "instance"}).AddRow(string(raw), "pending", "44"))
			m.ExpectRollback()
			if _, err := a.applyProjectLifecycleWorkflowCallback(context.Background(), url.Values{"workflow_callback_verified": {"1"}}, lifecycleCallback("pause", "approved")); err == nil {
				t.Fatal("different frozen business accepted")
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestProjectLifecycleNewRequestRejectsVersionAndPending(t *testing.T) {
	for _, kind := range []string{"version", "pending"} {
		t.Run(kind, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			m.ExpectQuery("SELECT name,short_name").WithArgs("7").WillReturnRows(versionTestRows())
			_, version, err := a.EnterpriseProjectEditableSnapshot(context.Background(), "7")
			if err != nil {
				t.Fatal(err)
			}
			m.ExpectBegin()
			tx, _ := a.DB().BeginTx(context.Background(), nil)
			expectLifecycleManager(m, "manager", "manager", "manager", "active", 1)
			m.ExpectQuery("SELECT request_no,CAST\\(snapshot_json AS CHAR\\)").WillReturnRows(sqlmock.NewRows([]string{"request", "snapshot", "status", "instance"}))
			m.ExpectQuery("SELECT name,short_name").WithArgs("7").WillReturnRows(versionTestRows())
			if kind == "version" {
				version = strings.Repeat("0", 64)
			} else {
				m.ExpectQuery("SELECT COUNT\\(\\*\\) FROM approval_records").WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
			}
			if _, err = requestProjectLifecycleTx(context.Background(), tx, lifecycleRequestIdentity(), "7", map[string]any{"actionCode": "pause", "comment": "reason", "expectedVersion": version}, false); err == nil {
				t.Fatal("stale or duplicate pending request accepted")
			}
			m.ExpectRollback()
			_ = tx.Rollback()
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
