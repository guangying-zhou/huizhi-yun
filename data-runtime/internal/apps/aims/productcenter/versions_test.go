package productcenter

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestProductVersionDraftValidation(t *testing.T) {
	good := ProductVersionDraft{ExpectedRevision: 1, VersionCode: "2026.09", Name: "九月版", PlannedReleaseDate: "2026-09-30"}
	if err := ValidateProductVersionDraft(good); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*ProductVersionDraft){"missing-revision": func(v *ProductVersionDraft) { v.ExpectedRevision = 0 }, "empty-code": func(v *ProductVersionDraft) { v.VersionCode = "" }, "code-space": func(v *ProductVersionDraft) { v.VersionCode = " v1" }, "code-control": func(v *ProductVersionDraft) { v.VersionCode = "v\n1" }, "long-code": func(v *ProductVersionDraft) { v.VersionCode = strings.Repeat("版", 65) }, "invalid-date": func(v *ProductVersionDraft) { v.PlannedReleaseDate = "2026-02-30" }, "mysql-date-range": func(v *ProductVersionDraft) { v.PlannedReleaseDate = "0001-01-01" }, "long-name": func(v *ProductVersionDraft) { v.Name = strings.Repeat("名", 201) }} {
		t.Run(name, func(t *testing.T) {
			v := good
			change(&v)
			if ValidateProductVersionDraft(v) == nil {
				t.Fatal("invalid version accepted")
			}
		})
	}
}

func TestMySQLProductCenterVersionPlanning(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-V")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-V", "pm", action)
		p.Resource = "product_versions"
		return p
	}
	identity := CommandIdentity{ProductCode: "P-V", ActorUID: "pm", Action: "product_versions:create", IdempotencyKey: "v1"}
	input := ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v1.0", Name: "首版", Description: "统一登录", PlannedReleaseDate: "2026-09-30"}
	_, err := CreateProductCenterVersion(ctx, db, identity, permit("view"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	result, err := CreateProductCenterVersion(ctx, db, identity, permit("edit"), input)
	if err != nil {
		t.Fatal(err)
	}
	var version struct {
		ID int64 `json:"id"`
	}
	if err = json.Unmarshal(result.Value, &version); err != nil {
		t.Fatal(err)
	}
	var unowned, unreleased bool
	if err = db.QueryRow(`SELECT owner_project_id IS NULL,current_release_record_id IS NULL AND released_at IS NULL AND released_by IS NULL FROM product_versions WHERE id=?`, version.ID).Scan(&unowned, &unreleased); err != nil || !unowned || !unreleased {
		t.Fatalf("fabricated ownership/release: %v %v %v", unowned, unreleased, err)
	}
	replay, err := CreateProductCenterVersion(ctx, db, identity, permit("edit"), input)
	if err != nil || !replay.Replayed || replay.ReceiptID != result.ReceiptID {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	// Legacy version columns use a case-insensitive collation. Product reads must
	// still enforce the case-sensitive product workspace boundary.
	if _, err = db.Exec(`INSERT INTO product_versions(product_code,version_code,status) VALUES ('p-v','PRIVATE','planning')`); err != nil {
		t.Fatal(err)
	}
	page, err := ListProductCenterVersions(ctx, db, "P-V", "pm", permit("view"), ProductVersionPageQuery{Page: 1, PageSize: 1})
	if err != nil || page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != version.ID || page.Items[0].Status != "planning" || page.Items[0].PlannedReleaseDate == nil || *page.Items[0].PlannedReleaseDate != "2026-09-30" {
		t.Fatalf("version page: %+v %v", page, err)
	}
	page, err = ListProductCenterVersions(ctx, db, "P-V", "pm", permit("view"), ProductVersionPageQuery{Page: 2, PageSize: 1})
	if err != nil || page.Total != 1 || page.Items == nil || len(page.Items) != 0 {
		t.Fatalf("empty page: %+v %v", page, err)
	}
	identity.IdempotencyKey = "v2"
	input.ExpectedRevision = 2
	input.VersionCode = "v2.0"
	if _, err = db.Exec(`CREATE TRIGGER fail_pc_version BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = CreateProductCenterVersion(ctx, db, identity, permit("edit"), input); err == nil {
		t.Fatal("audit failure committed version")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_versions WHERE version_code='v2.0'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback: %d %v", count, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_pc_version`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE product_workspaces SET status='archived' WHERE product_code='P-V'`); err != nil {
		t.Fatal(err)
	}
	_, err = CreateProductCenterVersion(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_archived")
	page, err = ListProductCenterVersions(ctx, db, "P-V", "pm", permit("view"), ProductVersionPageQuery{Page: 1, PageSize: 10, Keyword: "%_"})
	if err != nil || page.Total != 0 {
		t.Fatalf("literal keyword: %+v %v", page, err)
	}
}
