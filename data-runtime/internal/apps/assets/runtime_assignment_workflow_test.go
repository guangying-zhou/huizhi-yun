package assets

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestActorFromRequestPrefersTrustedQueryActor(t *testing.T) {
	actor := actorFromRequest(
		url.Values{"current_user": {"trusted-operator"}},
		map[string]any{
			"operator_uid": "spoofed-operator",
			"current_user": "spoofed-user",
		},
	)
	if actor != "trusted-operator" {
		t.Fatalf("actorFromRequest() = %q, want trusted query actor", actor)
	}
}

func TestCreateAssignmentCreatesPendingWithTrustedRequester(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id, asset_category, status").
		WithArgs(int64(88)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "asset_category", "status", "owner_uid", "custodian_uid", "user_uid", "dept_code", "project_code"}).
			AddRow(int64(88), "physical", "repairing", "", "", "", "", ""))
	mock.ExpectExec("INSERT INTO asset_assignments").
		WithArgs(
			sqlmock.AnyArg(),
			int64(88),
			"repair",
			"stock",
			nil,
			"none",
			nil,
			nil,
			"pending",
			nil,
			"trusted-operator",
			nil,
			nil,
			nil,
			nil,
		).
		WillReturnResult(sqlmock.NewResult(99, 1))
	mock.ExpectExec("INSERT INTO asset_events").
		WithArgs("assignment", int64(99), "repair", sqlmock.AnyArg(), "trusted-operator").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	assignmentID, err := adapter.createAssignment(
		context.Background(),
		assignmentPermissionQuery("operator-1", "edit", "all", ""),
		map[string]any{
			"asset_id":    int64(88),
			"action_type": "repair",
			"status":      "pending",
			"approved_by": "spoofed-approver",
		},
		"trusted-operator",
	)
	if err != nil {
		t.Fatalf("createAssignment returned error: %v", err)
	}
	if assignmentID != 99 {
		t.Fatalf("assignmentID = %d, want 99", assignmentID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestCreateAssignmentRejectsTerminalStatusWithoutWorkflow(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	_, err := adapter.createAssignment(
		context.Background(),
		assignmentPermissionQuery("operator-1", "edit", "all", ""),
		map[string]any{
			"asset_id":    int64(88),
			"action_type": "repair",
			"status":      "completed",
			"approved_by": "spoofed-approver",
		},
		"trusted-operator",
	)
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "asset_assignment_status_requires_workflow" {
		t.Fatalf("expected assignment status workflow forbidden error, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestSyncAssignmentWorkflowUsesTrustedOperatorAsApprover(t *testing.T) {
	adapter, mock, closeDB := newAssetsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT assignment\\.id, assignment\\.asset_id, assignment\\.action_type, assignment\\.target_type, assignment\\.target_ref,").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "asset_id", "action_type", "target_type", "target_ref", "status", "asset_category",
		}).AddRow(int64(77), int64(88), "repair", "none", "", "pending", "physical"))
	mock.ExpectExec("UPDATE asset_assignments").
		WithArgs("completed", nil, "trusted-operator", "completed", "completed", int64(77)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO asset_events").
		WithArgs("assignment", int64(77), "workflow_synced", sqlmock.AnyArg(), "trusted-operator").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.syncAssignmentWorkflow(
		context.Background(),
		77,
		map[string]any{
			"status":      "approved",
			"approvedBy":  "spoofed-approver",
			"approved_by": "spoofed-approver-2",
		},
		"trusted-operator",
	)
	if err != nil {
		t.Fatalf("syncAssignmentWorkflow returned error: %v", err)
	}
	if data["status"] != "completed" {
		t.Fatalf("status = %v, want completed", data["status"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet sql expectations: %v", err)
	}
}

func TestAssignmentCreationCannotBypassWorkflowApproval(t *testing.T) {
	contentBytes, err := os.ReadFile("runtime_writes.go")
	if err != nil {
		t.Fatalf("read runtime_writes.go: %v", err)
	}
	content := string(contentBytes)
	for _, token := range []string{`nullableBodyText(body, "approved_by")`, `bodyText(body, "approvedBy")`, `bodyText(body, "approved_by")`} {
		if strings.Contains(content, token) {
			t.Fatalf("runtime_writes.go still reads assignment approver from request body: %s", token)
		}
	}
	if strings.Contains(content, `applyAssignmentEffect(ctx, tx, assetID`) {
		t.Fatal("createAssignment still applies asset effects directly instead of waiting for Workflow sync")
	}
}
