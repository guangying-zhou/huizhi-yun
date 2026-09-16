package aims

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestWorkItemDecomposeContextRequiresProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT\\s+wi\\.id,\\s+wi\\.project_id,\\s+p\\.project_code,.*FROM work_items wi").
		WithArgs("77").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"project_id",
			"project_code",
			"project_name",
			"milestone_id",
			"milestone_name",
			"item_key",
			"title",
			"tier",
			"type",
			"template_key",
			"status",
			"approval_status",
			"review_level",
			"portfolio_id",
			"git_group",
		}).AddRow(
			int64(77),
			int64(42),
			"PRJ-1",
			"项目一",
			int64(5),
			"需求里程碑",
			"PRJ-1-77",
			"需求分解",
			"target",
			"requirement",
			"requirement_breakdown",
			"todo",
			"not_required",
			int64(1),
			int64(3),
			"group/project",
		))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT repo_project_code\\s+FROM aims_project_repos").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"repo_project_code"}).AddRow("group/repo"))
	mock.ExpectQuery("(?s)SELECT\\s+a\\.heading_anchor,\\s+a\\.source_document_uuid,.*FROM work_item_source_anchors a").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{
			"heading_anchor",
			"source_document_uuid",
			"source_document_title",
			"heading_depth",
			"work_item_id",
			"work_item_key",
			"work_item_tier",
			"work_item_parent_id",
			"work_item_req_category",
		}).AddRow("scope", "doc-1", "需求说明", int64(2), int64(88), "PRJ-1-88", "matter", nil, "feature"))

	data, err := adapter.workItemDecomposeContextData(
		context.Background(),
		"77",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("workItemDecomposeContextData returned error: %v", err)
	}
	workItem, ok := data["workItem"].(decomposeWorkItem)
	if !ok || workItem.ProjectID != int64(42) {
		t.Fatalf("unexpected work item: %#v", data["workItem"])
	}
	codes, ok := data["sourceProjectCodes"].([]string)
	if !ok || len(codes) != 2 || codes[0] != "group/project" || codes[1] != "group/repo" {
		t.Fatalf("unexpected source project codes: %#v", data["sourceProjectCodes"])
	}
	anchors, ok := data["existingAnchors"].([]decomposeAnchor)
	if !ok || len(anchors) != 1 || anchors[0].SourceDocumentUUID != "doc-1" {
		t.Fatalf("unexpected anchors: %#v", data["existingAnchors"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
