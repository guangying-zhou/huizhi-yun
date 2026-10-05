package aims

import (
	"context"
	"database/sql"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

func testEnterpriseProjectReadScopeMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO aims_projects(id,project_code,name,short_name,security_level,confidentiality_level,leader_uid,created_by,lifecycle_status,dept_code) VALUES
 (1001,'SCOPE-A','PA01 scope','A','project_team','L1','other','other','active','D'),
 (1002,'SCOPE-B','PA01 scope','B','whitelist','L1','other','other','active','CHILD'),
 (1003,'SCOPE-P0','PA01 scope','P0','company','L0','other','other','active','D'),
 (1004,'SCOPE-P1','PA01 scope','P1','company','L1','other','other','active','D'),
 (1005,'SCOPE-CREATOR','PA01 creator','C','project_team','L1','other','scope-actor','active','D'),
 (1006,'SCOPE-OWNER','PA01 owner','O','project_team','L1','scope-actor','other','active','D')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(1001,'scope-actor','member','active'),(1002,'scope-actor','member','active')`); err != nil {
		t.Fatal(err)
	}
	defer db.Exec("DELETE FROM aims_project_members WHERE project_id>=1001")
	defer db.Exec("DELETE FROM aims_projects WHERE id>=1001")
	ctx := WithEnterpriseProjectReadScope(context.Background(), projectscope.Projection{Version: 1, ProjectCodes: []string{"SCOPE-A"}, Masks: []int{0, 65535}}, nil)
	query := url.Values{"current_user": {"scope-actor"}, "search": {"PA01 scope"}, "pageSize": {"1"}, "page": {"1"}}
	list, err := a.memberProjects(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	if list["total"] != int64(3) {
		t.Fatalf("scope must precede COUNT/pagination: %#v", list)
	}
	query.Set("page", "4")
	empty, err := a.memberProjects(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	if empty["total"] != int64(3) || len(empty["items"].([]map[string]any)) != 0 {
		t.Fatalf("empty page/count mismatch: %#v", empty)
	}
	if _, err := a.projectDetail(ctx, "1001", query); err != nil {
		t.Fatalf("scoped team member denied: %v", err)
	}
	if _, err := a.projectDetail(ctx, "1002", query); err == nil {
		t.Fatal("out-of-scope noncompany detail leaked")
	}
	for _, id := range []string{"1003", "1004"} {
		if _, err := a.projectDetail(ctx, id, query); err != nil {
			t.Fatalf("company scope exception lost: %v", err)
		}
	}
	lowerCase := WithEnterpriseProjectReadScope(context.Background(), projectscope.Projection{Version: 1, ProjectCodes: []string{"scope-a"}, Masks: []int{0, 65535}}, nil)
	if _, err := a.projectDetail(lowerCase, "1001", query); err == nil {
		t.Fatal("case-insensitive SQL widened a project code scope")
	}
	// participant comes from the current row, and removal affects the next read.
	participant := WithEnterpriseProjectReadScope(context.Background(), projectscope.Projection{Version: 1, Masks: []int{65280}}, nil)
	for _, id := range []string{"1005", "1006"} {
		if _, err := a.projectDetail(participant, id, query); err != nil {
			t.Fatalf("authoritative creator/leader participant denied: %v", err)
		}
	}
	creator := WithEnterpriseProjectReadScope(context.Background(), projectscope.Projection{Version: 1, Masks: []int{61680}}, nil)
	if _, err := a.projectDetail(creator, "1005", query); err != nil {
		t.Fatal(err)
	}
	if _, err := a.projectDetail(creator, "1006", query); err == nil {
		t.Fatal("leader conflated with creator scope")
	}
	if _, err := a.projectDetail(participant, "1002", query); err != nil {
		t.Fatalf("active participant denied: %v", err)
	}
	if _, err := db.Exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=1002 AND uid='scope-actor'"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.projectDetail(participant, "1002", query); err == nil {
		t.Fatal("revoked participant retained access")
	}
	// Nested reads keep the public read exception but never let an admin query
	// flag bypass the signed non-public scope. Denied parent means no member list.
	query.Set("current_user_is_project_admin", "1")
	if err := a.EnterpriseProjectReadAccess(ctx, "1001", query); err != nil {
		t.Fatal(err)
	}
	if _, err := a.listProjectMembers(ctx, "1002", query, map[string]any{}); err == nil {
		t.Fatal("nested members leaked outside scope")
	}
	for _, id := range []string{"1003", "1004"} {
		if err := a.EnterpriseProjectReadAccess(ctx, id, query); err != nil {
			t.Fatalf("company nested read denied: %v", err)
		}
	}
	if err := a.EnterpriseProjectReadAccess(participant, "1002", query); err == nil {
		t.Fatal("admin query bypassed revoked participant")
	}
	// A public read permit never substitutes for the independent write permit.
	for _, id := range []string{"1003", "1004"} {
		before, version, err := a.EnterpriseProjectEditableSnapshot(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		identity := EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "scope-actor", ServiceClientID: "enterprise.runtime", RequestID: "public-denied-" + id, IdempotencyKey: "public-denied-" + id}
		_, err = a.UpdateEnterpriseProject(ctx, identity, id, map[string]any{"expectedVersion": version, "description": "must not be written"})
		var denied httperror.Error
		if !errors.As(err, &denied) || denied.Status != 403 {
			t.Fatalf("public read widened write: %v", err)
		}
		after, afterVersion, err := a.EnterpriseProjectEditableSnapshot(context.Background(), id)
		if err != nil || afterVersion != version || after["description"] != before["description"] {
			t.Fatal("denied write changed public project")
		}
		var receipts int
		if err := db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key=?", identity.IdempotencyKey).Scan(&receipts); err != nil || receipts != 0 {
			t.Fatal("denied public write left receipt", err)
		}
	}
	// Tree facts are supplied by owning Runtime Directory, not request input.
	tree := projectscope.Projection{Version: 1, DepartmentCodes: []string{"D"}, DepartmentTreeRoots: []string{"D"}, Masks: []int{0, 65535, 65535, 65535}}
	treeCtx := WithEnterpriseProjectReadScope(context.Background(), tree, map[string][]string{"D": {"D", "CHILD"}})
	query.Set("current_user_is_project_admin", "1")
	if _, err := a.projectDetail(treeCtx, "1002", query); err != nil {
		t.Fatalf("authoritative descendant denied: %v", err)
	}
	if _, _, err := enterpriseProjectReadScopeWhere(WithEnterpriseProjectReadScope(context.Background(), tree, nil), "scope-actor"); err == nil {
		t.Fatal("missing authoritative tree facts accepted")
	}
}
