package workflow

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
)

func peopleFrozenRequest() CreateInstanceRequest {
	form, hash := people.AssignmentSnapshot(map[string]any{"id": int64(1), "assignment_code": "ASN-1", "employee_uid": "Employee", "change_type": "transfer", "effective_from": "2026-10-04", "dept_code": "A", "position_code": "P", "rank_code": nil, "manager_uid": "Manager", "remarks": "中文"}, "HR")
	form["snapshotHash"] = hash
	return CreateInstanceRequest{ActionDefID: 5, RouteID: 6, BizID: "ASN-1", BizTitle: "任职变更", CurrentUser: "HR", FormData: form, CallbackURL: workflowapproval.CallbackPath}
}
func peopleReplayStatus(e error) int {
	var h httperror.Error
	if errors.As(e, &h) {
		return h.Status
	}
	return 0
}

func TestPeopleFrozenApprovalReplay(t *testing.T) {
	for _, kind := range []string{"hit", "new", "changed-form", "foreign-initiator", "bad-callback", "bad-requester", "missing-id", "missing-employee", "wrong-biz", "invalid-storage", "dependency"} {
		t.Run(kind, func(t *testing.T) {
			a, m, done := newWorkflowRuntimeSQLMockAdapter(t)
			defer done()
			m.ExpectBegin()
			tx, e := a.db.BeginTx(context.Background(), nil)
			if e != nil {
				t.Fatal(e)
			}
			req := peopleFrozenRequest()
			action := &actionDefRecord{ID: 5, AppCode: "people", ResourceCode: "assignments", ActionCode: "change"}
			invalid := false
			switch kind {
			case "bad-callback":
				req.CallbackURL = "/other"
				invalid = true
			case "bad-requester":
				req.FormData["requestedBy"] = "Other"
				invalid = true
			case "missing-id":
				delete(req.FormData, "id")
				invalid = true
			case "missing-employee":
				delete(req.FormData, "employee_uid")
				invalid = true
			case "wrong-biz":
				req.BizID = "ASN-other"
				invalid = true
			}
			if !invalid {
				m.ExpectQuery("SELECT id FROM flow_action_defs.*FOR UPDATE").WithArgs(int64(5)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(5))
				q := m.ExpectQuery("SELECT id,instance_no,initiator_uid,CAST.*snapshotHash.*FOR UPDATE").WithArgs("people", "assignments", "change", "ASN-1", req.FormData["snapshotHash"])
				if kind == "dependency" {
					q.WillReturnError(errors.New("dependency"))
				} else {
					rows := sqlmock.NewRows([]string{"id", "no", "actor", "form"})
					if kind != "new" {
						stored := map[string]any{}
						for k, v := range req.FormData {
							stored[k] = v
						}
						actor := "HR"
						if kind == "foreign-initiator" {
							actor = "Other"
						}
						if kind == "changed-form" {
							stored["remarks"] = "changed"
						}
						raw, _ := json.Marshal(stored)
						if kind == "invalid-storage" {
							raw = []byte("null")
						}
						rows.AddRow(39, "WF39", actor, string(raw))
					}
					q.WillReturnRows(rows)
				}
			}
			out, e := replayPeopleApproval(context.Background(), tx, action, req)
			switch {
			case invalid:
				if peopleReplayStatus(e) != 400 {
					t.Fatal("invalid request", out, e)
				}
			case kind == "new":
				if out != nil || e != nil {
					t.Fatal("miss must create normally", out, e)
				}
			case kind == "changed-form" || kind == "foreign-initiator":
				var h httperror.Error
				if !errors.As(e, &h) || h.Status != 409 || h.Code != "idempotency_payload_mismatch" {
					t.Fatal(out, e)
				}
			case kind == "invalid-storage":
				if peopleReplayStatus(e) != 503 {
					t.Fatal(out, e)
				}
			case kind == "dependency":
				if e == nil {
					t.Fatal("dependency hidden")
				}
			default:
				if e != nil || out == nil || out.Data.(map[string]any)["instance_id"] != int64(39) || out.Data.(map[string]any)["replayed"] != true {
					t.Fatal(out, e)
				}
			}
			m.ExpectRollback()
			_ = tx.Rollback()
			if e = m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}

func TestPeopleFrozenReplayEntryPrecedesActiveGuard(t *testing.T) {
	for _, kind := range []string{"replay", "people-miss", "non-people-active"} {
		t.Run(kind, func(t *testing.T) {
			a, m, done := newWorkflowRuntimeSQLMockAdapter(t)
			defer done()
			m.ExpectBegin()
			tx, _ := a.db.BeginTx(context.Background(), nil)
			req := peopleFrozenRequest()
			app, resource, action := "people", "assignments", "change"
			if kind == "non-people-active" {
				app, resource, action = "ordinary", "items", "edit"
			}
			m.ExpectQuery("SELECT id, app_code, resource_code, action_code, name, form_schema_id").WithArgs(int64(5)).WillReturnRows(sqlmock.NewRows([]string{"id", "app", "resource", "action", "name", "schema"}).AddRow(5, app, resource, action, "Change", nil))
			if kind != "non-people-active" {
				m.ExpectQuery("SELECT id FROM flow_action_defs.*FOR UPDATE").WithArgs(int64(5)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(5))
				rows := sqlmock.NewRows([]string{"id", "no", "actor", "form"})
				if kind == "replay" {
					raw, _ := json.Marshal(req.FormData)
					rows.AddRow(39, "WF39", "HR", string(raw))
				}
				m.ExpectQuery("SELECT id,instance_no,initiator_uid,CAST").WithArgs(app, resource, action, "ASN-1", req.FormData["snapshotHash"]).WillReturnRows(rows)
			}
			if kind != "replay" {
				rows := sqlmock.NewRows([]string{"id", "no", "status", "actor"})
				if kind == "non-people-active" {
					rows.AddRow(39, "WF39", "running", "HR")
				}
				m.ExpectQuery("SELECT id, instance_no, status, initiator_uid").WithArgs(app, resource, "ASN-1", action).WillReturnRows(rows)
				if kind == "people-miss" {
					m.ExpectQuery("SELECT id, instance_no, status, initiator_uid").WithArgs(app, resource, "ASN-1", action).WillReturnRows(sqlmock.NewRows([]string{"id", "no", "status", "actor"}))
					m.ExpectQuery("SELECT id, action_def_id, flow_schema_id").WithArgs(int64(6), int64(5)).WillReturnRows(sqlmock.NewRows([]string{"id", "action", "schema", "name", "desc", "level", "conditions", "priority", "default"}))
				}
			}
			raw, _ := json.Marshal(req)
			body := map[string]any{}
			_ = json.Unmarshal(raw, &body)
			out, e := a.createInstanceTx(context.Background(), tx, body)
			if kind == "replay" {
				if e != nil || out.Data.(map[string]any)["replayed"] != true {
					t.Fatal(out, e)
				}
			} else {
				var h httperror.Error
				want := "active_instance_exists"
				if kind == "people-miss" {
					want = "route_not_found"
				}
				if !errors.As(e, &h) || h.Code != want {
					t.Fatal("normal creation/active behavior changed", out, e)
				}
			}
			m.ExpectRollback()
			_ = tx.Rollback()
			if e = m.ExpectationsWereMet(); e != nil {
				t.Fatal(e)
			}
		})
	}
}

func TestPeopleFrozenRecognitionIsExact(t *testing.T) {
	req := peopleFrozenRequest()
	a := &actionDefRecord{AppCode: "people", ResourceCode: "assignments", ActionCode: "change"}
	if !isFrozenPeopleApproval(a, req) {
		t.Fatal("actual snapshot not recognized")
	}
	for _, hash := range []string{"", strings.Repeat("A", 64), strings.Repeat("g", 64), strings.Repeat("a", 63), " " + strings.Repeat("a", 64)} {
		req.FormData["snapshotHash"] = hash
		if isFrozenPeopleApproval(a, req) {
			t.Fatal("invalid hash accepted")
		}
	}
	req = peopleFrozenRequest()
	for _, tuple := range [][3]string{{"finance", "assignments", "change"}, {"people", "performance_cycles", "change"}, {"people", "assignments", "view"}} {
		a.AppCode, a.ResourceCode, a.ActionCode = tuple[0], tuple[1], tuple[2]
		if isFrozenPeopleApproval(a, req) {
			t.Fatal("adjacent tuple changed")
		}
	}
	src, e := os.ReadFile("instances.go")
	if e != nil {
		t.Fatal(e)
	}
	if strings.Index(string(src), "replayPeopleApproval") > strings.Index(string(src), "activeInstanceByBiz(ctx") {
		t.Fatal("replay behind active guard")
	}
}
