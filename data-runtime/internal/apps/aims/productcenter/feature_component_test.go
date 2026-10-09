package productcenter

import (
	"context"
	"github.com/google/uuid"
	"os"
	"testing"
)

func TestMySQLFeatureComponentAssignmentAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.21_product_components.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	workspaceFixture(t, db, "P-CLASSIFY")
	workspaceFixture(t, db, "P-FOREIGN-CLASSIFY")
	feature := uuid.NewString()
	if _, err = db.Exec(`INSERT INTO product_features(biz_id,product_code,title,description,created_by,updated_by,created_at,updated_at) VALUES(?,'P-CLASSIFY','既有功能','原始说明','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, feature); err != nil {
		t.Fatal(err)
	}
	insert := func(code string) int64 {
		r, e := db.Exec(`INSERT INTO product_components(biz_id,product_code,name,created_by,updated_by,created_at,updated_at) VALUES(UUID(),?,'目标模块','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code)
		if e != nil {
			t.Fatal(e)
		}
		id, e := r.LastInsertId()
		if e != nil {
			t.Fatal(e)
		}
		return id
	}
	target := insert("P-CLASSIFY")
	foreign := insert("P-FOREIGN-CLASSIFY")
	identity := CommandIdentity{ProductCode: "P-CLASSIFY", ActorUID: "pm", Action: "product_features:component-assign", IdempotencyKey: "classify"}
	input := FeatureComponentAssignment{BizID: feature, ComponentID: &target, ExpectedRevision: 1, ExpectedFeatureRevision: 1, Reason: "归入模块"}
	run := func(action string) (CommandResult, error) {
		p := workspacePermit(t, db, "P-CLASSIFY", "pm", action)
		p.Resource = "product_features"
		return AssignProductFeatureComponent(context.Background(), db, identity, p, input)
	}
	assertState := func(component *int64, revision uint64, count int) {
		t.Helper()
		var actual *int64
		var title, description, biz string
		var rev, rootRev uint64
		if err = db.QueryRow(`SELECT biz_id,component_id,title,description,revision FROM product_features WHERE biz_id=?`, feature).Scan(&biz, &actual, &title, &description, &rev); err != nil {
			t.Fatal(err)
		}
		if biz != feature || title != "既有功能" || description != "原始说明" || rev != revision || (component == nil) != (actual == nil) || (actual != nil && component != nil && *actual != *component) {
			t.Fatalf("feature changed %s %s %d %v", biz, title, rev, actual)
		}
		if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-CLASSIFY'`).Scan(&rootRev); err != nil || rootRev != revision {
			t.Fatalf("root %d %v", rootRev, err)
		}
		for _, table := range []string{"product_activity_logs", "product_command_receipts"} {
			var actualCount int
			if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&actualCount); err != nil || actualCount != count {
				t.Fatalf("%s %d %v", table, actualCount, err)
			}
		}
	}
	_, err = run("view")
	requireProductRule(t, err, "product_authorization_invalid")
	input.ComponentID = &foreign
	if _, err = run("edit"); err == nil {
		t.Fatal("foreign target accepted")
	}
	input.ComponentID = &target
	if _, err = db.Exec(`CREATE TRIGGER fail_classify BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run("edit"); err == nil {
		t.Fatal("audit failure committed")
	}
	assertState(nil, 1, 0)
	if _, err = db.Exec(`DROP TRIGGER fail_classify`); err != nil {
		t.Fatal(err)
	}
	saved, err := run("edit")
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run("edit")
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %+v %v", replay, err)
	}
	assertState(&target, 2, 1)
	readPermit := workspacePermit(t, db, "P-CLASSIFY", "pm", "view")
	readPermit.Resource = "product_features"
	listed, err := ListProductFeatures(context.Background(), db, "P-CLASSIFY", "pm", readPermit, FeaturePageQuery{Page: 1, PageSize: 20})
	if err != nil || len(listed.Items) != 1 || listed.Items[0].ComponentID == nil || *listed.Items[0].ComponentID != target {
		t.Fatalf("classified list %+v %v", listed, err)
	}
	filtered, err := ListProductFeatures(context.Background(), db, "P-CLASSIFY", "pm", readPermit, FeaturePageQuery{Page: 1, PageSize: 1, ComponentID: &target})
	if err != nil || filtered.Total != 1 || len(filtered.Items) != 1 {
		t.Fatalf("module filter %+v %v", filtered, err)
	}
	ungrouped, err := ListProductFeatures(context.Background(), db, "P-CLASSIFY", "pm", readPermit, FeaturePageQuery{Page: 1, PageSize: 1, Ungrouped: true})
	if err != nil || ungrouped.Total != 0 || len(ungrouped.Items) != 0 {
		t.Fatalf("ungrouped %+v %v", ungrouped, err)
	}
	if _, err = ListProductFeatures(context.Background(), db, "P-CLASSIFY", "pm", readPermit, FeaturePageQuery{Page: 1, PageSize: 1, ComponentID: &foreign}); err == nil {
		t.Fatal("foreign module filter accepted")
	}
	requireProductRule(t, ValidateFeaturePageQuery(FeaturePageQuery{Page: 1, PageSize: 1, ComponentID: &target, Ungrouped: true}), "product_feature_query_invalid")
	identity.IdempotencyKey = "ungroup"
	input.ComponentID = nil
	_, err = run("edit")
	requireProductRule(t, err, "product_revision_conflict")
	input.ExpectedRevision = 2
	_, err = run("edit")
	requireProductRule(t, err, "product_feature_revision_conflict")
	input.ExpectedFeatureRevision = 2
	if _, err = run("edit"); err != nil {
		t.Fatal(err)
	}
	assertState(nil, 3, 2)
	readPermit = workspacePermit(t, db, "P-CLASSIFY", "pm", "view")
	readPermit.Resource = "product_features"
	detail, err := ReadProductFeature(context.Background(), db, "P-CLASSIFY", "pm", feature, readPermit)
	if err != nil || detail.ComponentID != nil || detail.BizID != feature || detail.Revision != 3 {
		t.Fatalf("ungrouped detail %+v %v", detail, err)
	}
}
