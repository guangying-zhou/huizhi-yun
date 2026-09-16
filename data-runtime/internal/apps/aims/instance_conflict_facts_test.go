package aims

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestRequirementReviewInstanceConflictFactsUseProjectScopedAccess(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT\\s+b\\.project_id,.*FROM requirement_review_batches b\\s+INNER JOIN aims_projects p ON p\\.id = b\\.project_id\\s+WHERE b\\.id = \\?").
		WithArgs(int64(9)).
		WillReturnRows(sqlmock.NewRows([]string{
			"project_id",
			"title",
			"batch_type",
			"status",
			"submitted_by",
			"workflow_instance_id",
			"project_code",
			"dept_code",
			"leader_uid",
		}).AddRow(
			int64(42),
			"Requirement baseline review",
			"baseline",
			"pending",
			"requester-uid",
			"wf-1",
			"PRJ-1",
			"dept-rd",
			"pm-uid",
		))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\).*FROM aims_projects p\\s+LEFT JOIN aims_project_members pm").
		WithArgs("approver-uid", int64(42), "approver-uid", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))

	facts, err := adapter.aimsInstanceConflictFacts(
		context.Background(),
		url.Values{
			"current_user": {"approver-uid"},
			"target_type":  {"requirement_review"},
			"id":           {"9"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("aimsInstanceConflictFacts returned error: %v", err)
	}
	if facts["resourceCode"] != "projects" || facts["action"] != "approve" {
		t.Fatalf("unexpected permission facts: %#v", facts)
	}
	principals := facts["principals"].([]aimsConflictPrincipal)
	if len(principals) != 2 || principals[0].Kind != "requester" || principals[0].UID != "requester-uid" {
		t.Fatalf("unexpected principals: %#v", principals)
	}
	object := facts["object"].(map[string]any)
	if object["ownerUid"] != "requester-uid" || object["projectCode"] != "PRJ-1" || object["departmentCode"] != "dept-rd" {
		t.Fatalf("unexpected object facts: %#v", object)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestApprovalInstanceConflictFactsMapWorkItemApprovalToConfirm(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT\\s+a\\.project_id,.*FROM approval_records a\\s+LEFT JOIN aims_projects p ON p\\.id = a\\.project_id\\s+WHERE a\\.id = \\?").
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{
			"project_id",
			"project_owner_id",
			"milestone_owner_id",
			"work_item_owner_id",
			"entity_code",
			"transition",
			"title",
			"requested_by",
			"reviewer_uid",
			"status",
			"approval_project_code",
			"project_code",
			"dept_code",
			"leader_uid",
		}).AddRow(
			int64(42),
			nil,
			nil,
			int64(10),
			"AIMS-10",
			"complete",
			"Complete work item",
			"developer-uid",
			"approver-uid",
			"pending",
			"PRJ-1",
			"PRJ-1",
			"dept-rd",
			"pm-uid",
		))

	facts, err := adapter.aimsInstanceConflictFacts(
		context.Background(),
		url.Values{
			"current_user":                  {"approver-uid"},
			"target_type":                   {"approval"},
			"id":                            {"7"},
			"current_user_is_project_admin": {"1"},
		},
	)
	if err != nil {
		t.Fatalf("aimsInstanceConflictFacts returned error: %v", err)
	}
	if facts["resourceCode"] != "work_items" || facts["action"] != "confirm" {
		t.Fatalf("unexpected permission facts: %#v", facts)
	}
	object := facts["object"].(map[string]any)
	if object["ownerUid"] != "developer-uid" || object["entityType"] != "work_item" || object["entityId"] != int64(10) {
		t.Fatalf("unexpected object facts: %#v", object)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
