package aims

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

func TestCreateApprovalRecordUsesTrustedActorAndDerivedProjectContext(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT wi\\.project_id, p\\.project_code\\s+FROM work_items wi\\s+JOIN aims_projects p").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id", "project_code"}).AddRow(int64(42), "PRJ-1"))
	mock.ExpectExec("INSERT INTO approval_records").
		WithArgs(nil, nil, int64(77), "WI-77", "submit_breakdown", "Review title", "u-trusted", "note", "reviewer-1", int64(42), "PRJ-1").
		WillReturnResult(sqlmock.NewResult(555, 1))

	data, err := adapter.createApprovalRecord(
		context.Background(),
		url.Values{"current_user": {"u-trusted"}},
		map[string]any{
			"entityType":     "task",
			"entityId":       77,
			"entityCode":     "WI-77",
			"transition":     "submit_breakdown",
			"title":          "Review title",
			"requestComment": "note",
			"reviewerUid":    "reviewer-1",
			"current_user":   "spoofed",
			"projectId":      999,
			"projectCode":    "SPOOFED",
		},
	)
	if err != nil {
		t.Fatalf("createApprovalRecord returned error: %v", err)
	}
	if data["id"] != int64(555) {
		t.Fatalf("id = %#v, want 555", data["id"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestCreateApprovalRecordRequiresReviewerBeforeDBWrite(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	_, err := adapter.createApprovalRecord(
		context.Background(),
		url.Values{"current_user": {"u1"}},
		map[string]any{
			"entityType": "project",
			"entityId":   42,
			"transition": "approve",
		},
	)
	if err == nil {
		t.Fatal("expected missing reviewer to be rejected")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "missing_reviewer_uid" {
		t.Fatalf("expected missing_reviewer_uid 400, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestApprovalCreateRouteUsesDedicatedRuntimeBeforeGenericFallback(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)
	postIndex := strings.Index(content, "if method == http.MethodPost {")
	if postIndex == -1 {
		t.Fatal("missing POST branch")
	}
	postSegment := content[postIndex:]
	createIndex := strings.Index(postSegment, "a.createApprovalRecord(ctx, query, body)")
	genericIndex := strings.Index(postSegment, "handleProjectScopedGenericRuntime")
	if createIndex == -1 {
		t.Fatal("missing dedicated approval create route")
	}
	if genericIndex != -1 && genericIndex < createIndex {
		t.Fatal("approval create route must run before generic runtime fallback")
	}
}
