package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Runs inside TestEnterpriseProjectMembersMySQL: unified mode, canonical Aims
// tables, real rows. Document asset design DOC-05, batch 5b-1 (read only).
func testPortfolioDocumentsMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("%v\n%s", err, q)
		}
	}
	// The portfolio and one project share the code PFD; that project is NOT in
	// the portfolio. Project INPF is.
	exec("INSERT INTO project_portfolios(id,code,name,owner_uid,created_by) VALUES(911,'PFD','Docs','OWN','OWN'),(912,'PFG','Gone owner','GONE','GONE')")
	exec("INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,portfolio_id) VALUES(9111,'PFD','Same name','SN','SAME','SAME',NULL),(9112,'INPF','In portfolio','IN','LEAD','LEAD',911)")
	exec("INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(9111,'SAMEM','member','active'),(9112,'MEM','member','active'),(9112,'SUSP','member','suspended')")
	exec(`INSERT INTO aims_portfolio_members(portfolio_id,uid,relation_type,status,valid_from,valid_until,revision,created_by,updated_by,created_at,updated_at) VALUES
		(911,'MGR','manager','active',UTC_TIMESTAMP(3),NULL,1,'OWN','OWN',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
		(911,'VIEW','viewer','active',UTC_TIMESTAMP(3),NULL,1,'OWN','OWN',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
		(911,'EXP','viewer','active',UTC_TIMESTAMP(3)-INTERVAL 2 DAY,UTC_TIMESTAMP(3)-INTERVAL 1 DAY,1,'OWN','OWN',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	const uL0, uL1, uL2, uOff = "bbbbbbbb-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002", "bbbbbbbb-0000-4000-8000-000000000003", "bbbbbbbb-0000-4000-8000-000000000004"
	exec(`INSERT INTO project_documents(id,uuid,portfolio_id,project_id,project_code,parent_id,title,is_folder,document_source,codocs_uuid,repo_project_code,repo_file_path,created_by) VALUES
		(9101,UUID(),911,NULL,NULL,NULL,'公开目录',1,'codocs',NULL,NULL,NULL,'OWN'),
		(9102,UUID(),911,NULL,NULL,9101,'公开说明',0,'codocs',?,NULL,NULL,'OWN'),
		(9103,UUID(),911,NULL,NULL,NULL,'机密目录',1,'codocs',NULL,NULL,NULL,'OWN'),
		(9104,UUID(),911,NULL,NULL,9103,'机密方案',0,'codocs',?,NULL,NULL,'OWN'),
		(9105,UUID(),911,NULL,NULL,NULL,'内部规范',0,'codocs',?,NULL,NULL,'OWN'),
		(9106,UUID(),911,NULL,NULL,NULL,'不继承纪要',0,'codocs',?,NULL,NULL,'OWN'),
		(9107,UUID(),911,NULL,NULL,NULL,'仓库设计',0,'repo',NULL,'group/pf','README.md','OWN'),
		(9108,UUID(),NULL,9112,'INPF',NULL,'项目自有文档',0,'codocs','bbbbbbbb-0000-4000-8000-000000000009',NULL,NULL,'LEAD')`, uL0, uL2, uL1, uOff)
	defer func() {
		exec("DELETE FROM project_documents WHERE id BETWEEN 9101 AND 9109")
		exec("DELETE FROM aims_portfolio_members WHERE portfolio_id IN (911,912)")
		exec("DELETE FROM aims_project_members WHERE project_id IN (9111,9112)")
		exec("DELETE FROM aims_projects WHERE id IN (9111,9112)")
		exec("DELETE FROM project_portfolios WHERE id IN (911,912)")
	}()

	// Stand-in for the Codocs policy check (covered on real tables by
	// TestPortfolioDocumentPolicyMySQL): what matters here is which documents
	// and which facts Aims hands to it.
	type policy struct {
		level   string
		inherit bool
	}
	policies := map[string]policy{uL0: {"L0", true}, uL1: {"L1", true}, uL2: {"L2", true}, uOff: {"L0", false}}
	var seen []EnterprisePortfolioDocumentAccessFacts
	acl := EnterprisePortfolioDocumentACL(func(_ context.Context, uuid, ref string, f EnterprisePortfolioDocumentAccessFacts) (map[string]any, error) {
		seen = append(seen, f)
		p, ok := policies[uuid]
		if !ok || ref != "codocs_document" {
			t.Fatalf("unexpected ACL target %s %s", uuid, ref)
		}
		allowed := f.Relation != portfolioRelationInherited || ((p.level == "L0" || p.level == "L1") && p.inherit)
		return map[string]any{"allowed": allowed, "readonly": true, "reason": "test", "permission": "view", "lifecycleStage": "formal", "confidentialityLevel": p.level}, nil
	})
	base := WithEnterprisePortfolioDocumentACL(context.Background(), acl)
	list := func(ctx context.Context, portfolio, actor string) (map[string]any, string) {
		t.Helper()
		out, err := a.listPortfolioDocuments(ctx, portfolio, portfolioActorQuery(actor, false))
		return out, portfolioErrorCode(err)
	}
	titles := func(out map[string]any) string {
		t.Helper()
		raw, err := json.Marshal(out)
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}

	// Direct relations see every portfolio document, read only, and never a
	// project's own document.
	for actor, relation := range map[string]string{"OWN": "manager", "MGR": "manager", "VIEW": "viewer"} {
		out, code := list(base, "911", actor)
		if code != "" || out["relation"] != relation || out["total"] != 7 || out["documentTotal"] != 5 || len(out["items"].([]map[string]any)) != 7 || out["portfolioCode"] != "PFD" || out["readonly"] != true || out["ownerInactive"] != false {
			t.Fatalf("%s out=%v code=%q", actor, out, code)
		}
		text := titles(out)
		if strings.Contains(text, "项目自有文档") || !strings.Contains(text, "仓库设计") || !strings.Contains(text, "portfolio_member_direct") {
			t.Fatalf("%s list=%s", actor, text)
		}
		for _, item := range out["items"].([]map[string]any) {
			if item["accessReadonly"] != true {
				t.Fatalf("%s writable item=%v", actor, item)
			}
		}
	}
	for _, f := range seen {
		if f.PortfolioCode != "PFD" || f.ActorUID == "" || f.Relation == portfolioRelationInherited {
			t.Fatalf("direct facts=%+v", f)
		}
	}

	// Inherited relation: members and the leader of a project currently in the
	// portfolio see only what the policy opens to member projects. Titles and
	// counts of everything else, including the folder that only holds an L2
	// document and the repository document, are not observable.
	for _, actor := range []string{"MEM", "LEAD"} {
		seen = nil
		out, code := list(base, "911", actor)
		if code != "" || out["relation"] != portfolioRelationInherited || out["total"] != 3 || out["documentTotal"] != 2 || len(out["items"].([]map[string]any)) != 3 {
			t.Fatalf("%s out=%v code=%q", actor, out, code)
		}
		text := titles(out)
		for _, hidden := range []string{"机密目录", "机密方案", "不继承纪要", "仓库设计", "group/pf", uL2, uOff, "项目自有文档"} {
			if strings.Contains(text, hidden) {
				t.Fatalf("%s inherited list leaks %q: %s", actor, hidden, text)
			}
		}
		for _, shown := range []string{"公开目录", "公开说明", "内部规范"} {
			if !strings.Contains(text, shown) {
				t.Fatalf("%s inherited list misses %q", actor, shown)
			}
		}
		for _, f := range seen {
			if f.Relation != portfolioRelationInherited || f.ActorUID != actor || f.PortfolioCode != "PFD" {
				t.Fatalf("inherited facts=%+v", f)
			}
		}
	}

	// A dangling reference: the Codocs document is gone (or the row never had
	// one). Direct relations still see it, flagged and without any Codocs
	// facts, so that a manager can remove it; inherited relations never do.
	const uGone = "bbbbbbbb-0000-4000-8000-0000000000aa"
	exec("INSERT INTO project_documents(id,uuid,portfolio_id,parent_id,title,is_folder,document_source,codocs_uuid,created_by) VALUES(9109,?,911,9103,'悬空引用',0,'codocs',NULL,'OWN')", uGone)
	dangling := WithEnterprisePortfolioDocumentACL(context.Background(), func(ctx context.Context, uuid, ref string, f EnterprisePortfolioDocumentAccessFacts) (map[string]any, error) {
		if uuid == uGone {
			return map[string]any{"allowed": false}, nil
		}
		return acl(ctx, uuid, ref, f)
	})
	out, code := list(dangling, "911", "MGR")
	if code != "" || out["total"] != 8 || out["documentTotal"] != 6 {
		t.Fatalf("dangling manager out=%v code=%q", out, code)
	}
	flagged := 0
	for _, item := range out["items"].([]map[string]any) {
		if item["missingSource"] == true {
			flagged++
			if item["title"] != "悬空引用" || item["policy"] != nil || item["accessPermission"] != "none" || item["accessReason"] != "portfolio_source_missing" {
				t.Fatalf("dangling item=%v", item)
			}
		}
	}
	if flagged != 1 {
		t.Fatalf("flagged dangling references=%d", flagged)
	}
	if out, code = list(dangling, "911", "MEM"); code != "" || out["total"] != 3 || strings.Contains(titles(out), "悬空引用") || strings.Contains(titles(out), "机密目录") {
		t.Fatalf("dangling inherited out=%v code=%q", out, code)
	}
	exec("DELETE FROM project_documents WHERE id=9109")

	// No current relation: expired member row, suspended project member, and
	// the leader and a member of the project that merely shares the portfolio's code.
	for _, actor := range []string{"EXP", "SUSP", "SAME", "SAMEM", "NOBODY"} {
		if out, code := list(base, "911", actor); code != "portfolio_document_relation_required" || out != nil {
			t.Fatalf("%s out=%v code=%q", actor, out, code)
		}
	}
	// Relations are evaluated now: moving the project out of the portfolio or
	// ending a member row revokes immediately.
	exec("UPDATE aims_projects SET portfolio_id=NULL WHERE id=9112")
	if _, code := list(base, "911", "MEM"); code != "portfolio_document_relation_required" {
		t.Fatalf("moved-out project member code=%q", code)
	}
	exec("UPDATE aims_projects SET portfolio_id=911 WHERE id=9112")
	exec("UPDATE aims_portfolio_members SET status='inactive' WHERE portfolio_id=911 AND uid='VIEW'")
	if _, code := list(base, "911", "VIEW"); code != "portfolio_document_relation_required" {
		t.Fatalf("removed viewer code=%q", code)
	}
	exec("UPDATE aims_portfolio_members SET status='active' WHERE portfolio_id=911 AND uid='VIEW'")

	// Dependencies: no policy check injected, unknown portfolio.
	if _, err := a.listPortfolioDocuments(context.Background(), "911", portfolioActorQuery("OWN", false)); portfolioErrorCode(err) != "document_acl_unavailable" {
		t.Fatalf("missing ACL err=%v", err)
	}
	if _, code := list(base, "999999", "OWN"); code != "portfolio_not_found" {
		t.Fatalf("unknown portfolio code=%q", code)
	}

	// Owner no longer an active employee (Directory): not an implicit manager
	// any more, and the list says so to those who still have a relation.
	status := func(active map[string]bool, fail bool) context.Context {
		return WithPortfolioOwnerStatus(base, func(_ context.Context, uid string) (bool, error) {
			if fail {
				return false, httperror.New(503, "directory_subject_status_unavailable", "down")
			}
			return active[uid], nil
		})
	}
	if out, code := list(status(map[string]bool{"OWN": true}, false), "911", "OWN"); code != "" || out["relation"] != "manager" || out["ownerInactive"] != false {
		t.Fatalf("active owner out=%v code=%q", out, code)
	}
	if _, code := list(status(nil, false), "911", "OWN"); code != "portfolio_document_relation_required" {
		t.Fatalf("inactive owner code=%q", code)
	}
	if out, code := list(status(nil, false), "911", "MGR"); code != "" || out["ownerInactive"] != true || out["relation"] != "manager" {
		t.Fatalf("manager with inactive owner out=%v code=%q", out, code)
	}
	if _, code := list(status(nil, true), "911", "MGR"); code != "directory_subject_status_unavailable" {
		t.Fatalf("directory failure code=%q", code)
	}
	if (portfolioOwnerFacts{checked: true, uid: "OLD"}).matches("NEW") == nil || (portfolioOwnerFacts{checked: true, uid: "OWN"}).matches("OWN") != nil || (portfolioOwnerFacts{}).matches("ANY") != nil {
		t.Fatal("owner pre-read must be bound to the locked row")
	}

	// Member writes: an inactive owner counts as no owner (5a bootstrap rule).
	gone := status(nil, false)
	save := func(ctx context.Context, actor string, admin bool, body map[string]any) string {
		_, err := a.savePortfolioMember(ctx, "912", portfolioActorQuery(actor, admin), body)
		return portfolioErrorCode(err)
	}
	// Owner taken as recorded (no Directory answer injected, or owner active): no bootstrap.
	if code := save(base, "ADM", true, map[string]any{"action": "upsert", "uid": "B1", "relationType": "manager"}); code != "portfolio_member_manager_required" {
		t.Fatalf("bootstrap with recorded owner code=%q", code)
	}
	if code := save(status(map[string]bool{"GONE": true}, false), "ADM", true, map[string]any{"action": "upsert", "uid": "B1", "relationType": "manager"}); code != "portfolio_member_manager_required" {
		t.Fatalf("bootstrap with active owner code=%q", code)
	}
	// Directory down: fail closed, nothing written.
	if code := save(status(nil, true), "ADM", true, map[string]any{"action": "upsert", "uid": "B1", "relationType": "manager"}); code != "directory_subject_status_unavailable" {
		t.Fatalf("bootstrap without Directory code=%q", code)
	}
	members, err := a.listPortfolioMembers(gone, "912", portfolioActorQuery("ADM", true))
	if err != nil || members["ownerInactive"] != true || members["canBootstrap"] != true || members["canManage"] != false {
		t.Fatalf("members=%v err=%v", members, err)
	}
	// The inactive owner himself cannot manage; the permission alone still only
	// bootstraps a first manager, and needs portfolios:admin.
	if code := save(gone, "GONE", true, map[string]any{"action": "upsert", "uid": "B1", "relationType": "viewer"}); code != "portfolio_member_manager_required" {
		t.Fatalf("inactive owner code=%q", code)
	}
	if code := save(gone, "ADM", false, map[string]any{"action": "upsert", "uid": "B1", "relationType": "manager"}); code != "portfolio_member_manager_required" {
		t.Fatalf("bootstrap without permission code=%q", code)
	}
	if code := save(gone, "ADM", true, map[string]any{"action": "upsert", "uid": "B1", "relationType": "viewer"}); code != "portfolio_member_manager_required" {
		t.Fatalf("bootstrap non-manager code=%q", code)
	}
	if code := save(gone, "ADM", true, map[string]any{"action": "upsert", "uid": "B1", "relationType": "manager"}); code != "" {
		t.Fatalf("bootstrap code=%q", code)
	}
	if code := save(gone, "ADM", true, map[string]any{"action": "upsert", "uid": "B2", "relationType": "manager"}); code != "portfolio_member_manager_required" {
		t.Fatalf("second bootstrap code=%q", code)
	}
	// Last-manager guard counts the inactive owner as absent...
	if code := save(gone, "B1", true, map[string]any{"action": "remove", "uid": "B1", "expectedRevision": 1}); code != "portfolio_last_manager_required" {
		t.Fatalf("last manager with inactive owner code=%q", code)
	}
	// ...and an active owner as present.
	if code := save(status(map[string]bool{"GONE": true}, false), "B1", true, map[string]any{"action": "remove", "uid": "B1", "expectedRevision": 1}); code != "" {
		t.Fatalf("manager leaves under an active owner code=%q", code)
	}

	// Read-only portfolio section of a project's document list.
	section, unavailable, err := a.projectPortfolioDocuments(base, 9112, "MEM")
	if err != nil || unavailable || section == nil || section["documentTotal"] != 2 || section["total"] != 3 || section["inheritedFrom"] != "portfolio" || section["relation"] != portfolioRelationInherited {
		t.Fatalf("project section=%v unavailable=%v err=%v", section, unavailable, err)
	}
	if text := titles(section); strings.Contains(text, "机密方案") || strings.Contains(text, "仓库设计") {
		t.Fatalf("project section leaks: %s", text)
	}
	// A visitor of the project with no relation, a project outside any
	// portfolio, and a caller without the policy check get no section.
	for _, probe := range []struct {
		ctx     context.Context
		project int64
		actor   string
	}{{base, 9112, "NOBODY"}, {base, 9111, "SAME"}, {context.Background(), 9112, "MEM"}} {
		if section, unavailable, err = a.projectPortfolioDocuments(probe.ctx, probe.project, probe.actor); err != nil || unavailable || section != nil {
			t.Fatalf("probe %+v section=%v unavailable=%v err=%v", probe.actor, section, unavailable, err)
		}
	}
	// A portfolio dependency that is down never fails the project list.
	if section, unavailable, err = a.projectPortfolioDocuments(status(nil, true), 9112, "MEM"); err != nil || !unavailable || section != nil {
		t.Fatalf("dependency down section=%v unavailable=%v err=%v", section, unavailable, err)
	}
	failing := WithEnterprisePortfolioDocumentACL(context.Background(), func(context.Context, string, string, EnterprisePortfolioDocumentAccessFacts) (map[string]any, error) {
		return nil, httperror.New(503, "codocs_portfolio_policy_unavailable", "not installed")
	})
	if section, unavailable, err = a.projectPortfolioDocuments(failing, 9112, "MEM"); err != nil || !unavailable || section != nil {
		t.Fatalf("policy columns missing section=%v unavailable=%v err=%v", section, unavailable, err)
	}
	if _, code := list(failing, "911", "MEM"); code != "codocs_portfolio_policy_unavailable" {
		t.Fatalf("portfolio list without policy columns code=%q", code)
	}

	// ---- 5c-2: content read ----
	var reads []string
	reader := PortfolioDocumentReader(func(_ context.Context, uuid string, f EnterprisePortfolioDocumentAccessFacts) (map[string]any, error) {
		reads = append(reads, f.Relation+":"+uuid)
		p, ok := policies[uuid]
		if !ok || (f.Relation == portfolioRelationInherited && !((p.level == "L0" || p.level == "L1") && p.inherit)) {
			return nil, httperror.New(404, "portfolio_document_not_found", "from codocs")
		}
		return map[string]any{"source": map[string]any{"uuid": uuid, "oss_path": "p/" + uuid}, "access": map[string]any{"allowed": true, "permission": "view"}}, nil
	})
	readCtx := WithPortfolioDocumentReader(context.Background(), reader)
	content := func(ctx context.Context, actor, document string) (map[string]any, error) {
		return a.readPortfolioDocumentContent(ctx, "911", document, portfolioActorQuery(actor, false))
	}
	opened, err := content(readCtx, "VIEW", "9104")
	if err != nil || opened["access"].(map[string]any)["relation"] != "viewer" || opened["source"].(map[string]any)["uuid"] != uL2 || opened["document"].(map[string]any)["title"] != "机密方案" || opened["portfolioCode"] != "PFD" {
		t.Fatalf("viewer content=%v err=%v", opened, err)
	}
	if opened, err = content(readCtx, "MEM", "9102"); err != nil || opened["access"].(map[string]any)["relation"] != portfolioRelationInherited || opened["source"].(map[string]any)["uuid"] != uL0 {
		t.Fatalf("inherited content=%v err=%v", opened, err)
	}
	// Inherited: one indistinguishable 404 for a hidden document, a missing
	// reference, a folder, a repository file, and a document of a project or of
	// another portfolio; each takes the read path.
	reads = nil
	var answers []string
	for _, document := range []string{"9104", "9106", "424242", "9101", "9107", "9108"} {
		out, err := content(readCtx, "MEM", document)
		if out != nil || portfolioErrorCode(err) != "portfolio_document_not_found" {
			t.Fatalf("inherited %s out=%v err=%v", document, out, err)
		}
		answers = append(answers, err.Error())
	}
	for _, answer := range answers {
		if answer != answers[0] {
			t.Fatalf("distinguishable answers: %q", answers)
		}
	}
	wantReads := []string{"inherited:" + uL2, "inherited:" + uOff, "inherited:" + portfolioDocumentProbeUUID, "inherited:" + portfolioDocumentProbeUUID, "inherited:" + portfolioDocumentProbeUUID, "inherited:" + portfolioDocumentProbeUUID}
	if strings.Join(reads, ",") != strings.Join(wantReads, ",") {
		t.Fatalf("reads=%v", reads)
	}
	// Direct relations are told what is unsupported; a missing reference is 404.
	for document, want := range map[string]string{"9101": "portfolio_document_content_unsupported", "9107": "portfolio_document_content_unsupported", "424242": "portfolio_document_not_found", "9108": "portfolio_document_not_found"} {
		if _, err = content(readCtx, "MGR", document); portfolioErrorCode(err) != want {
			t.Fatalf("manager %s err=%v", document, err)
		}
	}
	// No relation, no reader, a reader that answers for another document.
	if _, err = content(readCtx, "NOBODY", "9102"); portfolioErrorCode(err) != "portfolio_document_relation_required" {
		t.Fatalf("no relation err=%v", err)
	}
	if _, err = content(context.Background(), "MGR", "9102"); portfolioErrorCode(err) != "document_acl_unavailable" {
		t.Fatalf("missing reader err=%v", err)
	}
	swapped := WithPortfolioDocumentReader(context.Background(), func(context.Context, string, EnterprisePortfolioDocumentAccessFacts) (map[string]any, error) {
		return map[string]any{"source": map[string]any{"uuid": uL2}, "access": map[string]any{"allowed": true}}, nil
	})
	if _, err = content(swapped, "MGR", "9102"); portfolioErrorCode(err) != "portfolio_document_content_unavailable" {
		t.Fatalf("swapped reader err=%v", err)
	}
	// Revocation is immediate for reading too.
	exec("UPDATE aims_projects SET portfolio_id=NULL WHERE id=9112")
	if _, err = content(readCtx, "MEM", "9102"); portfolioErrorCode(err) != "portfolio_document_relation_required" {
		t.Fatalf("moved-out reader err=%v", err)
	}
	exec("UPDATE aims_projects SET portfolio_id=911 WHERE id=9112")
	if _, err = content(status(nil, false), "OWN", "9102"); portfolioErrorCode(err) != "document_acl_unavailable" {
		// base has no reader: the dependency check comes first.
		t.Fatalf("inactive owner without reader err=%v", err)
	}
	if _, err = content(WithPortfolioDocumentReader(status(nil, false), reader), "OWN", "9102"); portfolioErrorCode(err) != "portfolio_document_relation_required" {
		t.Fatalf("inactive owner content err=%v", err)
	}

	// Source of the policy owner reconcile: Codocs documents owned by a
	// portfolio only; folders, repository documents and project documents excluded.
	owners, err := a.PortfolioPolicyOwners(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, owner := range owners {
		got[owner[0]] = owner[1]
	}
	if len(got) != 4 || got[uL0] != "PFD" || got[uL1] != "PFD" || got[uL2] != "PFD" || got[uOff] != "PFD" {
		t.Fatalf("policy owners=%v", owners)
	}
}
