package aims

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestWorkItemSourceSectionsRequireProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT id, source_document_uuid, source_document_title, heading_anchor, heading_depth, sort_order\\s+FROM work_item_source_anchors").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"source_document_uuid",
			"source_document_title",
			"heading_anchor",
			"heading_depth",
			"sort_order",
		}).AddRow(int64(9), "doc-1", "需求说明", "scope", int64(2), int64(1)))

	data, err := adapter.workItemSourceSectionAnchors(
		context.Background(),
		"77",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("workItemSourceSectionAnchors returned error: %v", err)
	}
	if data["projectId"] != int64(42) {
		t.Fatalf("projectId = %#v, want 42", data["projectId"])
	}
	anchors, ok := data["anchors"].([]sourceSectionAnchor)
	if !ok || len(anchors) != 1 || anchors[0].SourceDocumentUUID != "doc-1" {
		t.Fatalf("unexpected anchors: %#v", data["anchors"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
