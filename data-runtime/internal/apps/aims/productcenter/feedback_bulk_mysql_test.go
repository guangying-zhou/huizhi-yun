package productcenter

import (
	"context"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"testing"
	"time"
)

func TestMySQLFeedbackThousandMergedSources(t *testing.T) {
	exerciseFeedbackBulk(t, 0)
}

func TestMySQLFeedbackThousandSourcesWithPublicVersions(t *testing.T) {
	exerciseFeedbackBulk(t, 20)
}

func exerciseFeedbackBulk(t *testing.T, publicVersions int) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-BULK")
	ctx := context.Background()
	fixture, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer fixture.Rollback()
	if _, err := fixture.Exec(`INSERT INTO product_requests(id,biz_id,product_code,title,decision_status,created_by,updated_by,created_at,updated_at) VALUES(1001,'00000000-0000-4000-8000-000000001001','P-BULK','Canonical','accepted','pm','pm',NOW(3),NOW(3))`); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 1000; i++ {
		if _, err := fixture.Exec(`INSERT INTO product_requests(id,biz_id,product_code,title,decision_status,merged_into_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,'P-BULK','Source','merged',1001,'pm','pm',NOW(3),NOW(3))`, i, fmt.Sprintf("00000000-0000-4000-8000-%012d", i)); err != nil {
			t.Fatal(err)
		}
		if _, err := fixture.Exec(`INSERT INTO product_request_sources(id,request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) VALUES(?,?,'service_ticket','Feedback','pm','pm',NOW(3),NOW(3))`, i, i); err != nil {
			t.Fatal(err)
		}
		if _, err := fixture.Exec(`INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) VALUES('altoc','service_ticket',?,'P-BULK',?,?,'pm',NOW(3))`, fmt.Sprintf("ST-%d", i), i, i); err != nil {
			t.Fatal(err)
		}
	}
	if publicVersions > 0 {
		if _, err := fixture.Exec(`INSERT INTO product_features(id,biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(1,'00000000-0000-4000-8000-000000002001','P-BULK','PRIVATE-FEATURE-TITLE','pm','pm',NOW(3),NOW(3))`); err != nil {
			t.Fatal(err)
		}
		// Multiple family members link the same feature; it must count once.
		for _, request := range []int{1, 2, 1001} {
			if _, err := fixture.Exec(`INSERT INTO product_request_features(product_code,request_id,product_feature_id,created_by,created_at) VALUES('P-BULK',?,1,'pm',NOW(3))`, request); err != nil {
				t.Fatal(err)
			}
		}
		for version := 1; version <= publicVersions+1; version++ {
			if _, err := fixture.Exec(`INSERT INTO product_versions(id,product_code,version_code,status) VALUES(?,'P-BULK',?,'developing')`, version, fmt.Sprintf("v%03d", version)); err != nil {
				t.Fatal(err)
			}
			public := 0
			if version <= publicVersions {
				public = 1
			}
			if _, err := fixture.Exec(`INSERT INTO product_version_features(version_id,product_feature_id,title,status,is_public) VALUES(?,1,'PRIVATE-SCOPE-TITLE','delivered',?)`, version, public); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := fixture.Commit(); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var revision uint64
	if err := tx.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-BULK' FOR UPDATE`).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	if err := enqueueProductFeedbackProgressTx(ctx, tx, integrationoperation.TrustedContext{SourceApp: "aims", TenantCode: "T", DeploymentCode: "A"}, "pm", "P-BULK", revision); err != nil {
		t.Fatal(err)
	}
	var events, originals, roots, matchingVersions int
	if err := tx.QueryRow(`SELECT COUNT(*),COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.requestBizId'))),COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.canonicalRequestBizId'))),SUM(JSON_LENGTH(JSON_EXTRACT(command_json,'$.versions'))=?) FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-progress.v1'`, publicVersions).Scan(&events, &originals, &roots, &matchingVersions); err != nil {
		t.Fatal(err)
	}
	if events != 1000 || originals != 1000 || roots != 1 || matchingVersions != 1000 {
		t.Fatalf("bulk projection: %d %d %d %d", events, originals, roots, matchingVersions)
	}
	var distinctSnapshots, leaks int
	if err := tx.QueryRow(`SELECT COUNT(DISTINCT CAST(JSON_EXTRACT(command_json,'$.versions') AS CHAR)),SUM(CAST(command_json AS CHAR) LIKE '%PRIVATE-%') FROM integration_operation`).Scan(&distinctSnapshots, &leaks); err != nil || distinctSnapshots != 1 || leaks != 0 {
		t.Fatalf("snapshot consistency/privacy: %d %d %v", distinctSnapshots, leaks, err)
	}
	if publicVersions > 0 {
		snapshot, err := readFeedbackProgressTx(ctx, tx, "P-BULK", 1)
		if err != nil || len(snapshot.Versions) != publicVersions {
			t.Fatalf("snapshot: %+v %v", snapshot, err)
		}
		for _, version := range snapshot.Versions {
			if version.PublicFeatureCount != 1 || version.DeliveredFeatureCount != 1 {
				t.Fatalf("duplicate feature counting: %+v", version)
			}
		}
	}
	t.Logf("1000-source outbox refresh with %d public versions: %s", publicVersions, time.Since(started))
}
