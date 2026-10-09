package aims

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/documentcatalog"
)

// Runs inside TestEnterpriseProjectMembersMySQL against the canonical Aims schema.
func testDocumentCatalogSourceMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("%v\n%s", err, q)
		}
	}
	exec("INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by) VALUES(7701,'CAT1','目录项目','CAT1','U1','U1')")
	exec("INSERT INTO project_portfolios(id,code,name,created_by) VALUES(7701,'CATPF','Catalog','U1')")
	defer func() {
		exec("DELETE FROM project_weekly_report_versions WHERE report_id IN (7701,7702)")
		exec("DELETE FROM project_weekly_reports WHERE id IN (7701,7702)")
		exec("DELETE FROM requirement_contents WHERE project_id=7701")
		exec("DELETE FROM project_documents WHERE id BETWEEN 7701 AND 7706")
		exec("DELETE FROM project_portfolios WHERE id=7701")
		exec("DELETE FROM aims_projects WHERE id=7701")
	}()
	// Repository documents: only repo-backed files with a complete reference.
	exec(`INSERT INTO project_documents(id,uuid,project_id,project_code,portfolio_id,title,is_folder,document_source,repo_project_code,repo_file_path,repo_commit_id,created_by) VALUES
		(7701,UUID(),7701,'CAT1',NULL,'设计说明',0,'repo','group/repo','docs/design.md','abc123','U1'),
		(7702,UUID(),7701,'CAT1',NULL,'跟随分支',0,'repo','group/repo','docs/follow.md',NULL,'U1'),
		(7703,UUID(),7701,'CAT1',NULL,'平台文档',0,'codocs',NULL,NULL,NULL,'U1'),
		(7704,UUID(),7701,'CAT1',NULL,'仓库目录',1,'repo','group/repo','docs',NULL,'U1'),
		(7705,UUID(),NULL,NULL,7701,'项目集仓库文档',0,'repo','group/pf','README.md','def456','U1'),
		(7706,UUID(),7701,'CAT1',NULL,'缺路径',0,'repo','group/repo',NULL,NULL,'U1')`)
	repo, err := a.DocumentCatalogEntries(ctx, catalogKindRepoDocument, documentcatalog.Filter{ObjectIDs: []string{"7701", "7702", "7703", "7704", "7705", "7706"}})
	if err != nil || len(repo) != 3 {
		t.Fatalf("repo entries=%+v err=%v", repo, err)
	}
	if repo[0].ObjectID != "7701" || repo[0].Revision != "abc123" || repo[0].OwnerType != "project" || repo[0].OwnerCode != "CAT1" || repo[0].Locator["repoPath"] != "group/repo" || repo[0].Locator["filePath"] != "docs/design.md" {
		t.Fatalf("fixed-commit entry=%+v", repo[0])
	}
	if repo[1].ObjectID != "7702" || repo[1].Revision != "" {
		t.Fatalf("follow-branch entry=%+v", repo[1])
	}
	if repo[2].ObjectID != "7705" || repo[2].OwnerType != "portfolio" || repo[2].OwnerCode != "CATPF" {
		t.Fatalf("portfolio entry=%+v", repo[2])
	}

	// Requirement specification: one entry per project, only baselined chapters,
	// and a revision that follows the baseline.
	exec(`INSERT INTO requirement_contents(id,content_original_id,version_no,version_status,project_id,heading_depth,title,content_md,sort_order) VALUES
		(770101,770101,1,'baselined',7701,2,'概述','第一版',1),
		(770102,770102,1,'draft',7701,2,'草稿章节','不应计入',2)`)
	spec, err := a.DocumentCatalogEntries(ctx, catalogKindRequirementSpec, documentcatalog.Filter{ObjectIDs: []string{"7701"}})
	if err != nil || len(spec) != 1 || spec[0].ObjectID != "7701" || spec[0].Title != "目录项目 需求规格书" || len(spec[0].Revision) != 64 || spec[0].ContentSHA256 != spec[0].Revision {
		t.Fatalf("spec entries=%+v err=%v", spec, err)
	}
	first := spec[0].Revision
	exec("UPDATE requirement_contents SET content_md='草稿改动' WHERE id=770102")
	if spec, _ = a.DocumentCatalogEntries(ctx, catalogKindRequirementSpec, documentcatalog.Filter{ObjectIDs: []string{"7701"}}); spec[0].Revision != first {
		t.Fatal("a draft change must not move the baseline revision")
	}
	exec("INSERT INTO requirement_contents(id,content_original_id,version_no,version_status,project_id,heading_depth,title,content_md,sort_order) VALUES(770103,770101,2,'baselined',7701,2,'概述','第二版',1)")
	if spec, _ = a.DocumentCatalogEntries(ctx, catalogKindRequirementSpec, documentcatalog.Filter{ObjectIDs: []string{"7701"}}); spec[0].Revision == first {
		t.Fatal("a new baseline must change the revision")
	}

	// Weekly reports: only frozen reports with their frozen version.
	exec(`INSERT INTO project_weekly_reports(id,project_id,report_year,report_week,week_start,week_end,status,current_version_no,created_by) VALUES
		(7701,7701,2026,40,'2026-09-28','2026-10-04','frozen',2,'U1'),
		(7702,7701,2026,41,'2026-10-05','2026-10-11','submitted',1,'U1')`)
	exec(`INSERT INTO project_weekly_report_versions(id,report_id,version_no,manager_content_json,fact_snapshot_json,fact_snapshot_sha256,system_rag,selected_rag,rag_rule_version,submitted_by,submitted_at) VALUES
		(770101,7701,2,'{}','{}',?,'green','green','v1','U1',NOW(6)),
		(770102,7702,1,'{}','{}',?,'green','green','v1','U1',NOW(6))`, strings.Repeat("b", 64), strings.Repeat("c", 64))
	exec("UPDATE project_weekly_reports SET current_frozen_version_id=770101 WHERE id=7701")
	weekly, err := a.DocumentCatalogEntries(ctx, catalogKindWeeklyReport, documentcatalog.Filter{ObjectIDs: []string{"7701", "7702"}})
	if err != nil || len(weekly) != 1 || weekly[0].ObjectID != "7701" || weekly[0].Revision != "2" || weekly[0].ContentSHA256 != strings.Repeat("b", 64) || weekly[0].Title != "目录项目 2026年第40周项目周报" {
		t.Fatalf("weekly entries=%+v err=%v", weekly, err)
	}

	// Owner narrowing: one project's repository documents only, and only for
	// the kind that supports it.
	owned, err := a.DocumentCatalogEntries(ctx, catalogKindRepoDocument, documentcatalog.Filter{OwnerType: "project", OwnerCode: "CAT1"})
	if err != nil || len(owned) != 2 || owned[0].ObjectID != "7701" || owned[1].ObjectID != "7702" {
		t.Fatalf("owner entries=%+v err=%v", owned, err)
	}
	if other, err := a.DocumentCatalogEntries(ctx, catalogKindRepoDocument, documentcatalog.Filter{OwnerType: "project", OwnerCode: "NOPE"}); err != nil || len(other) != 0 {
		t.Fatalf("other owner entries=%+v err=%v", other, err)
	}
	if _, err = a.DocumentCatalogEntries(ctx, catalogKindWeeklyReport, documentcatalog.Filter{OwnerType: "project", OwnerCode: "CAT1"}); !errors.Is(err, documentcatalog.ErrInvalid) {
		t.Fatalf("owner filter on weekly reports err=%v", err)
	}

	// The closed contract rejects unknown kinds and non-numeric object filters.
	if _, err = a.DocumentCatalogEntries(ctx, "anything", documentcatalog.Filter{}); !errors.Is(err, documentcatalog.ErrInvalid) {
		t.Fatalf("unknown kind err=%v", err)
	}
	if _, err = a.DocumentCatalogEntries(ctx, catalogKindRepoDocument, documentcatalog.Filter{ObjectIDs: []string{"1 OR 1=1"}}); !errors.Is(err, documentcatalog.ErrInvalid) {
		t.Fatalf("object filter err=%v", err)
	}
}

// Catalog sync is always fired after the owning transaction has committed, and
// a missing hook is a no-op: it can never fail or roll back Aims business.
func TestDocumentCatalogSyncRunsOnlyAfterCommit(t *testing.T) {
	target := documentcatalog.Filter{ObjectIDs: []string{"1"}}
	(&Adapter{}).syncDocumentCatalog(catalogKindRepoDocument, target) // no hook configured
	var nilAdapter *Adapter
	nilAdapter.syncDocumentCatalog(catalogKindRepoDocument, target)
	// Business triggers are always targeted: an empty filter (the whole kind)
	// is reserved for the reconcile command and is never forwarded.
	calls := 0
	hooked := &Adapter{}
	hooked.ConfigureDocumentCatalogSync(func(string, documentcatalog.Filter) { calls++ })
	hooked.syncDocumentCatalog(catalogKindWeeklyReport, documentcatalog.Filter{})
	hooked.syncDocumentCatalog(catalogKindWeeklyReport, target)
	hooked.syncDocumentCatalog(catalogKindRepoDocument, documentcatalog.Filter{OwnerType: "project", OwnerCode: "P1"})
	if calls != 2 {
		t.Fatalf("forwarded triggers=%d", calls)
	}
	for file, want := range map[string]int{"enterprise_project_document_write.go": 1, "requirement_review_workflow.go": 1, "company_weekly_summary_governance.go": 2} {
		source, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		calls := regexp.MustCompile(`(?s)tx\.Commit\(\); err != nil \{\s*return nil, err\s*\}\s*(?://[^\n]*\n\s*)*a\.syncDocumentCatalog\(`).FindAllIndex(source, -1)
		if len(calls) != want || strings.Count(string(source), "a.syncDocumentCatalog(") != want {
			t.Fatalf("%s: %d sync calls directly after commit, want %d", file, len(calls), want)
		}
	}
}
