package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func versionAcceptanceInput() ProductVersionAcceptanceInput {
	return ProductVersionAcceptanceInput{ExpectedReviewHash: "0000000000000000000000000000000000000000000000000000000000000000", VersionID: 1, ExpectedRevision: 1, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1, Checks: []VersionAcceptanceCheck{{Code: "execution-review", Evidence: "执行清单已逐项核验"}, {Code: "blocking-defects-review", Evidence: "缺陷清单核验记录 BUG-01"}, {Code: "release-readiness", Evidence: "回滚方案与发布说明已核验"}}, Exceptions: []VersionAcceptanceException{}}
}
func TestProductVersionAcceptanceValidation(t *testing.T) {
	good := versionAcceptanceInput()
	if err := ValidateProductVersionAcceptance(good); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*ProductVersionAcceptanceInput){func(v *ProductVersionAcceptanceInput) { v.ExpectedScopeRevision = 0 }, func(v *ProductVersionAcceptanceInput) { v.Checks = nil }, func(v *ProductVersionAcceptanceInput) { v.Checks = append(v.Checks, v.Checks[0]) }, func(v *ProductVersionAcceptanceInput) { v.Exceptions = nil }, func(v *ProductVersionAcceptanceInput) { v.Exceptions = []VersionAcceptanceException{{Code: "risk"}} }} {
		bad := good
		mutate(&bad)
		if ValidateProductVersionAcceptance(bad) == nil {
			t.Fatal("incomplete acceptance admitted")
		}
	}
}

func TestMySQLProductVersionAcceptanceImmutable(t *testing.T) {
	for _, distinctKeys := range []bool{false, true} {
		name := "same-key"
		if distinctKeys {
			name = "different-keys"
		}
		t.Run(name, func(t *testing.T) { exerciseVersionAcceptanceScenario(t, distinctKeys) })
	}
}

func exerciseVersionAcceptanceScenario(t *testing.T, distinctKeys bool) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-ACCEPT")
	versionExecutionFixture(t, db, nil)
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-ACCEPT", "pm", action)
		p.Resource = "product_versions"
		return p
	}
	if _, err := db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-ACCEPT','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); err != nil {
		t.Fatal(err)
	}
	owner := "pm"
	created, err := CreateProductCenterVersion(ctx, db, CommandIdentity{ProductCode: "P-ACCEPT", ActorUID: "pm", Action: "product_versions:create", IdempotencyKey: "version"}, permit("edit"), ProductVersionDraft{BusinessOwnerUID: &owner, ExpectedRevision: 1, VersionCode: "v1"})
	if err != nil {
		t.Fatal(err)
	}
	var version ProductVersionRecord
	if err = json.Unmarshal(created.Value, &version); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_version_features(version_id,title,acceptance_criteria,status) VALUES(?,'登录','登录注销测试','planned')`, version.ID); err != nil {
		t.Fatal(err)
	}
	// Explicit fixture relation is frozen by the real acceptance/publish flow.
	featureResult, err := db.Exec(`INSERT INTO product_features(biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-ACCEPT','登录功能','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	featureID, err := featureResult.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_version_features SET product_feature_id=? WHERE version_id=?`, featureID, version.ID); err != nil {
		t.Fatal(err)
	}
	input := versionAcceptanceInput()
	input.VersionID = version.ID
	input.ExpectedRevision = 2
	identity := CommandIdentity{ProductCode: "P-ACCEPT", ActorUID: "pm", Action: "product_versions:accept", IdempotencyKey: "accept"}
	run := func() (CommandResult, error) { return AcceptProductVersion(ctx, db, identity, permit("accept"), input) }
	_, err = AcceptProductVersion(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	if _, err = db.Exec(`UPDATE product_versions SET business_owner_uid=NULL WHERE id=?`, version.ID); err != nil {
		t.Fatal(err)
	}
	_, err = run()
	requireProductRule(t, err, "product_version_owner_required")
	if _, err = db.Exec(`UPDATE product_versions SET business_owner_uid='other' WHERE id=?`, version.ID); err != nil {
		t.Fatal(err)
	}
	_, err = run()
	requireProductRule(t, err, "product_version_owner_required")
	if _, err = db.Exec(`UPDATE product_versions SET business_owner_uid='pm' WHERE id=?`, version.ID); err != nil {
		t.Fatal(err)
	}
	_, err = run()
	requireProductRule(t, err, "product_version_scope_unresolved")
	// Fixture represents an existing completed scope. Delivery command itself
	// has separate real-MySQL coverage; no historical review is fabricated.
	exerciseInactiveVersionOwner(t, db, run)
	if _, err = db.Exec(`UPDATE product_version_features SET status='delivered' WHERE version_id=?`, version.ID); err != nil {
		t.Fatal(err)
	}
	preview, err := PreviewProductVersionAcceptance(ctx, db, "P-ACCEPT", "pm", permit("view"), version.ID)
	if err != nil {
		t.Fatal(err)
	}
	input.ExpectedReviewHash = preview.ReviewHash
	_, err = AcceptProductVersion(ctx, db, identity, permit("accept"), input, "wrong-preflight-snapshot")
	requireProductRule(t, err, "product_version_review_changed")
	if _, err = db.Exec(`CREATE TRIGGER pc_accept_fail BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='acceptance audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run(); err == nil {
		t.Fatal("failed audit committed acceptance")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_version_acceptances`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback: %d %v", count, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_accept_fail`); err != nil {
		t.Fatal(err)
	}
	saved, err := run()
	if err != nil {
		t.Fatal(err)
	}
	replay, err := AcceptProductVersion(ctx, db, identity, permit("accept"), input, "new-preflight-after-success")
	if err != nil || !replay.Replayed || saved.ReceiptID != replay.ReceiptID {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	var record struct {
		ID int64 `json:"acceptance_id"`
	}
	if err = json.Unmarshal(saved.Value, &record); err != nil {
		t.Fatal(err)
	}
	history, err := ListProductVersionAcceptances(ctx, db, "P-ACCEPT", "pm", permit("view"), version.ID, PlanningPageQuery{Page: 1, PageSize: 1})
	if err != nil || history.Total != 1 || len(history.Items) != 1 || history.Items[0].ID != record.ID {
		t.Fatalf("history: %+v %v", history, err)
	}
	next, err := ListProductVersionAcceptances(ctx, db, "P-ACCEPT", "pm", permit("view"), version.ID, PlanningPageQuery{Page: 2, PageSize: 1})
	if err != nil || next.Total != 1 || len(next.Items) != 0 {
		t.Fatalf("history second page: %+v %v", next, err)
	}
	detail, err := ReadProductVersionAcceptance(ctx, db, "P-ACCEPT", "pm", permit("view"), version.ID, record.ID)
	if err != nil || len(detail.Checks) != 3 || len(detail.Exceptions) != 0 || detail.Checks[0].Evidence != input.Checks[0].Evidence || detail.AcceptedBy != "pm" {
		t.Fatalf("history detail: %+v %v", detail, err)
	}
	if _, err = ReadProductVersionAcceptance(ctx, db, "P-ACCEPT", "pm", permit("accept"), version.ID, record.ID); err == nil {
		t.Fatal("history accepted wrong action")
	}
	if _, err = ReadProductVersionAcceptance(ctx, db, "P-ACCEPT", "pm", permit("view"), version.ID+999, record.ID); err == nil {
		t.Fatal("history accepted wrong version")
	}
	var mode, actor, criteria string
	var acceptedScope uint64
	if err = db.QueryRow(`SELECT accepted_by,scope_revision,JSON_UNQUOTE(JSON_EXTRACT(checklist,'$.review_mode')),JSON_UNQUOTE(JSON_EXTRACT(checklist,'$.scope_snapshot[0].acceptance_criteria')) FROM product_version_acceptances WHERE id=?`, record.ID).Scan(&actor, &acceptedScope, &mode, &criteria); err != nil || actor != "pm" || acceptedScope != 1 || mode != "manual" || criteria != "登录注销测试" {
		t.Fatalf("snapshot: %s %d %s %s %v", actor, acceptedScope, mode, criteria, err)
	}
	if _, err = db.Exec(`UPDATE product_version_acceptances SET checklist=JSON_OBJECT() WHERE id=?`, record.ID); err == nil {
		t.Fatal("acceptance content mutable")
	}
	if _, err = db.Exec(`DELETE FROM product_version_acceptances WHERE id=?`, record.ID); err == nil {
		t.Fatal("acceptance deletable")
	}
	identity.IdempotencyKey = "stale"
	input.ExpectedRevision = 3
	_, err = run()
	requireProductRule(t, err, "product_version_revision_conflict")
	input.ExpectedVersionRevision = 2
	if _, err = db.Exec(`UPDATE product_versions SET scope_revision=scope_revision+1 WHERE id=?`, version.ID); err != nil {
		t.Fatal(err)
	}
	_, err = run()
	requireProductRule(t, err, "product_version_revision_conflict")
	var current bool
	if err = db.QueryRow(`SELECT a.scope_revision=v.scope_revision FROM product_version_acceptances a JOIN product_versions v ON v.id=a.version_id WHERE a.id=?`, record.ID).Scan(&current); err != nil || current {
		t.Fatalf("stale acceptance current: %v %v", current, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_release_records`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("acceptance published version: %d %v", count, err)
	}
	if _, err = db.Exec(`UPDATE product_versions SET scope_revision=1 WHERE id=?`, version.ID); err != nil {
		t.Fatal(err)
	}
	exerciseVersionPublication(t, db, version.ID, record.ID, distinctKeys)

}
