package aims

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestApproveRequirementReviewBatchUsesTrustedCurrentUserAsApprover(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT id, project_id, title, batch_type, status, workflow_instance_id, submitted_by, requirement_ids_json").
		WithArgs(int64(88)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"project_id",
			"title",
			"batch_type",
			"status",
			"workflow_instance_id",
			"submitted_by",
			"requirement_ids_json",
		}).AddRow(int64(88), int64(42), "需求评审", "baseline", "pending", nil, "submitter", []byte("[10]")))
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE requirement_review_batches SET status = 'approved'").
		WithArgs(nil, int64(88)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT id, item_kind, parent_requirement_id, title, type, priority, source, scope_note").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"item_kind",
			"parent_requirement_id",
			"title",
			"type",
			"priority",
			"source",
			"scope_note",
			"milestone_id",
			"current_version",
		}).AddRow(int64(10), "requirement", nil, "订单管理", "functional", "medium", nil, nil, nil, int64(1)))
	mock.ExpectQuery("SELECT MAX\\(version_no\\) FROM requirement_versions WHERE requirement_id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"max_version"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT ric\\.content_id AS id, MIN\\(ric\\.sort_order\\) AS sort_order").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "sort_order"}))
	mock.ExpectExec("INSERT INTO requirement_versions").
		WithArgs(
			int64(10),
			int64(2),
			sqlmock.AnyArg(),
			"baseline",
			nil,
			int64(88),
			nil,
			"trusted-approver",
			"trusted-approver",
		).
		WillReturnResult(sqlmock.NewResult(100, 1))
	mock.ExpectExec("UPDATE requirement_items SET status = 'baselined', current_version = \\?, baselined_at = COALESCE\\(baselined_at, NOW\\(\\)\\) WHERE id = \\?").
		WithArgs(int64(2), int64(10)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT id FROM work_items").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectCommit()

	data, err := adapter.approveRequirementReviewBatch(
		context.Background(),
		"88",
		url.Values{"current_user": {"trusted-approver"}},
		map[string]any{
			"approvedBy":  "spoofed-approver",
			"approved_by": "spoofed-approver-2",
		},
	)
	if err != nil {
		t.Fatalf("approveRequirementReviewBatch returned error: %v", err)
	}
	if data["approved"] != true {
		t.Fatalf("approved = %#v, want true", data["approved"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestApproveRequirementReviewBatchDoesNotReadApproverFromBody(t *testing.T) {
	contentBytes, err := os.ReadFile("requirement_review_actions.go")
	if err != nil {
		t.Fatalf("read requirement_review_actions.go: %v", err)
	}
	content := string(contentBytes)
	startIndex := strings.Index(content, "func (a *Adapter) approveRequirementReviewBatch")
	if startIndex == -1 {
		t.Fatal("missing approveRequirementReviewBatch")
	}
	segment := content[startIndex:]

	if strings.Contains(segment, `"approvedBy"`) || strings.Contains(segment, `"approved_by"`) {
		t.Fatal("approveRequirementReviewBatch must not accept approvedBy/approved_by from request body")
	}
}
