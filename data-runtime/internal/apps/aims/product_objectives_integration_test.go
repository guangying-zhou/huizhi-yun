package aims

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"testing"
	"time"
	"unsafe"
)

func TestMySQLProductObjectivesThroughRuntime(t *testing.T) {
	db := handoffMySQLDatabase(t)
	migrateHandoffProductCenter(t, db)
	script, err := os.ReadFile("../../../../aims/docs/migration_v5.22_product_objectives.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(script))
	correctionScript, err := os.ReadFile("../../../../aims/docs/migration_v5.23_objective_observation_corrections.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(correctionScript))
	mappingScript, err := os.ReadFile("../../../../aims/docs/migration_v5.24_objective_cycle_mappings.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(mappingScript))
	const code = "P-OBJECTIVE-RUNTIME"
	if _, err = db.Exec(`INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES(?,UUID(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES(?,'pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code); err != nil {
		t.Fatal(err)
	}
	adapter := &Adapter{Adapter: &compat.Adapter{}}
	field := reflect.ValueOf(adapter.Adapter).Elem().FieldByName("db")
	reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	ctx := context.Background()
	query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}}
	call := func(action, key string, input any) (any, error) {
		t.Helper()
		facts, err := productcenter.LoadAuthorizationFacts(ctx, db, code, "pm")
		if err != nil {
			t.Fatal(err)
		}
		permission := "edit"
		if action != "create" && action != "item-link" && action != "cycle-map" && action != "cycle-revoke" {
			permission = action
		}
		capability := action
		if action == "item-objectives" || action == "list" || action == "view" || action == "observations" || action == "items" || action == "cycles" {
			permission = "view"
			capability = "read"
		}
		query.Set("current_user_scopes", "aims:product-objectives:"+capability)
		body := map[string]any{"input": input, "idempotency_key": key, "authorization": productcenter.AuthorizationPermit{Resource: "product_objectives", Action: permission, Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
		if action == "item-objectives" {
			body["planning_authorization"] = productcenter.AuthorizationPermit{Resource: "product_priorities", Action: "view", Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
		}
		result, operation, err := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/objectives:"+action, query, body)
		if err != nil {
			return nil, err
		}
		envelope, ok := result.(map[string]any)
		if !ok || envelope["code"] != 0 || operation != "aims.product-objectives."+action {
			t.Fatalf("envelope %#v %s", result, operation)
		}
		return envelope["data"], nil
	}
	input := productcenter.ProductObjectiveDraft{Title: "降低失败率", StartsOn: "2026-09-01", EndsOn: "2026-12-31", OwnerUID: "pm", ExpectedRevision: 1, Metric: productcenter.ProductObjectiveMetric{Name: "失败率", Unit: "%", MeasurementDefinition: "失败次数/总次数", Direction: "decrease", BaselineValue: "5", TargetValue: "2"}}
	raw, err := call("create", "objective-create", input)
	if err != nil {
		t.Fatal(err)
	}
	saved := raw.(productcenter.CommandResult)
	var objective productcenter.ProductObjectiveRecord
	if err = json.Unmarshal(saved.Value, &objective); err != nil || objective.ID < 1 || objective.BizID == "" || objective.Metric.TargetValue != "2.000000" {
		t.Fatalf("saved %+v %v", objective, err)
	}
	raw, err = call("create", "objective-create", input)
	if err != nil {
		t.Fatal(err)
	}
	replay := raw.(productcenter.CommandResult)
	if !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay %+v", replay)
	}
	raw, err = call("list", "", map[string]any{"page": 1, "page_size": 10, "status": "draft"})
	if err != nil {
		t.Fatal(err)
	}
	page := raw.(productcenter.ProductObjectivePage)
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].BizID != objective.BizID || page.WorkspaceRevision != 2 {
		t.Fatalf("page %+v", page)
	}
	raw, err = call("view", "", map[string]any{"id": objective.ID})
	if err != nil {
		t.Fatal(err)
	}
	detail := raw.(productcenter.ProductObjectiveDetail)
	if detail.Objective != objective || detail.WorkspaceRevision != 2 {
		t.Fatalf("detail %+v want %+v", detail, objective)
	}
	_, err = call("create", "stale-create", input)
	var response httperror.Error
	if !errors.As(err, &response) || response.Status != 409 {
		t.Fatalf("stale create %v", err)
	}
	_, err = call("view", "", map[string]any{"id": objective.ID + 1})
	if !errors.As(err, &response) || response.Status != 404 {
		t.Fatalf("missing view %v", err)
	}

	transition := productcenter.ProductObjectiveTransition{ObjectiveID: objective.ID, ExpectedRevision: 2, ExpectedObjectiveRevision: 1, Action: "activate", Reason: "开始执行"}
	raw, err = call("activate", "activate", transition)
	if err != nil {
		t.Fatal(err)
	}
	activated := raw.(productcenter.CommandResult)
	raw, err = call("activate", "activate", transition)
	if err != nil || !raw.(productcenter.CommandResult).Replayed || raw.(productcenter.CommandResult).ReceiptID != activated.ReceiptID {
		t.Fatalf("activate replay %v", err)
	}
	observation := productcenter.ProductObjectiveObservation{ObjectiveID: objective.ID, ExpectedRevision: 3, ExpectedObjectiveRevision: 2, ObservedOn: "2026-09-01", MeasuredValue: "4.5", Evidence: "登录统计"}
	raw, err = call("observe", "observe", observation)
	if err != nil {
		t.Fatal(err)
	}
	observed := raw.(productcenter.CommandResult)
	var result struct {
		Attainment string `json:"attainment_percent"`
	}
	if err = json.Unmarshal(observed.Value, &result); err != nil || result.Attainment != "16.666667" {
		t.Fatalf("observation %+v %v", result, err)
	}
	raw, err = call("observe", "observe", observation)
	if err != nil || !raw.(productcenter.CommandResult).Replayed {
		t.Fatalf("observe replay %v", err)
	}
	transition.ExpectedRevision = 4
	transition.ExpectedObjectiveRevision = 2
	transition.Action = "close"
	_, err = call("close", "close", transition)
	if err != nil {
		t.Fatal(err)
	}
	raw, err = call("view", "", map[string]any{"id": objective.ID})
	if err != nil {
		t.Fatal(err)
	}
	closed := raw.(productcenter.ProductObjectiveDetail)
	if closed.Objective.Status != "closed" || closed.Objective.Revision != 3 || closed.WorkspaceRevision != 5 {
		t.Fatalf("closed %+v", closed)
	}
	transition.Action = "reopen"
	transition.ExpectedRevision = 5
	transition.ExpectedObjectiveRevision = 2
	_, err = call("reopen", "stale-reopen", transition)
	if !errors.As(err, &response) || response.Status != 409 {
		t.Fatalf("objective conflict %v", err)
	}
	_, err = call("close", "wrong-action", transition)
	if !errors.As(err, &response) || response.Status != 400 {
		t.Fatalf("route action conflict %v", err)
	}

	raw, err = call("observations", "", map[string]any{"objective_id": objective.ID, "page": 1, "page_size": 10})
	if err != nil {
		t.Fatal(err)
	}
	history := raw.(productcenter.ProductObjectiveObservationPage)
	if history.Total != 1 || len(history.Items) != 1 || history.Items[0].CorrectionOfID != nil || history.Items[0].SupersededByID != nil {
		t.Fatalf("observation history %+v", history)
	}

	originalObservationID := history.Items[0].ID
	observation.CorrectionOfID = &originalObservationID
	observation.CorrectionReason = "修正统计分母"
	observation.MeasuredValue = "4"
	observation.ExpectedRevision = 5
	observation.ExpectedObjectiveRevision = 3
	raw, err = call("observe", "correct-observation", observation)
	if err != nil {
		t.Fatal(err)
	}
	correctionReceipt := raw.(productcenter.CommandResult)
	var correctionResult struct {
		CorrectionOfID    *int64 `json:"correction_of_id"`
		ObjectiveRevision uint64 `json:"objective_revision"`
		Attainment        string `json:"attainment_percent"`
	}
	if err = json.Unmarshal(correctionReceipt.Value, &correctionResult); err != nil || correctionResult.CorrectionOfID == nil || *correctionResult.CorrectionOfID != originalObservationID || correctionResult.ObjectiveRevision != 2 || correctionResult.Attainment != "33.333333" {
		t.Fatalf("runtime correction %+v %v", correctionResult, err)
	}
	raw, err = call("observe", "correct-observation", observation)
	if err != nil || !raw.(productcenter.CommandResult).Replayed {
		t.Fatalf("correction replay %v", err)
	}
	observation.ExpectedRevision = 6
	_, err = call("observe", "competing-correction", observation)
	if !errors.As(err, &response) || response.Status != 409 {
		t.Fatalf("correction branch %v", err)
	}
	raw, err = call("observations", "", map[string]any{"objective_id": objective.ID, "page": 1, "page_size": 10})
	if err != nil {
		t.Fatal(err)
	}
	correctedHistory := raw.(productcenter.ProductObjectiveObservationPage)
	if correctedHistory.Total != 2 || len(correctedHistory.Items) != 2 || correctedHistory.Items[0].CorrectionOfID == nil || correctedHistory.Items[1].SupersededByID == nil {
		t.Fatalf("runtime correction history %+v", correctedHistory)
	}
	// Edit through the actual adapter after observations exist: history must keep
	// its original metric snapshot and attainment, including correction records.
	transition.Action = "reopen"
	transition.ExpectedRevision = 6
	transition.ExpectedObjectiveRevision = 3
	if _, err = call("reopen", "reopen-for-edit", transition); err != nil {
		t.Fatal(err)
	}
	edit := productcenter.ProductObjectiveEdit{ProductObjectiveDraft: input, ObjectiveID: objective.ID, ExpectedObjectiveRevision: 4, Reason: "调整目标值"}
	edit.ExpectedRevision = 7
	edit.Title = "修订后的目标"
	edit.Metric.TargetValue = "1"
	raw, err = call("edit", "edit-definition", edit)
	if err != nil {
		t.Fatal(err)
	}
	editReceipt := raw.(productcenter.CommandResult)
	var edited productcenter.ProductObjectiveDetail
	if err = json.Unmarshal(editReceipt.Value, &edited); err != nil || edited.Objective.ID != objective.ID || edited.Objective.BizID != objective.BizID || edited.Objective.Title != edit.Title || edited.Objective.Metric.TargetValue != "1.000000" || edited.Objective.Revision != 5 || edited.WorkspaceRevision != 8 {
		t.Fatalf("edit %+v %v", edited, err)
	}
	raw, err = call("edit", "edit-definition", edit)
	if err != nil || !raw.(productcenter.CommandResult).Replayed || raw.(productcenter.CommandResult).ReceiptID != editReceipt.ReceiptID {
		t.Fatalf("edit replay %v", err)
	}
	_, err = call("edit", "stale-edit", edit)
	if !errors.As(err, &response) || response.Status != 409 {
		t.Fatalf("stale edit %v", err)
	}
	raw, err = call("observations", "", map[string]any{"objective_id": objective.ID, "page": 1, "page_size": 10})
	if err != nil {
		t.Fatal(err)
	}
	afterEditHistory := raw.(productcenter.ProductObjectiveObservationPage)
	if afterEditHistory.WorkspaceRevision != 8 || !reflect.DeepEqual(afterEditHistory.Items, correctedHistory.Items) {
		t.Fatalf("edit changed historical observations: before %+v after %+v", correctedHistory, afterEditHistory)
	}
	itemResult, err := db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(UUID(),?,'登录改进','减少失败','reliability','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code)
	if err != nil {
		t.Fatal(err)
	}
	itemID, err := itemResult.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	link := productcenter.ProductObjectiveItemLink{ObjectiveID: objective.ID, PlanningItemID: itemID, ExpectedRevision: 8, ExpectedObjectiveRevision: 5, ExpectedPlanningRevision: 1, ContributionNote: "减少登录失败", Reason: "建立追踪"}
	raw, err = call("item-link", "link-planning", link)
	if err != nil {
		t.Fatal(err)
	}
	linkedReceipt := raw.(productcenter.CommandResult)
	raw, err = call("item-link", "link-planning", link)
	if err != nil || !raw.(productcenter.CommandResult).Replayed || raw.(productcenter.CommandResult).ReceiptID != linkedReceipt.ReceiptID {
		t.Fatalf("link replay %v", err)
	}
	readLinks := func() productcenter.ProductObjectiveItemPage {
		t.Helper()
		raw, err := call("items", "", map[string]any{"objective_id": objective.ID, "page": 1, "page_size": 10})
		if err != nil {
			t.Fatal(err)
		}
		return raw.(productcenter.ProductObjectiveItemPage)
	}
	links := readLinks()
	if links.Total != 1 || len(links.Items) != 1 || links.Items[0].PlanningItemID != itemID || links.Items[0].ContributionNote != link.ContributionNote || links.WorkspaceRevision != 9 || links.ObjectiveRevision != 6 {
		t.Fatalf("links %+v", links)
	}

	var itemBizID string
	if err = db.QueryRow(`SELECT biz_id FROM product_planning_items WHERE id=?`, itemID).Scan(&itemBizID); err != nil {
		t.Fatal(err)
	}
	readReverse := func(page int) productcenter.PlanningItemObjectivePage {
		t.Helper()
		value, err := call("item-objectives", "", map[string]any{"item_biz_id": itemBizID, "page": page, "page_size": 1})
		if err != nil {
			t.Fatal(err)
		}
		return value.(productcenter.PlanningItemObjectivePage)
	}
	reverse := readReverse(1)
	if reverse.Total != 1 || len(reverse.Items) != 1 || reverse.Items[0].ObjectiveID != objective.ID || reverse.Items[0].ContributionNote != link.ContributionNote || reverse.ItemBizID != itemBizID || reverse.ItemRevision != 1 || reverse.WorkspaceRevision != 9 {
		t.Fatalf("runtime reverse %+v", reverse)
	}
	reverse = readReverse(2)
	if reverse.Total != 1 || len(reverse.Items) != 0 || reverse.Page != 2 {
		t.Fatalf("runtime reverse page %+v", reverse)
	}
	link.ExpectedRevision = 9
	link.ExpectedObjectiveRevision = 6
	link.ExpectedPlanningRevision = 2
	_, err = call("item-link", "stale-planning-link", link)
	if !errors.As(err, &response) || response.Status != 409 {
		t.Fatalf("planning conflict %v", err)
	}
	link.ExpectedPlanningRevision = 1
	link.ContributionNote = "提升登录稳定性"
	if _, err = call("item-link", "update-contribution", link); err != nil {
		t.Fatal(err)
	}
	links = readLinks()
	if links.Total != 1 || links.Items[0].ContributionNote != link.ContributionNote {
		t.Fatalf("contribution %+v", links)
	}
	reverse = readReverse(1)
	if len(reverse.Items) != 1 || reverse.Items[0].ContributionNote != link.ContributionNote || reverse.WorkspaceRevision != 10 {
		t.Fatalf("runtime reverse updated %+v", reverse)
	}
	link.ExpectedRevision = 10
	link.ExpectedObjectiveRevision = 7
	link.Remove = true
	link.ContributionNote = ""
	link.Reason = "调整规划关联"
	if _, err = call("item-link", "unlink-planning", link); err != nil {
		t.Fatal(err)
	}
	links = readLinks()
	if links.Total != 0 || len(links.Items) != 0 || links.ObjectiveRevision != 8 || links.WorkspaceRevision != 11 {
		t.Fatalf("unlink %+v", links)
	}
	reverse = readReverse(1)
	if reverse.Total != 0 || len(reverse.Items) != 0 || reverse.WorkspaceRevision != 11 {
		t.Fatalf("runtime reverse unlinked %+v", reverse)
	}
	var planningRevision uint64
	if err = db.QueryRow(`SELECT revision FROM product_planning_items WHERE id=?`, itemID).Scan(&planningRevision); err != nil || planningRevision != 1 {
		t.Fatalf("planning changed %d %v", planningRevision, err)
	}
	cycleRow, err := db.Exec(`INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,created_by,updated_by,created_at,updated_at) VALUES(UUID(),?,'季度规划','2026-09-01','2026-12-31','周期原摘要',JSON_OBJECT(),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code)
	if err != nil {
		t.Fatal(err)
	}
	cycleID, err := cycleRow.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	mapping := productcenter.ProductObjectiveCycleMap{ObjectiveID: objective.ID, CycleID: cycleID, ExpectedRevision: 11, ExpectedObjectiveRevision: 8, ExpectedCycleRevision: 1, Reason: "对应季度目标"}
	raw, err = call("cycle-map", "map-cycle", mapping)
	if err != nil {
		t.Fatal(err)
	}
	mappedReceipt := raw.(productcenter.CommandResult)
	var mapped struct {
		ID int64 `json:"id"`
	}
	if err = json.Unmarshal(mappedReceipt.Value, &mapped); err != nil || mapped.ID < 1 {
		t.Fatalf("mapping receipt %+v %v", mapped, err)
	}
	raw, err = call("cycle-map", "map-cycle", mapping)
	if err != nil || !raw.(productcenter.CommandResult).Replayed {
		t.Fatalf("mapping replay %v", err)
	}
	mapping.ExpectedRevision = 12
	mapping.ExpectedObjectiveRevision = 9
	_, err = call("cycle-map", "duplicate-cycle", mapping)
	if !errors.As(err, &response) || response.Status != 409 {
		t.Fatalf("mapping conflict %v", err)
	}
	raw, err = call("cycles", "", map[string]any{"objective_id": objective.ID, "page": 1, "page_size": 10})
	if err != nil {
		t.Fatal(err)
	}
	mappedHistory := raw.(productcenter.ProductObjectiveCyclePage)
	if mappedHistory.Total != 1 || len(mappedHistory.Items) != 1 || mappedHistory.Items[0].CycleSnapshot.GoalSummary != "周期原摘要" || mappedHistory.Items[0].RevokedAt != nil {
		t.Fatalf("mapping history %+v", mappedHistory)
	}
	revoke := productcenter.ProductObjectiveCycleRevoke{ObjectiveID: objective.ID, MappingID: mapped.ID, ExpectedRevision: 12, ExpectedObjectiveRevision: 9, Reason: "调整周期映射"}
	raw, err = call("cycle-revoke", "revoke-cycle", revoke)
	if err != nil {
		t.Fatal(err)
	}
	raw, err = call("cycle-revoke", "revoke-cycle", revoke)
	if err != nil || !raw.(productcenter.CommandResult).Replayed {
		t.Fatalf("revoke replay %v", err)
	}
	raw, err = call("cycles", "", map[string]any{"objective_id": objective.ID, "page": 1, "page_size": 10})
	if err != nil {
		t.Fatal(err)
	}
	revokedHistory := raw.(productcenter.ProductObjectiveCyclePage)
	if revokedHistory.Total != 1 || revokedHistory.Items[0].RevokedAt == nil || revokedHistory.Items[0].RevocationReason == nil || *revokedHistory.Items[0].RevocationReason != revoke.Reason || revokedHistory.WorkspaceRevision != 13 || revokedHistory.ObjectiveRevision != 10 {
		t.Fatalf("revoked history %+v", revokedHistory)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts`).Scan(&count); err != nil || count != 12 {
		t.Fatalf("receipts %d %v", count, err)
	}
}
