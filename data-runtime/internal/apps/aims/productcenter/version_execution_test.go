package productcenter

import (
	"context"
	"database/sql"
	"os"
	"regexp"
	"testing"
)

func versionExecutionFixture(t *testing.T, db *sql.DB, seed func(*sql.Conn)) {
	t.Helper()
	ctx := context.Background()
	content, err := os.ReadFile("../../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	statement := regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `work_items` \\(.*?^\\) ENGINE=.*?;").FindString(string(content))
	if statement == "" {
		t.Fatal("canonical work_items definition missing")
	}
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, `SET FOREIGN_KEY_CHECKS=0`); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, e := conn.ExecContext(ctx, `SET FOREIGN_KEY_CHECKS=1`); e != nil {
			t.Error(e)
		}
	}()
	if _, err = conn.ExecContext(ctx, statement); err != nil {
		t.Fatal(err)
	}
	if seed != nil {
		seed(conn)
	}
}

func TestMySQLVersionExecutionSnapshot(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-EXEC")
	ctx := context.Background()
	if _, err := db.Exec(`INSERT INTO product_versions(id,product_code,version_code,status) VALUES(1,'P-EXEC','v1','developing'),(2,'P-OTHER','v2','developing')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO product_version_features(id,version_id,title,status,acceptance_criteria) VALUES(1,1,'范围','delivered','验收标准')`); err != nil {
		t.Fatal(err)
	}
	versionExecutionFixture(t, db, func(conn *sql.Conn) {
		_, err := conn.ExecContext(ctx, `INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,status,weight,parent_id,version_id,feature_id,title,severity) VALUES
 (1,10,1,'T-1','target','requirement','completed',3,NULL,1,1,'目标一',NULL),
 (2,10,2,'T-2','target','requirement','todo',1,NULL,1,1,'目标二',NULL),
 (3,10,3,'B-3','matter','bug','in_progress',1,2,NULL,NULL,'缺陷','high'),
 (4,10,4,'B-4','matter','bug','completed',1,3,NULL,NULL,'已修复缺陷','medium'),
 (5,10,5,'T-5','target','requirement','todo',99,2,2,NULL,'另一版本',NULL),
 (6,10,6,'B-6','matter','bug','todo',1,5,NULL,NULL,'另一版本缺陷','critical'),
 (7,99,7,'B-7','matter','bug','todo',1,2,NULL,NULL,'其他项目缺陷','critical'),
 (8,10,8,'T-8','target','requirement','completed',0,1,1,1,'嵌套目标',NULL)`)
		if err != nil {
			t.Fatal(err)
		}
	})
	if _, err := db.Exec(`UPDATE product_versions SET business_owner_uid='pm' WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-EXEC','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}
	read := func() (VersionExecutionSnapshot, error) {
		p := workspacePermit(t, db, "P-EXEC", "pm", "view")
		p.Resource = "product_versions"
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return VersionExecutionSnapshot{}, err
		}
		defer tx.Rollback()
		if err = AuthorizeWorkspaceTransaction(ctx, tx, "P-EXEC", "pm", "product_versions", "view", p); err != nil {
			return VersionExecutionSnapshot{}, err
		}
		if _, err = loadProductVersion(ctx, tx, "P-EXEC", 1); err != nil {
			return VersionExecutionSnapshot{}, err
		}
		scopes, err := loadVersionAcceptanceScopes(ctx, tx, "P-EXEC", 1)
		if err != nil {
			return VersionExecutionSnapshot{}, err
		}
		return loadVersionExecution(ctx, tx, 1, scopes)
	}
	snapshot, err := read()
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Targets) != 3 || snapshot.TotalWeight != 4 || snapshot.CompletedWeight != 3 || snapshot.NoExecutionPlan || len(snapshot.OpenDefects) != 1 || snapshot.OpenDefects[0].ID != 3 {
		t.Fatalf("execution snapshot: %+v", snapshot)
	}
	if snapshot.Targets[0].ItemKey != "T-1" || snapshot.Targets[0].Title != "目标一" || snapshot.OpenDefects[0].ItemKey != "B-3" || snapshot.OpenDefects[0].Title != "缺陷" {
		t.Fatalf("execution display identity: %+v", snapshot)
	}
	requireProductRule(t, requireVersionExecutionExceptions(snapshot, nil), "product_version_execution_unresolved")
	exceptions := []VersionAcceptanceException{{Code: "incomplete-target:2"}, {Code: "open-defect:3"}}
	if err = requireVersionExecutionExceptions(snapshot, exceptions); err != nil {
		t.Fatal(err)
	}
	p := workspacePermit(t, db, "P-EXEC", "pm", "view")
	p.Resource = "product_versions"
	preview, err := PreviewProductVersionAcceptance(ctx, db, "P-EXEC", "pm", p, 1)
	if err != nil || preview.ScopeCount != 1 || preview.DeliveredScopeCount != 1 || preview.UnresolvedScopeCount != 0 || preview.Execution.ContentHash != snapshot.ContentHash {
		t.Fatalf("preview: %+v %v", preview, err)
	}
	coordination, err := ReadVersionExecutionCoordination(ctx, db, "P-EXEC", "pm", p, 1)
	if err != nil || coordination.ProductCode != "P-EXEC" || coordination.VersionID != 1 || coordination.WorkspaceRevision != p.Facts.Revision || coordination.TargetCount != 3 || coordination.IncompleteTargetCount != 1 || coordination.OpenDefectCount != 1 || coordination.TotalWeight != 4 || coordination.CompletedWeight != 3 || len(coordination.Projects) != 1 || coordination.Projects[0].ProjectID != 10 || coordination.DefectCoverage != "linked-descendants-only" {
		t.Fatalf("coordination: %+v %v", coordination, err)
	}
	wrongPermit := p
	wrongPermit.Resource = "product_features"
	if _, err = ReadVersionExecutionCoordination(ctx, db, "P-EXEC", "pm", wrongPermit, 1); err == nil {
		t.Fatal("coordination accepted wrong resource")
	}
	if _, err = ReadVersionExecutionCoordination(ctx, db, "P-EXEC", "pm", p, 2); err == nil {
		t.Fatal("coordination accepted foreign version")
	}
	var rev uint64
	if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-EXEC'`).Scan(&rev); err != nil || rev != p.Facts.Revision {
		t.Fatalf("preview mutated product: %d %v", rev, err)
	}
	acceptance := versionAcceptanceInput()
	acceptance.VersionID = 1
	acceptance.ExpectedReviewHash = preview.ReviewHash
	acceptanceIdentity := CommandIdentity{ProductCode: "P-EXEC", ActorUID: "pm", Action: "product_versions:accept", IdempotencyKey: "execution-accept"}
	acceptPermit := workspacePermit(t, db, "P-EXEC", "pm", "accept")
	acceptPermit.Resource = "product_versions"
	if _, err = db.Exec(`UPDATE work_items SET title='目标二已变更' WHERE id=2`); err != nil {
		t.Fatal(err)
	}
	_, err = AcceptProductVersion(ctx, db, acceptanceIdentity, acceptPermit, acceptance)
	requireProductRule(t, err, "product_version_review_changed")
	if _, err = db.Exec(`UPDATE work_items SET title='目标二' WHERE id=2`); err != nil {
		t.Fatal(err)
	}
	_, err = AcceptProductVersion(ctx, db, acceptanceIdentity, acceptPermit, acceptance)
	requireProductRule(t, err, "product_version_execution_unresolved")
	acceptance.Exceptions = []VersionAcceptanceException{{Code: "incomplete-target:2", Reason: "剩余收尾已核对", ResponsibleUID: "pm", Impact: "不影响已验收范围"}, {Code: "open-defect:3", Reason: "已核验风险接受", ResponsibleUID: "pm", Impact: "列入后续处理清单"}}
	if _, err = AcceptProductVersion(ctx, db, acceptanceIdentity, acceptPermit, acceptance); err != nil {
		t.Fatal(err)
	}
	var frozenHash string
	if err = db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(checklist,'$.execution_snapshot.content_hash')) FROM product_version_acceptances`).Scan(&frozenHash); err != nil || frozenHash != snapshot.ContentHash {
		t.Fatalf("acceptance execution snapshot: %s %v", frozenHash, err)
	}
	if _, err = db.Exec(`UPDATE work_items SET feature_id=NULL WHERE id=2`); err != nil {
		t.Fatal(err)
	}
	rebound, err := read()
	if err != nil || rebound.ContentHash == snapshot.ContentHash {
		t.Fatalf("binding drift not detected: %v", err)
	}
	if _, err = db.Exec(`UPDATE work_items SET feature_id=1 WHERE id=2`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE work_items SET status='completed' WHERE id=2`); err != nil {
		t.Fatal(err)
	}
	after, err := read()
	if err != nil || after.ContentHash == snapshot.ContentHash {
		t.Fatalf("execution change not detected: %v", err)
	}
	requireProductRule(t, requireVersionExecutionExceptions(after, exceptions), "product_version_exception_stale")
	if _, err = db.Exec(`UPDATE work_items SET version_id=2 WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	_, err = read()
	requireProductRule(t, err, "product_version_execution_binding_invalid")
}
