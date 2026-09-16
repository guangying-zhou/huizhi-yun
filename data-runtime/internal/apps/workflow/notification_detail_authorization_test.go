package workflow

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestNormalizeWorkflowNotificationAuthorizationDescriptor(t *testing.T) {
	descriptor, err := normalizeWorkflowNotificationAuthorizationDescriptor(map[string]any{
		"resource": "workflow_task",
		"id":       "instance:9:tasks:12,7,12",
	})
	if err != nil {
		t.Fatal(err)
	}
	if descriptor.ID != "instance:9:tasks:7,12" || descriptor.InstanceID != 9 || len(descriptor.TaskIDs) != 2 {
		t.Fatalf("descriptor=%+v", descriptor)
	}

	if _, err := normalizeWorkflowNotificationAuthorizationDescriptor(map[string]any{
		"resource": "workflow_task",
		"id":       "instance:9:tasks:bad",
	}); err == nil {
		t.Fatal("invalid task descriptor must fail closed")
	}
	if _, err := normalizeWorkflowNotificationAuthorizationDescriptor(map[string]any{
		"resource": "business_object",
		"id":       "9",
	}); err == nil {
		t.Fatal("unsupported descriptor must fail closed")
	}
}

func TestWorkflowNotificationDetailAccessUsesPendingAssignmentOrInstanceVisibility(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	descriptor := workflowNotificationAuthorizationDescriptor{
		Resource: "workflow_task", ID: "instance:9:tasks:7,12", InstanceID: 9, TaskIDs: []int64{7, 12},
	}

	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*), COALESCE(SUM(CASE WHEN status = 'pending' AND assignee_uid = ? THEN 1 ELSE 0 END), 0)")).
		WithArgs("u-1", int64(9), int64(7), int64(12)).
		WillReturnRows(sqlmock.NewRows([]string{"count", "pending"}).AddRow(2, 1))
	authorized, reason, err := adapter.workflowNotificationDetailAccess(context.Background(), "u-1", descriptor)
	if err != nil || !authorized || reason != "allowed" {
		t.Fatalf("pending assignment result: authorized=%v reason=%s err=%v", authorized, reason, err)
	}

	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*), COALESCE(SUM(CASE WHEN status = 'pending' AND assignee_uid = ? THEN 1 ELSE 0 END), 0)")).
		WithArgs("u-2", int64(9), int64(7), int64(12)).
		WillReturnRows(sqlmock.NewRows([]string{"count", "pending"}).AddRow(2, 0))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\), COALESCE\\(SUM\\(CASE").
		WithArgs("u-2", "u-2", int64(9)).
		WillReturnRows(sqlmock.NewRows([]string{"count", "visible"}).AddRow(1, 1))
	authorized, reason, err = adapter.workflowNotificationDetailAccess(context.Background(), "u-2", descriptor)
	if err != nil || !authorized || reason != "allowed" {
		t.Fatalf("instance visibility result: authorized=%v reason=%s err=%v", authorized, reason, err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWorkflowNotificationDetailAccessRejectsMismatchedTaskSet(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	adapter := &Adapter{db: db}
	descriptor := workflowNotificationAuthorizationDescriptor{
		Resource: "workflow_task", ID: "instance:9:tasks:7,12", InstanceID: 9, TaskIDs: []int64{7, 12},
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*), COALESCE(SUM(CASE WHEN status = 'pending' AND assignee_uid = ? THEN 1 ELSE 0 END), 0)")).
		WithArgs("u-1", int64(9), int64(7), int64(12)).
		WillReturnRows(sqlmock.NewRows([]string{"count", "pending"}).AddRow(1, 1))

	authorized, reason, err := adapter.workflowNotificationDetailAccess(context.Background(), "u-1", descriptor)
	if err != nil || authorized || reason != "descriptor_mismatch" {
		t.Fatalf("result: authorized=%v reason=%s err=%v", authorized, reason, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
