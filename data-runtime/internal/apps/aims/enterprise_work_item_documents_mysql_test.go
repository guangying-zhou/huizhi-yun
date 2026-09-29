package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

func testEnterpriseWorkItemDocumentScopeMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	const doc = "11111111-1111-4111-8111-111111111111"
	const missing = "22222222-2222-4222-8222-222222222222"
	for _, statement := range []string{
		"INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(980,'DOC-P','Documents','DOC','U1','U1','active')",
		"INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(980,'U1','manager','active')",
		"INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status) VALUES(9800,980,1,'DOC-1','matter','task','Document item','in_progress')",
		"INSERT INTO project_documents(uuid,project_id,project_code,title,is_folder,codocs_uuid,document_source,created_by,updated_by) VALUES('33333333-3333-4333-8333-333333333333',980,'DOC-P','Indexed',0,'" + doc + "','codocs','U1','U1')",
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	query := url.Values{"current_user": {"U1"}}
	scope := func(code string) context.Context {
		return WithEnterpriseProjectCommandScope(context.Background(), EnterpriseProjectUpdateIdentity{
			ActorUID: "U1",
			CommandScope: &EnterpriseProjectCommandScope{
				Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{code}, Masks: []int{0, 65535}},
				ExpiresAt:  time.Now().Add(15 * time.Second).UnixMilli(),
			},
		})
	}
	assertCode := func(err error, code string, status int) {
		t.Helper()
		var denied httperror.Error
		if !errors.As(err, &denied) || denied.Code != code || denied.Status != status {
			t.Fatalf("error = %v; want %d %s", err, status, code)
		}
	}
	count := func() int {
		t.Helper()
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM project_documents WHERE work_item_id=9800").Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	check := func(allowed bool) EnterpriseProjectDocumentACL {
		return func(_ context.Context, uuid, ref string, facts EnterpriseProjectDocumentAccessFacts) (map[string]any, error) {
			if uuid != doc || ref != "codocs_document" || facts.ActorUID != "U1" || facts.ProjectCode != "DOC-P" || len(facts.Roles) != 1 || facts.Roles[0] != "project_manager" {
				t.Fatalf("untrusted ACL facts: %q %q %#v", uuid, ref, facts)
			}
			return map[string]any{"allowed": allowed}, nil
		}
	}
	_, err := a.linkWorkItemDocument(WithEnterpriseWorkItemDocumentACL(scope("OTHER"), check(true)), "9800", query, map[string]any{"documentId": doc})
	assertCode(err, "enterprise_project_command_scope_denied", 403)
	_, err = a.linkWorkItemDocument(WithEnterpriseWorkItemDocumentACL(scope("DOC-P"), check(true)), "9800", query, map[string]any{"documentId": missing})
	assertCode(err, "document_source_not_found", 404)
	_, err = a.linkWorkItemDocument(WithEnterpriseWorkItemDocumentACL(scope("DOC-P"), check(false)), "9800", query, map[string]any{"documentId": doc})
	assertCode(err, "document_view_required", 403)
	if got := count(); got != 0 {
		t.Fatalf("denied link inserted %d rows", got)
	}
	if _, err = a.linkWorkItemDocument(WithEnterpriseWorkItemDocumentACL(scope("DOC-P"), check(true)), "9800", query, map[string]any{"documentId": doc}); err != nil {
		t.Fatalf("allowed link: %v", err)
	}
	if got := count(); got != 1 {
		t.Fatalf("allowed link count = %d", got)
	}
	_, err = a.unlinkWorkItemDocument(scope("DOC-P"), "9800", missing, query)
	assertCode(err, "document_link_not_found", 404)
	// Unlink deliberately has no Codocs callback: removing a stale link must work
	// after the actor loses document view, without changing the Codocs document.
	if _, err = a.unlinkWorkItemDocument(scope("DOC-P"), "9800", doc, query); err != nil {
		t.Fatalf("unlink without current Codocs view: %v", err)
	}
	if got := count(); got != 0 {
		t.Fatalf("unlink left %d rows", got)
	}
}
