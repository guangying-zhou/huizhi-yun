package codocs

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Portfolio document policy (DOC-05, 5b-1) on the canonical Codocs tables and
// the real candidate migration. Isolated MySQL only.
func TestPortfolioDocumentPolicyMySQL(t *testing.T) {
	socket := os.Getenv("HZY_PORTFOLIO_DOCUMENT_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	mc := mysql.NewConfig()
	mc.User, mc.Net, mc.Addr = "root", "unix", socket
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "hzy_pfpolicy_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	must := func(db *sql.DB, q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("%v\n%s", err, q)
		}
	}
	must(root, "CREATE DATABASE "+name+" DEFAULT CHARSET utf8mb4")
	defer must(root, "DROP DATABASE "+name)
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	schema, err := os.ReadFile("../../../../codocs/docs/codocs_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	must(db, "SET FOREIGN_KEY_CHECKS=0")
	for _, table := range []string{"folders", "documents", "document_shares", "document_access_policies", "document_access_grants", "document_access_audit_logs"} {
		ddl := regexp.MustCompile("(?ms)^CREATE TABLE `" + table + "` \\(.*?^\\) ENGINE=.*?;").FindString(string(schema))
		if ddl == "" {
			t.Fatal("canonical DDL missing: " + table)
		}
		must(db, ddl)
	}
	must(db, "SET FOREIGN_KEY_CHECKS=1")
	// Start from the installed shape: the canonical file already has the columns.
	must(db, "ALTER TABLE document_access_policies DROP COLUMN source_owner_type, DROP COLUMN inherit_to_member_projects")

	ctx := context.Background()
	a := &Adapter{db: db}
	doc := func(n string) string { return "aaaaaaaa-0000-4000-8000-00000000000" + n }
	for _, n := range []string{"1", "2", "3", "4", "5", "6"} {
		must(db, "INSERT INTO documents(uuid,title,doc_type,oss_path,owner_uid,status) VALUES(?,?,'project',?,'U1',1)", doc(n), "Doc "+n, "p/"+n)
	}
	must(db, "INSERT INTO documents(uuid,title,doc_type,oss_path,owner_uid,status) VALUES(?,'Deleted','project','p/x','U1',0)", doc("9"))
	policy := func(n, code, level, permission string) {
		must(db, "INSERT INTO document_access_policies(document_ref_type,document_uuid,source_app,source_project_code,lifecycle_stage,confidentiality_level,default_permission,allow_internal_access,created_by,updated_by) VALUES('codocs_document',?,'aims',?,'formal',?,?,1,'U1','U1')", doc(n), code, level, permission)
	}
	// Legacy rows: every one of them stores the portfolio code "PF" as its
	// "project" code, and a project happens to be called "PF" as well.
	policy("1", "PF", "L0", "view")
	policy("2", "PF", "L1", "download")
	policy("3", "PF", "L2", "view")
	policy("4", "PF", "L3", "view")
	policy("5", "OTHER", "L0", "view")
	// doc 6 has no policy row at all.
	check := func(n, relation string) (map[string]any, error) {
		return a.CheckEnterprisePortfolioDocument(ctx, doc(n), "codocs_document", EnterprisePortfolioDocumentFacts{ActorUID: "ACT", PortfolioCode: "PF", Relation: relation})
	}
	code := func(err error) string {
		var h httperror.Error
		if errors.As(err, &h) {
			return h.Code
		}
		return ""
	}

	// Columns not installed: portfolio documents fail closed, project documents are untouched.
	if _, err = check("1", "manager"); code(err) != "codocs_portfolio_policy_unavailable" {
		t.Fatalf("missing columns err=%v", err)
	}
	if _, err = a.ReconcilePortfolioPolicyOwners(ctx, []PortfolioPolicyOwner{{doc("1"), "PF"}}, "system:test", false); code(err) != "codocs_portfolio_policy_unavailable" {
		t.Fatalf("reconcile without columns err=%v", err)
	}
	project, err := a.CheckEnterpriseProjectDocument(ctx, doc("3"), "codocs_document", EnterpriseProjectDocumentFacts{ActorUID: "ACT", ProjectCode: "PF", ProjectCodes: []string{"PF"}, Roles: []string{"project_member"}})
	if err != nil || project["allowed"] != true || project["reason"] != "source_project_member" {
		t.Fatalf("project path before migration=%v err=%v", project, err)
	}

	t.Run("project-access-check-action-and-ACL", func(t *testing.T) {
		f := EnterpriseProjectDocumentFacts{ActorUID: "ACT", ProjectCode: "PF", ProjectCodes: []string{"PF"}, Roles: []string{"project_member"}}
		for _, action := range []string{"view", "download", "edit"} {
			out, err := a.CheckEnterpriseProjectDocumentAction(ctx, doc("3"), "codocs_document", action, f)
			if err != nil || out["allowed"] != true {
				t.Fatalf("member action=%s result=%v err=%v", action, out, err)
			}
		}
		must(db, "UPDATE document_access_policies SET readonly=1 WHERE document_uuid=?", doc("3"))
		readonly, err := a.CheckEnterpriseProjectDocumentAction(ctx, doc("3"), "codocs_document", "edit", f)
		if err != nil || readonly["allowed"] != false || readonly["reason"] != "readonly" {
			t.Fatalf("readonly result=%v err=%v", readonly, err)
		}
		must(db, "UPDATE document_access_policies SET readonly=0 WHERE document_uuid=?", doc("3"))

		outsider := EnterpriseProjectDocumentFacts{ActorUID: "OUTSIDE", ProjectCode: "PF"}
		out, err := a.CheckEnterpriseProjectDocumentAction(ctx, doc("3"), "codocs_document", "view", outsider)
		if err != nil || out["allowed"] != false {
			t.Fatalf("outsider result=%v err=%v", out, err)
		}
		must(db, "INSERT INTO document_access_grants(policy_id,subject_type,subject_code,permission,created_by) SELECT id,'user','OUTSIDE','view','U1' FROM document_access_policies WHERE document_uuid=?", doc("3"))
		out, err = a.CheckEnterpriseProjectDocumentAction(ctx, doc("3"), "codocs_document", "view", outsider)
		if err != nil || out["allowed"] != true {
			t.Fatalf("shared view result=%v err=%v", out, err)
		}
		out, err = a.CheckEnterpriseProjectDocumentAction(ctx, doc("3"), "codocs_document", "edit", outsider)
		if err != nil || out["allowed"] != false {
			t.Fatalf("view grant cannot edit result=%v err=%v", out, err)
		}
		must(db, "DELETE FROM document_access_grants WHERE subject_code='OUTSIDE'")
		out, err = a.CheckEnterpriseProjectDocumentAction(ctx, doc("3"), "codocs_document", "view", outsider)
		if err != nil || out["allowed"] != false {
			t.Fatalf("revoked grant result=%v err=%v", out, err)
		}

		for _, action := range []string{"approve", "", "VIEW"} {
			if _, err := a.CheckEnterpriseProjectDocumentAction(ctx, doc("3"), "codocs_document", action, f); code(err) != "project_document_acl_input_invalid" {
				t.Fatalf("invalid action %q: %v", action, err)
			}
		}
		out, err = a.CheckEnterpriseProjectDocumentAction(ctx, doc("9"), "codocs_document", "view", f)
		if err != nil || out["allowed"] != false {
			t.Fatalf("deleted result=%v err=%v", out, err)
		}
	})

	t.Run("project-access-runtime-response-fixture", func(t *testing.T) {
		raw, err := os.ReadFile("../../../../aims/test/fixtures/projectDocumentAccess.runtime.json")
		if err != nil {
			t.Fatal(err)
		}
		var fixtures map[string]struct {
			Code int            `json:"code"`
			Data map[string]any `json:"data"`
		}
		if err = json.Unmarshal(raw, &fixtures); err != nil {
			t.Fatal(err)
		}
		member := EnterpriseProjectDocumentFacts{ActorUID: "ACT", ProjectCode: "PF", ProjectCodes: []string{"PF"}, Roles: []string{"project_member"}}
		outsider := EnterpriseProjectDocumentFacts{ActorUID: "OUTSIDE", ProjectCode: "PF"}
		allowed, e1 := a.CheckEnterpriseRepositoryProjectDocument(ctx, doc("7"), "view", member)
		denied, e2 := a.CheckEnterpriseRepositoryProjectDocument(ctx, doc("7"), "view", outsider)
		missing, e3 := a.CheckEnterpriseProjectDocumentAction(ctx, doc("9"), "codocs_document", "view", member)
		if e1 != nil || e2 != nil || e3 != nil {
			t.Fatalf("%v %v %v", e1, e2, e3)
		}
		for name, actual := range map[string]map[string]any{"repositoryMember": allowed, "repositoryOutsider": denied, "missingDocument": missing} {
			if fixtures[name].Code != 0 || !reflect.DeepEqual(actual, fixtures[name].Data) {
				t.Fatalf("real Runtime fixture drift %s: %v", name, actual)
			}
		}
		// Repository policies still enforce readonly and explicit grants.
		must(db, "INSERT INTO document_access_policies(document_ref_type,document_uuid,source_app,source_project_code,lifecycle_stage,confidentiality_level,default_permission,readonly,created_by,updated_by) VALUES('cabinet_file',?,'aims','PF','formal','L2','none',1,'U1','U1')", doc("7"))
		defer must(db, "DELETE FROM document_access_policies WHERE document_uuid=?", doc("7"))
		out, err := a.CheckEnterpriseRepositoryProjectDocument(ctx, doc("7"), "edit", member)
		if err != nil || out["allowed"] != false || out["reason"] != "readonly" {
			t.Fatalf("repository readonly bypass: %v %v", out, err)
		}
		out, err = a.CheckEnterpriseRepositoryProjectDocument(ctx, doc("7"), "view", outsider)
		if err != nil || out["allowed"] != false {
			t.Fatalf("repository outsider bypass: %v %v", out, err)
		}
		if _, err = a.CheckEnterpriseRepositoryProjectDocument(ctx, doc("7"), "approve", member); code(err) != "project_document_acl_input_invalid" {
			t.Fatalf("action closure: %v", err)
		}
	})

	migration, err := os.ReadFile("../../../../codocs/docs/migrations/20261007_document_access_policy_owner.sql")
	if err != nil {
		t.Fatal(err)
	}
	statements := regexp.MustCompile(`(?m)^--.*$`).ReplaceAllString(string(migration), "")
	for _, statement := range strings.Split(statements, ";") {
		if strings.TrimSpace(statement) != "" {
			must(db, statement)
		}
	}

	expect := func(label, n, relation string, allowed bool, reason, permission, level string) {
		t.Helper()
		out, err := check(n, relation)
		if err != nil || out["allowed"] != allowed || out["reason"] != reason || out["permission"] != permission || out["confidentialityLevel"] != level || out["readonly"] != true {
			t.Fatalf("%s: out=%v err=%v", label, out, err)
		}
	}
	// Same-name counter-example. The legacy rows default to owner type
	// "project": until they are explicitly marked, nothing is inherited, even
	// for L0, and the source-project-member rule is never consulted. A direct
	// relation still reads, under the restrictive default.
	expect("legacy L0 inherited", "1", "inherited", false, "portfolio_inherit_not_allowed", "none", "L2")
	expect("legacy L0 direct", "1", "viewer", true, "portfolio_member_direct", "view", "L2")
	expect("no policy inherited", "6", "inherited", false, "portfolio_inherit_not_allowed", "none", "L2")
	expect("no policy direct", "6", "contributor", true, "portfolio_member_direct", "view", "L2")

	// Reconcile: dry run writes nothing; apply marks rows 1-4, leaves the
	// document without a policy alone, and a replay changes nothing.
	owners := []PortfolioPolicyOwner{{doc("1"), "PF"}, {doc("2"), "PF"}, {doc("3"), "PF"}, {doc("4"), "PF"}, {doc("6"), "PF"}}
	count := func(q string) (n int) {
		t.Helper()
		if err := db.QueryRow(q).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	report, err := a.ReconcilePortfolioPolicyOwners(ctx, owners, "system:test", false)
	if err != nil || len(report.Changes) != 4 || report.NoPolicy != 1 || report.Applied || count("SELECT COUNT(*) FROM document_access_policies WHERE source_owner_type='portfolio'") != 0 {
		t.Fatalf("dry run=%+v err=%v", report, err)
	}
	if report, err = a.ReconcilePortfolioPolicyOwners(ctx, owners, "system:test", true); err != nil || len(report.Changes) != 4 || count("SELECT COUNT(*) FROM document_access_policies WHERE source_owner_type='portfolio' AND source_project_code='PF'") != 4 {
		t.Fatalf("apply=%+v err=%v", report, err)
	}
	if report, err = a.ReconcilePortfolioPolicyOwners(ctx, owners, "system:test", true); err != nil || len(report.Changes) != 0 || report.Unchanged != 4 {
		t.Fatalf("replay=%+v err=%v", report, err)
	}
	if n := count("SELECT COUNT(*) FROM document_access_policies WHERE confidentiality_level IN ('L0','L1','L2','L3') AND lifecycle_stage='formal'"); n != 5 {
		t.Fatalf("reconcile changed other policy fields: %d", n)
	}
	if n := count("SELECT COUNT(*) FROM document_access_audit_logs WHERE action='policy_update' AND reason='portfolio_owner_reconciled'"); n != 4 {
		t.Fatalf("reconcile audit rows=%d", n)
	}
	if _, err = a.ReconcilePortfolioPolicyOwners(ctx, []PortfolioPolicyOwner{{"not-a-uuid!", "PF"}}, "system:test", true); code(err) != "portfolio_policy_owner_input_invalid" {
		t.Fatalf("invalid input err=%v", err)
	}

	// Explicit portfolio policies: L0/L1 inherit, L2/L3 never do.
	expect("L0 inherited", "1", "inherited", true, "portfolio_member_project_inherited", "view", "L0")
	expect("L1 inherited, download by policy", "2", "inherited", true, "portfolio_member_project_inherited", "download", "L1")
	expect("L2 not inherited", "3", "inherited", false, "portfolio_inherit_not_allowed", "none", "L2")
	expect("L3 not inherited", "4", "inherited", false, "portfolio_inherit_not_allowed", "none", "L3")
	expect("L3 direct", "4", "viewer", true, "portfolio_member_direct", "view", "L3")
	expect("manager", "3", "manager", true, "portfolio_member_direct", "view", "L2")
	// Another portfolio's policy is not this portfolio's policy.
	must(db, "UPDATE document_access_policies SET source_owner_type='portfolio' WHERE document_uuid=?", doc("5"))
	expect("other portfolio inherited", "5", "inherited", false, "portfolio_inherit_not_allowed", "none", "L2")
	// Inheritance switched off for one document.
	must(db, "UPDATE document_access_policies SET inherit_to_member_projects=0 WHERE document_uuid=?", doc("1"))
	expect("inherit off", "1", "inherited", false, "portfolio_inherit_not_allowed", "none", "L0")
	expect("inherit off direct", "1", "viewer", true, "portfolio_member_direct", "view", "L0")

	// Once a row is explicitly owned by the portfolio, the project that happens
	// to share its code no longer reads it through the project path either.
	project, err = a.CheckEnterpriseProjectDocument(ctx, doc("3"), "codocs_document", EnterpriseProjectDocumentFacts{ActorUID: "ACT", ProjectCode: "PF", ProjectCodes: []string{"PF"}, Roles: []string{"project_member"}})
	if err != nil || project["allowed"] != false || project["reason"] == "source_project_member" {
		t.Fatalf("same-name project read a portfolio policy: %v err=%v", project, err)
	}

	// ---- 5b-2: linking and policy maintenance ----
	// Direct relations get the maintenance state; inherited ones never do.
	direct, err := check("2", "manager")
	state, _ := direct["policy"].(map[string]any)
	if err != nil || state["exists"] != true || state["ownedElsewhere"] != false || state["etag"] != portfolioPolicyEtag("formal", "L1", "download", true) || state["defaultPermission"] != "download" || state["inheritToMemberProjects"] != true {
		t.Fatalf("direct policy state=%v err=%v", direct, err)
	}
	if elsewhere, _ := check("5", "manager"); elsewhere["policy"].(map[string]any)["ownedElsewhere"] != true || elsewhere["policy"].(map[string]any)["etag"] != "" || elsewhere["policy"].(map[string]any)["exists"] != false {
		t.Fatalf("elsewhere policy state=%v", elsewhere)
	}
	if inherited, _ := check("2", "inherited"); inherited["policy"] != nil {
		t.Fatalf("inherited relation sees policy state: %v", inherited)
	}

	// Linking is sharing: only the Codocs owner, and only a live, unlocked document.
	link := func(n, actor, portfolio string) (PortfolioDocumentLinkFacts, string) {
		facts, err := a.ConfirmEnterprisePortfolioDocumentSharer(ctx, doc(n), actor, portfolio)
		return facts, code(err)
	}
	if facts, c := link("2", "U1", "PF"); c != "" || facts.PolicyOwnedElsewhere || facts.Title != "Doc 2" {
		t.Fatalf("owner link facts=%+v code=%q", facts, c)
	}
	if facts, c := link("2", "U1", "ANOTHER"); c != "" || !facts.PolicyOwnedElsewhere {
		t.Fatalf("link into another portfolio facts=%+v code=%q", facts, c)
	}
	if facts, c := link("6", "U1", "PF"); c != "" || facts.PolicyOwnedElsewhere {
		t.Fatalf("link without policy facts=%+v code=%q", facts, c)
	}
	must(db, "INSERT INTO document_shares(document_id,owner_uid,shared_to_uid,permission) SELECT id,'U1','EDITOR','write' FROM documents WHERE uuid=?", doc("2"))
	for _, actor := range []string{"ACT", "EDITOR"} {
		if facts, c := link("2", actor, "PF"); c != "portfolio_document_share_required" || facts.Title != "" {
			t.Fatalf("%s link facts=%+v code=%q", actor, facts, c)
		}
	}
	if _, c := link("9", "U1", "PF"); c != "portfolio_document_source_not_found" {
		t.Fatalf("deleted link code=%q", c)
	}
	must(db, "UPDATE documents SET deleted_at=NOW() WHERE uuid=?", doc("4"))
	if _, c := link("4", "U1", "PF"); c != "portfolio_document_source_not_found" {
		t.Fatalf("recycled link code=%q", c)
	}
	must(db, "UPDATE documents SET deleted_at=NULL, readonly_flag=1 WHERE uuid=?", doc("4"))
	if _, c := link("4", "U1", "PF"); c != "document_readonly" {
		t.Fatalf("locked link code=%q", c)
	}
	must(db, "UPDATE documents SET readonly_flag=0 WHERE uuid=?", doc("4"))

	save := func(n, portfolio, stage, level, permission string, inherit bool, etag string) (map[string]any, string) {
		out, err := a.SaveEnterprisePortfolioDocumentPolicy(ctx, PortfolioDocumentPolicyInput{ActorUID: "MGR", PortfolioCode: portfolio, DocumentUUID: doc(n),
			LifecycleStage: stage, Confidentiality: level, DefaultPermission: permission, InheritToMemberProjects: inherit, ExpectedEtag: etag})
		return out, code(err)
	}
	row := func(n string) string {
		t.Helper()
		var text string
		if err := db.QueryRow("SELECT CONCAT_WS('|',source_owner_type,source_project_code,lifecycle_stage,confidentiality_level,default_permission,inherit_to_member_projects,readonly,updated_by) FROM document_access_policies WHERE document_uuid=?", doc(n)).Scan(&text); err != nil {
			t.Fatal(err)
		}
		return text
	}
	// No row yet: created as a portfolio policy; a stale expectation is refused.
	if _, c := save("6", "PF", "formal", "L1", "view", true, "stale"); c != "portfolio_document_policy_conflict" {
		t.Fatalf("create with etag code=%q", c)
	}
	created, c := save("6", "PF", "formal", "L1", "view", true, "")
	if c != "" || created["changed"] != true || row("6") != "portfolio|PF|formal|L1|view|1|0|MGR" {
		t.Fatalf("create policy out=%v code=%q row=%s", created, c, row("6"))
	}
	expect("created policy inherits", "6", "inherited", true, "portfolio_member_project_inherited", "view", "L1")
	// Replay of the stored state is a no-op, whatever the expectation.
	audits := count("SELECT COUNT(*) FROM document_access_audit_logs WHERE reason='portfolio_policy_updated'")
	if replay, c := save("6", "PF", "formal", "L1", "view", true, ""); c != "" || replay["changed"] != false || count("SELECT COUNT(*) FROM document_access_audit_logs WHERE reason='portfolio_policy_updated'") != audits {
		t.Fatalf("replay out=%v code=%q", replay, c)
	}
	// Update needs the current etag.
	if _, c := save("6", "PF", "formal", "L2", "none", false, "stale"); c != "portfolio_document_policy_conflict" || row("6") != "portfolio|PF|formal|L1|view|1|0|MGR" {
		t.Fatalf("stale update code=%q row=%s", c, row("6"))
	}
	if updated, c := save("6", "PF", "archived", "L2", "none", false, created["etag"].(string)); c != "" || updated["changed"] != true || row("6") != "portfolio|PF|archived|L2|none|0|1|MGR" {
		t.Fatalf("update out=%v code=%q row=%s", updated, c, row("6"))
	}
	expect("raised to L2 stops inheriting", "6", "inherited", false, "portfolio_inherit_not_allowed", "none", "L2")
	// A policy owned by another portfolio or by a project is never taken over.
	must(db, "INSERT INTO documents(uuid,title,doc_type,oss_path,owner_uid,status) VALUES(?,'Doc 7','project','p/7','U1',1)", doc("7"))
	policy("7", "PF", "L0", "view") // owner type project, same code as the portfolio
	for _, n := range []string{"5", "7"} {
		before := row(n)
		if _, c := save(n, "PF", "formal", "L0", "view", true, ""); c != "portfolio_document_policy_owned_elsewhere" || row(n) != before {
			t.Fatalf("doc %s takeover code=%q row=%s", n, c, row(n))
		}
	}
	if _, c := save("9", "PF", "formal", "L0", "view", true, ""); c != "portfolio_document_source_not_found" {
		t.Fatalf("policy on deleted document code=%q", c)
	}
	if _, c := save("6", "PF", "published", "L0", "view", true, ""); c != "portfolio_document_policy_input_invalid" {
		t.Fatalf("invalid stage code=%q", c)
	}
	if _, c := save("6", "PF", "formal", "L0", "edit", true, ""); c != "portfolio_document_policy_input_invalid" {
		t.Fatalf("invalid permission code=%q", c)
	}

	// The project path's policy update never rewrites a row owned elsewhere,
	// and still maintains project rows.
	projectUpdate := func(n string) (string, string) {
		_, err := a.updateDocumentAccessPolicy(ctx, doc(n), url.Values{"current_user": {"PM"}, "hzy_runtime_actor_delegated": {"1"}}, map[string]any{"sourceApp": "aims", "sourceProjectCode": "HIJACK", "confidentialityLevel": "L0", "lifecycleStage": "formal", "defaultPermission": "download"})
		return code(err), row(n)
	}
	for _, n := range []string{"6", "5"} {
		before := row(n)
		if c, after := projectUpdate(n); c != "document_policy_owned_elsewhere" || after != before {
			t.Fatalf("project path rewrote portfolio policy %s: code=%q row=%s", n, c, after)
		}
	}
	if c, after := projectUpdate("7"); c != "" || after != "project|HIJACK|formal|L0|download|1|0|PM" {
		t.Fatalf("project policy update code=%q row=%s", c, after)
	}

	// ---- 5c-2: content read ----
	readDoc := func(uuid, relation string) (map[string]any, error) {
		return a.ReadEnterprisePortfolioDocument(ctx, uuid, EnterprisePortfolioDocumentFacts{ActorUID: "RDR", PortfolioCode: "PF", Relation: relation})
	}
	got, err := readDoc(doc("2"), "inherited")
	src, _ := got["source"].(map[string]any)
	acc, _ := got["access"].(map[string]any)
	if err != nil || src["uuid"] != doc("2") || src["title"] != "Doc 2" || src["oss_path"] != "p/2" || src["doc_type"] != "project" || src["snapshot_generation"] != int64(0) || src["snapshot_ref"] != nil ||
		acc["allowed"] != true || acc["permission"] != "download" || acc["reason"] != "portfolio_member_project_inherited" || acc["policy"] != nil || len(got) != 2 {
		t.Fatalf("inherited read=%v err=%v", got, err)
	}
	if got, err = readDoc(doc("3"), "manager"); err != nil || got["access"].(map[string]any)["policy"] != nil || got["source"].(map[string]any)["oss_path"] != "p/3" {
		t.Fatalf("direct read=%v err=%v", got, err)
	}
	// For an inherited reader "not allowed" and "does not exist" are the same
	// answer, and both leave the same kind of audit record.
	absent := "aaaaaaaa-0000-4000-8000-0000000000ff"
	var answers []string
	for _, uuid := range []string{doc("3"), doc("4"), doc("5"), doc("1"), absent, doc("9")} {
		out, err := readDoc(uuid, "inherited")
		if out != nil || code(err) != "portfolio_document_not_found" {
			t.Fatalf("hidden read %s out=%v err=%v", uuid, out, err)
		}
		answers = append(answers, err.Error())
	}
	for _, answer := range answers {
		if answer != answers[0] {
			t.Fatalf("distinguishable answers: %q", answers)
		}
	}
	for _, uuid := range []string{doc("3"), absent} {
		if n := count("SELECT COUNT(*) FROM document_access_audit_logs WHERE document_uuid='" + uuid + "' AND actor_uid='RDR' AND action='view' AND decision='deny' AND source_project_code='PF' AND JSON_CONTAINS(actor_project_codes, '\"portfolio:inherited\"', '$.roles')"); n != 1 {
			t.Fatalf("deny audit rows for %s = %d", uuid, n)
		}
	}
	if n := count("SELECT COUNT(*) FROM document_access_audit_logs WHERE document_uuid='" + doc("2") + "' AND actor_uid='RDR' AND decision='allow' AND reason='portfolio_member_project_inherited'"); n != 1 {
		t.Fatalf("allow audit rows=%d", n)
	}
	// A recycled document is gone for direct relations as well.
	must(db, "UPDATE documents SET deleted_at=NOW() WHERE uuid=?", doc("3"))
	if _, err = readDoc(doc("3"), "manager"); code(err) != "portfolio_document_not_found" {
		t.Fatalf("recycled read err=%v", err)
	}
	must(db, "UPDATE documents SET deleted_at=NULL WHERE uuid=?", doc("3"))
	if _, err = readDoc(doc("2"), "owner"); code(err) != "portfolio_document_acl_input_invalid" {
		t.Fatalf("invalid relation err=%v", err)
	}

	// Deleted documents are omitted; malformed facts are rejected.
	if out, err := check("9", "manager"); err != nil || out["allowed"] != false || len(out) != 1 {
		t.Fatalf("deleted doc out=%v err=%v", out, err)
	}
	if _, err = check("1", "owner"); code(err) != "portfolio_document_acl_input_invalid" {
		t.Fatalf("unknown relation err=%v", err)
	}
	if _, err = a.CheckEnterprisePortfolioDocument(ctx, doc("1"), "codocs_document", EnterprisePortfolioDocumentFacts{ActorUID: "ACT", Relation: "manager"}); code(err) != "portfolio_document_acl_input_invalid" {
		t.Fatalf("missing portfolio err=%v", err)
	}
	// Every decision is audited with the relation.
	if n := count("SELECT COUNT(*) FROM document_access_audit_logs WHERE actor_uid='ACT' AND action='view' AND JSON_CONTAINS(actor_project_codes, '\"portfolio:inherited\"', '$.roles')"); n == 0 {
		t.Fatal("inherited decisions were not audited")
	}
}
