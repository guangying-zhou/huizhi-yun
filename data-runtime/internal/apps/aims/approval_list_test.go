package aims

import (
	"context"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestApprovalListKeepsLegacyShapeAndFilters(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT\\s+a\\.id,.*FROM approval_records a\\s+LEFT JOIN aims_projects p ON p\\.id = a\\.project_id\\s+WHERE \\(a\\.reviewer_uid = \\? OR a\\.requested_by = \\? OR \\(p\\.id IS NOT NULL AND \\(.*\\)\\)\\) AND a\\.reviewer_uid = \\? AND a\\.status = \\? AND a\\.work_item_owner_id IS NOT NULL AND a\\.work_item_owner_id = \\? AND a\\.project_id = \\?").
		WithArgs("u1", "u1", "u1", "u1", "u1", "u1", "u2", "pending", int64(10), int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"entity_type",
			"entity_id",
			"entity_code",
			"transition",
			"title",
			"requested_by",
			"requested_at",
			"request_comment",
			"reviewer_uid",
			"status",
			"reviewed_at",
			"review_comment",
			"project_id",
			"project_code",
			"created_at",
		}).AddRow(
			int64(7),
			"work_item",
			int64(10),
			"AIMS-10",
			"complete",
			"Complete task",
			"u1",
			"2026-06-30 10:00:00",
			"please review",
			"u2",
			"pending",
			nil,
			nil,
			int64(42),
			"PRJ-1",
			"2026-06-30 09:00:00",
		))

	items, err := adapter.approvalList(
		context.Background(),
		url.Values{
			"current_user": {"u1"},
			"reviewer_uid": {"u2"},
			"status":       {"pending"},
			"entity_type":  {"task"},
			"entity_id":    {"10"},
			"project_id":   {"42"},
		},
	)
	if err != nil {
		t.Fatalf("approvalList returned error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %#v", items)
	}
	item := items[0]
	if item.EntityType != "work_item" || item.EntityID != 10 || item.ProjectID != 42 {
		t.Fatalf("unexpected item: %#v", item)
	}
	if item.EntityCode == nil || *item.EntityCode != "AIMS-10" {
		t.Fatalf("entity code = %#v", item.EntityCode)
	}
	if item.ReviewedAt != nil || item.ReviewComment != nil {
		t.Fatalf("nullable review fields should remain nil: %#v", item)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestApprovalListWhereConstrainsToCurrentUserOrProjectVisibility(t *testing.T) {
	where, args, err := approvalListWhere(url.Values{
		"current_user_project_admin_project_codes": {"PRJ-1"},
	}, "u1")
	if err != nil {
		t.Fatalf("approvalListWhere returned error: %v", err)
	}

	combined := strings.Join(where, " AND ")
	for _, expected := range []string{
		"a.reviewer_uid = ?",
		"a.requested_by = ?",
		"p.id IS NOT NULL",
		"p.project_code IN (?)",
	} {
		if !strings.Contains(combined, expected) {
			t.Fatalf("approval list visibility where missing %q in %s", expected, combined)
		}
	}
	if !reflect.DeepEqual(args, []any{"u1", "u1", "u1", "u1", "u1", "u1", "PRJ-1"}) {
		t.Fatalf("unexpected visibility args %#v", args)
	}
}

func TestApprovalListRouteUsesDedicatedRuntimeBeforeGenericFallback(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)
	getIndex := strings.Index(content, "if method == http.MethodGet {")
	if getIndex == -1 {
		t.Fatal("missing GET branch")
	}
	getSegment := content[getIndex:]
	listIndex := strings.Index(getSegment, "a.approvalList(ctx, query)")
	genericIndex := strings.Index(getSegment, "handleProjectScopedGenericRuntime")
	if listIndex == -1 {
		t.Fatal("missing dedicated approval list route")
	}
	if genericIndex != -1 && genericIndex < listIndex {
		t.Fatal("approval list route must run before generic runtime fallback")
	}
}
