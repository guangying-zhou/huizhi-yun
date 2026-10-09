package workflow

import (
	"context"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"testing"
)

func TestProjectLifecycleTypedInstanceReader(t *testing.T) {
	for _, kind := range []string{"valid", "missing", "invalid-form", "read-failed"} {
		t.Run(kind, func(t *testing.T) {
			a, m, done := newWorkflowRuntimeSQLMockAdapter(t)
			defer done()
			rows := sqlmock.NewRows([]string{"id", "instance_no", "biz_id", "initiator_uid", "app_code", "resource_code", "action_code", "form_data"})
			raw := `{"requestNo":"PLC-request","projectId":"7","requestedBy":"U1","actionCode":"pause"}`
			if kind == "invalid-form" {
				raw = `[]`
			}
			if kind != "missing" {
				rows.AddRow(44, "WF44", "7", "U1", "aims", "projects", "pause", raw)
			}
			query := m.ExpectQuery("SELECT id,instance_no,biz_id,initiator_uid,app_code,resource_code,action_code,form_data FROM flow_instances WHERE id = \\?").WithArgs("44")
			if kind == "read-failed" {
				query.WillReturnError(errors.New("offline"))
			} else {
				query.WillReturnRows(rows)
			}
			result, err := a.ReadProjectLifecycleInstance(context.Background(), "44")
			if kind == "valid" {
				if err != nil || result.InstanceID != "44" || result.InstanceNo != "WF44" || result.BizID != "7" || result.InitiatorUID != "U1" || result.AppCode != "aims" || result.ResourceCode != "projects" || result.ActionCode != "pause" || result.Form["requestNo"] != "PLC-request" {
					t.Fatalf("%+v %v", result, err)
				}
			} else if err == nil {
				t.Fatal("invalid read accepted")
			}
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
	var a *Adapter
	_, err := a.ReadProjectLifecycleInstance(context.Background(), "44")
	var h httperror.Error
	if !errors.As(err, &h) || h.Status != 503 {
		t.Fatalf("unavailable adapter: %v", err)
	}
}
