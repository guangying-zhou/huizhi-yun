package productcenter

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"
)

func TestMySQLRoadmapSavedViewStorage(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	windowMigration, e := os.ReadFile("../../../../../aims/docs/migration_v5.25_planning_roadmap_windows.sql")
	if e != nil {
		t.Fatal(e)
	}
	executeSQLScript(t, db, string(windowMigration))
	workspaceFixture(t, db, "P-VIEW")
	workspaceFixture(t, db, "P-OTHER")
	result, err := db.Exec(`INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,created_by,updated_by,created_at,updated_at) VALUES(UUID(),'P-VIEW','周期','2026-01-01','2026-12-31','目标',JSON_OBJECT(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	cycleID, _ := result.LastInsertId()
	insert := `INSERT INTO product_roadmap_saved_views(biz_id,product_code,cycle_id,owner_uid,title,audience,visibility,roadmap_year,roadmap_quarter,created_by,updated_by,created_at,updated_at) VALUES(UUID(),?,?,?,?,?,?,?,?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`
	if _, err = db.Exec(insert, "P-VIEW", cycleID, "pm", "季度交付", "delivery", "personal", 2026, 4); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]any{
		{"P-OTHER", cycleID, "pm", "跨产品", "delivery", "personal", 2026, 4},
		{"P-VIEW", cycleID, "", "无创建者", "delivery", "personal", 2026, 4},
		{"P-VIEW", cycleID, "pm", " ", "delivery", "personal", 2026, 4},
		{"P-VIEW", cycleID, "pm", "越界", "admin", "personal", 2026, 4},
		{"P-VIEW", cycleID, "pm", "越界", "delivery", "public", 2026, 4},
		{"P-VIEW", cycleID, "pm", "越界", "delivery", "product", 2026, 5},
	} {
		if _, err = db.Exec(insert, args...); err == nil {
			t.Fatalf("invalid view persisted: %v", args)
		}
	}
	script, err := os.ReadFile("../../../../../aims/docs/migration_v5.32_roadmap_saved_views.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(script))
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM product_roadmap_saved_views").Scan(&count); err != nil || count != 1 {
		t.Fatalf("repeat migration lost view %d %v", count, err)
	}
	var cycleBiz string
	if err = db.QueryRow("SELECT biz_id FROM product_planning_cycles WHERE id=?", cycleID).Scan(&cycleBiz); err != nil {
		t.Fatal(err)
	}
	permits := func(action string) (AuthorizationPermit, AuthorizationPermit) {
		planning := workspacePermit(t, db, "P-VIEW", "pm", "view")
		planning.Resource = "product_priorities"
		roadmap := workspacePermit(t, db, "P-VIEW", "pm", action)
		roadmap.Resource = "product_roadmaps"
		return planning, roadmap
	}
	identity := CommandIdentity{ProductCode: "P-VIEW", ActorUID: "pm", Action: "product_roadmaps:view-create", IdempotencyKey: "view-create"}
	input := RoadmapSavedViewCreate{ExpectedRevision: 1, Definition: RoadmapSavedViewDefinition{Title: "个人路线", Audience: "planning", Visibility: "personal", CycleBizID: cycleBiz, Year: 2026, Quarter: 4}}
	planning, roadmap := permits("view")
	if _, err = db.Exec("CREATE TRIGGER reject_view_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit unavailable'"); err != nil {
		t.Fatal(err)
	}
	if _, err = CreateRoadmapSavedView(context.Background(), db, identity, planning, roadmap, input); err == nil {
		t.Fatal("view audit failure accepted")
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM product_roadmap_saved_views").Scan(&count); err != nil || count != 1 {
		t.Fatal("failed view persisted", err)
	}
	if _, err = db.Exec("DROP TRIGGER reject_view_audit"); err != nil {
		t.Fatal(err)
	}
	saved, err := CreateRoadmapSavedView(context.Background(), db, identity, planning, roadmap, input)
	if err != nil {
		t.Fatal(err)
	}
	planning, roadmap = permits("view")
	replay, err := CreateRoadmapSavedView(context.Background(), db, identity, planning, roadmap, input)
	if err != nil || !replay.Replayed || saved.ReceiptID != replay.ReceiptID {
		t.Fatalf("view replay %+v %v", replay, err)
	}
	input.ExpectedRevision, input.Definition.Visibility = 2, "product"
	identity.IdempotencyKey = "shared-view"
	if _, err = CreateRoadmapSavedView(context.Background(), db, identity, planning, roadmap, input); err == nil {
		t.Fatal("view permit created shared definition")
	}
	planning, roadmap = permits("edit")
	if _, err = CreateRoadmapSavedView(context.Background(), db, identity, planning, roadmap, input); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM product_roadmap_saved_views WHERE owner_uid='pm'").Scan(&count); err != nil || count != 3 {
		t.Fatalf("view count %d %v", count, err)
	}

	// Another owner's private definition must affect neither rows nor total.
	if _, err = db.Exec(insert, "P-VIEW", cycleID, "other", "其他人的个人视图", "planning", "personal", 2026, 4); err != nil {
		t.Fatal(err)
	}
	planning, roadmap = permits("view")
	views, err := ListRoadmapSavedViews(context.Background(), db, "P-VIEW", "pm", planning, roadmap, 1, 2)
	if err != nil || views.Total != 3 || len(views.Items) != 2 || views.WorkspaceRevision != 3 {
		t.Fatalf("view list %+v %v", views, err)
	}
	for _, view := range views.Items {
		if view.OwnerUID != "pm" {
			t.Fatal("private view leaked")
		}
	}
	second, err := ListRoadmapSavedViews(context.Background(), db, "P-VIEW", "pm", planning, roadmap, 2, 2)
	if err != nil || second.Total != 3 || len(second.Items) != 1 || second.Items[0].BizID == views.Items[0].BizID {
		t.Fatalf("view pagination %+v %v", second, err)
	}
	empty, err := ListRoadmapSavedViews(context.Background(), db, "P-VIEW", "pm", planning, roadmap, 3, 2)
	if err != nil || empty.Total != 3 || len(empty.Items) != 0 {
		t.Fatalf("empty view page %+v %v", empty, err)
	}
	if _, err = ListRoadmapSavedViews(context.Background(), db, "P-VIEW", "pm", planning, roadmap, 1, 101); err == nil {
		t.Fatal("unbounded view list accepted")
	}
	wrong := roadmap
	wrong.Resource = "product_priorities"
	if _, err = ListRoadmapSavedViews(context.Background(), db, "P-VIEW", "pm", planning, wrong, 1, 20); err == nil {
		t.Fatal("missing roadmap authorization accepted")
	}

	if _, err = db.Exec(insert, "P-VIEW", cycleID, "other", "其他人的共享视图", "stakeholder", "product", 2026, 4); err != nil {
		t.Fatal(err)
	}
	shared, err := ListRoadmapSavedViews(context.Background(), db, "P-VIEW", "pm", planning, roadmap, 1, 20)
	if err != nil || shared.Total != 4 || len(shared.Items) != 4 || shared.Items[0].OwnerUID != "other" || shared.Items[0].Definition.Visibility != "product" {
		t.Fatalf("shared view missing %+v %v", shared, err)
	}

	var leaked int
	if err = db.QueryRow("SELECT COUNT(*) FROM product_activity_logs WHERE object_type='roadmap_saved_view' AND JSON_UNQUOTE(JSON_EXTRACT(changes,'$.after.visibility'))='personal' AND JSON_CONTAINS_PATH(changes,'one','$.after.definition','$.after.title')").Scan(&leaked); err != nil || leaked != 0 {
		t.Fatalf("personal view audit leaked definition %d %v", leaked, err)
	}

	for _, record := range shared.Items {
		detail, e := ReadRoadmapSavedView(context.Background(), db, "P-VIEW", "pm", record.BizID, planning, roadmap)
		if e != nil || detail.BizID != record.BizID || detail.OwnerUID != record.OwnerUID || detail.Definition != record.Definition || detail.WorkspaceRevision != 3 {
			t.Fatalf("view detail %+v %v", detail, e)
		}
	}
	var privateID string
	if err = db.QueryRow("SELECT biz_id FROM product_roadmap_saved_views WHERE owner_uid='other' AND visibility='personal'").Scan(&privateID); err != nil {
		t.Fatal(err)
	}
	if _, err = ReadRoadmapSavedView(context.Background(), db, "P-VIEW", "pm", privateID, planning, roadmap); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("private detail disclosed existence: %v", err)
	}
	if _, err = ReadRoadmapSavedView(context.Background(), db, "P-VIEW", "pm", "bad", planning, roadmap); err == nil {
		t.Fatal("invalid view identity accepted")
	}
	if _, err = ReadRoadmapSavedView(context.Background(), db, "P-VIEW", "pm", shared.Items[0].BizID, planning, wrong); err == nil {
		t.Fatal("detail bypassed roadmap permission")
	}

	applied, err := ApplyRoadmapSavedView(context.Background(), db, "P-VIEW", "pm", shared.Items[0].BizID, planning, roadmap, 2, 10)
	if err != nil || applied.View.BizID != shared.Items[0].BizID || applied.Roadmap.CycleBizID != cycleBiz || applied.Roadmap.Year != 2026 || applied.Roadmap.Quarter != 4 || applied.Roadmap.Page != 2 || applied.Roadmap.PageSize != 10 || applied.Roadmap.WorkspaceRevision != 3 {
		t.Fatalf("applied view %+v %v", applied, err)
	}
	if _, err = ApplyRoadmapSavedView(context.Background(), db, "P-VIEW", "pm", privateID, planning, roadmap, 1, 20); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("private view applied: %v", err)
	}
	if _, err = ApplyRoadmapSavedView(context.Background(), db, "P-VIEW", "pm", shared.Items[0].BizID, planning, wrong, 1, 20); err == nil {
		t.Fatal("apply reused creator authorization")
	}

	own := shared.Items[1]
	updateInput := RoadmapSavedViewUpdate{BizID: own.BizID, ExpectedRevision: 3, ExpectedViewRevision: own.Revision, Definition: own.Definition}
	updateInput.Definition.Title = "更新后的共享视图"
	updateIdentity := CommandIdentity{ProductCode: "P-VIEW", ActorUID: "pm", Action: "product_roadmaps:view-update", IdempotencyKey: "view-update"}
	if _, err = UpdateRoadmapSavedView(context.Background(), db, updateIdentity, planning, roadmap, updateInput); err == nil {
		t.Fatal("view permission updated shared view")
	}
	planning, roadmap = permits("edit")
	updated, err := UpdateRoadmapSavedView(context.Background(), db, updateIdentity, planning, roadmap, updateInput)
	if err != nil {
		t.Fatal(err)
	}
	planning, roadmap = permits("edit")
	updatedReplay, err := UpdateRoadmapSavedView(context.Background(), db, updateIdentity, planning, roadmap, updateInput)
	if err != nil || !updatedReplay.Replayed || updatedReplay.ReceiptID != updated.ReceiptID {
		t.Fatalf("update replay %+v %v", updatedReplay, err)
	}
	planning, roadmap = permits("view")
	detail, err := ReadRoadmapSavedView(context.Background(), db, "P-VIEW", "pm", own.BizID, planning, roadmap)
	if err != nil || detail.Definition.Title != updateInput.Definition.Title || detail.Revision != 2 || detail.WorkspaceRevision != 4 || detail.OwnerUID != "pm" {
		t.Fatalf("updated view %+v %v", detail, err)
	}

	planning, roadmap = permits("edit")
	updateIdentity.IdempotencyKey = "stale-update"
	updateInput.ExpectedRevision = 4
	if _, err = UpdateRoadmapSavedView(context.Background(), db, updateIdentity, planning, roadmap, updateInput); err == nil {
		t.Fatal("stale view revision accepted")
	}
	updateIdentity.IdempotencyKey = "other-visibility"
	updateInput.BizID, updateInput.Definition, updateInput.ExpectedViewRevision = shared.Items[0].BizID, shared.Items[0].Definition, 1
	updateInput.Definition.Visibility = "personal"
	if _, err = UpdateRoadmapSavedView(context.Background(), db, updateIdentity, planning, roadmap, updateInput); err == nil {
		t.Fatal("nonowner changed shared visibility")
	}
	updateIdentity.IdempotencyKey = "other-private"
	updateInput.BizID = privateID
	if _, err = UpdateRoadmapSavedView(context.Background(), db, updateIdentity, planning, roadmap, updateInput); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("other private view update: %v", err)
	}

	deleteIdentity := CommandIdentity{ProductCode: "P-VIEW", ActorUID: "pm", Action: "product_roadmaps:view-delete", IdempotencyKey: "delete-view"}
	deleteInput := RoadmapSavedViewDelete{BizID: own.BizID, ExpectedRevision: 4, ExpectedViewRevision: 2}
	planning, roadmap = permits("edit")
	if _, err = db.Exec("CREATE TRIGGER reject_view_delete_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='delete audit unavailable'"); err != nil {
		t.Fatal(err)
	}
	if _, err = DeleteRoadmapSavedView(context.Background(), db, deleteIdentity, planning, roadmap, deleteInput); err == nil {
		t.Fatal("delete audit failure accepted")
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM product_roadmap_saved_views WHERE biz_id=? AND deleted_at IS NULL AND revision=2", own.BizID).Scan(&count); err != nil || count != 1 {
		t.Fatal("failed delete changed view", err)
	}
	if _, err = db.Exec("DROP TRIGGER reject_view_delete_audit"); err != nil {
		t.Fatal(err)
	}
	deleted, err := DeleteRoadmapSavedView(context.Background(), db, deleteIdentity, planning, roadmap, deleteInput)
	if err != nil {
		t.Fatal(err)
	}
	planning, roadmap = permits("edit")
	deleteReplay, err := DeleteRoadmapSavedView(context.Background(), db, deleteIdentity, planning, roadmap, deleteInput)
	if err != nil || !deleteReplay.Replayed || deleted.ReceiptID != deleteReplay.ReceiptID {
		t.Fatalf("delete replay %+v %v", deleteReplay, err)
	}
	planning, roadmap = permits("view")
	if _, err = DeleteRoadmapSavedView(context.Background(), db, deleteIdentity, planning, roadmap, deleteInput); err == nil {
		t.Fatal("delete replay bypassed current edit permission")
	}

	planning, roadmap = permits("view")
	visible, err := ListRoadmapSavedViews(context.Background(), db, "P-VIEW", "pm", planning, roadmap, 1, 20)
	if err != nil || visible.Total != 3 || len(visible.Items) != 3 {
		t.Fatalf("deleted view still listed %+v %v", visible, err)
	}
	if _, err = ReadRoadmapSavedView(context.Background(), db, "P-VIEW", "pm", own.BizID, planning, roadmap); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted detail visible: %v", err)
	}
	if _, err = ApplyRoadmapSavedView(context.Background(), db, "P-VIEW", "pm", own.BizID, planning, roadmap, 1, 20); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("deleted view applied: %v", err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM product_roadmap_saved_views WHERE biz_id=? AND deleted_at IS NOT NULL", own.BizID).Scan(&count); err != nil || count != 1 {
		t.Fatal("deletion erased identity", err)
	}

	var finalRoot, finalView int
	if err = db.QueryRow("SELECT revision FROM product_workspaces WHERE product_code='P-VIEW'").Scan(&finalRoot); err != nil || finalRoot != 5 {
		t.Fatalf("delete root revision %d %v", finalRoot, err)
	}
	if err = db.QueryRow("SELECT revision FROM product_roadmap_saved_views WHERE biz_id=?", own.BizID).Scan(&finalView); err != nil || finalView != 3 {
		t.Fatalf("delete view revision %d %v", finalView, err)
	}

}
