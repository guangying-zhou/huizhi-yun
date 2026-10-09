package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"strings"
	"testing"
	"time"
)

func testEnterpriseDeliverableQualityMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	ctx := context.Background()
	exec := func(q string, args ...any) sql.Result {
		t.Helper()
		r, e := db.Exec(q, args...)
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	t.Cleanup(func() {
		for _, q := range []string{
			"DROP TRIGGER IF EXISTS r2b_receipt_fault",
			"UPDATE deliverables SET current_submission_id=NULL WHERE project_id IN (983011,983012)",
			"DELETE r FROM deliverable_quality_reviews r JOIN deliverable_submissions s ON s.id=r.submission_id JOIN deliverables d ON d.id=s.deliverable_id WHERE d.project_id IN (983011,983012)",
			"DELETE w FROM deliverable_waivers w JOIN deliverables d ON d.id=w.deliverable_id WHERE d.project_id IN (983011,983012)",
			"DELETE s FROM deliverable_submissions s JOIN deliverables d ON d.id=s.deliverable_id WHERE d.project_id IN (983011,983012)",
			"DELETE FROM deliverables WHERE project_id IN (983011,983012)",
			"DELETE FROM aims_project_members WHERE project_id IN (983011,983012)",
			"DELETE FROM aims_projects WHERE id IN (983011,983012)",
			"DELETE FROM qa_checklist_versions WHERE id=983001",
			"DELETE FROM service_command_receipt WHERE idempotency_key LIKE 'r2b-%'",
		} {
			if _, e := db.Exec(q); e != nil {
				t.Errorf("cleanup %s: %v", q, e)
			}
		}
	})
	exec("INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by) VALUES(983011,'R2QUALITY','Quality','R2Q','R2Manager','R2Manager'),(983012,'R2OUTSIDE','Outside','R2X','Other','Other')")
	exec("INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(983011,'R2QA','member','active'),(983011,'R2Manager','manager','active')")
	exec("INSERT INTO qa_checklist_versions(id,checklist_code,version_no,title,items_json,items_sha256,status,created_by) VALUES(983001,'PROJECT_DOCUMENT_STANDARD',9999,'R2 test',JSON_ARRAY(JSON_OBJECT('code','one','label','One','required',true)),?,'published','R2QA')", strings.Repeat("a", 64))
	exec("INSERT INTO deliverables(id,project_owner_id,project_id,name,deliverable_type,document_source,repo_project_code,repo_file_path,repo_commit_id,created_by) VALUES(983021,983011,983011,'QA snapshot','document','repo','group/repo','README.md','abc123','R2QA'),(983022,983011,983011,'Waive','document','codocs',NULL,NULL,NULL,'R2Manager'),(983023,983012,983012,'Foreign','document','codocs',NULL,NULL,NULL,'Other'),(983024,983011,983011,'Fault','document','codocs',NULL,NULL,NULL,'Other')")
	id := func(actor, key string) EnterpriseProjectUpdateIdentity {
		return EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: actor, ServiceClientID: "enterprise.runtime", RequestID: key, IdempotencyKey: key, CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{"R2QUALITY"}, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
	}
	facts := EnterpriseQualityFacts{QAUID: "R2QA", QARevision: 27, DirectorUID: "R2Director", DirectorRevision: 28}
	command := func(actor, key, object, action string, b map[string]any) map[string]any {
		t.Helper()
		out, e := a.WriteEnterpriseDeliverableQuality(ctx, id(actor, key), "983011", object, action, b, facts)
		if e != nil {
			t.Fatalf("%s: %v", action, e)
		}
		return out
	}
	deny := func(e error, want int) {
		t.Helper()
		var h httperror.Error
		if !errors.As(e, &h) || h.Status != want {
			t.Fatalf("want %d got %v", want, e)
		}
	}
	body := map[string]any{"documentSource": "repo", "repoProjectCode": "group/repo", "repoFilePath": "README.md", "repoCommitId": "abc123", "contentSha256": strings.Repeat("b", 64)}
	s := command("R2QA", "r2b-create", "983021", "submission-create", body)
	sid := fmt.Sprint(s["id"])
	if s["reviewRoute"] != "pm_completeness_then_director_quality" {
		t.Fatal(s)
	}
	resume := command("R2QA", "r2b-create", "983021", "submission-resume", map[string]any{})
	if fmt.Sprint(resume["submission"].(map[string]any)["id"]) != sid {
		t.Fatal(resume)
	}
	replay := command("R2QA", "r2b-create", "983021", "submission-create", body)
	if replay["idempotent"] != true || fmt.Sprint(replay["id"]) != sid {
		t.Fatal(replay)
	}
	command("R2QA", "r2b-activate", sid, "submission-activate", map[string]any{})
	command("R2QA", "r2b-activate", sid, "submission-activate", map[string]any{})
	_, e := a.WriteEnterpriseDeliverableQuality(ctx, id("R2QA", "r2b-self-complete"), "983011", sid, "completeness", map[string]any{"action": "pass"}, facts)
	deny(e, 403)
	review := command("R2Manager", "r2b-complete", sid, "completeness", map[string]any{"action": "pass", "comment": "完整"})
	second := command("R2Manager", "r2b-complete", sid, "completeness", map[string]any{"action": "pass", "comment": "完整"})
	if second["idempotent"] != true || fmt.Sprint(second["reviewId"]) != fmt.Sprint(review["reviewId"]) {
		t.Fatal(second)
	}
	_, e = a.WriteEnterpriseDeliverableQuality(ctx, id("R2Manager", "r2b-waive-denied"), "983011", "983022", "waiver", map[string]any{"reason": "test"}, facts)
	deny(e, 403)
	command("R2Director", "r2b-waive", "983022", "waiver", map[string]any{"reason": "标记豁免"})
	command("R2Director", "r2b-waive", "983022", "waiver", map[string]any{"reason": "标记豁免"})
	exec("CREATE TRIGGER r2b_receipt_fault BEFORE UPDATE ON service_command_receipt FOR EACH ROW BEGIN IF NEW.idempotency_key='r2b-fault' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated R2b receipt fault'; END IF; END")
	_, fault := a.WriteEnterpriseDeliverableQuality(ctx, id("R2Director", "r2b-fault"), "983011", "983024", "waiver", map[string]any{"reason": "fault"}, facts)
	if fault == nil {
		t.Fatal("receipt fault accepted")
	}
	exec("DROP TRIGGER r2b_receipt_fault")
	var residue int
	if e = db.QueryRow("SELECT COUNT(*) FROM deliverable_waivers WHERE deliverable_id=983024").Scan(&residue); e != nil || residue != 0 {
		t.Fatalf("fault waiver residue %d %v", residue, e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='r2b-fault'").Scan(&residue); e != nil || residue != 0 {
		t.Fatalf("fault receipt residue %d %v", residue, e)
	}
	_, e = a.WriteEnterpriseDeliverableQuality(ctx, id("R2QA", "r2b-foreign"), "983011", "983023", "submission-create", body, facts)
	deny(e, 403)
	noScope := id("R2QA", "r2b-scope")
	noScope.CommandScope.Projection.ProjectCodes = []string{"UNRELATED"}
	_, e = a.WriteEnterpriseDeliverableQuality(ctx, noScope, "983011", "983021", "submission-create", body, facts)
	deny(e, 403)
	expired := id("R2QA", "r2b-expired")
	expired.CommandScope.ExpiresAt = 0
	_, e = a.WriteEnterpriseDeliverableQuality(ctx, expired, "983011", "983021", "submission-create", body, facts)
	deny(e, 403)
	exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=983011 AND uid='R2QA'")
	_, e = a.WriteEnterpriseDeliverableQuality(ctx, id("R2QA", "r2b-create"), "983011", "983021", "submission-create", body, facts)
	deny(e, 403)
	exec("UPDATE aims_projects SET leader_uid='Other' WHERE id=983011")
	_, e = a.WriteEnterpriseDeliverableQuality(ctx, id("R2Manager", "r2b-complete"), "983011", sid, "completeness", map[string]any{"action": "pass", "comment": "完整"}, facts)
	deny(e, 403)
	var count int
	if e = db.QueryRow("SELECT COUNT(*) FROM deliverable_quality_reviews WHERE submission_id=?", sid).Scan(&count); e != nil || count != 1 {
		t.Fatalf("reviews=%d %v", count, e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM deliverable_waivers WHERE deliverable_id=983022").Scan(&count); e != nil || count != 1 {
		t.Fatalf("waivers=%d %v", count, e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key IN ('r2b-foreign','r2b-scope','r2b-self-complete','r2b-waive-denied')").Scan(&count); e != nil || count != 0 {
		t.Fatalf("denied receipts=%d %v", count, e)
	}
}
