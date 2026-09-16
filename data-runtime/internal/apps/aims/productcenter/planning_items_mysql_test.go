package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
)

func TestMySQLPlanningItemCreateSourcesAndAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-PLAN")
	ctx := context.Background()
	permit := func(resource, action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-PLAN", "pm", action)
		p.Resource = resource
		return p
	}
	created, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-PLAN", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "request"}, permit("product_requests", "create"), RequestDraft{ExpectedRevision: 1, Title: "统一身份", ProblemStatement: "重复登录", SourceType: "internal", UrgencyLevel: "P2"})
	if err != nil {
		t.Fatal(err)
	}
	var request struct {
		BizID string `json:"biz_id"`
	}
	if err := json.Unmarshal(created.Value, &request); err != nil {
		t.Fatal(err)
	}
	input := PlanningItemDraft{ExpectedRevision: 2, Title: "增加 OIDC 支持", ScopeSummary: "本次实现标准身份登录与退出", InvestmentCategory: "usability", UrgencyLevel: "P2", Requests: []PlanningRequestRef{{BizID: request.BizID, Revision: 1}}}
	identity := CommandIdentity{ProductCode: "P-PLAN", ActorUID: "pm", Action: "product_priorities:create", IdempotencyKey: "item"}
	_, err = CreatePlanningItem(ctx, db, identity, permit("product_requests", "edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	bad := input
	bad.Requests = []PlanningRequestRef{{BizID: request.BizID, Revision: 99}}
	_, err = CreatePlanningItem(ctx, db, identity, permit("product_priorities", "edit"), bad)
	requireProductRule(t, err, "product_request_revision_conflict")
	bad.Requests = []PlanningRequestRef{input.Requests[0], input.Requests[0]}
	_, err = CreatePlanningItem(ctx, db, identity, permit("product_priorities", "edit"), bad)
	requireProductRule(t, err, "product_planning_sources_invalid")
	workspaceFixture(t, db, "P-FOREIGN")
	foreignPermit := workspacePermit(t, db, "P-FOREIGN", "pm", "create")
	foreignPermit.Resource = "product_requests"
	foreign, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-FOREIGN", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "foreign"}, foreignPermit, RequestDraft{ExpectedRevision: 1, Title: "其他产品需求", ProblemStatement: "不允许跨产品关联", SourceType: "internal", UrgencyLevel: "P2"})
	if err != nil {
		t.Fatal(err)
	}
	var foreignRequest struct {
		BizID string `json:"biz_id"`
	}
	if err := json.Unmarshal(foreign.Value, &foreignRequest); err != nil {
		t.Fatal(err)
	}
	bad.Requests = []PlanningRequestRef{input.Requests[0], {BizID: foreignRequest.BizID, Revision: 1}}
	_, err = CreatePlanningItem(ctx, db, identity, permit("product_priorities", "edit"), bad)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("foreign source: %v", err)
	}
	for _, table := range []string{"product_planning_items", "product_planning_item_requests"} {
		var total int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&total); err != nil || total != 0 {
			t.Fatalf("partial %s %d %v", table, total, err)
		}
	}
	if _, err := db.Exec(`CREATE TRIGGER pc_fail_planning BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = CreatePlanningItem(ctx, db, identity, permit("product_priorities", "edit"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_planning_items`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rollback count %d %v", count, err)
	}
	if _, err := db.Exec(`DROP TRIGGER pc_fail_planning`); err != nil {
		t.Fatal(err)
	}
	result, err := CreatePlanningItem(ctx, db, identity, permit("product_priorities", "edit"), input)
	if err != nil {
		t.Fatal(err)
	}
	var item struct {
		BizID string `json:"biz_id"`
	}
	if err := json.Unmarshal(result.Value, &item); err != nil {
		t.Fatal(err)
	}
	detail, err := ReadPlanningItem(ctx, db, "P-PLAN", "pm", item.BizID, permit("product_priorities", "view"))
	if err != nil || detail.Revision != 1 || detail.WorkspaceRevision != 3 || len(detail.Requests) != 1 || detail.Requests[0].BizID != request.BizID {
		t.Fatalf("detail %+v %v", detail, err)
	}
	foreignView := workspacePermit(t, db, "P-FOREIGN", "pm", "view")
	foreignView.Resource = "product_priorities"
	_, err = ReadPlanningItem(ctx, db, "P-FOREIGN", "pm", item.BizID, foreignView)
	if !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("cross product detail: %v", err)
	}
	if len(result.Value) == 0 {
		t.Fatal("missing result")
	}
	replay, err := CreatePlanningItem(ctx, db, identity, permit("product_priorities", "edit"), input)
	if err != nil || !replay.Replayed {
		t.Fatalf("replay %+v %v", replay, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_planning_item_requests`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("source count %d %v", count, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM product_planning_cycle_items`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("unexpected selection %d %v", count, err)
	}
	input.ExpectedRevision = 3
	input.Requests = nil
	identity.IdempotencyKey = "engineering"
	input.InvestmentCategory = "reliability"
	if _, err = CreatePlanningItem(ctx, db, identity, permit("product_priorities", "edit"), input); err != nil {
		t.Fatalf("no customer source required: %v", err)
	}
	page, err := ListPlanningItems(ctx, db, "P-PLAN", "pm", permit("product_priorities", "view"), PlanningPageQuery{Page: 1, PageSize: 1})
	if err != nil || page.Total != 2 || len(page.Items) != 1 || page.Items[0].InvestmentCategory != "reliability" || page.Items[0].Deadline != nil || page.WorkspaceRevision != 4 {
		t.Fatalf("planning page %+v %v", page, err)
	}
	filtered, err := ListPlanningItems(ctx, db, "P-PLAN", "pm", permit("product_priorities", "view"), PlanningPageQuery{Page: 1, PageSize: 10, InvestmentCategory: "usability", Lifecycle: "proposed", Keyword: "OIDC"})
	if err != nil || filtered.Total != 1 || len(filtered.Items) != 1 {
		t.Fatalf("filtered %+v %v", filtered, err)
	}
	empty, err := ListPlanningItems(ctx, db, "P-PLAN", "pm", permit("product_priorities", "view"), PlanningPageQuery{Page: 1, PageSize: 10, Keyword: "%_"})
	if err != nil || empty.Total != 0 || empty.Items == nil {
		t.Fatalf("literal empty %+v %v", empty, err)
	}
	_, err = ListPlanningItems(ctx, db, "P-PLAN", "pm", permit("product_requests", "view"), PlanningPageQuery{Page: 1, PageSize: 10})
	requireProductRule(t, err, "product_authorization_invalid")

	edit := PlanningItemEdit{PlanningItemDraft: PlanningItemDraft{ExpectedRevision: 4, Title: "缩小 OIDC 范围", ScopeSummary: "本次仅登录，退出后续安排", InvestmentCategory: "usability", UrgencyLevel: "P2", Requests: []PlanningRequestRef{}}, BizID: item.BizID, ExpectedItemRevision: 1, Reason: "明确边界"}
	editIdentity := CommandIdentity{ProductCode: "P-PLAN", ActorUID: "pm", Action: "product_priorities:edit", IdempotencyKey: "edit-item"}
	if _, err := db.Exec(`CREATE TRIGGER pc_fail_planning_edit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failed'`); err != nil {
		t.Fatal(err)
	}
	if _, err = EditPlanningItem(ctx, db, editIdentity, permit("product_priorities", "edit"), edit); err == nil {
		t.Fatal("edit audit failure committed")
	}
	original, err := ReadPlanningItem(ctx, db, "P-PLAN", "pm", item.BizID, permit("product_priorities", "view"))
	if err != nil || original.Revision != 1 || len(original.Requests) != 1 {
		t.Fatalf("edit rollback %+v %v", original, err)
	}
	if _, err := db.Exec(`DROP TRIGGER pc_fail_planning_edit`); err != nil {
		t.Fatal(err)
	}
	if _, err = EditPlanningItem(ctx, db, editIdentity, permit("product_priorities", "edit"), edit); err != nil {
		t.Fatal(err)
	}
	edited, err := ReadPlanningItem(ctx, db, "P-PLAN", "pm", item.BizID, permit("product_priorities", "view"))
	if err != nil || edited.Revision != 2 || edited.ScopeRevision != 2 || edited.EvidenceRevision != 2 || edited.WorkspaceRevision != 5 || len(edited.Requests) != 0 {
		t.Fatalf("edited %+v %v", edited, err)
	}
	replayed, err := EditPlanningItem(ctx, db, editIdentity, permit("product_priorities", "edit"), edit)
	if err != nil || !replayed.Replayed {
		t.Fatalf("edit replay %+v %v", replayed, err)
	}

	edit.ExpectedRevision = 5
	edit.ExpectedItemRevision = 2
	editIdentity.IdempotencyKey = "same-facts"
	if _, err = EditPlanningItem(ctx, db, editIdentity, permit("product_priorities", "edit"), edit); err != nil {
		t.Fatal(err)
	}
	unchanged, err := ReadPlanningItem(ctx, db, "P-PLAN", "pm", item.BizID, permit("product_priorities", "view"))
	if err != nil || unchanged.Revision != 2 || unchanged.WorkspaceRevision != 5 || unchanged.ScopeRevision != 2 || unchanged.EvidenceRevision != 2 {
		t.Fatalf("no-op changed versions %+v %v", unchanged, err)
	}

}

func TestMySQLPlanningImpactHintMatchesEditGate(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-IMPACT")
	id := planningFixture(t, db, "P-IMPACT")
	var bizID string
	if err := db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, id).Scan(&bizID); err != nil {
		t.Fatal(err)
	}
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-IMPACT", "pm", action)
		p.Resource = "product_priorities"
		return p
	}
	ctx := context.Background()
	read := func(want bool) PlanningItemDetail {
		t.Helper()
		out, err := ReadPlanningItem(ctx, db, "P-IMPACT", "pm", bizID, permit("view"))
		if err != nil || out.RequiresImpactNote != want {
			t.Fatalf("impact hint %+v: %v, want %v", out, err, want)
		}
		return out
	}
	read(false)
	result, err := db.Exec(`INSERT INTO product_planning_cycles (biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,created_by,updated_by,created_at,updated_at) VALUES (UUID(),'P-IMPACT','周期','2026-09-01','2026-09-30','目标','{}','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`)
	if err != nil {
		t.Fatal(err)
	}
	cycleID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO product_planning_cycle_items(cycle_id,planning_item_id,product_code,selection_status,decision_rank) VALUES (?,?,'P-IMPACT','candidate',1)`, cycleID, id); err != nil {
		t.Fatal(err)
	}
	read(false)
	if _, err := db.Exec(`UPDATE product_planning_cycle_items SET selection_status='selected' WHERE cycle_id=?`, cycleID); err != nil {
		t.Fatal(err)
	}
	selected := read(true)
	input := PlanningItemEdit{PlanningItemDraft: PlanningItemDraft{ExpectedRevision: selected.WorkspaceRevision, Title: selected.Title + "修改", ScopeSummary: selected.ScopeSummary, InvestmentCategory: selected.InvestmentCategory, UrgencyLevel: selected.UrgencyLevel, Requests: []PlanningRequestRef{}}, BizID: bizID, ExpectedItemRevision: selected.Revision, Reason: "调整标题"}
	_, err = EditPlanningItem(ctx, db, CommandIdentity{ProductCode: "P-IMPACT", ActorUID: "pm", Action: "product_priorities:edit", IdempotencyKey: "missing-impact"}, permit("edit"), input)
	requireProductRule(t, err, "product_planning_impact_required")
	if _, err := db.Exec(`UPDATE product_planning_cycle_items SET selection_status='deferred' WHERE cycle_id=?`, cycleID); err != nil {
		t.Fatal(err)
	}
	read(false)
	if _, err := db.Exec(`UPDATE product_planning_items SET lifecycle='in_delivery' WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	read(true)
}
