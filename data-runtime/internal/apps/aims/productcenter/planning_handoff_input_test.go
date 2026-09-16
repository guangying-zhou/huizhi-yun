package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func handoffInput() PlanningHandoffInput {
	return PlanningHandoffInput{PlanningDeliveryCheck: PlanningDeliveryCheck{ItemBizID: "00000000-0000-4000-8000-000000000001", CycleBizID: "00000000-0000-4000-8000-000000000002", ExpectedRevision: 1, ExpectedItemRevision: 1, ExpectedCycleRevision: 1, ExpectedQueueRevision: 1}, ProjectCode: "PRJ", SliceKey: "default", Operation: "create", Title: "登录能力", ScopeSummary: "OIDC 登录与退出", Reason: "确认本期交付"}
}
func TestPlanningHandoffInputBoundaries(t *testing.T) {
	valid := handoffInput()
	if err := ValidatePlanningHandoffInput(valid); err != nil {
		t.Fatal(err)
	}
	linked := valid
	linked.Operation = "link"
	linked.RequirementID = 42
	linked.Title = ""
	if err := ValidatePlanningHandoffInput(linked); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*PlanningHandoffInput){
		"missing-version":               func(i *PlanningHandoffInput) { i.ExpectedRevision = 0 },
		"source-version-without-source": func(i *PlanningHandoffInput) { i.ExpectedRequestRevision = 1 },
		"source-missing-version":        func(i *PlanningHandoffInput) { i.RequestBizID = i.ItemBizID },
		"slice-padding":                 func(i *PlanningHandoffInput) { i.SliceKey = " default" },
		"project-control":               func(i *PlanningHandoffInput) { i.ProjectCode = "P\nR" },
		"create-with-existing":          func(i *PlanningHandoffInput) { i.RequirementID = 42 },
		"link-without-existing":         func(i *PlanningHandoffInput) { i.Operation = "link"; i.Title = "" },
		"link-overwrites-title":         func(i *PlanningHandoffInput) { i.Operation = "link"; i.RequirementID = 42 },
		"scope-truncation":              func(i *PlanningHandoffInput) { i.ScopeSummary = strings.Repeat("界", 2001) },
		"orphan-version-feature":        func(i *PlanningHandoffInput) { i.PlannedVersionFeatureID = 1 },
	} {
		t.Run(name, func(t *testing.T) {
			input := valid
			change(&input)
			if ValidatePlanningHandoffInput(input) == nil {
				t.Fatal("accepted invalid handoff")
			}
		})
	}
}

func TestMySQLPlanningHandoffSourceBinding(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-HANDOFF")
	ctx := context.Background()
	itemID := planningFixture(t, db, "P-HANDOFF")
	input := handoffInput()
	if err := db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, itemID).Scan(&input.ItemBizID); err != nil {
		t.Fatal(err)
	}
	resolve := func() (*PlanningHandoffSource, error) {
		t.Helper()
		p := workspacePermit(t, db, "P-HANDOFF", "pm", "handoff")
		p.Resource = "product_priorities"
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		if err = AuthorizeWorkspaceTransaction(ctx, tx, "P-HANDOFF", "pm", "product_priorities", "handoff", p); err != nil {
			t.Fatal(err)
		}
		return ResolvePlanningHandoffSourceTx(ctx, tx, "P-HANDOFF", input)
	}
	if source, err := resolve(); err != nil || source != nil {
		t.Fatalf("engineering source: %+v %v", source, err)
	}
	p := workspacePermit(t, db, "P-HANDOFF", "pm", "create")
	p.Resource = "product_requests"
	result, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-HANDOFF", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "source"}, p, RequestDraft{ExpectedRevision: 1, Title: "统一身份", ProblemStatement: "重复登录", SourceType: "internal", UrgencyLevel: "P2"})
	if err != nil {
		t.Fatal(err)
	}
	var request struct {
		ID    int64  `json:"id"`
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(result.Value, &request); err != nil {
		t.Fatal(err)
	}
	input.RequestBizID = request.BizID
	input.ExpectedRequestRevision = 1
	if _, err = resolve(); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("unrelated request: %v", err)
	}
	if _, err = db.Exec(`INSERT INTO product_planning_item_requests(product_code,planning_item_id,request_id,created_by,created_at) VALUES ('P-HANDOFF',?,?,'pm',UTC_TIMESTAMP(3))`, itemID, request.ID); err != nil {
		t.Fatal(err)
	}
	source, err := resolve()
	if err != nil || source.ID != request.ID || source.Title != "统一身份" {
		t.Fatalf("source: %+v %v", source, err)
	}
	input.ExpectedRequestRevision = 2
	_, err = resolve()
	requireProductRule(t, err, "product_request_revision_conflict")
	input.RequestBizID = ""
	input.ExpectedRequestRevision = 0
	_, err = resolve()
	requireProductRule(t, err, "planning_handoff_source_required")
	input.RequestBizID = request.BizID
	input.ExpectedRequestRevision = 1
	if _, err = db.Exec(`UPDATE product_requests SET decision_status='merged' WHERE id=?`, request.ID); err != nil {
		t.Fatal(err)
	}
	_, err = resolve()
	requireProductRule(t, err, "product_request_merged_readonly")
}
