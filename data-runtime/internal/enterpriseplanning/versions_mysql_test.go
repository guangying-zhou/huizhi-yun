package enterpriseplanning

import (
	"context"
	"github.com/google/uuid"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
	"time"
)

func TestMySQLVersionLifecyclePreservesTransactionsFeedbackAndReleaseFacts(t *testing.T) {
	db, registry, b := planningMySQLFixture(t)
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("ALTER TABLE u_product_versions ADD CONSTRAINT test_version_release FOREIGN KEY(current_release_record_id,id) REFERENCES u_product_release_records(id,version_id)")
	exec("INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P',?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString())
	exec("INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	for i, status := range []string{"planning", "released", "released", "planning", "planning"} {
		exec("INSERT INTO product_versions(id,product_code,version_code,status) VALUES(?,'P',?,?)", i+1, "v"+string(rune('1'+i)), status)
	}
	// Explicit imported history, not a fabricated verified publish receipt.
	for _, version := range []int{2, 3} {
		exec("INSERT INTO product_release_records(id,biz_id,version_id,release_seq,scope_revision,scope_snapshot,acceptance_snapshot,content_hash,evidence_level,recorded_at) VALUES(?,UUID(),?,1,1,JSON_OBJECT(),JSON_OBJECT(),REPEAT('a',64),'legacy_import',UTC_TIMESTAMP(3))", version, version)
		exec("UPDATE product_versions SET current_release_record_id=?,released_at=UTC_TIMESTAMP(3) WHERE id=?", version, version)
	}
	exec("UPDATE product_versions SET planning_mode='simple' WHERE id=5")
	exec("INSERT INTO product_version_plans(version_id,product_code,goal,created_by,updated_by,created_at,updated_at) VALUES(5,'P','Unconfirmed','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec("INSERT INTO product_requests(id,biz_id,product_code,title,decision_status,created_by,updated_by,created_at,updated_at) VALUES(1,UUID(),'P','Feedback','accepted','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec("INSERT INTO product_request_sources(id,request_id,source_type,source_note,created_by,updated_by,created_at,updated_at) VALUES(1,1,'service_ticket','Feedback','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec("INSERT INTO product_feedback_bindings(source_app,source_type,source_biz_id,product_code,request_id,source_id,created_by,created_at) VALUES('altoc','service_ticket','ST-1','P',1,1,'pm',UTC_TIMESTAMP(3))")
	exec("INSERT INTO product_features(id,biz_id,product_code,title,created_by,updated_by,created_at,updated_at) VALUES(1,UUID(),'P','Visible','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
	exec("INSERT INTO product_request_features(product_code,request_id,product_feature_id,created_by,created_at) VALUES('P',1,1,'pm',UTC_TIMESTAMP(3))")
	for _, version := range []int{1, 2, 3} {
		exec("INSERT INTO product_version_features(version_id,product_feature_id,title,status,is_public) VALUES(?,1,'Visible','delivered',1)", version)
	}
	exec("DROP VIEW integration_operation")
	exec("CREATE TABLE integration_operation LIKE u_integration_operation")
	unbound, err := NewVersionService(ctx, registry, b)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := registry.Resolve(unbound.writer)
	if err != nil {
		t.Fatal(err)
	}
	source, err := e.NewOutboundSource(unbound.writer, resolved, "actual-aims-worker", "aims.runtime")
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewVersionService(ctx, registry, b, source)
	if err != nil {
		t.Fatal(err)
	}
	permit := func(action string) pc.AuthorizationPermit {
		facts, err := pc.LoadAuthorizationFacts(ctx, db, "P", "pm")
		if err != nil {
			t.Fatal(err)
		}
		return pc.AuthorizationPermit{Resource: "product_versions", Action: action, Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	}
	id := func(action string) pc.CommandIdentity {
		return pc.CommandIdentity{ProductCode: "P", ActorUID: "pm", Action: "product_versions:" + action, IdempotencyKey: action}
	}
	state := func() string {
		var v string
		if err = db.QueryRow("SELECT CONCAT((SELECT revision FROM product_workspaces WHERE product_code='P'),':',(SELECT COUNT(*) FROM product_command_receipts),':',(SELECT COUNT(*) FROM product_activity_logs),':',(SELECT COUNT(*) FROM u_integration_operation),':',(SELECT COUNT(*) FROM product_release_events),':',(SELECT GROUP_CONCAT(CONCAT(id,'/',status,'/',revision,'/',scope_revision,'/',COALESCE(current_release_record_id,0)) ORDER BY id) FROM product_versions))").Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	verify := func(call, old func() (pc.CommandResult, error)) {
		t.Helper()
		before := state()
		exec("CREATE TRIGGER version_late BEFORE INSERT ON u_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late audit'")
		if _, err = call(); err == nil {
			t.Fatal("late error accepted")
		}
		if after := state(); after != before {
			t.Fatal("partial lifecycle/outbox", before, after)
		}
		exec("DROP TRIGGER version_late")
		saved, err := call()
		if err != nil {
			t.Fatal(err)
		}
		before = state()
		replay, err := old()
		if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
			t.Fatal("old replay", err)
		}
		if after := state(); after != before {
			t.Fatal("replay changed facts")
		}
	}
	edit := pc.ProductVersionEdit{VersionID: 1, ExpectedVersionRevision: 1, Reason: "clarify", ProductVersionDraft: pc.ProductVersionDraft{ExpectedRevision: 1, VersionCode: "v1", Name: "Updated", PlannedReleaseDate: "2099-01-01"}}
	if _, err = unbound.Edit(ctx, id("edit"), permit("edit"), edit); err == nil {
		t.Fatal("feedback dropped without worker")
	}
	verify(func() (pc.CommandResult, error) { return service.Edit(ctx, id("edit"), permit("edit"), edit) }, func() (pc.CommandResult, error) {
		return pc.EditProductCenterVersion(ctx, db, id("edit"), permit("edit"), edit)
	})
	transition := pc.ProductVersionTransitionInput{VersionID: 1, ExpectedRevision: 2, ExpectedVersionRevision: 2, ToStatus: "developing", Reason: "start"}
	verify(func() (pc.CommandResult, error) {
		return service.Transition(ctx, id("transition"), permit("edit"), transition)
	}, func() (pc.CommandResult, error) {
		return pc.TransitionProductVersion(ctx, db, id("transition"), permit("edit"), transition)
	})
	if _, err = service.Transition(ctx, pc.CommandIdentity{ProductCode: "P", ActorUID: "pm", Action: "product_versions:transition", IdempotencyKey: "unconfirmed"}, permit("edit"), pc.ProductVersionTransitionInput{VersionID: 5, ExpectedRevision: 3, ExpectedVersionRevision: 1, ToStatus: "developing", Reason: "start"}); err == nil {
		t.Fatal("unconfirmed simple plan entered development")
	}
	archive := pc.ProductVersionArchiveInput{VersionID: 2, ExpectedRevision: 3, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1, Reason: "maintenance ended"}
	verify(func() (pc.CommandResult, error) {
		return service.Archive(ctx, id("archive"), permit("archive"), archive)
	}, func() (pc.CommandResult, error) {
		return pc.ArchiveProductVersion(ctx, db, id("archive"), permit("archive"), archive)
	})
	reopen := pc.ProductVersionReopenInput{VersionID: 3, ReleaseRecordID: 3, ExpectedRevision: 4, ExpectedVersionRevision: 1, Reason: "correct"}
	verify(func() (pc.CommandResult, error) { return service.Reopen(ctx, id("reopen"), permit("reopen"), reopen) }, func() (pc.CommandResult, error) {
		return pc.ReopenProductVersion(ctx, db, id("reopen"), permit("reopen"), reopen)
	})
	remove := pc.ProductVersionDeleteInput{VersionID: 4, ExpectedRevision: 5, ExpectedVersionRevision: 1, ExpectedScopeRevision: 1, Reason: "unused"}
	exec("INSERT INTO product_version_features(version_id,title,status) VALUES(4,'Reference','planned')")
	if _, err = service.Delete(ctx, id("delete"), permit("delete"), remove); err == nil {
		t.Fatal("referenced version deleted")
	}
	exec("DELETE FROM product_version_features WHERE version_id=4")
	verify(func() (pc.CommandResult, error) { return service.Delete(ctx, id("delete"), permit("delete"), remove) }, func() (pc.CommandResult, error) {
		return pc.DeleteProductCenterVersion(ctx, db, id("delete"), permit("delete"), remove)
	})
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM u_integration_operation WHERE deployment_code='actual-aims-worker' AND operation_code='aims.altoc.product-feedback.update-progress.v1'").Scan(&count); err != nil || count != 4 {
		t.Fatal("feedback events", count, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM integration_operation").Scan(&count); err != nil || count != 0 {
		t.Fatal("wrong outbox", count, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM product_release_records WHERE content_hash=REPEAT('a',64) AND evidence_level='legacy_import'").Scan(&count); err != nil || count != 2 {
		t.Fatal("rewrote imported history", count, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM product_release_events WHERE release_record_id=3 AND event_type='withdrawn'").Scan(&count); err != nil || count != 1 {
		t.Fatal("missing withdrawal", count, err)
	}
}
