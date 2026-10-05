package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"testing"
)

func exerciseVersionPublication(t *testing.T, db *sql.DB, versionID, acceptanceID int64, distinctKeys bool) {
	t.Helper()
	ctx := context.Background()
	permit := func(uid, action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-ACCEPT", uid, action)
		p.Resource = "product_versions"
		return p
	}
	identity := CommandIdentity{ProductCode: "P-ACCEPT", ActorUID: "publisher", Action: "product_versions:publish", IdempotencyKey: "publish"}
	input := ProductVersionPublishInput{VersionID: versionID, AcceptanceID: acceptanceID, ExpectedRevision: 3, ExpectedVersionRevision: 2, ExpectedScopeRevision: 1, Reason: "独立核验后发布"}

	trusted := integrationoperation.TrustedContext{SourceApp: "aims", TenantCode: "TENANT", DeploymentCode: "AIMS"}
	for _, statement := range []string{
		`INSERT INTO product_requests(biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES('00000000-0000-4000-8000-000000000089','P-ACCEPT','Feedback','pm','pm',NOW(3),NOW(3))`,
		`INSERT INTO product_request_sources(request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) SELECT id,'service_ticket','Feedback','pm','pm',NOW(3),NOW(3) FROM product_requests WHERE biz_id='00000000-0000-4000-8000-000000000089'`,
		`INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) SELECT 'altoc','service_ticket','ST-PUBLISH','P-ACCEPT',request_id,id,'pm',NOW(3) FROM product_request_sources WHERE request_id=(SELECT id FROM product_requests WHERE biz_id='00000000-0000-4000-8000-000000000089')`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	run := func() (CommandResult, error) {
		return PublishProductVersionWithFeedback(ctx, db, identity, permit(identity.ActorUID, "publish"), input, trusted)
	}
	if _, err := PublishProductVersion(ctx, db, identity, permit("publisher", "edit"), input); err == nil {
		t.Fatal("edit authorized publication")
	}
	_, err := PublishProductVersion(ctx, db, identity, permit("publisher", "publish"), input, "wrong-preflight-snapshot")
	requireProductRule(t, err, "product_version_review_changed")
	identity.ActorUID = "pm"
	_, err = run()
	requireProductRule(t, err, "product_version_self_publish")
	identity.ActorUID = "publisher"
	for _, owner := range []any{nil, "other"} {
		if _, err = db.Exec(`UPDATE product_versions SET business_owner_uid=? WHERE id=?`, owner, versionID); err != nil {
			t.Fatal(err)
		}
		_, err = run()
		requireProductRule(t, err, "product_version_owner_required")
	}
	if _, err = db.Exec(`UPDATE product_versions SET business_owner_uid='pm' WHERE id=?`, versionID); err != nil {
		t.Fatal(err)
	}
	exerciseInactiveVersionOwner(t, db, run)
	if _, err = db.Exec(`UPDATE product_version_features SET title='验收后修改' WHERE version_id=?`, versionID); err != nil {
		t.Fatal(err)
	}
	_, err = run()
	requireProductRule(t, err, "product_version_acceptance_stale")
	// Restore the exact stored fixture title, not a new acceptance or revision.
	if _, err = db.Exec(`UPDATE product_version_features f JOIN product_version_acceptances a ON a.version_id=f.version_id SET f.title=JSON_UNQUOTE(JSON_EXTRACT(a.checklist,'$.scope_snapshot[0].title')) WHERE a.id=?`, acceptanceID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER pc_publish_fail BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='publish audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run(); err == nil {
		t.Fatal("failed audit committed publication")
	}
	var count int
	var status string
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_release_records`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("release rollback: %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT status FROM product_versions WHERE id=?`, versionID).Scan(&status); err != nil || status == "released" {
		t.Fatalf("version rollback: %s %v", status, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_publish_fail`); err != nil {
		t.Fatal(err)
	}
	// Two requests carry the same pre-write permit, with same or distinct keys.
	// Capture the permit before starting workers so neither observes a later
	// revision and accidentally turns this into two sequential commands.
	publicationPermit := permit("publisher", "publish")
	type publicationOutcome struct {
		key    string
		result CommandResult
		err    error
	}
	start := make(chan struct{})
	outcomes := make(chan publicationOutcome, 2)
	for i := 0; i < 2; i++ {
		requestIdentity := identity
		if distinctKeys && i == 1 {
			requestIdentity.IdempotencyKey = "publish-other"
		}
		go func() {
			<-start
			result, err := PublishProductVersionWithFeedback(ctx, db, requestIdentity, publicationPermit, input, trusted)
			outcomes <- publicationOutcome{requestIdentity.IdempotencyKey, result, err}
		}()
	}
	close(start)
	firstPublication, secondPublication := <-outcomes, <-outcomes
	var saved CommandResult
	if distinctKeys {
		winner, loser := firstPublication, secondPublication
		if winner.err != nil {
			winner, loser = loser, winner
		}
		if winner.err != nil || winner.result.Replayed || loser.err == nil {
			t.Fatalf("distinct-key publication: %+v / %+v", winner, loser)
		}
		requireProductRule(t, loser.err, "product_authorization_changed")
		identity.IdempotencyKey = loser.key
		_, retryErr := run()
		requireProductRule(t, retryErr, "product_revision_conflict")
		identity.IdempotencyKey = winner.key
		saved = winner.result
	} else {
		// A concurrent winner invalidates the other request's authorization
		// snapshot. Only that exact conflict may be recovered with a fresh permit.
		for _, outcome := range []*publicationOutcome{&firstPublication, &secondPublication} {
			if outcome.err != nil {
				requireProductRule(t, outcome.err, "product_authorization_changed")
				outcome.result, outcome.err = run()
				if outcome.err != nil || !outcome.result.Replayed {
					t.Fatalf("reauthorized concurrent replay: %+v %v", outcome.result, outcome.err)
				}
			}
		}
		if firstPublication.result.ReceiptID != secondPublication.result.ReceiptID || firstPublication.result.Replayed == secondPublication.result.Replayed {
			t.Fatalf("publication did not execute exactly once: %+v / %+v", firstPublication.result, secondPublication.result)
		}
		saved = firstPublication.result
		if saved.Replayed {
			saved = secondPublication.result
		}

	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_release_records WHERE version_id=?`, versionID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("duplicate release records: %d %v", count, err)
	}
	replay, err := run()
	if err != nil || !replay.Replayed || saved.ReceiptID != replay.ReceiptID {
		t.Fatalf("publish replay: %+v %v", replay, err)
	}

	var events int
	if err := db.QueryRow(`SELECT COUNT(*) FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-progress.v1' AND JSON_EXTRACT(command_json,'$.sourceRevision')=4`).Scan(&events); err != nil || events != 1 {
		t.Fatalf("publication progress must freeze once: %d %v", events, err)
	}
	if _, err := db.Exec(`DELETE FROM product_feedback_bindings WHERE source_biz_id='ST-PUBLISH'`); err != nil {
		t.Fatal(err)
	}
	var result struct {
		ID   int64  `json:"release_record_id"`
		Hash string `json:"content_hash"`
	}
	if err = json.Unmarshal(saved.Value, &result); err != nil {
		t.Fatal(err)
	}
	var actor, level, hash string
	var current int64
	if err = db.QueryRow(`SELECT r.released_by,r.evidence_level,r.content_hash,v.current_release_record_id,v.status FROM product_release_records r JOIN product_versions v ON v.id=r.version_id WHERE r.id=?`, result.ID).Scan(&actor, &level, &hash, &current, &status); err != nil || actor != "publisher" || level != "verified" || len(hash) != 64 || hash != result.Hash || current != result.ID || status != "released" {
		t.Fatalf("release evidence: %s %s %s %d %s %v", actor, level, hash, current, status, err)
	}
	var storedScope, storedAcceptance json.RawMessage
	if err = db.QueryRow(`SELECT scope_snapshot,acceptance_snapshot FROM product_release_records WHERE id=?`, result.ID).Scan(&storedScope, &storedAcceptance); err != nil {
		t.Fatal(err)
	}
	computedHash, err := versionReleaseContentHash(storedScope, storedAcceptance)
	if err != nil || computedHash != hash {
		t.Fatalf("stored release hash: %s %s %v", computedHash, hash, err)
	}
	if _, err = db.Exec(`UPDATE product_release_records SET content_hash=REPEAT('0',64) WHERE id=?`, result.ID); err == nil {
		t.Fatal("release mutable")
	}
	if _, err = db.Exec(`DELETE FROM product_release_records WHERE id=?`, result.ID); err == nil {
		t.Fatal("release deletable")
	}
	frozen, err := ReadProductVersionRelease(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), versionID, result.ID)
	if err != nil || !frozen.SnapshotAvailable || !frozen.Current || len(frozen.Checks) != 3 || len(frozen.Scopes) != 1 {
		t.Fatalf("frozen release: %+v %v", frozen, err)
	}
	assertMatrixRelease := func(recordID int64, current, withdrawn bool) {
		t.Helper()
		featurePermit := permit("publisher", "view")
		featurePermit.Resource = "product_features"
		matrix, readErr := ReadFeatureVersionMatrix(ctx, db, "P-ACCEPT", "publisher", featurePermit, permit("publisher", "view"), FeatureVersionMatrixQuery{VersionIDs: []int64{versionID}, Page: 1, PageSize: 20})
		if readErr != nil || len(matrix.Items) != 1 || len(matrix.Items[0].Cells) != 1 {
			t.Fatalf("release matrix: %+v %v", matrix, readErr)
		}
		evidence := matrix.Items[0].Cells[0].LatestRelease
		if evidence == nil || evidence.RecordID != recordID || evidence.VersionID != versionID || evidence.Membership != "included" || evidence.ScopeID == nil || *evidence.ScopeID != frozen.Scopes[0].ID || evidence.FrozenStatus == nil || *evidence.FrozenStatus != "delivered" || evidence.Current != current || evidence.Withdrawn != withdrawn || evidence.Superseded {
			t.Fatalf("frozen feature evidence: %+v", evidence)
		}
	}
	assertMatrixRelease(result.ID, true, false)
	q := ReleaseScopeDiffQuery{BeforeVersionID: versionID, AfterVersionID: versionID, BeforeRecordID: result.ID, AfterRecordID: result.ID, Page: 1, PageSize: 10}
	diff, diffErr := ReadReleaseScopeDiff(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), q)
	if diffErr != nil || diff.Total != 0 || diff.Unchanged != 1 || len(diff.Changes) != 0 || diff.BeforeContentHash != frozen.ContentHash || diff.AfterContentHash != frozen.ContentHash {
		t.Fatalf("release self diff %+v %v", diff, diffErr)
	}
	if _, diffErr = ReadReleaseScopeDiff(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "publish"), q); diffErr == nil {
		t.Fatal("diff accepted wrong permission")
	}
	badQuery := q
	badQuery.AfterVersionID++
	if _, diffErr = ReadReleaseScopeDiff(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), badQuery); diffErr == nil {
		t.Fatal("diff accepted wrong version")
	}
	originalTitle := frozen.Scopes[0].Title
	if _, err = db.Exec(`UPDATE product_version_features SET title='发布后不同内容' WHERE version_id=?`, versionID); err != nil {
		t.Fatal(err)
	}
	after, err := ReadProductVersionRelease(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), versionID, result.ID)
	if err != nil || after.Scopes[0].Title != originalTitle || after.ContentHash != frozen.ContentHash {
		t.Fatalf("release drifted: %+v %v", after, err)
	}
	if _, err = ReadProductVersionRelease(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "publish"), versionID, result.ID); err == nil {
		t.Fatal("wrong action read release")
	}
	if _, err = ReadProductVersionRelease(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), versionID+1, result.ID); err == nil {
		t.Fatal("wrong version read release")
	}
	identity.IdempotencyKey = "second"
	input.ExpectedRevision = 4
	input.ExpectedVersionRevision = 3
	_, err = run()
	requireProductRule(t, err, "product_version_locked")
	reopenIdentity := CommandIdentity{ProductCode: "P-ACCEPT", ActorUID: "publisher", Action: "product_versions:reopen", IdempotencyKey: "reopen"}
	reopenInput := ProductVersionReopenInput{VersionID: versionID, ReleaseRecordID: result.ID, ExpectedRevision: 4, ExpectedVersionRevision: 3, Reason: "修正发布范围"}

	if _, err := db.Exec(`INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) SELECT 'altoc','service_ticket','ST-PUBLISH','P-ACCEPT',request_id,id,'pm',NOW(3) FROM product_request_sources WHERE request_id=(SELECT id FROM product_requests WHERE biz_id='00000000-0000-4000-8000-000000000089')`); err != nil {
		t.Fatal(err)
	}
	reopen := func() (CommandResult, error) {
		return ReopenProductVersion(ctx, db, reopenIdentity, permit("publisher", "reopen"), reopenInput, trusted)
	}
	if _, err = ReopenProductVersion(ctx, db, reopenIdentity, permit("publisher", "edit"), reopenInput); err == nil {
		t.Fatal("edit authorized reopen")
	}
	if _, err = db.Exec(`CREATE TRIGGER pc_reopen_fail BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='reopen audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = reopen(); err == nil {
		t.Fatal("failed audit reopened version")
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_release_events`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("reopen event rollback: %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT status FROM product_versions WHERE id=?`, versionID).Scan(&status); err != nil || status != "released" {
		t.Fatalf("reopen status rollback: %s %v", status, err)
	}

	if err := db.QueryRow(`SELECT COUNT(*) FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-progress.v1' AND JSON_EXTRACT(command_json,'$.sourceRevision')=5`).Scan(&events); err != nil || events != 0 {
		t.Fatal("failed reopen left progress outbox")
	}
	if _, err = db.Exec(`DROP TRIGGER pc_reopen_fail`); err != nil {
		t.Fatal(err)
	}
	reopened, err := reopen()
	if err != nil {
		t.Fatal(err)
	}
	reopenedAgain, err := reopen()
	if err != nil || !reopenedAgain.Replayed || reopenedAgain.ReceiptID != reopened.ReceiptID {
		t.Fatalf("reopen replay: %+v %v", reopenedAgain, err)
	}

	if err := db.QueryRow(`SELECT COUNT(*) FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-progress.v1' AND JSON_EXTRACT(command_json,'$.sourceRevision')=5`).Scan(&events); err != nil || events != 1 {
		t.Fatalf("reopen progress must freeze once: %d %v", events, err)
	}
	if _, err := db.Exec(`DELETE FROM product_feedback_bindings WHERE source_biz_id='ST-PUBLISH'`); err != nil {
		t.Fatal(err)
	}
	var newScope uint64
	var currentRelease sql.NullInt64
	if err = db.QueryRow(`SELECT status,scope_revision,current_release_record_id FROM product_versions WHERE id=?`, versionID).Scan(&status, &newScope, &currentRelease); err != nil || status != "developing" || newScope != 2 || currentRelease.Valid {
		t.Fatalf("reopen state: %s %d %+v %v", status, newScope, currentRelease, err)
	}

	assertMatrixRelease(result.ID, false, true)
	withdrawn, err := ReadProductVersionRelease(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), versionID, result.ID)
	if err != nil || !withdrawn.Withdrawn || withdrawn.Current || withdrawn.ContentHash != hash {
		t.Fatalf("withdrawn snapshot: %+v %v", withdrawn, err)
	}

	preview, err := PreviewProductVersionAcceptance(ctx, db, "P-ACCEPT", "pm", permit("pm", "view"), versionID)
	if err != nil {
		t.Fatal(err)
	}
	input.ExpectedRevision = preview.WorkspaceRevision
	input.ExpectedVersionRevision = preview.Version.Revision
	input.ExpectedScopeRevision = preview.Version.ScopeRevision
	identity.IdempotencyKey = "stale-after-reopen"
	_, err = run()
	requireProductRule(t, err, "product_version_acceptance_stale")
	newAcceptance := versionAcceptanceInput()
	newAcceptance.VersionID = versionID
	newAcceptance.ExpectedRevision = preview.WorkspaceRevision
	newAcceptance.ExpectedVersionRevision = preview.Version.Revision
	newAcceptance.ExpectedScopeRevision = preview.Version.ScopeRevision
	newAcceptance.ExpectedReviewHash = preview.ReviewHash
	accepted, err := AcceptProductVersion(ctx, db, CommandIdentity{ProductCode: "P-ACCEPT", ActorUID: "pm", Action: "product_versions:accept", IdempotencyKey: "accept-correction"}, permit("pm", "accept"), newAcceptance)
	if err != nil {
		t.Fatal(err)
	}
	var newRecord struct {
		ID int64 `json:"acceptance_id"`
	}
	if err = json.Unmarshal(accepted.Value, &newRecord); err != nil {
		t.Fatal(err)
	}
	input.AcceptanceID = newRecord.ID
	input.ExpectedRevision = preview.WorkspaceRevision + 1
	input.ExpectedVersionRevision = preview.Version.Revision + 1
	input.ExpectedScopeRevision = preview.Version.ScopeRevision
	identity.IdempotencyKey = "publish-correction"
	if _, err := db.Exec(`INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) SELECT 'altoc','service_ticket','ST-PUBLISH','P-ACCEPT',request_id,id,'pm',NOW(3) FROM product_request_sources WHERE request_id=(SELECT id FROM product_requests WHERE biz_id='00000000-0000-4000-8000-000000000089')`); err != nil {
		t.Fatal(err)
	}

	if _, err = db.Exec(`CREATE TRIGGER pc_correction_fail BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='correction audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run(); err == nil {
		t.Fatal("failed correction audit committed")
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_release_records`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("correction rollback: %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_release_events WHERE event_type='superseded'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("correction event rollback: %d %v", count, err)
	}

	if err := db.QueryRow(`SELECT COUNT(*) FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-progress.v1' AND JSON_EXTRACT(command_json,'$.sourceRevision')=?`, input.ExpectedRevision+1).Scan(&events); err != nil || events != 0 {
		t.Fatal("failed correction left progress outbox")
	}
	if _, err = db.Exec(`DROP TRIGGER pc_correction_fail`); err != nil {
		t.Fatal(err)
	}
	corrected, err := run()
	if err != nil {
		t.Fatal(err)
	}

	repeatedCorrection, err := run()
	if err != nil || !repeatedCorrection.Replayed || repeatedCorrection.ReceiptID != corrected.ReceiptID {
		t.Fatal("correction replay changed receipt")
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM integration_operation WHERE operation_code='aims.altoc.product-feedback.update-progress.v1' AND JSON_EXTRACT(command_json,'$.sourceRevision')=?`, input.ExpectedRevision+1).Scan(&events); err != nil || events != 1 {
		t.Fatalf("correction progress: %d %v", events, err)
	}
	if _, err := db.Exec(`DELETE FROM product_feedback_bindings WHERE source_biz_id='ST-PUBLISH'`); err != nil {
		t.Fatal(err)
	}
	var correctedRecord struct {
		ID int64 `json:"release_record_id"`
	}
	if err = json.Unmarshal(corrected.Value, &correctedRecord); err != nil {
		t.Fatal(err)
	}
	var seq uint64
	var supersedes int64
	if err = db.QueryRow(`SELECT release_seq,supersedes_record_id FROM product_release_records WHERE id=?`, correctedRecord.ID).Scan(&seq, &supersedes); err != nil || seq != 2 || supersedes != result.ID {
		t.Fatalf("correction chain: %d %d %v", seq, supersedes, err)
	}
	assertMatrixRelease(correctedRecord.ID, true, false)
	original, err := ReadProductVersionRelease(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), versionID, result.ID)
	if err != nil || !original.Superseded || original.ContentHash != hash || original.Scopes[0].Title != originalTitle {
		t.Fatalf("original overwritten: %+v %v", original, err)
	}

	q.AfterRecordID = correctedRecord.ID
	q.PageSize = 1
	diff, diffErr = ReadReleaseScopeDiff(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), q)
	if diffErr != nil || diff.Total != 1 || diff.Changed != 1 || diff.Added != 0 || diff.Removed != 0 || len(diff.Changes) != 1 || diff.Changes[0].Before.Title != originalTitle || diff.Changes[0].After.Title != "发布后不同内容" || diff.BeforeContentHash == diff.AfterContentHash {
		t.Fatalf("release correction diff %+v %v", diff, diffErr)
	}
	q.Page = 2
	diff, diffErr = ReadReleaseScopeDiff(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), q)
	if diffErr != nil || diff.Total != 1 || diff.Changed != 1 || len(diff.Changes) != 0 {
		t.Fatalf("release diff empty page %+v %v", diff, diffErr)
	}
	if _, err = db.Exec(`UPDATE product_version_features SET title='再次变化但未发布' WHERE version_id=?`, versionID); err != nil {
		t.Fatal(err)
	}
	q.Page = 1
	diff, diffErr = ReadReleaseScopeDiff(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), q)
	if diffErr != nil || len(diff.Changes) != 1 || diff.Changes[0].After.Title != "发布后不同内容" {
		t.Fatalf("release diff used live scope %+v %v", diff, diffErr)
	}

	first, err := ListProductVersionReleases(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), versionID, PlanningPageQuery{Page: 1, PageSize: 1})
	if err != nil || first.Total != 2 || len(first.Items) != 1 || first.Items[0].ID != correctedRecord.ID || !first.Items[0].Current || first.Items[0].SupersedesRecordID == nil || *first.Items[0].SupersedesRecordID != result.ID {
		t.Fatalf("release first page: %+v %v", first, err)
	}
	second, err := ListProductVersionReleases(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), versionID, PlanningPageQuery{Page: 2, PageSize: 1})
	if err != nil || second.Total != 2 || len(second.Items) != 1 || second.Items[0].ID != result.ID || !second.Items[0].Withdrawn || !second.Items[0].Superseded || second.Items[0].Current {
		t.Fatalf("release second page: %+v %v", second, err)
	}
	empty, err := ListProductVersionReleases(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "view"), versionID, PlanningPageQuery{Page: 3, PageSize: 1})
	if err != nil || empty.Total != 2 || len(empty.Items) != 0 {
		t.Fatalf("release empty page: %+v %v", empty, err)
	}
	if _, err = ListProductVersionReleases(ctx, db, "P-ACCEPT", "publisher", permit("publisher", "publish"), versionID, PlanningPageQuery{Page: 1, PageSize: 1}); err == nil {
		t.Fatal("wrong action listed releases")
	}

	exerciseVersionArchive(t, db, versionID, correctedRecord.ID)
}

func TestVersionReleaseContentHashCanonical(t *testing.T) {
	a, err := versionReleaseContentHash(json.RawMessage(`{"z":9007199254740993,"a":{"b":2,"a":1}}`), json.RawMessage(`[]`))
	if err != nil {
		t.Fatal(err)
	}
	b, err := versionReleaseContentHash(json.RawMessage(`{"a":{"a":1,"b":2},"z":9007199254740993}`), json.RawMessage(`[]`))
	if err != nil || a != b {
		t.Fatalf("key order changed hash: %s %s %v", a, b, err)
	}
	c, err := versionReleaseContentHash(json.RawMessage(`{"a":{"a":1,"b":2},"z":9007199254740992}`), json.RawMessage(`[]`))
	if err != nil || a == c {
		t.Fatalf("integer precision lost: %s %s %v", a, c, err)
	}
}
