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

func testEnterpriseRequirementsMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	ctx := context.Background()
	for _, q := range []string{`INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(981001,'R1A','Requirements','R1A','R1Actor','R1Actor','active'),(981002,'R1B','Other','R1B','Other','Other','active')`, `INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(981001,'R1Actor','manager','active')`} {
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	identity := func(key string, allow bool) EnterpriseProjectUpdateIdentity {
		codes := []string{"R1A"}
		if !allow {
			codes = []string{"R1B"}
		}
		return EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "R1Actor", ServiceClientID: "enterprise.runtime", RequestID: key, IdempotencyKey: key, CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: codes, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
	}
	status := func(err error, want int) {
		t.Helper()
		var h httperror.Error
		if !errors.As(err, &h) || h.Status != want {
			t.Fatalf("want %d: %v", want, err)
		}
	}
	command := func(key, oid, action string, body map[string]any) map[string]any {
		t.Helper()
		r, e := a.WriteEnterpriseRequirement(ctx, identity(key, true), "981001", oid, action, body)
		if e != nil {
			t.Fatalf("%s: %v", action, e)
		}
		return r
	}
	content := command("r1-content", "", "content-create", map[string]any{"kind": "module", "title": "模块", "headingDepth": float64(2), "contentMd": "正文"})
	cid := fmt.Sprint(content["id"])
	body := map[string]any{"title": "标记需求", "contentIds": []any{content["id"]}}
	first := command("r1-create", "", "create", body)
	rid := fmt.Sprint(first["id"])
	replay := command("r1-create", "", "create", body)
	if replay["idempotent"] != true || replay["receiptId"] != first["receiptId"] {
		t.Fatalf("replay %#v", replay)
	}
	_, err := a.WriteEnterpriseRequirement(ctx, identity("r1-create", false), "981001", "", "create", body)
	status(err, 403)
	_, err = a.WriteEnterpriseRequirement(ctx, identity("r1-create", true), "981001", "", "create", map[string]any{"title": "changed"})
	status(err, 409)
	_, err = a.WriteEnterpriseRequirement(ctx, identity("r1-cross", true), "981001", "", "create", map[string]any{"title": "cross", "contentIds": []any{float64(999999)}})
	status(err, 404)
	var foreignID int64
	res, errForeign := db.Exec("INSERT INTO requirement_contents(project_id,heading_depth,title,status,version_status) VALUES(981002,2,'foreign','imported','draft')")
	if errForeign != nil {
		t.Fatal(errForeign)
	}
	foreignID, errForeign = res.LastInsertId()
	if errForeign != nil {
		t.Fatal(errForeign)
	}
	_, err = a.WriteEnterpriseRequirement(ctx, identity("r1-foreign", true), "981001", fmt.Sprint(foreignID), "content-update", map[string]any{"title": "denied"})
	status(err, 403)

	command("r1-update", rid, "update", map[string]any{"title": "修改"})
	command("r1-content-update", cid, "content-update", map[string]any{"title": "章节修改", "contentMd": "新正文"})
	command("r1-delete", rid, "delete", map[string]any{})
	command("r1-delete", rid, "delete", map[string]any{})
	command("r1-content-delete", cid, "content-delete", map[string]any{})
	command("r1-content-restore", cid, "content-restore", map[string]any{})
	expired := identity("r1-expired", true)
	expired.CommandScope.ExpiresAt = time.Now().Add(-time.Second).UnixMilli()
	_, err = a.WriteEnterpriseRequirement(ctx, expired, "981001", cid, "content-update", map[string]any{"title": "expired"})
	status(err, 403)
	if _, err = db.Exec("UPDATE aims_projects SET leader_uid='Other' WHERE id=981001"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=981001"); err != nil {
		t.Fatal(err)
	}
	_, err = a.WriteEnterpriseRequirement(ctx, identity("r1-create", true), "981001", "", "create", body)
	status(err, 403)
	// Restore test manager only through the isolated fixture; production is untouched.
	db.Exec("UPDATE aims_projects SET leader_uid='R1Actor' WHERE id=981001")
	db.Exec("UPDATE aims_project_members SET status='active' WHERE project_id=981001")
	importBody := map[string]any{"source": "codocs", "codocsUuid": "12345678-1234-4234-9234-123456789abc", "repoProjectCode": nil, "repoFilePath": nil, "repoCommitId": nil, "docName": "规格书", "mode": "flat", "headingLevels": "2,3", "forceOverwrite": false, "items": []any{map[string]any{"title": "模块", "headingDepth": float64(2), "contentMd": "正文", "asRequirement": false, "mergeGroupId": nil, "requirementType": "functional", "requirementCategory": nil, "children": []any{}}}}
	imported := command("r1-import", "", "import", importBody)
	replayImport := command("r1-import", "", "import", importBody)
	if imported["receiptId"] != replayImport["receiptId"] || replayImport["idempotent"] != true {
		t.Fatal("import replay duplicated")
	}

	// A failure recording the terminal receipt rolls back the domain write too.
	if _, err = db.Exec("CREATE TRIGGER r1_receipt_fault BEFORE UPDATE ON service_command_receipt FOR EACH ROW BEGIN IF NEW.idempotency_key='r1-rollback' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated fault'; END IF; END"); err != nil {
		t.Fatal(err)
	}
	_, err = a.WriteEnterpriseRequirement(ctx, identity("r1-rollback", true), "981001", "", "create", map[string]any{"title": "R1 rollback marker"})
	db.Exec("DROP TRIGGER r1_receipt_fault")
	if err == nil {
		t.Fatal("injected receipt fault did not fail")
	}
	var residue int
	if err = db.QueryRow("SELECT COUNT(*) FROM requirement_items WHERE project_id=981001 AND title='R1 rollback marker'").Scan(&residue); err != nil || residue != 0 {
		t.Fatalf("domain write survived rollback: %d %v", residue, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='r1-rollback'").Scan(&residue); err != nil || residue != 0 {
		t.Fatalf("receipt survived rollback: %d %v", residue, err)
	}

	command("r1-page-a", "", "create", map[string]any{"title": "page A"})
	command("r1-page-b", "", "create", map[string]any{"title": "page B"})

	readCtx := WithEnterpriseProjectReadScope(ctx, projectscope.Projection{Version: 1, ProjectCodes: []string{"R1A"}, Masks: []int{0, 65535}}, nil)
	q := url.Values{"current_user": {"R1Actor"}, "page": {"1"}, "pageSize": {"1"}}
	page1, e := a.ReadEnterpriseRequirementProjection(readCtx, "981001", "list", q)
	if e != nil {
		t.Fatal(e)
	}
	d := page1["data"].(map[string]any)
	if d["total"] != int64(2) || len(d["items"].([]map[string]any)) != 1 {
		t.Fatalf("COUNT/page mismatch: %#v", d)
	}
	q.Set("page", "2")
	page2, e := a.ReadEnterpriseRequirementProjection(readCtx, "981001", "list", q)
	if e != nil {
		t.Fatal(e)
	}
	if page2["data"].(map[string]any)["total"] != int64(2) {
		t.Fatal("page total changed")
	}
	for _, action := range []string{"list", "spec", "targets"} {
		if _, e := a.ReadEnterpriseRequirementProjection(readCtx, "981001", action, q); e != nil {
			t.Fatalf("%s: %v", action, e)
		}
	}
}
