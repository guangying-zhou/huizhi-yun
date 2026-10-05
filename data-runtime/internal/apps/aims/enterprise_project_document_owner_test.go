package aims

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"os"
	"reflect"
	"sort"
	"testing"
)

func TestEnterpriseDocumentPortfolioOwnerRejectedBeforeMutation(t *testing.T) {
	for _, tc := range []struct {
		name     string
		body     map[string]any
		document string
	}{
		{"explicit", map[string]any{"portfolioId": int64(9)}, ""},
		{"parent", map[string]any{"parentId": int64(8)}, ""},
		{"projectCannotOverrideParent", map[string]any{"parentId": int64(8), "projectId": int64(42)}, ""},
		{"stored", nil, "7"},
		{"storedParent", nil, "7"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, m, cleanup := newAimsSQLMockAdapter(t)
			defer cleanup()
			if tc.document != "" {
				parent := any(nil)
				if tc.name == "storedParent" {
					parent = int64(8)
				}
				m.ExpectQuery("SELECT portfolio_id,project_id,milestone_id,work_item_id,project_code,parent_id").WithArgs(int64(7)).WillReturnRows(sqlmock.NewRows([]string{"portfolio_id", "project_id", "milestone_id", "work_item_id", "project_code", "parent_id"}).AddRow(9, nil, nil, nil, "P1", parent))
			}
			if tc.name == "parent" || tc.name == "projectCannotOverrideParent" || tc.name == "storedParent" {
				m.ExpectQuery("(?s)SELECT is_folder, portfolio_id, project_id, project_code, milestone_id, work_item_id").WithArgs(int64(8)).WillReturnRows(sqlmock.NewRows([]string{"is_folder", "portfolio_id", "project_id", "project_code", "milestone_id", "work_item_id"}).AddRow(1, 9, nil, "P1", nil, nil))
			} else {
				m.ExpectQuery("(?s)SELECT code.*FROM project_portfolios").WithArgs(int64(9)).WillReturnRows(sqlmock.NewRows([]string{"code"}).AddRow("P1"))
			}
			_, err := a.ResolveEnterpriseProjectDocumentOwner(context.Background(), tc.body, tc.document)
			var e httperror.Error
			if !errors.As(err, &e) || e.Status != 409 || e.Code != "project_document_portfolio_owner_unsupported" {
				t.Fatalf("error=%v", err)
			}
			// No INSERT/UPDATE/DELETE or external request is part of owner preflight.
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestEnterpriseDocumentOwnerResolvesAuthoritativeProject(t *testing.T) {
	for _, kind := range []string{"projectId", "milestoneId", "workItemId"} {
		t.Run(kind, func(t *testing.T) {
			a, m, cleanup := newAimsSQLMockAdapter(t)
			defer cleanup()
			query := "(?s)SELECT id, project_code.*FROM aims_projects"
			columns := []string{"id", "project_code"}
			if kind == "milestoneId" {
				query = "(?s)SELECT m.project_id, p.project_code.*FROM milestones"
				columns[0] = "project_id"
			}
			if kind == "workItemId" {
				query = "(?s)SELECT wi.project_id, p.project_code.*FROM work_items"
				columns[0] = "project_id"
			}
			m.ExpectQuery(query).WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows(columns).AddRow(263, "P263"))
			id, err := a.ResolveEnterpriseProjectDocumentOwner(context.Background(), map[string]any{kind: int64(42)}, "")
			if err != nil || id != "263" {
				t.Fatalf("id=%s err=%v", id, err)
			}
			if err = m.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestEnterpriseDocumentListDoesNotAliasPortfolioCodeToProject(t *testing.T) {
	a, m, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	m.ExpectQuery("(?s)FROM project_documents d.*NOT \\(d.portfolio_id IS NOT NULL AND d.project_id IS NULL AND d.milestone_id IS NULL AND d.work_item_id IS NULL\\)").WillReturnRows(sqlmock.NewRows([]string{"id"}))
	ctx := context.WithValue(context.Background(), enterpriseDocumentReadKey{}, true)
	items, err := a.listDirectDocuments(ctx, url.Values{"current_user": {"actor"}, "project_code": {"P1"}})
	if err != nil || len(items) != 0 {
		t.Fatalf("items=%v err=%v", items, err)
	}
	if err = m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseDocumentWriteOwnerMismatchRollsBackBeforeMutation(t *testing.T) {
	a, m, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	m.ExpectBegin()
	m.ExpectQuery("(?s)SELECT id, project_code.*FROM aims_projects").WithArgs(int64(42)).WillReturnRows(sqlmock.NewRows([]string{"id", "project_code"}).AddRow(42, "P42"))
	m.ExpectRollback()
	_, err := a.WriteEnterpriseProjectDocument(context.Background(), EnterpriseProjectUpdateIdentity{ActorUID: "actor", CommandScope: &EnterpriseProjectCommandScope{}}, "263", "", "create", map[string]any{"projectId": int64(42)}, false)
	var e httperror.Error
	if !errors.As(err, &e) || e.Status != 403 || e.Code != "project_document_owner_mismatch" {
		t.Fatalf("err=%v", err)
	}
	if err = m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Tree counts include descendants; duplicate/cyclic output is a failure.
func projectDocumentTreeIDs(t *testing.T, roots []*directDocumentListItem) []int64 {
	t.Helper()
	seen := make(map[int64]bool)
	ids := []int64{}
	var walk func([]*directDocumentListItem)
	walk = func(items []*directDocumentListItem) {
		for _, item := range items {
			if seen[item.ID] {
				t.Fatalf("duplicate document tree ID %d", item.ID)
			}
			seen[item.ID] = true
			ids = append(ids, item.ID)
			walk(item.Children)
		}
	}
	walk(roots)
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

func TestProjectDocumentTreeKeepsProjectOwnedDescendants(t *testing.T) {
	projectID, parentID, nestedParentID := int64(1), int64(1), int64(80)
	roots := buildDirectDocumentTree([]*directDocumentListItem{
		{ID: 1, ProjectID: &projectID, IsFolder: true},
		{ID: 2, ProjectID: &projectID, ParentID: &parentID},
		{ID: 3, ProjectID: &projectID},
		{ID: 80, ProjectID: &projectID, ParentID: &parentID, IsFolder: true},
		{ID: 81, ProjectID: &projectID, ParentID: &nestedParentID},
	})
	ids := projectDocumentTreeIDs(t, roots)
	if len(roots) != 2 || !reflect.DeepEqual(ids, []int64{1, 2, 3, 80, 81}) {
		t.Fatalf("project-owned descendants lost: roots=%d IDs=%v", len(roots), ids)
	}
}

func TestEnterpriseProjectDocumentCreationSourceUsesRealHostPayload(t *testing.T) {
	fixture, err := os.ReadFile("../../../../enterprise/test/fixtures/host-project-document-create-index.json")
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err = json.Unmarshal(fixture, &payload); err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{"", "codocs", "repo"} {
		t.Run("source="+source, func(t *testing.T) {
			input := make(map[string]any)
			for key, value := range payload {
				input[key] = value
			}
			if source != "" {
				input["documentSource"] = source
			}
			out := enterpriseProjectDocumentCreationPayload(input)
			want := source
			if want == "" {
				want = "codocs"
			}
			if normalizeDocumentSource(out) != want {
				t.Fatalf("source=%v want %s", out["documentSource"], want)
			}
			delete(out, "documentSource")
			if !reflect.DeepEqual(out, payload) {
				t.Fatal("Host creation fields changed")
			}
			if source == "" {
				if _, changed := input["documentSource"]; changed {
					t.Fatal("input mutated")
				}
			}
		})
	}
}
