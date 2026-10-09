package workflow

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	aims "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	directory "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func completionTestHTTP(t *testing.T, err error, status int, code string) {
	t.Helper()
	var h httperror.Error
	if !errors.As(err, &h) || h.Status != status || h.Code != code {
		t.Fatalf("wanted %d %s, got %v", status, code, err)
	}
}
func TestCompletionLaneDisabledNeverSelectsByBody(t *testing.T) {
	a := &Adapter{}
	for _, action := range []string{"approve", "reject", "delegate", "cancel"} {
		_, _, handled, err := a.decideCompletion(context.Background(), "1", action, map[string]any{"workflowLane": true, "completionInProcess": true, "hzy_internal_lane": true})
		if handled || err != nil {
			t.Fatal("body selected lane", action, err)
		}
	}
	_, err := a.RequestCompletion(context.Background(), aims.EnterpriseProjectUpdateIdentity{}, "1", "1", "target", nil)
	completionTestHTTP(t, err, 503, "workflow_lane_unavailable")
}
func TestCompletionLaneEmployeeInitiatorAndDependencyFailBeforeBusinessTx(t *testing.T) {
	for _, kind := range []string{"system", "service", "agent", "external", "future", "dependency"} {
		t.Run(kind, func(t *testing.T) {
			db, m, _ := sqlmock.New()
			defer db.Close()
			a := &Adapter{completion: &completionLane{binding: e.Binding{Key: e.BindingKey{Tenant: "T1", RuntimeDeployment: "R"}}, sourceDeployment: "E", directory: directory.NewWithDB(db, "T1", "", "")}}
			id := aims.EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "E", TargetDeployment: "R", ServiceClientID: "enterprise.runtime", ActorUID: "U", CommandScope: &aims.EnterpriseProjectCommandScope{}}
			m.ExpectBegin()
			q := m.ExpectQuery("SELECT id,uid,status,user_type").WithArgs("U")
			if kind == "dependency" {
				q.WillReturnError(errors.New("sensitive DB error"))
			} else {
				q.WillReturnRows(sqlmock.NewRows([]string{"id", "uid", "status", "kind", "name", "dept", "updated"}).AddRow(1, "U", "active", kind, "", "", "time"))
			}
			m.ExpectRollback()
			_, err := a.RequestCompletion(context.Background(), id, "1", "1", "target", map[string]any{"expectedVersion": "ignored"})
			if kind == "dependency" {
				completionTestHTTP(t, err, 503, "workflow_directory_snapshot_unavailable")
			} else {
				completionTestHTTP(t, err, 403, "workflow_subject_type_not_allowed")
			}
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestCompletionLaneDecisionDirectoryTypesCannotBeForgedInBody(t *testing.T) {
	for _, subject := range []string{"actor", "delegate"} {
		t.Run(subject, func(t *testing.T) {
			db, m, _ := sqlmock.New()
			defer db.Close()
			a := &Adapter{db: db, completion: &completionLane{directory: directory.NewWithDB(db, "T1", "", "")}}
			m.ExpectQuery("SELECT \\* FROM flow_tasks WHERE id").WithArgs("1").WillReturnRows(sqlmock.NewRows([]string{"id", "instance_id", "assignee_uid"}).AddRow(1, 2, "Reviewer"))
			m.ExpectQuery("SELECT \\* FROM flow_instances WHERE id").WithArgs(int64(2)).WillReturnRows(sqlmock.NewRows([]string{"id", "app_code", "resource_code", "action_code", "callback_url", "initiator_uid"}).AddRow(2, "aims", "tasks", "complete", aimsCompletionWorkflowCallback, "Initiator"))
			if subject == "actor" {
				m.ExpectQuery("SELECT actor_uid FROM flow_actions").WillReturnRows(sqlmock.NewRows([]string{"actor_uid"}))
			}
			m.ExpectBegin()
			uid := "Reviewer"
			if subject == "delegate" {
				uid = "Delegate"
			}
			m.ExpectQuery("SELECT uid,status,user_type").WithArgs(uid).WillReturnRows(sqlmock.NewRows([]string{"uid", "status", "user_type"}).AddRow(uid, "active", "service"))
			m.ExpectRollback()
			action := "approve"
			if subject == "delegate" {
				action = "delegate"
			}
			_, _, handled, err := a.decideCompletion(context.Background(), "1", action, map[string]any{"current_user": "Reviewer", "idempotency_key": "K", "delegate_to": "Delegate", "user_type": "employee"})
			if !handled {
				t.Fatal("missed completion")
			}
			completionTestHTTP(t, err, 403, "workflow_subject_type_not_allowed")
			if err := m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestCompletionLaneDecisionMissingObjectIs409(t *testing.T) {
	for _, err := range []error{e.ErrCompletionObjectMissing, e.ErrBindingMismatch, e.ErrCompatibilityView} {
		completionTestHTTP(t, completionDecisionLaneError(err), 409, "completion_binding_changed")
	}
	completionTestHTTP(t, laneError(e.ErrCompletionObjectMissing), 404, "completion_object_not_found")
}
func TestCompletionLaneOperationNamespacesAndAuditMarkers(t *testing.T) {
	request := stableCompletionLaneOperationID("T", "request:K")
	decision := stableCompletionLaneOperationID("T", "decision:K")
	if request == decision || request != stableCompletionLaneOperationID("T", "request:K") || request[14] != '4' || decision[14] != '4' {
		t.Fatal(request, decision)
	}
}

func TestCompletionLaneReceiptOperationCannotUseLegacyServiceAPI(t *testing.T) {
	for _, op := range []string{"aims.completion.request.lane.v1", "aims.completion.request.lane.v2"} {
		body := map[string]any{iop.TrustedServiceCommandTenantKey: "T1", iop.TrustedServiceCommandSourceDeploymentKey: "AIMS", iop.TrustedServiceCommandTargetDeploymentKey: "WORKFLOW", iop.TrustedServiceCommandSourceAppKey: "aims", iop.TrustedServiceCommandTargetAppKey: "workflow", iop.TrustedServiceCommandSourceClientKey: "aims.lane", iop.ServiceCommandEnvelopeKey: map[string]any{"operationCode": op, "targetApp": "workflow", "requiredCapability": aimsCompletionWorkflowCapability, "command": map[string]any{}}}
		if _, _, err := iop.ReceiptCommandFromBody(body, "workflow", aimsCompletionWorkflowOperationCode, aimsCompletionWorkflowCapability); !errors.Is(err, iop.ErrIdempotencyPayloadMismatch) {
			t.Fatal("internal receipt accepted as legacy service request", err)
		}
	}
	if aimsCompletionWorkflowOperationCode != "aims.work-item.completion.workflow-submit.v1" {
		t.Fatal("legacy operation changed")
	}
}
