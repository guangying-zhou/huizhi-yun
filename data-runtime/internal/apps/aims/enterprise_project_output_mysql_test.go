package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/url"
	"testing"
	"time"
)

func testEnterpriseProjectOutputMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	// Later subtests in the shared fixture count portfolios/projects; leave no rows behind.
	t.Cleanup(func() {
		for _, q := range []string{
			"DELETE FROM deliverables WHERE project_id IN (982011,982012)",
			"DELETE FROM project_documents WHERE project_id IN (982011,982012)",
			"DELETE FROM aims_project_repos WHERE project_id IN (982011,982012)",
			"DELETE FROM aims_project_members WHERE project_id IN (982011,982012)",
			"DELETE FROM aims_projects WHERE id IN (982011,982012)",
			"DELETE FROM project_portfolios WHERE id=982001",
		} {
			if _, err := db.Exec(q); err != nil {
				t.Errorf("cleanup %q: %v", q, err)
			}
		}
	})
	exec("INSERT INTO project_portfolios(id,code,name,git_group,created_by) VALUES(982001,'R2PF','Output','huizhi-yun','R2Actor')")
	exec("INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,portfolio_id,security_level,confidentiality_level) VALUES(982011,'R2OUT','Output','R2OUT','R2Actor','R2Actor',982001,'project_team','L1'),(982012,'R2OTHER','Other','R2OTHER','Other','Other',NULL,'company','L1')")
	exec("INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(982011,'R2Actor','manager','active')")
	for index := 0; index < 25; index++ {
		status := "pending"
		var uuid any
		if index < 5 {
			status = "approved"
		} else if index < 10 {
			status = "submitted"
		} else if index < 15 {
			uuid = fmt.Sprintf("00000000-0000-4000-8000-%012d", index)
		}
		exec("INSERT INTO deliverables(project_owner_id,project_id,name,deliverable_type,status,document_uuid,created_by) VALUES(982011,982011,?,'document',?,?,'R2Actor')", fmt.Sprintf("Doc-%02d", index), status, uuid)
	}
	exec("INSERT INTO deliverables(project_owner_id,project_id,name,deliverable_type,created_by) VALUES(982011,982011,'Artifact','artifact','R2Actor'),(982012,982012,'Other','document','Other')")
	// Cards are category based, irrespective of deliverable page; a folder is not a card.
	exec("INSERT INTO project_documents(uuid,project_id,title,is_folder,doc_category,created_by) VALUES('00000000-0000-4000-8000-000000982001',982011,'Folder',1,'project_proposal','R2Actor'),('00000000-0000-4000-8000-000000982002',982011,'Proposal',0,'project_proposal','R2Actor'),('00000000-0000-4000-8000-000000982003',982011,'Spec',0,'requirement_spec','R2Actor')")
	exec("INSERT INTO aims_project_repos(project_id,repo_project_code) VALUES(982011,'huizhi-yun/huizhiyun')")
	projection := projectscope.Projection{Version: 1, ProjectCodes: []string{"R2OUT"}, Masks: []int{0, 65535}}
	readCtx := WithEnterpriseProjectReadScope(ctx, projection, nil)
	q := url.Values{"current_user": {"R2Actor"}, "page": {"1"}, "pageSize": {"20"}}
	var stats map[string]int64
	for _, page := range []string{"1", "2", "3"} {
		q.Set("page", page)
		out, err := a.ReadEnterpriseProjectOutput(readCtx, "982011", q)
		if err != nil {
			t.Fatal(err)
		}
		data := out["data"].(map[string]any)
		items := data["items"].([]deliverableListItem)
		want := 20
		if page == "2" {
			want = 5
		}
		if page == "3" {
			want = 0
		}
		if len(items) != want || data["total"] != int64(25) {
			t.Fatal(data)
		}
		for _, row := range items {
			if row.DeliverableType != "document" || row.ProjectID != 982011 {
				t.Fatal(row)
			}
		}
		current := data["stats"].(map[string]int64)
		if current["total"] != 25 || current["approved"] != 5 || current["submitted"] != 10 || current["pending"] != 10 {
			t.Fatal(current)
		}
		if stats != nil && fmt.Sprint(stats) != fmt.Sprint(current) {
			t.Fatal("stats changed with page")
		}
		stats = current
		cards := data["documents"].(map[string]any)
		if cards["project_proposal"].(*directDocumentListItem).Title != "Proposal" || cards["requirement_spec"].(*directDocumentListItem).Title != "Spec" {
			t.Fatal(cards)
		}
		if len(data["repos"].([]projectRepo)) != 1 {
			t.Fatal(data)
		}
	}
	identity := EnterpriseProjectUpdateIdentity{ActorUID: "R2Actor", CommandScope: &EnterpriseProjectCommandScope{Projection: projection, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
	writeCtx := WithEnterpriseProjectCommandScope(ctx, identity)
	out, err := a.enterpriseProjectRepoCandidates(writeCtx, "982011", q)
	if err != nil || out["data"].(map[string]any)["gitGroup"] != "huizhi-yun" {
		t.Fatal(out, err)
	}
	expect403 := func(err error) {
		t.Helper()
		var h httperror.Error
		if !errors.As(err, &h) || h.Status != 403 {
			t.Fatal("want forbidden", err)
		}
	}
	_, err = a.enterpriseProjectRepoCandidates(writeCtx, "982012", q)
	expect403(err) // company read is not edit.
	_, err = a.enterpriseProjectRepoCandidates(readCtx, "982011", q)
	expect403(err)
	exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=982011")
	exec("UPDATE aims_projects SET leader_uid='Other',created_by='Other' WHERE id=982011")
	_, err = a.enterpriseProjectRepoCandidates(writeCtx, "982011", q)
	expect403(err)
	q.Set("current_user", "NonMember")
	_, err = a.ReadEnterpriseProjectOutput(readCtx, "982011", q)
	expect403(err)
	q.Set("current_user", "R2Actor")
	q.Set("pageSize", "101")
	_, err = a.ReadEnterpriseProjectOutput(readCtx, "982012", q)
	if err == nil {
		t.Fatal("oversize pagination accepted")
	}
}
