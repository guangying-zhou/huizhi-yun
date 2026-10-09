package workflow

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strings"
	"testing"
)

func TestRequirementReviewCreationReplaysImmutableFinalInstance(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	form := map[string]any{"projectId": "263", "batchId": "9", "requestedBy": "actor", "snapshotHash": strings.Repeat("a", 64), "requestNo": "RRB-9-" + strings.Repeat("a", 64)}
	action := &actionDefRecord{ID: 7, AppCode: "aims", ResourceCode: "requirements", ActionCode: "requirement_baseline"}
	request := CreateInstanceRequest{BizID: "9", CurrentUser: "actor", FormData: form}
	if !isFrozenRequirementReviewRequest(action, request) {
		t.Fatal("frozen request not recognized")
	}
	legacy := request
	legacy.FormData = map[string]any{"projectId": "263"}
	if isFrozenRequirementReviewRequest(action, legacy) {
		t.Fatal("legacy independent workflow changed")
	}
	raw, _ := json.Marshal(form)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM flow_action_defs").WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(7))
	mock.ExpectQuery("SELECT id,instance_no,initiator_uid").WithArgs("requirement_baseline", "9").WillReturnRows(sqlmock.NewRows([]string{"id", "no", "actor", "form"}).AddRow(42, "WF-42", "actor", string(raw)))
	mock.ExpectRollback()
	tx, err := adapter.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err := replayRequirementReviewRequest(context.Background(), tx, action, request)
	tx.Rollback()
	if err != nil || result == nil {
		t.Fatal(result, err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"batchId", "requestedBy", "snapshotHash", "requestNo", "projectId"} {
		bad := request
		bad.FormData = map[string]any{}
		for k, v := range form {
			bad.FormData[k] = v
		}
		bad.FormData[key] = "wrong"
		if _, err = replayRequirementReviewRequest(context.Background(), nil, action, bad); err == nil {
			t.Fatal("invalid frozen field", key)
		}
	}
}
func TestRequirementReviewOwningReadIncludesFormalResultAndForm(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectQuery("SELECT id,instance_no,app_code").WithArgs("9", "actor", "requirement_baseline", "42").WillReturnRows(sqlmock.NewRows([]string{"id", "instance_no", "app_code", "resource_code", "action_code", "biz_id", "initiator_uid", "status", "form_data"}).AddRow(42, "WF42", "aims", "requirements", "requirement_baseline", "9", "actor", "approved", `{"snapshotHash":"test"}`))
	mock.ExpectQuery("SELECT actor_uid FROM flow_actions").WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"actor_uid"}).AddRow("reviewer"))
	result, err := adapter.ReadAimsRequirementReviewInstance(context.Background(), "9", "42", "actor", "requirement_baseline")
	if err != nil || result["approval_operator_uid"] != "reviewer" {
		t.Fatal(result, err)
	}
	if _, ok := result["form_data"].(map[string]any); !ok {
		t.Fatal("unparsed form")
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRequirementReviewFinalInstanceCannotResubmit(t *testing.T) {
	adapter, mock, closeDB := newWorkflowRuntimeSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT \\* FROM flow_instances").WithArgs("42").WillReturnRows(sqlmock.NewRows([]string{"id", "initiator_uid", "status", "app_code", "resource_code", "action_code", "form_data"}).AddRow(42, "actor", "rejected", "aims", "requirements", "requirement_baseline", `{"requestNo":"RRB-9-test"}`))
	mock.ExpectRollback()
	_, _, err := adapter.resubmitInstance(context.Background(), "42", map[string]any{"current_user": "actor", "form_data": map[string]any{"requestNo": "forged"}})
	var h httperror.Error
	if !errors.As(err, &h) || h.Status != 409 {
		t.Fatal(err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	for _, instance := range []map[string]any{{"app_code": "assets", "resource_code": "requirements"}, {"app_code": "aims", "resource_code": "requirements", "action_code": "requirement_baseline", "form_data": "{}"}} {
		if err = requireMutableRequirementReviewInstance(instance); err != nil {
			t.Fatal("non-RRB changed", err)
		}
	}
}
