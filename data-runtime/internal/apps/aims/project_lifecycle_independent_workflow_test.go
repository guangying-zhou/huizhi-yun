package aims

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type projectLifecycleReaderFunc func(context.Context, string) (ProjectLifecycleInstance, error)

func (read projectLifecycleReaderFunc) ReadProjectLifecycleInstance(ctx context.Context, id string) (ProjectLifecycleInstance, error) {
	return read(ctx, id)
}
func lifecycleInstanceFromTestMap(instance map[string]any) ProjectLifecycleInstance {
	form, _ := instance["form_data"].(map[string]any)
	return ProjectLifecycleInstance{InstanceID: firstBodyText(instance, "instance_id"), InstanceNo: firstBodyText(instance, "instance_no"), BizID: firstBodyText(instance, "biz_id"), InitiatorUID: firstBodyText(instance, "initiator_uid"), AppCode: firstBodyText(instance, "app_code"), ResourceCode: firstBodyText(instance, "resource_code"), ActionCode: firstBodyText(instance, "action_code"), Form: form}
}

func TestIndependentWorkflowLifecycleBinding(t *testing.T) {
	for _, kind := range []string{"valid", "replay", "instance_id", "instance_no", "biz_id", "initiator_uid", "app_code", "resource_code", "action_code", "requestNo", "projectId", "requestedBy", "actionCode", "missing", "unavailable", "read-failed", "not-found", "stale-generation"} {
		t.Run(kind, func(t *testing.T) {
			a, m, done := newAimsSQLMockAdapter(t)
			defer done()
			bindProjectCallbackMock(t, a)
			identity := lifecycleRequestIdentity()
			identity.Tenant = "T"
			identity.SourceDeployment = "host"
			identity.TargetDeployment = "runtime"
			input := map[string]any{"instanceId": "44", "instanceNo": "WF44", "requestNo": "PLC-test", "actionCode": "pause"}
			form := map[string]any{"requestNo": "PLC-test", "projectId": "7", "requestedBy": "manager", "actionCode": "pause"}
			instance := map[string]any{"instance_id": "44", "instance_no": "WF44", "biz_id": "7", "initiator_uid": "manager", "app_code": "aims", "resource_code": "projects", "action_code": "pause", "form_data": form}
			switch kind {
			case "requestNo", "projectId", "requestedBy", "actionCode":
				form[kind] = "wrong"
			case "instance_id", "instance_no", "biz_id", "initiator_uid", "app_code", "resource_code", "action_code":
				instance[kind] = "wrong"
			case "missing":
				instance = nil
			}
			reads := 0
			if kind != "unavailable" {
				a.ConfigureWorkflowInstanceReader(projectLifecycleReaderFunc(func(_ context.Context, id string) (ProjectLifecycleInstance, error) {
					reads++
					if id != "44" {
						t.Fatal("read did not use verified identity")
					}
					if kind == "read-failed" {
						return ProjectLifecycleInstance{}, errors.New("offline")
					}
					if kind == "not-found" {
						return ProjectLifecycleInstance{}, httperror.New(404, "instance_not_found", "missing")
					}
					return lifecycleInstanceFromTestMap(instance), nil
				}))
			}
			if kind == "valid" || kind == "replay" || kind == "stale-generation" {
				// Reader must complete before Begin: this hook sets these expectations only
				// after receiving the real typed read, so no transaction is held across it.
				prior := a.workflowInstanceReader
				a.ConfigureWorkflowInstanceReader(projectLifecycleReaderFunc(func(ctx context.Context, id string) (ProjectLifecycleInstance, error) {
					result, err := prior.ReadProjectLifecycleInstance(ctx, id)
					m.ExpectBegin()
					generation := 1
					if kind == "stale-generation" {
						generation = 2
					}
					expectProjectCallbackFence(m, generation)
					if kind == "stale-generation" {
						m.ExpectRollback()
						return result, err
					}
					state := "active"
					var bound any
					if kind == "replay" {
						state = "paused"
						bound = "44"
					}
					expectLifecycleManager(m, "manager", "manager", "manager", state, 1)
					m.ExpectQuery("SELECT request_no,CAST\\(snapshot_json AS CHAR\\)").WillReturnRows(sqlmock.NewRows([]string{"request", "snapshot", "status", "instance"}).AddRow("PLC-test", lifecycleSnapshotJSON("pause"), "pending", bound))
					if kind == "valid" {
						m.ExpectExec("UPDATE approval_records SET workflow_instance_id").WithArgs("44", "PLC-test", int64(7)).WillReturnResult(sqlmock.NewResult(0, 1))
					}
					m.ExpectCommit()
					return result, err
				}))
			}
			out, err := a.RequestEnterpriseProjectLifecycle(context.Background(), identity, "7", input, true)
			if kind == "valid" || kind == "replay" {
				if err != nil || out["bound"] != true {
					t.Fatalf("%v %v", out, err)
				}
			} else if kind == "stale-generation" {
				if err == nil {
					t.Fatal("stale generation accepted")
				}
			} else {
				var h httperror.Error
				want := 409
				if kind == "unavailable" || kind == "read-failed" {
					want = 503
				}
				if !errors.As(err, &h) || h.Status != want {
					t.Fatalf("want%d got%v", want, err)
				}
			}
			if kind != "unavailable" && reads != 1 {
				t.Fatal("typed reader not called exactly once")
			}
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func (read projectLifecycleReaderFunc) ReadAimsRequirementReviewInstance(context.Context, string, string, string, string) (map[string]any, error) {
	panic("unexpected requirement read")
}
