package aims

import (
	"context"
	"database/sql"
	"testing"
)

// Runs inside TestEnterpriseProjectMembersMySQL: unified mode with the Registry
// fence, real rows and real locks. Document asset design DOC-05a.
func testPortfolioMembersMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	count := func(q string, args ...any) (n int) {
		t.Helper()
		if err := db.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	exec("INSERT INTO project_portfolios(id,code,name,owner_uid,created_by) VALUES(901,'PFA','Owned','OWN','OWN'),(902,'PFB','Ownerless',NULL,'ADM')")
	// Other subtests assert exact portfolio totals: leave no fixture behind.
	defer func() {
		exec("DELETE FROM aims_portfolio_members WHERE portfolio_id IN (901,902)")
		exec("DELETE FROM aims_portfolio_doc_repos WHERE portfolio_id IN (901,902)")
		exec("DELETE FROM project_portfolios WHERE id IN (901,902)")
	}()
	save := func(portfolio, actor string, admin bool, body map[string]any) (map[string]any, string) {
		out, err := a.savePortfolioMember(ctx, portfolio, portfolioActorQuery(actor, admin), body)
		return out, portfolioErrorCode(err)
	}

	// Permission and relation must both hold.
	if _, code := save("901", "ADM", true, map[string]any{"action": "upsert", "uid": "X1", "relationType": "viewer"}); code != "portfolio_member_manager_required" {
		t.Fatalf("admin without relation code=%q", code)
	}
	if _, code := save("901", "OWN", false, map[string]any{"action": "upsert", "uid": "X1", "relationType": "viewer"}); code != "portfolio_member_manager_required" {
		t.Fatalf("owner without permission code=%q", code)
	}
	if n := count("SELECT COUNT(*) FROM aims_portfolio_members"); n != 0 {
		t.Fatalf("rejected commands wrote %d rows", n)
	}

	// Owner with permission adds a manager and a viewer; the replay is rejected by revision.
	if out, code := save("901", "OWN", true, map[string]any{"action": "upsert", "uid": "MGR", "relationType": "manager"}); code != "" || out["revision"] != int64(1) {
		t.Fatalf("add manager out=%v code=%q", out, code)
	}
	if _, code := save("901", "OWN", true, map[string]any{"action": "upsert", "uid": "MGR", "relationType": "manager"}); code != "portfolio_member_revision_conflict" {
		t.Fatalf("stale replay code=%q", code)
	}
	if _, code := save("901", "MGR", true, map[string]any{"action": "upsert", "uid": "VIEW", "relationType": "viewer"}); code != "" {
		t.Fatalf("manager adds viewer code=%q", code)
	}
	// A viewer with the permission is still not a manager.
	if _, code := save("901", "VIEW", true, map[string]any{"action": "upsert", "uid": "X2", "relationType": "viewer"}); code != "portfolio_member_manager_required" {
		t.Fatalf("viewer code=%q", code)
	}
	// Removal revokes immediately: the removed manager can no longer manage.
	if _, code := save("901", "OWN", true, map[string]any{"action": "remove", "uid": "MGR", "expectedRevision": 1}); code != "" {
		t.Fatalf("remove manager code=%q", code)
	}
	if _, code := save("901", "MGR", true, map[string]any{"action": "upsert", "uid": "X3", "relationType": "viewer"}); code != "portfolio_member_manager_required" {
		t.Fatalf("removed manager code=%q", code)
	}

	// Bootstrap: only the first manager of a portfolio with no owner and no manager.
	if _, code := save("902", "ADM", true, map[string]any{"action": "upsert", "uid": "B1", "relationType": "viewer"}); code != "portfolio_member_manager_required" {
		t.Fatalf("bootstrap non-manager code=%q", code)
	}
	if _, code := save("902", "ADM", true, map[string]any{"action": "upsert", "uid": "B1", "relationType": "manager"}); code != "" {
		t.Fatalf("bootstrap code=%q", code)
	}
	if _, code := save("902", "ADM", true, map[string]any{"action": "upsert", "uid": "B2", "relationType": "manager"}); code != "portfolio_member_manager_required" {
		t.Fatalf("second bootstrap code=%q", code)
	}
	// The only manager of an ownerless portfolio cannot leave or demote themself.
	if _, code := save("902", "B1", true, map[string]any{"action": "remove", "uid": "B1", "expectedRevision": 1}); code != "portfolio_last_manager_required" {
		t.Fatalf("last manager remove code=%q", code)
	}
	if _, code := save("902", "B1", true, map[string]any{"action": "upsert", "uid": "B1", "relationType": "viewer", "expectedRevision": 1}); code != "portfolio_last_manager_required" {
		t.Fatalf("last manager demote code=%q", code)
	}
	if n := count("SELECT COUNT(*) FROM aims_portfolio_members WHERE portfolio_id=902 AND relation_type='manager' AND status='active'"); n != 1 {
		t.Fatalf("ownerless portfolio managers=%d", n)
	}

	// List reflects the current relation of the caller.
	list, err := a.listPortfolioMembers(ctx, "901", portfolioActorQuery("VIEW", true))
	if err != nil || list["canManage"] != false || len(list["members"].([]map[string]any)) != 2 {
		t.Fatalf("list=%v err=%v", list, err)
	}
	list, err = a.listPortfolioMembers(ctx, "901", portfolioActorQuery("OWN", true))
	if err != nil || list["canManage"] != true {
		t.Fatalf("owner list=%v err=%v", list, err)
	}

	// Document repository registration follows the same rule and row version.
	if _, err = a.savePortfolioDocRepo(ctx, "901", portfolioActorQuery("VIEW", true), map[string]any{"repoPath": "group/docs"}); portfolioErrorCode(err) != "portfolio_member_manager_required" {
		t.Fatalf("viewer repo err=%v", err)
	}
	if _, err = a.savePortfolioDocRepo(ctx, "901", portfolioActorQuery("OWN", true), map[string]any{"repoPath": "group/docs"}); err != nil {
		t.Fatal(err)
	}
	if _, err = a.savePortfolioDocRepo(ctx, "901", portfolioActorQuery("OWN", true), map[string]any{"repoPath": "group/other"}); portfolioErrorCode(err) != "portfolio_doc_repo_version_conflict" {
		t.Fatalf("stale repo err=%v", err)
	}
	if _, err = a.savePortfolioDocRepo(ctx, "901", portfolioActorQuery("OWN", true), map[string]any{"repoPath": "group/other", "expectedRowVersion": 1}); err != nil {
		t.Fatal(err)
	}
	if n := count("SELECT COUNT(*) FROM aims_portfolio_doc_repos WHERE portfolio_id=901 AND repo_path='group/other' AND row_version=2"); n != 1 {
		t.Fatalf("repo rows=%d", n)
	}

	// A changed Registry generation rejects the command before any business write.
	before := count("SELECT COUNT(*) FROM aims_portfolio_members")
	exec("UPDATE enterprise_schema_registry SET generation=generation+1 WHERE id=1")
	_, err = a.savePortfolioMember(ctx, "901", portfolioActorQuery("OWN", true), map[string]any{"action": "upsert", "uid": "GEN", "relationType": "viewer"})
	exec("UPDATE enterprise_schema_registry SET generation=generation-1 WHERE id=1")
	if err == nil || count("SELECT COUNT(*) FROM aims_portfolio_members") != before {
		t.Fatalf("stale generation err=%v", err)
	}
}
