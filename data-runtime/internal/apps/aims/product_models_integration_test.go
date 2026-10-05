package aims

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"testing"
	"time"
	"unsafe"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
)

func TestMySQLPriorityModelsThroughRuntime(t *testing.T) {
	db := handoffMySQLDatabase(t)
	migrateHandoffProductCenter(t, db)
	script, err := os.ReadFile("../../../../aims/docs/migration_v5.29_priority_model_versions.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(script))
	const code = "P-MODEL-RUNTIME"
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
	permit := func(action string) productcenter.AuthorizationPermit {
		t.Helper()
		facts, e := productcenter.LoadAuthorizationFacts(ctx, db, code, "pm")
		if e != nil {
			t.Fatal(e)
		}
		return productcenter.AuthorizationPermit{Resource: "product_priorities", Action: action, Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	}
	call := func(action, key string, input any) any {
		t.Helper()
		permission, capability := "admin", "model-create"
		if action == "list" {
			permission, capability = "view", "read"
		}
		if action == "cycle-select" {
			capability = "cycle-model-select"
		}
		query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims:product-priorities:" + capability}}
		raw, operation, e := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/priority-models:"+action, query, map[string]any{"input": input, "idempotency_key": key, "authorization": permit(permission)})
		if e != nil {
			t.Fatalf("%s: %v", action, e)
		}
		envelope, ok := raw.(map[string]any)
		if !ok || envelope["code"] != 0 || operation != "aims.product-priority-models."+action {
			t.Fatalf("envelope %#v %s", raw, operation)
		}
		return envelope["data"]
	}
	input := productcenter.WeightedModelCreate{ExpectedRevision: 1, Title: "用户价值模型", Reason: "试点配置", Model: productcenter.WeightedAssessmentModel{Version: "customer-v2", Strategic: 10, UserValue: 60, Business: 20, Risk: 10}}
	saved := call("create", "model-create", input).(productcenter.CommandResult)
	replay := call("create", "model-create", input).(productcenter.CommandResult)
	if !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatal("create replay changed receipt")
	}
	page := call("list", "", map[string]any{"page": 1, "page_size": 20}).(productcenter.PriorityModelPage)
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].Version != input.Model.Version || page.WorkspaceRevision != 2 || page.Builtin["version"] != "weighted-value-effort-v1" {
		t.Fatalf("list %+v", page)
	}
	empty := call("list", "", map[string]any{"page": 2, "page_size": 20}).(productcenter.PriorityModelPage)
	if empty.Total != 1 || len(empty.Items) != 0 {
		t.Fatalf("pagination %+v", empty)
	}
	created, err := productcenter.CreatePlanningCycle(ctx, db, productcenter.CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_priorities:cycle-create", IdempotencyKey: "cycle"}, permit("edit"), productcenter.PlanningCycleDraft{ExpectedRevision: 2, Title: "试点周期", StartsOn: "2099-01-01", EndsOn: "2099-12-31", GoalSummary: "验证模型规则", ReviewIntervalDays: 14})
	if err != nil {
		t.Fatal(err)
	}
	var cycle struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(created.Value, &cycle); err != nil || cycle.BizID == "" {
		t.Fatalf("cycle %s %v", created.Value, err)
	}
	selection := productcenter.PlanningCycleModelSelect{BizID: cycle.BizID, ModelVersion: input.Model.Version, ExpectedRevision: 3, ExpectedCycleRevision: 1, Reason: "试点选用"}
	selected := call("cycle-select", "select", selection).(productcenter.CommandResult)
	replay = call("cycle-select", "select", selection).(productcenter.CommandResult)
	if !replay.Replayed || replay.ReceiptID != selected.ReceiptID {
		t.Fatal("select replay changed receipt")
	}
	var version string
	var cycleRevision, queueRevision, weight, rootRevision int
	if err = db.QueryRow(`SELECT model_version,revision,queue_revision,JSON_EXTRACT(model_snapshot,'$.weights.user_value') FROM product_planning_cycles WHERE biz_id=?`, cycle.BizID).Scan(&version, &cycleRevision, &queueRevision, &weight); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code=?`, code).Scan(&rootRevision); err != nil {
		t.Fatal(err)
	}
	if version != input.Model.Version || cycleRevision != 2 || queueRevision != 1 || weight != 60 || rootRevision != 4 {
		t.Fatalf("persisted %s cycle=%d queue=%d weight=%d root=%d", version, cycleRevision, queueRevision, weight, rootRevision)
	}
	var receipts, versions int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_command_receipts WHERE product_code=?`, code).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_priority_model_versions WHERE product_code=?`, code).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if receipts != 3 || versions != 1 {
		t.Fatalf("retries duplicated writes receipts=%d versions=%d", receipts, versions)
	}
	rice := productcenter.RICEModelCreate{ExpectedRevision: 4, Title: "季度用户 RICE", Reason: "冻结口径供后续周期", Model: productcenter.RICEAssessmentModel{Version: "rice-person-day-v1", ReachUnit: "unique_users", ReachDefinition: "按用户 UID 去重", ReachStartsOn: "2026-10-01", ReachEndsOn: "2026-12-31", SourceDefinition: "产品事件去重汇总"}}
	riceSaved := call("rice-create", "rice", rice).(productcenter.CommandResult)
	riceReplay := call("rice-create", "rice", rice).(productcenter.CommandResult)
	if !riceReplay.Replayed || riceReplay.ReceiptID != riceSaved.ReceiptID {
		t.Fatal("RICE replay changed receipt")
	}
	page = call("list", "", map[string]any{"page": 1, "page_size": 20}).(productcenter.PriorityModelPage)
	if page.Total != 2 || page.WorkspaceRevision != 5 || page.Items[0].Method != "rice" || page.Items[0].Version != rice.Model.Version {
		t.Fatalf("RICE list %+v", page)
	}
	if err = db.QueryRow(`SELECT model_version FROM product_planning_cycles WHERE biz_id=?`, cycle.BizID).Scan(&version); err != nil || version != input.Model.Version {
		t.Fatal("RICE publication changed existing cycle")
	}

	observationsSchema, err := os.ReadFile("../../../../aims/docs/migration_v5.30_rice_reach_observations.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeHandoffSQLScript(t, db, string(observationsSchema))
	const itemBiz = "00000000-0000-4000-8000-000000000077"
	if _, err = db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(?,?,'Reach 试点','登录流程','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, itemBiz, code); err != nil {
		t.Fatal(err)
	}
	reachCall := func(action string, input any) any {
		t.Helper()
		query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims:product-priorities:read"}}
		body := map[string]any{"input": input, "authorization": permit("view")}
		if action == "record" {
			query.Set("current_user_scopes", "aims:product-priorities:reach-record")
			body["authorization"] = permit("assess")
			body["idempotency_key"] = "reach"
		}
		raw, operation, e := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/reach-observations:"+action, query, body)
		if e != nil {
			t.Fatalf("reach %s: %v", action, e)
		}
		envelope, ok := raw.(map[string]any)
		if !ok || envelope["code"] != 0 || operation != "aims.product-reach-observations."+action {
			t.Fatalf("reach envelope %#v %s", raw, operation)
		}
		return envelope["data"]
	}
	recordInput := productcenter.RICEObservationCreate{ItemBizID: itemBiz, ModelVersion: rice.Model.Version, ExpectedRevision: 5, ExpectedItemRevision: 1, ExpectedScopeRevision: 1, ExpectedEvidenceRevision: 1, Reach: 450, SourceReference: "report-q4", Methodology: "按用户 UID 去重"}
	recorded := reachCall("record", recordInput).(productcenter.CommandResult)
	recordReplay := reachCall("record", recordInput).(productcenter.CommandResult)
	if !recordReplay.Replayed || recordReplay.ReceiptID != recorded.ReceiptID {
		t.Fatal("Reach Runtime replay changed receipt")
	}
	var observed struct {
		Observation productcenter.RICEReachObservation `json:"observation"`
	}
	if err = json.Unmarshal(recorded.Value, &observed); err != nil {
		t.Fatal(err)
	}
	reachPage := reachCall("list", map[string]any{"item_biz_id": itemBiz, "page": 1, "page_size": 20}).(productcenter.RICEObservationPage)
	if reachPage.Total != 1 || len(reachPage.Items) != 1 || reachPage.Items[0].Stale || reachPage.WorkspaceRevision != 6 || reachPage.ItemRevision != 2 {
		t.Fatalf("reach page %+v", reachPage)
	}
	reachView := reachCall("view", map[string]any{"item_biz_id": itemBiz, "biz_id": observed.Observation.BizID}).(productcenter.RICEObservationView)
	if reachView.Observation.Reach != 450 || reachView.Observation.RecordedBy != "pm" || reachView.Observation.EvidenceRevision != 2 || reachView.Stale {
		t.Fatalf("reach detail %+v", reachView)
	}
	reachPage = reachCall("list", map[string]any{"item_biz_id": itemBiz, "page": 2, "page_size": 20}).(productcenter.RICEObservationPage)
	if reachPage.Total != 1 || len(reachPage.Items) != 0 {
		t.Fatalf("reach empty page %+v", reachPage)
	}

	zero, total, target := productcenter.Hundredths(0), productcenter.Hundredths(1000), "75"
	riceCycleResult, err := productcenter.CreatePlanningCycle(ctx, db, productcenter.CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_priorities:cycle-create", IdempotencyKey: "rice-cycle"}, permit("edit"), productcenter.PlanningCycleDraft{ExpectedRevision: 6, Title: "RICE Runtime 评估", StartsOn: "2099-01-01", EndsOn: "2099-12-31", GoalSummary: "验证 Runtime 保存", ReviewIntervalDays: 14, Budget: &productcenter.PlanningCycleBudget{Total: &total, Reserve: &zero, Reliability: &zero, Usability: &zero, Growth: &total}, Metric: &productcenter.PlanningCycleMetric{Name: "成功率", Unit: "百分比", Direction: "increase", MeasurementMethod: "按用户去重", TargetValue: &target}})
	if err != nil {
		t.Fatal(err)
	}
	var riceCycle struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(riceCycleResult.Value, &riceCycle); err != nil {
		t.Fatal(err)
	}
	candidate := productcenter.PlanningCycleCandidateAdd{CycleBizID: riceCycle.BizID, ItemBizID: itemBiz, ExpectedRevision: 7, ExpectedCycleRevision: 1, ExpectedItemRevision: 2}
	if _, err = productcenter.AddPlanningCycleCandidate(ctx, db, productcenter.CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_priorities:candidate-add", IdempotencyKey: "rice-candidate"}, permit("edit"), candidate); err != nil {
		t.Fatal(err)
	}
	call("cycle-select", "rice-select", productcenter.PlanningCycleModelSelect{BizID: riceCycle.BizID, ModelVersion: rice.Model.Version, ExpectedRevision: 8, ExpectedCycleRevision: 2, Reason: "已有当前观测"})
	if _, err = productcenter.OpenPlanningCycle(ctx, db, productcenter.CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_priorities:cycle-open", IdempotencyKey: "rice-open"}, permit("prioritize"), productcenter.PlanningCycleTransition{BizID: riceCycle.BizID, ExpectedRevision: 9, ExpectedCycleRevision: 3, Reason: "开始评估"}); err != nil {
		t.Fatal(err)
	}
	impact, confidence, effort := productcenter.Hundredths(200), productcenter.Hundredths(80), productcenter.Hundredths(800)
	candidate.ExpectedRevision, candidate.ExpectedCycleRevision = 10, 4
	assessmentInput := productcenter.PlanningRICEAssessmentCreate{PlanningCycleCandidateAdd: candidate, ExpectedScopeRevision: 1, ExpectedEvidenceRevision: 2, Assessment: productcenter.RICEObservedAssessmentInput{ModelVersion: rice.Model.Version, ObservationBizID: observed.Observation.BizID, EffortUnit: "person_day", Impact: &impact, Confidence: &confidence, Effort: &effort}, Rationale: map[string]string{"impact": "试点影响", "confidence": "试点证据", "effort_person_days": "设计开发测试"}, EvidenceReferences: map[string][]string{"impact": {"trial"}, "confidence": {"trial"}, "effort_person_days": {"trial"}}, Evidence: []productcenter.AssessmentEvidence{{Key: "trial", Summary: "试点反馈", ObservedOn: "2099-01-02", Kind: "fact", Polarity: "supporting"}}, EstimateConfirmed: true}
	assessmentCall := func() productcenter.CommandResult {
		t.Helper()
		query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims:product-priorities:rice-assess"}}
		raw, operation, e := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/planning-assessments:rice-create", query, map[string]any{"input": assessmentInput, "authorization": permit("assess"), "idempotency_key": "rice-assessment"})
		if e != nil {
			t.Fatal(e)
		}
		envelope, ok := raw.(map[string]any)
		if !ok || envelope["code"] != 0 || operation != "aims.product-priorities.rice-assess" {
			t.Fatalf("RICE assessment envelope %#v %s", raw, operation)
		}
		return envelope["data"].(productcenter.CommandResult)
	}
	assessmentSaved, assessmentReplay := assessmentCall(), assessmentCall()
	if !assessmentReplay.Replayed || assessmentReplay.ReceiptID != assessmentSaved.ReceiptID {
		t.Fatal("RICE Runtime replay changed receipt")
	}
	history, err := productcenter.ListPlanningAssessments(ctx, db, code, "pm", permit("view"), productcenter.PlanningAssessmentQuery{CycleBizID: riceCycle.BizID, ItemBizID: itemBiz, Page: 1, PageSize: 20})
	if err != nil || history.Total != 1 || len(history.Items) != 1 {
		t.Fatalf("RICE Runtime history %+v %v", history, err)
	}
	assessment := history.Items[0]
	if assessment.ModelMethod != "rice" || assessment.PriorityScore == nil || *assessment.PriorityScore != "90.00000000" || assessment.AssessedBy != "pm" || assessment.ValueScore != nil || assessment.Stale {
		t.Fatalf("RICE Runtime persisted assessment %+v", assessment)
	}

	if err = db.QueryRow("SELECT revision FROM product_workspaces WHERE product_code=?", code).Scan(&rootRevision); err != nil || rootRevision != 11 {
		t.Fatalf("RICE replay product revision %d %v", rootRevision, err)
	}
	if err = db.QueryRow("SELECT revision,queue_revision FROM product_planning_cycles WHERE biz_id=?", riceCycle.BizID).Scan(&cycleRevision, &queueRevision); err != nil || cycleRevision != 5 || queueRevision != 2 {
		t.Fatalf("RICE replay cycle/queue revision %d/%d %v", cycleRevision, queueRevision, err)
	}

	for _, migration := range []string{"migration_v5.25_planning_roadmap_windows.sql", "migration_v5.32_roadmap_saved_views.sql", "migration_v5.33_roadmap_saved_view_deletion.sql"} {
		script, e := os.ReadFile("../../../../aims/docs/" + migration)
		if e != nil {
			t.Fatal(e)
		}
		executeHandoffSQLScript(t, db, string(script))
	}
	viewCall := func(action string, input any) any {
		t.Helper()
		capability := "read"
		if action == "create" || action == "update" || action == "delete" {
			capability = "view-" + action
		}
		query := url.Values{"current_user": {"pm"}, "hzy_runtime_actor_delegated": {"1"}, "hzy_runtime_source_app": {"aims"}, "hzy_runtime_tenant_code": {"t"}, "hzy_runtime_deployment_code": {"d"}, "hzy_runtime_service_client_id": {"aims.runtime"}, "current_user_scopes": {"aims:product-roadmaps:" + capability}}
		roadmap := permit("view")
		roadmap.Resource = "product_roadmaps"
		raw, operation, e := adapter.HandleRuntime(ctx, http.MethodPost, "/v1/aims/internal/products/"+code+"/roadmap-views:"+action, query, map[string]any{"input": input, "authorization": roadmap, "planning_authorization": permit("view"), "idempotency_key": "saved-view-" + action})
		if e != nil {
			t.Fatalf("saved view %s: %v", action, e)
		}
		envelope, ok := raw.(map[string]any)
		if !ok || envelope["code"] != 0 || operation != "aims.product-roadmap-views."+action {
			t.Fatalf("saved view envelope %#v %s", raw, operation)
		}
		return envelope["data"]
	}
	viewInput := productcenter.RoadmapSavedViewCreate{ExpectedRevision: 11, Definition: productcenter.RoadmapSavedViewDefinition{Title: "交付受众视图", Audience: "delivery", Visibility: "personal", CycleBizID: riceCycle.BizID, Year: 2099, Quarter: 1, Unscheduled: true}}
	viewSaved := viewCall("create", viewInput).(productcenter.CommandResult)
	viewReplay := viewCall("create", viewInput).(productcenter.CommandResult)
	if !viewReplay.Replayed || viewReplay.ReceiptID != viewSaved.ReceiptID {
		t.Fatal("saved view create replay changed")
	}
	var viewIdentity struct {
		BizID string `json:"biz_id"`
	}
	if err = json.Unmarshal(viewSaved.Value, &viewIdentity); err != nil {
		t.Fatal(err)
	}
	viewList := viewCall("list", map[string]any{"page": 1, "page_size": 20}).(productcenter.RoadmapSavedViewPage)
	if viewList.Total != 1 || len(viewList.Items) != 1 || viewList.WorkspaceRevision != 12 {
		t.Fatalf("Runtime view list %+v", viewList)
	}
	viewDetail := viewCall("view", map[string]any{"biz_id": viewIdentity.BizID}).(productcenter.RoadmapSavedViewDetail)
	if viewDetail.OwnerUID != "pm" || viewDetail.Definition != viewInput.Definition {
		t.Fatalf("Runtime view detail %+v", viewDetail)
	}
	applied := viewCall("apply", map[string]any{"biz_id": viewIdentity.BizID, "page": 1, "page_size": 20}).(productcenter.AppliedRoadmapSavedView)
	if applied.Roadmap.Total != 1 || len(applied.Roadmap.Items) != 1 || applied.Roadmap.Items[0].BizID != itemBiz || applied.Roadmap.QueueRevision != 2 {
		t.Fatalf("Runtime applied roadmap %+v", applied)
	}
	viewUpdate := productcenter.RoadmapSavedViewUpdate{BizID: viewIdentity.BizID, ExpectedRevision: 12, ExpectedViewRevision: 1, Definition: viewInput.Definition}
	viewUpdate.Definition.Title = "更新后的交付视图"
	viewUpdated := viewCall("update", viewUpdate).(productcenter.CommandResult)
	viewUpdateReplay := viewCall("update", viewUpdate).(productcenter.CommandResult)
	if !viewUpdateReplay.Replayed || viewUpdateReplay.ReceiptID != viewUpdated.ReceiptID {
		t.Fatal("saved view update replay changed")
	}
	viewDelete := productcenter.RoadmapSavedViewDelete{BizID: viewIdentity.BizID, ExpectedRevision: 13, ExpectedViewRevision: 2}
	viewDeleted := viewCall("delete", viewDelete).(productcenter.CommandResult)
	viewDeleteReplay := viewCall("delete", viewDelete).(productcenter.CommandResult)
	if !viewDeleteReplay.Replayed || viewDeleteReplay.ReceiptID != viewDeleted.ReceiptID {
		t.Fatal("saved view delete replay changed")
	}
	viewList = viewCall("list", map[string]any{"page": 1, "page_size": 20}).(productcenter.RoadmapSavedViewPage)
	if viewList.Total != 0 || len(viewList.Items) != 0 || viewList.WorkspaceRevision != 14 {
		t.Fatalf("Runtime deleted view list %+v", viewList)
	}

}
