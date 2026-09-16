package productcenter

import (
	"context"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strings"
	"testing"
)

func TestMySQLFeedbackProgressCanonicalAndPublicVersions(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-PROGRESS")
	for _, statement := range []string{
		`INSERT INTO product_requests(id,biz_id,product_code,title,decision_status,created_by,updated_by,created_at,updated_at) VALUES(1,'00000000-0000-4000-8000-000000000001','P-PROGRESS','Original','submitted','pm','pm',NOW(3),NOW(3)),(2,'00000000-0000-4000-8000-000000000002','P-PROGRESS','Middle','submitted','pm','pm',NOW(3),NOW(3)),(3,'00000000-0000-4000-8000-000000000003','P-PROGRESS','Canonical','accepted','pm','pm',NOW(3),NOW(3))`,
		`UPDATE product_requests SET decision_status='merged',merged_into_id=id+1 WHERE id IN(1,2)`,
		`INSERT INTO product_features(id,biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(1,'00000000-0000-4000-8000-000000000011','P-PROGRESS','PRIVATE TITLE','pm','pm',NOW(3),NOW(3)),(2,'00000000-0000-4000-8000-000000000012','P-PROGRESS','PRIVATE TITLE','pm','pm',NOW(3),NOW(3))`,
		`INSERT INTO product_request_features(product_code,request_id,product_feature_id,created_by,created_at) VALUES('P-PROGRESS',1,1,'pm',NOW(3)),('P-PROGRESS',3,1,'pm',NOW(3)),('P-PROGRESS',2,2,'pm',NOW(3))`,
		`INSERT INTO product_versions(id,product_code,version_code,status,planned_release_date,released_at) VALUES(1,'P-PROGRESS','v1','released','2026-08-01','2026-08-03 10:00:00'),(2,'P-PROGRESS','v2','planning','2026-10-01',NULL),(3,'OTHER','v3','released',NULL,NOW())`,
		`INSERT INTO product_version_features(version_id,product_feature_id,title,status,is_public) VALUES(1,1,'PRIVATE TITLE','delivered',1),(1,2,'PRIVATE TITLE','planned',0),(2,2,'PRIVATE TITLE','planned',1),(3,1,'OTHER PRODUCT','delivered',1)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}

	for _, statement := range []string{
		`INSERT INTO product_request_sources(request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) VALUES(1,'service_ticket','Feedback','pm','pm',NOW(3),NOW(3))`,
		`INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) SELECT 'altoc','service_ticket','ST-1','P-PROGRESS',request_id,id,'pm',NOW(3) FROM product_request_sources`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	result, err := readFeedbackProgressTx(context.Background(), tx, "P-PROGRESS", 1)
	if err != nil {
		t.Fatal(err)
	}
	if result.CanonicalRequestBizID != "00000000-0000-4000-8000-000000000003" || result.CanonicalDecisionStatus != "accepted" || len(result.Versions) != 2 {
		t.Fatalf("canonical progress: %#v", result)
	}

	trusted := integrationoperation.TrustedContext{SourceApp: "aims", TenantCode: "TENANT", DeploymentCode: "AIMS"}
	if err := enqueueFeedbackProgressTx(context.Background(), tx, trusted, "pm", "P-PROGRESS", 3, 7); err != nil {
		t.Fatal(err)
	}
	var frozen []byte
	var storedHash, operation, schema string
	if err := tx.QueryRow(`SELECT command_json,command_sha256,operation_code,command_schema_version FROM integration_operation`).Scan(&frozen, &storedHash, &operation, &schema); err != nil {
		t.Fatal(err)
	}
	var command map[string]any
	if err := json.Unmarshal(frozen, &command); err != nil {
		t.Fatal(err)
	}
	hash, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil || hash != storedHash || len(command) != 8 || command["decisionStatus"] != "merged" || command["canonicalDecisionStatus"] != "accepted" || command["requestBizId"] != "00000000-0000-4000-8000-000000000001" || operation != "aims.altoc.product-feedback.update-progress.v1" || schema != "product-feedback-progress.v1" {
		t.Fatalf("frozen progress: %s %v", frozen, err)
	}
	first, second := result.Versions[0], result.Versions[1]
	if first.PublicFeatureCount != 1 || first.DeliveredFeatureCount != 1 || first.PlannedReleaseDate == nil || *first.PlannedReleaseDate != "2026-08-01" || first.ReleasedAt == nil || *first.ReleasedAt != "2026-08-03 10:00:00" {
		t.Fatalf("released counts/dates: %#v", first)
	}
	if second.PublicFeatureCount != 1 || second.DeliveredFeatureCount != 0 || second.ReleasedAt != nil {
		t.Fatalf("planned version became delivered: %#v", second)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "PRIVATE") || strings.Contains(string(encoded), "OTHER") {
		t.Fatal("private information escaped")
	}
	if _, err := readFeedbackProgressTx(context.Background(), tx, "p-progress", 1); err == nil {
		t.Fatal("product boundary ignored")
	}

	if _, err := tx.Exec(`DELETE FROM product_request_features`); err != nil {
		t.Fatal(err)
	}
	empty, err := readFeedbackProgressTx(context.Background(), tx, "P-PROGRESS", 1)
	if err != nil || empty.Versions == nil || len(empty.Versions) != 0 {
		t.Fatalf("missing version evidence must be an empty list: %#v, %v", empty, err)
	}
	if _, err := tx.Exec(`UPDATE product_requests SET decision_status='accepted' WHERE id=2`); err != nil {
		t.Fatal(err)
	}
	if _, err := readFeedbackProgressTx(context.Background(), tx, "P-PROGRESS", 1); err == nil {
		t.Fatal("inconsistent merge state accepted")
	}
	if _, err := tx.Exec(`UPDATE product_requests SET decision_status='merged' WHERE id=2`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`UPDATE product_requests SET decision_status='merged',merged_into_id=1 WHERE id=3`); err != nil {
		t.Fatal(err)
	}
	if _, err := readFeedbackProgressTx(context.Background(), tx, "P-PROGRESS", 1); err == nil {
		t.Fatal("merge cycle accepted")
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err := db.QueryRow(`SELECT COUNT(*) FROM integration_operation`).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatal("progress outbox escaped parent rollback")
	}

	permit := workspacePermit(t, db, "P-PROGRESS", "pm", "edit")
	permit.Resource = "product_versions"
	identity := CommandIdentity{ProductCode: "P-PROGRESS", ActorUID: "pm", Action: "product_versions:edit", IdempotencyKey: "feedback-version-date"}
	edit := ProductVersionEdit{ProductVersionDraft: ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v2", PlannedReleaseDate: "2026-11-01"}, VersionID: 2, ExpectedVersionRevision: 1, Reason: "reschedule"}
	if _, err := EditProductCenterVersion(context.Background(), db, identity, permit, edit, trusted); err != nil {
		t.Fatal(err)
	}
	var date string
	if err := db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.versions[1].plannedReleaseDate')) FROM integration_operation WHERE JSON_EXTRACT(command_json,'$.sourceRevision')=2`).Scan(&date); err != nil || date != "2026-11-01" {
		t.Fatalf("version edit progress: %s %v", date, err)
	}
	permit = workspacePermit(t, db, "P-PROGRESS", "pm", "archive")
	permit.Resource = "product_versions"
	identity.Action = "product_versions:archive"
	identity.IdempotencyKey = "feedback-version-archive"
	archive := ProductVersionArchiveInput{VersionID: 1, ExpectedRevision: 2, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1, Reason: "archive"}
	if _, err := ArchiveProductVersion(context.Background(), db, identity, permit, archive, trusted); err != nil {
		t.Fatal(err)
	}
	var archived string
	if err := db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.versions[0].status')) FROM integration_operation WHERE JSON_EXTRACT(command_json,'$.sourceRevision')=3`).Scan(&archived); err != nil || archived != "archived" {
		t.Fatalf("version archive progress: %s %v", archived, err)
	}

	var scopeID int64
	if err := db.QueryRow(`SELECT id FROM product_version_features WHERE version_id=2`).Scan(&scopeID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE product_version_features SET acceptance_criteria='verified' WHERE id=?`, scopeID); err != nil {
		t.Fatal(err)
	}
	permit = workspacePermit(t, db, "P-PROGRESS", "pm", "accept")
	permit.Resource = "product_versions"
	identity.Action = "product_versions:scope-deliver"
	identity.IdempotencyKey = "feedback-scope-deliver"
	delivery := ProductVersionScopeDelivery{VersionID: 2, ScopeID: scopeID, ExpectedRevision: 3, ExpectedVersionRevision: 2, ExpectedScopeRevision: 1, Evidence: "review", Reason: "accepted"}
	if _, err := ConfirmProductVersionScopeDelivery(context.Background(), db, identity, permit, delivery, trusted); err != nil {
		t.Fatal(err)
	}
	var delivered int
	if err := db.QueryRow(`SELECT JSON_EXTRACT(command_json,'$.versions[1].deliveredFeatureCount') FROM integration_operation WHERE JSON_EXTRACT(command_json,'$.sourceRevision')=4`).Scan(&delivered); err != nil || delivered != 1 {
		t.Fatalf("scope delivery progress: %d %v", delivered, err)
	}
	permit = workspacePermit(t, db, "P-PROGRESS", "pm", "accept")
	permit.Resource = "product_versions"
	identity.Action = "product_versions:scope-reopen"
	identity.IdempotencyKey = "feedback-scope-reopen"
	reopen := ProductVersionScopeReopen{VersionID: 2, ScopeID: scopeID, ExpectedRevision: 4, ExpectedVersionRevision: 3, ExpectedScopeRevision: 2, Reason: "recheck"}
	if _, err := ReopenProductVersionScope(context.Background(), db, identity, permit, reopen, trusted); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT JSON_EXTRACT(command_json,'$.versions[1].deliveredFeatureCount') FROM integration_operation WHERE JSON_EXTRACT(command_json,'$.sourceRevision')=5`).Scan(&delivered); err != nil || delivered != 0 {
		t.Fatalf("scope reopen progress: %d %v", delivered, err)
	}

	permit = workspacePermit(t, db, "P-PROGRESS", "pm", "edit")
	permit.Resource = "product_versions"
	identity.Action = "product_versions:transition"
	identity.IdempotencyKey = "feedback-development"
	transition := ProductVersionTransitionInput{VersionID: 2, ExpectedRevision: 5, ExpectedVersionRevision: 4, ToStatus: "developing", Reason: "start development"}
	if _, err := TransitionProductVersion(context.Background(), db, identity, permit, transition, trusted); err != nil {
		t.Fatal(err)
	}
	var developing string
	if err := db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.versions[1].status')) FROM integration_operation WHERE JSON_EXTRACT(command_json,'$.sourceRevision')=6`).Scan(&developing); err != nil || developing != "developing" {
		t.Fatalf("development progress: %s %v", developing, err)
	}

	permit = workspacePermit(t, db, "P-PROGRESS", "pm", "edit")
	permit.Resource = "product_versions"
	identity.Action = "product_versions:scope-visibility"
	identity.IdempotencyKey = "feedback-hide-scope"
	public := false
	visibility := ProductVersionScopeVisibility{VersionID: 2, ScopeID: scopeID, ExpectedRevision: 6, ExpectedVersionRevision: 5, ExpectedScopeRevision: 3, IsPublic: &public, Reason: "internal only"}
	hidden, err := ChangeProductVersionScopeVisibility(context.Background(), db, identity, permit, visibility, trusted)
	if err != nil {
		t.Fatal(err)
	}
	permit = workspacePermit(t, db, "P-PROGRESS", "pm", "edit")
	permit.Resource = "product_versions"
	replay, err := ChangeProductVersionScopeVisibility(context.Background(), db, identity, permit, visibility, trusted)
	if err != nil || !replay.Replayed || replay.ReceiptID != hidden.ReceiptID {
		t.Fatal("visibility replay changed")
	}
	var visibleVersions int
	if err := db.QueryRow(`SELECT JSON_LENGTH(command_json,'$.versions') FROM integration_operation WHERE JSON_EXTRACT(command_json,'$.sourceRevision')=7`).Scan(&visibleVersions); err != nil || visibleVersions != 1 {
		t.Fatalf("hidden version leaked: %d %v", visibleVersions, err)
	}

	viewPermit := workspacePermit(t, db, "P-PROGRESS", "pm", "view")
	viewPermit.Resource = "product_versions"
	hiddenPage, err := ListProductVersionScope(context.Background(), db, "P-PROGRESS", "pm", viewPermit, 2, PlanningPageQuery{Page: 1, PageSize: 20})
	if err != nil || len(hiddenPage.Items) != 1 || hiddenPage.Items[0].IsPublic {
		t.Fatalf("hidden scope read: %#v %v", hiddenPage, err)
	}
	public = true
	visibility.ExpectedRevision = 7
	visibility.ExpectedVersionRevision = 6
	visibility.ExpectedScopeRevision = 4
	identity.IdempotencyKey = "feedback-show-scope"
	permit = workspacePermit(t, db, "P-PROGRESS", "pm", "edit")
	permit.Resource = "product_versions"
	if _, err := ChangeProductVersionScopeVisibility(context.Background(), db, identity, permit, visibility, trusted); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT JSON_LENGTH(command_json,'$.versions') FROM integration_operation WHERE JSON_EXTRACT(command_json,'$.sourceRevision')=8`).Scan(&visibleVersions); err != nil || visibleVersions != 2 {
		t.Fatalf("public version missing: %d %v", visibleVersions, err)
	}

	viewPermit = workspacePermit(t, db, "P-PROGRESS", "pm", "view")
	viewPermit.Resource = "product_versions"
	publicPage, err := ListProductVersionScope(context.Background(), db, "P-PROGRESS", "pm", viewPermit, 2, PlanningPageQuery{Page: 1, PageSize: 20})
	if err != nil || len(publicPage.Items) != 1 || !publicPage.Items[0].IsPublic {
		t.Fatalf("public scope read: %#v %v", publicPage, err)
	}

	// Two source requests in one merged family must each receive exactly one
	// operation, while sharing the same canonical version snapshot.
	familyTx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer familyTx.Rollback()
	for _, statement := range []string{
		`SELECT revision FROM product_workspaces WHERE product_code='P-PROGRESS' FOR UPDATE`,
		`INSERT INTO product_request_sources(request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) VALUES(2,'service_ticket','Feedback 2','pm','pm',NOW(3),NOW(3))`,
		`INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) SELECT 'altoc','service_ticket','ST-2','P-PROGRESS',request_id,id,'pm',NOW(3) FROM product_request_sources WHERE request_id=2`,
	} {
		if _, err := familyTx.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	if err := enqueueProductFeedbackProgressTx(context.Background(), familyTx, trusted, "pm", "P-PROGRESS", 9); err != nil {
		t.Fatal(err)
	}
	var events, snapshots, originals int
	if err := familyTx.QueryRow(`SELECT COUNT(*),COUNT(DISTINCT CAST(JSON_EXTRACT(command_json,'$.versions') AS CHAR)),COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.requestBizId'))) FROM integration_operation WHERE JSON_EXTRACT(command_json,'$.sourceRevision')=9`).Scan(&events, &snapshots, &originals); err != nil || events != 2 || snapshots != 1 || originals != 2 {
		t.Fatalf("merged family refresh: events=%d snapshots=%d originals=%d err=%v", events, snapshots, originals, err)
	}

}
