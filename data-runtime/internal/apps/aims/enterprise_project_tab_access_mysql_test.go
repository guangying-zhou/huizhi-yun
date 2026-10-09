package aims

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/url"
	"strconv"
	"testing"
)

func testEnterpriseProjectTabsMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	t.Helper()
	t.Cleanup(func() {
		for _, q := range []string{"DELETE FROM time_entries WHERE project_id IN (890001,890002,890003)", "DELETE FROM aims_project_members WHERE project_id IN (890001,890002,890003)", "DELETE FROM aims_projects WHERE id IN (890001,890002,890003)"} {
			if _, err := db.Exec(q); err != nil {
				t.Error(err)
			}
		}
	})
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,security_level,confidentiality_level,lifecycle_status) VALUES
 (890001,'TAB-A','Tab A','A','tab-leader','tab-leader','company','L1','active'),
 (890002,'TAB-B','Tab B','B','tab-other-manager','tab-other-manager','company','L1','active'),
 (890003,'TAB-PRIVATE','Tab Private','P','tab-leader','tab-leader','project_team','L1','active')`)
	exec("INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(890001,'tab-member','member','active'),(890001,'tab-manager','manager','active')")
	makeCtx := func(management projectscope.Projection) context.Context {
		c := WithEnterpriseProjectReadScope(context.Background(), projectscope.Projection{Version: 1, Masks: []int{65535}}, nil)
		return WithEnterpriseProjectManagementScope(c, management, nil)
	}
	denied := projectscope.Projection{Version: 1, Masks: []int{0}}
	ctx := makeCtx(denied)
	for _, test := range []struct {
		actor, tab string
		allowed    bool
	}{
		{"tab-outsider", "board", false}, {"TAB-MEMBER", "board", false}, {"tab-member", "board", true}, {"tab-manager", "goals", true},
		{"tab-leader", "requirements", true}, {"tab-other-manager", "board", false}, {"tab-other-manager", "weekly-reports", true}, {"tab-outsider", "weekly-reports", false},
	} {
		_, err := a.RequireEnterpriseProjectTab(ctx, "890001", url.Values{"current_user": {test.actor}}, test.tab)
		if (err == nil) != test.allowed {
			t.Fatalf("%s/%s allowed=%v err=%v", test.actor, test.tab, test.allowed, err)
		}
	}
	// Manager of another project must still pass target visibility.
	if _, err := a.RequireEnterpriseProjectTab(ctx, "890003", url.Values{"current_user": {"tab-other-manager"}}, "weekly-reports"); err == nil {
		t.Fatal("private target visibility bypassed")
	}
	scoped := makeCtx(projectscope.Projection{Version: 1, ProjectCodes: []string{"TAB-A"}, Masks: []int{0, 65535}})
	if _, err := a.RequireEnterpriseProjectTab(scoped, "890001", url.Values{"current_user": {"tab-outsider"}}, "board"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.RequireEnterpriseProjectTab(scoped, "890002", url.Values{"current_user": {"tab-outsider"}}, "board"); err == nil {
		t.Fatal("scope escaped to company project")
	}
	exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=890001 AND uid='tab-member'")
	if _, err := a.RequireEnterpriseProjectTab(ctx, "890001", url.Values{"current_user": {"tab-member"}}, "board"); err == nil {
		t.Fatal("revoked member retained access")
	}
	exec("UPDATE aims_project_members SET status='active' WHERE project_id=890001 AND uid='tab-member'")
	exec("INSERT INTO time_entries(project_id,uid,entry_date,hours) VALUES(890001,'tab-member','2026-10-02',0.10),(890001,'tab-leader','2026-10-02',0.10)")
	for _, test := range []struct {
		actor string
		total int64
	}{{"tab-member", 1}, {"tab-manager", 2}} {
		out, err := a.projectTimeEntries(ctx, "890001", url.Values{"current_user": {test.actor}, "page": {"1"}, "pageSize": {"1"}})
		if err != nil || out["total"] != test.total {
			t.Fatalf("time COUNT %s: %#v %v", test.actor, out, err)
		}
	}
	out, err := a.projectTimeEntries(scoped, "890001", url.Values{"current_user": {"tab-outsider"}, "page": {"1"}, "pageSize": {"1"}})
	if err != nil || out["total"] != int64(2) {
		t.Fatalf("scoped manager time count %#v %v", out, err)
	}
	var otherID int64
	if err := db.QueryRow("SELECT id FROM time_entries WHERE project_id=890001 AND uid='tab-leader'").Scan(&otherID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.projectTimeEntryDetail(ctx, "890001", strconv.FormatInt(otherID, 10), url.Values{"current_user": {"tab-member"}}); err == nil {
		t.Fatal("other employee time detail leaked")
	}
}
