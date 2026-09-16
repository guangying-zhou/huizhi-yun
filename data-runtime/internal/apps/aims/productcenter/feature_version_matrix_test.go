package productcenter

import (
	"context"
	"testing"
)

func TestFeatureVersionMatrixQuery(t *testing.T) {
	valid := FeatureVersionMatrixQuery{VersionIDs: []int64{4, 2}, Page: 1, PageSize: 20}
	if err := ValidateFeatureVersionMatrixQuery(valid); err != nil {
		t.Fatal(err)
	}
	for _, q := range []FeatureVersionMatrixQuery{{VersionIDs: nil, Page: 1, PageSize: 20}, {VersionIDs: []int64{1, 1}, Page: 1, PageSize: 20}, {VersionIDs: []int64{0}, Page: 1, PageSize: 20}, {VersionIDs: []int64{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}, Page: 1, PageSize: 20}, {VersionIDs: []int64{1}, Page: 0, PageSize: 20}, {VersionIDs: []int64{1}, Page: 1, PageSize: 101}} {
		if err := ValidateFeatureVersionMatrixQuery(q); err == nil {
			t.Fatalf("accepted %+v", q)
		}
	}
	if valid.VersionIDs[0] != 4 || valid.VersionIDs[1] != 2 {
		t.Fatal("column order mutated")
	}
}

func TestMySQLFeatureVersionMatrix(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	ctx := context.Background()
	const code = "P-MATRIX"
	for _, statement := range []string{
		`INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P-MATRIX',UUID(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-MATRIX','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		`INSERT INTO product_features(biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-MATRIX','无范围功能','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),(UUID(),'P-MATRIX','多范围功能','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	var feature int64
	if err := db.QueryRow(`SELECT id FROM product_features WHERE product_code=? AND title='多范围功能'`, code).Scan(&feature); err != nil {
		t.Fatal(err)
	}
	versions := []int64{}
	for _, name := range []string{"v1", "v2", "v3", "v4"} {
		r, err := db.Exec(`INSERT INTO product_versions(product_code,version_code,status) VALUES(?,?,'developing')`, code, name)
		if err != nil {
			t.Fatal(err)
		}
		id, _ := r.LastInsertId()
		versions = append(versions, id)
	}
	for index, status := range []string{"planned", "delivered", "deferred"} {
		if _, err := db.Exec(`INSERT INTO product_version_features(version_id,product_feature_id,title,status) VALUES(?,?,'范围',?)`, versions[index], feature, status); err != nil {
			t.Fatal(err)
		}
	}
	var sourceScopeID int64
	if err := db.QueryRow(`SELECT id FROM product_version_features WHERE version_id=? AND product_feature_id=?`, versions[0], feature).Scan(&sourceScopeID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE product_version_features SET deferred_from_feature_id=? WHERE version_id=? AND product_feature_id=?`, sourceScopeID, versions[1], feature); err != nil {
		t.Fatal(err)
	}
	permit := func(resource string) AuthorizationPermit {
		p := workspacePermit(t, db, code, "pm", "view")
		p.Resource = resource
		return p
	}
	q := FeatureVersionMatrixQuery{VersionIDs: []int64{versions[3], versions[0], versions[1], versions[2]}, Page: 1, PageSize: 1}
	out, err := ReadFeatureVersionMatrix(ctx, db, code, "pm", permit("product_features"), permit("product_versions"), q)
	if err != nil || out.Total != 2 || len(out.Items) != 1 {
		t.Fatalf("matrix %+v %v", out, err)
	}
	cells := out.Items[0].Cells
	if len(cells) != 4 || cells[0].VersionID != versions[3] || cells[0].Planned != 0 || cells[0].Delivered != 0 || cells[1].Planned != 1 || cells[2].Delivered != 1 || cells[3].Deferred != 1 {
		t.Fatalf("counts %+v", cells)
	}
	if cells[0].ScopeID != nil || cells[1].ScopeID == nil || *cells[1].ScopeID != sourceScopeID || cells[2].DeferredFromScopeID == nil || *cells[2].DeferredFromScopeID != sourceScopeID || cells[2].DeferredFromVersionID == nil || *cells[2].DeferredFromVersionID != versions[0] {
		t.Fatalf("scope lineage %+v", cells)
	}
	q.Page = 2
	out, err = ReadFeatureVersionMatrix(ctx, db, code, "pm", permit("product_features"), permit("product_versions"), q)
	if err != nil || len(out.Items) != 1 || out.Items[0].Title != "无范围功能" || out.Items[0].Cells[1].Planned != 0 {
		t.Fatalf("empty relation %+v %v", out, err)
	}
	q.Page = 3
	out, err = ReadFeatureVersionMatrix(ctx, db, code, "pm", permit("product_features"), permit("product_versions"), q)
	if err != nil || out.Total != 2 || len(out.Items) != 0 {
		t.Fatalf("empty page %+v %v", out, err)
	}
	if _, err = ReadFeatureVersionMatrix(ctx, db, code, "pm", permit("product_features"), permit("product_features"), q); err == nil {
		t.Fatal("missing version permission accepted")
	}
	q.VersionIDs = []int64{versions[0] + 999}
	if _, err = ReadFeatureVersionMatrix(ctx, db, code, "pm", permit("product_features"), permit("product_versions"), q); err == nil {
		t.Fatal("missing version accepted")
	}
}
