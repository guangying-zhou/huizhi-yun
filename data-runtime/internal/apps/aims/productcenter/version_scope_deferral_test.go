package productcenter

import (
	"context"
	"testing"
)

func TestMySQLVersionScopeDeferralSource(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-DEFER")
	versionExecutionFixture(t, db, nil)
	for _, q := range []string{
		`INSERT INTO product_versions(id,product_code,version_code,status) VALUES(1,'P-DEFER','v1','developing')`,
		`INSERT INTO product_version_features(id,version_id,title,status) VALUES(1,1,'保留原范围','planned')`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	source := &ProductVersionScopeDeferralSource{VersionID: 1, ScopeID: 1, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1}
	if err = prepareVersionScopeDeferral(ctx, tx, "P-DEFER", source); err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var status string
	if err = db.QueryRow(`SELECT status FROM product_version_features WHERE id=1`).Scan(&status); err != nil || status != "planned" {
		t.Fatalf("rollback %s %v", status, err)
	}
	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err = prepareVersionScopeDeferral(ctx, tx, "P-DEFER", source); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var revision, scope int
	if err = db.QueryRow(`SELECT f.status,v.revision,v.scope_revision FROM product_version_features f JOIN product_versions v ON v.id=f.version_id WHERE f.id=1`).Scan(&status, &revision, &scope); err != nil || status != "deferred" || revision != 2 || scope != 2 {
		t.Fatalf("deferred %s %d %d %v", status, revision, scope, err)
	}
}
