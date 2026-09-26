package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
	"testing"
)

func TestMySQLLightweightPlanAdoptConfirmAndStale(t *testing.T) {
	exerciseLightweightPlanChain(t, false)
}

func exerciseLightweightPlanChain(t *testing.T, unified bool) {
	commands, db := lightweightChainFixture(t, unified)
	workspaceFixture(t, db, "P-SIMPLE")
	if _, e := db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-SIMPLE','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	permit := func(resource, action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-SIMPLE", "pm", action)
		p.Resource = resource
		return p
	}
	requestResult, e := commands.CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "request"}, permit("product_requests", "create"), RequestDraft{ExpectedRevision: 1, Title: "登录优化", ProblemStatement: "重复登录", SourceType: "internal", UrgencyLevel: "P2"})
	if e != nil {
		t.Fatal(e)
	}
	var request struct {
		BizID string `json:"biz_id"`
	}
	if e = json.Unmarshal(requestResult.Value, &request); e != nil {
		t.Fatal(e)
	}
	owner := "pm"
	versionResult, e := commands.CreateProductCenterVersion(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_versions:create", IdempotencyKey: "version"}, permit("product_versions", "edit"), ProductVersionDraft{ExpectedRevision: 2, VersionCode: "v-simple", Name: "轻量", PlanningMode: "simple", BusinessOwnerUID: &owner})
	if e != nil {
		t.Fatal(e)
	}
	var version struct {
		ID int64 `json:"id"`
	}
	if e = json.Unmarshal(versionResult.Value, &version); e != nil {
		t.Fatal(e)
	}
	available, _ := ParseHundredths("10")
	reserve, _ := ParseHundredths("1")
	estimate, _ := ParseHundredths("8")
	if _, e = commands.EditLightweightVersionPlan(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_versions:plan-edit", IdempotencyKey: "plan"}, permit("product_versions", "edit"), LightweightVersionPlanEdit{VersionID: version.ID, ExpectedRevision: 3, ExpectedVersionRevision: 1, ExpectedPlanRevision: 1, Goal: "完成登录", StartsOn: "2099-01-01", PlannedReleaseDate: "2099-01-31", AvailablePersonDays: &available, ReservePersonDays: &reserve}); e != nil {
		t.Fatal(e)
	}
	scopeResult, e := commands.CreateLightweightVersionPlanItem(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_versions:plan-item-create", IdempotencyKey: "scope"}, permit("product_versions", "edit"), permit("product_requests", "view"), permit("product_requests", "decide"), permit("product_priorities", "edit"), LightweightVersionPlanItemCreate{VersionID: version.ID, ExpectedRevision: 4, ExpectedVersionRevision: 2, ExpectedPlanRevision: 2, ExpectedRequestRevision: 1, RequestBizID: request.BizID, ScopeSummary: "统一入口", AcceptanceCriteria: "可通过统一登录", AdoptRequest: true})
	if e != nil {
		t.Fatal(e)
	}
	var scope struct {
		ID                int64  `json:"id"`
		PlanningItemBizID string `json:"planning_item_biz_id"`
	}
	if e = json.Unmarshal(scopeResult.Value, &scope); e != nil {
		t.Fatal(e)
	}
	_, e = commands.ConfirmLightweightVersionPlan(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_versions:plan-confirm", IdempotencyKey: "unknown"}, permit("product_versions", "edit"), permit("product_priorities", "prioritize"), LightweightVersionPlanConfirm{VersionID: version.ID, ExpectedRevision: 5, ExpectedVersionRevision: 3, ExpectedPlanRevision: 2, ExpectedScopeRevision: 2})
	requireProductRule(t, e, "product_version_plan_confirm_invalid")
	tooLarge, _ := ParseHundredths("10")
	_, e = commands.EditLightweightVersionPlanItem(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_versions:plan-item-edit", IdempotencyKey: "over"}, permit("product_versions", "edit"), LightweightVersionPlanItemEdit{VersionID: version.ID, ScopeID: scope.ID, ExpectedRevision: 5, ExpectedVersionRevision: 3, ExpectedPlanRevision: 2, ExpectedScopeRevision: 2, ScopeSummary: "统一入口", EstimatePersonDays: &tooLarge, AcceptanceCriteria: "可通过统一登录"})
	if e != nil {
		t.Fatal(e)
	}
	_, e = commands.ConfirmLightweightVersionPlan(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_versions:plan-confirm", IdempotencyKey: "over-confirm"}, permit("product_versions", "edit"), permit("product_priorities", "prioritize"), LightweightVersionPlanConfirm{VersionID: version.ID, ExpectedRevision: 6, ExpectedVersionRevision: 4, ExpectedPlanRevision: 2, ExpectedScopeRevision: 3})
	requireProductRule(t, e, "product_version_plan_confirm_invalid")
	_, e = commands.EditLightweightVersionPlanItem(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_versions:plan-item-edit", IdempotencyKey: "estimate"}, permit("product_versions", "edit"), LightweightVersionPlanItemEdit{VersionID: version.ID, ScopeID: scope.ID, ExpectedRevision: 6, ExpectedVersionRevision: 4, ExpectedPlanRevision: 2, ExpectedScopeRevision: 3, ScopeSummary: "统一入口", EstimatePersonDays: &estimate, AcceptanceCriteria: "可通过统一登录"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = commands.ConfirmLightweightVersionPlan(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_versions:plan-confirm", IdempotencyKey: "confirm"}, permit("product_versions", "edit"), permit("product_priorities", "prioritize"), LightweightVersionPlanConfirm{VersionID: version.ID, ExpectedRevision: 7, ExpectedVersionRevision: 5, ExpectedPlanRevision: 2, ExpectedScopeRevision: 4}); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(`CREATE TABLE pc_simple_handoff_drafts(id BIGINT PRIMARY KEY AUTO_INCREMENT,title VARCHAR(500)) ENGINE=InnoDB`); e != nil {
		t.Fatal(e)
	}
	_, e = commands.HandoffPlanningItem(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_priorities:handoff", IdempotencyKey: "success-handoff"}, permit("product_priorities", "handoff"), permit("product_requests", "handoff"), PlanningHandoffInput{PlanningDeliveryCheck: PlanningDeliveryCheck{ExpectedRevision: 7, ItemBizID: scope.PlanningItemBizID, ExpectedItemRevision: 3}, RequestBizID: request.BizID, ExpectedRequestRevision: 2, ProjectCode: "PJT", SliceKey: "success", Operation: "create", Title: "登录", ScopeSummary: "统一入口", Reason: "交付", PlannedVersionID: version.ID, PlannedVersionFeatureID: scope.ID}, PlanningHandoffTarget{AuthorizeProject: func(context.Context, *sql.Tx) (int64, error) { return 1, nil }, ResolveRequirement: func(ctx context.Context, tx *sql.Tx) (int64, error) {
		r, e := tx.ExecContext(ctx, `INSERT INTO pc_simple_handoff_drafts(title) VALUES('登录')`)
		if e != nil {
			return 0, e
		}
		return r.LastInsertId()
	}})
	if e != nil {
		t.Fatal(e)
	}
	plan, e := ReadLightweightVersionPlan(ctx, db, "P-SIMPLE", "pm", version.ID, permit("product_versions", "view"), permit("product_requests", "view"))
	if e != nil || plan.PlanStatus != "confirmed" {
		t.Fatalf("plan=%+v err=%v", plan, e)
	}
	// A source decision change invalidates only this plan's confirmation and
	// blocks transition, proving confirmation is not a one-time UI flag.
	if _, e = DecideProductRequest(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_requests:decide", IdempotencyKey: "reconsider"}, permit("product_requests", "decide"), RequestDecision{BizID: request.BizID, ExpectedRevision: 8, ExpectedRequestRevision: 2, Status: "evaluating", Reason: "重新评估", ImpactNote: "影响版本"}); e != nil {
		t.Fatal(e)
	}
	plan, e = ReadLightweightVersionPlan(ctx, db, "P-SIMPLE", "pm", version.ID, permit("product_versions", "view"), permit("product_requests", "view"))
	if e != nil || plan.PlanStatus != "stale" {
		t.Fatalf("stale plan=%+v err=%v", plan, e)
	}
	_, e = TransitionProductVersion(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_versions:transition", IdempotencyKey: "blocked-transition"}, permit("product_versions", "edit"), ProductVersionTransitionInput{VersionID: version.ID, ExpectedRevision: 9, ExpectedVersionRevision: 5, ToStatus: "developing", Reason: "开发"})
	requireProductRule(t, e, "product_version_plan_confirmation_required")
	_, e = commands.HandoffPlanningItem(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_priorities:handoff", IdempotencyKey: "wrong-scope-item"}, permit("product_priorities", "handoff"), permit("product_requests", "handoff"), PlanningHandoffInput{PlanningDeliveryCheck: PlanningDeliveryCheck{ExpectedRevision: 9, ItemBizID: "00000000-0000-4000-8000-000000000099", ExpectedItemRevision: 5}, RequestBizID: request.BizID, ExpectedRequestRevision: 3, ProjectCode: "PJT", SliceKey: "wrong", Operation: "create", Title: "登录", ScopeSummary: "统一入口", Reason: "交付", PlannedVersionID: version.ID, PlannedVersionFeatureID: scope.ID}, PlanningHandoffTarget{AuthorizeProject: func(context.Context, *sql.Tx) (int64, error) { return 1, nil }, ResolveRequirement: func(context.Context, *sql.Tx) (int64, error) { return 1, nil }})
	requireProductRule(t, e, "planning_handoff_version_invalid")
	_, e = commands.HandoffPlanningItem(ctx, db, CommandIdentity{ProductCode: "P-SIMPLE", ActorUID: "pm", Action: "product_priorities:handoff", IdempotencyKey: "blocked-handoff"}, permit("product_priorities", "handoff"), permit("product_requests", "handoff"), PlanningHandoffInput{PlanningDeliveryCheck: PlanningDeliveryCheck{ExpectedRevision: 9, ItemBizID: scope.PlanningItemBizID, ExpectedItemRevision: 5}, RequestBizID: request.BizID, ExpectedRequestRevision: 3, ProjectCode: "PJT", SliceKey: "one", Operation: "create", Title: "登录", ScopeSummary: "统一入口", Reason: "交付", PlannedVersionID: version.ID, PlannedVersionFeatureID: scope.ID}, PlanningHandoffTarget{AuthorizeProject: func(context.Context, *sql.Tx) (int64, error) { return 1, nil }, ResolveRequirement: func(context.Context, *sql.Tx) (int64, error) { return 1, nil }})
	requireProductRule(t, e, "product_version_plan_confirmation_required")
}

func TestMySQLLightweightPlanConfirmedMutationIsAtomic(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-ATOMIC")
	if _, e := db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES('P-ATOMIC','pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); e != nil {
		t.Fatal(e)
	}
	if _, e := db.Exec(`INSERT INTO product_versions(id,product_code,version_code,status,planned_release_date,business_owner_uid,planning_mode,revision,scope_revision,created_by,created_at,updated_at) VALUES(101,'P-ATOMIC','v1','planning','2099-01-31','pm','simple',1,1,'pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); e != nil {
		t.Fatal(e)
	}
	if _, e := db.Exec(`INSERT INTO product_version_plans(version_id,product_code,goal,starts_on,available_person_days,reserve_person_days,revision,scope_revision,created_by,updated_by,created_at,updated_at) VALUES(101,'P-ATOMIC','目标','2099-01-01',10,0,1,1,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`); e != nil {
		t.Fatal(e)
	}
	oldReq := uuid.NewString()
	if _, e := db.Exec(`INSERT INTO product_requests(biz_id,product_code,title,problem_statement,source_type,urgency_level,decision_status,revision,created_by,updated_by,created_at,updated_at) VALUES(?,'P-ATOMIC','已有','问题','internal','P2','accepted',1,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, oldReq); e != nil {
		t.Fatal(e)
	}
	var oldReqID int64
	if e := db.QueryRow(`SELECT id FROM product_requests WHERE biz_id=?`, oldReq).Scan(&oldReqID); e != nil {
		t.Fatal(e)
	}
	itemBiz := uuid.NewString()
	r, e := db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(?,'P-ATOMIC','已有','范围','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, itemBiz)
	if e != nil {
		t.Fatal(e)
	}
	itemID, _ := r.LastInsertId()
	if _, e = db.Exec(`INSERT INTO product_planning_item_requests(product_code,planning_item_id,request_id,created_by,created_at) VALUES('P-ATOMIC',?,?, 'pm',UTC_TIMESTAMP(3))`, itemID, oldReqID); e != nil {
		t.Fatal(e)
	}
	r, e = db.Exec(`INSERT INTO product_version_features(version_id,title,description,status,is_public,sort_order,created_by,created_at,updated_at,planning_item_id,change_type,acceptance_criteria) VALUES(101,'已有','范围','planned',0,0,'pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),?,'enhancement','标准')`, itemID)
	if e != nil {
		t.Fatal(e)
	}
	scopeID, _ := r.LastInsertId()
	if _, e = db.Exec(`INSERT INTO product_version_plan_scopes(version_feature_id,version_id,product_code,request_id,planning_item_id,scope_summary,estimate_person_days,created_by,updated_by,created_at,updated_at) VALUES(?,101,'P-ATOMIC',?,?, '范围',1,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, scopeID, oldReqID, itemID); e != nil {
		t.Fatal(e)
	}
	if _, e = db.Exec(`INSERT INTO product_version_plan_confirmations(version_id,plan_revision,scope_revision,snapshot,confirmed_by,confirmed_at) VALUES(101,1,1,'{}','pm',UTC_TIMESTAMP(3))`); e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	permit := func(resource, action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-ATOMIC", "pm", action)
		p.Resource = resource
		return p
	}
	created, e := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-ATOMIC", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "new-request"}, permit("product_requests", "create"), RequestDraft{ExpectedRevision: 1, Title: "新增", ProblemStatement: "问题", SourceType: "internal", UrgencyLevel: "P2"})
	if e != nil {
		t.Fatal(e)
	}
	var req struct {
		BizID string `json:"biz_id"`
	}
	if e = json.Unmarshal(created.Value, &req); e != nil {
		t.Fatal(e)
	}
	estimate, _ := ParseHundredths("1")
	input := LightweightVersionPlanItemCreate{VersionID: 101, ExpectedRevision: 2, ExpectedVersionRevision: 1, ExpectedPlanRevision: 1, ExpectedRequestRevision: 1, RequestBizID: req.BizID, ScopeSummary: "新增范围", EstimatePersonDays: &estimate, AcceptanceCriteria: "新标准", AdoptRequest: true}
	identity := CommandIdentity{ProductCode: "P-ATOMIC", ActorUID: "pm", Action: "product_versions:plan-item-create", IdempotencyKey: "confirmed-no-reason"}
	_, e = CreateLightweightVersionPlanItem(ctx, db, identity, permit("product_versions", "edit"), permit("product_requests", "view"), permit("product_requests", "decide"), permit("product_priorities", "edit"), input)
	requireProductRule(t, e, "product_version_plan_reason_required")
	var scopes, items, links, valid int
	if e = db.QueryRow(`SELECT (SELECT COUNT(*) FROM product_version_plan_scopes),(SELECT COUNT(*) FROM product_planning_items),(SELECT COUNT(*) FROM product_planning_item_requests),(SELECT COUNT(*) FROM product_version_plan_confirmations WHERE invalidated_at IS NULL)`).Scan(&scopes, &items, &links, &valid); e != nil || scopes != 1 || items != 1 || links != 1 || valid != 1 {
		t.Fatalf("rollback scopes=%d items=%d links=%d confirmation=%d err=%v", scopes, items, links, valid, e)
	}
	input.Reason = "确认后新增"
	identity.IdempotencyKey = "confirmed-add"
	first, e := CreateLightweightVersionPlanItem(ctx, db, identity, permit("product_versions", "edit"), permit("product_requests", "view"), permit("product_requests", "decide"), permit("product_priorities", "edit"), input)
	if e != nil {
		t.Fatal(e)
	}
	replay, e := CreateLightweightVersionPlanItem(ctx, db, identity, permit("product_versions", "edit"), permit("product_requests", "view"), permit("product_requests", "decide"), permit("product_priorities", "edit"), input)
	if e != nil || !replay.Replayed || replay.ReceiptID != first.ReceiptID {
		t.Fatalf("replay=%+v err=%v", replay, e)
	}
	conflict := input
	conflict.ScopeSummary = "不同"
	_, e = CreateLightweightVersionPlanItem(ctx, db, identity, permit("product_versions", "edit"), permit("product_requests", "view"), permit("product_requests", "decide"), permit("product_priorities", "edit"), conflict)
	requireProductRule(t, e, "idempotency_payload_mismatch")
	identity.IdempotencyKey = "old-revision"
	_, e = CreateLightweightVersionPlanItem(ctx, db, identity, permit("product_versions", "edit"), permit("product_requests", "view"), permit("product_requests", "decide"), permit("product_priorities", "edit"), input)
	requireProductRule(t, e, "product_revision_conflict")
	if e = db.QueryRow(`SELECT (SELECT COUNT(*) FROM product_version_plan_scopes),(SELECT COUNT(*) FROM product_planning_items),(SELECT COUNT(*) FROM product_planning_item_requests)`).Scan(&scopes, &items, &links); e != nil || scopes != 2 || items != 2 || links != 2 {
		t.Fatalf("duplicate scopes=%d items=%d links=%d err=%v", scopes, items, links, e)
	}
}

func TestMySQLLightweightPlanDependencyChangeRequiresReconfirmation(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	const code = "P-SIMPLE-DEPS"
	workspaceFixture(t, db, code)
	if _, e := db.Exec(`INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES(?,'pm','manager','active',UTC_TIMESTAMP(3),'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code); e != nil {
		t.Fatal(e)
	}
	if _, e := db.Exec(`INSERT INTO product_versions(id,product_code,version_code,status,planned_release_date,business_owner_uid,planning_mode,revision,scope_revision,created_by,created_at,updated_at) VALUES(201,?,'v-deps','planning','2099-01-31','pm','simple',1,1,'pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code); e != nil {
		t.Fatal(e)
	}
	if _, e := db.Exec(`INSERT INTO product_version_plans(version_id,product_code,goal,starts_on,available_person_days,reserve_person_days,revision,scope_revision,created_by,updated_by,created_at,updated_at) VALUES(201,?,'依赖计划','2099-01-01',10,0,1,1,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, code); e != nil {
		t.Fatal(e)
	}
	insertScope := func(title string, order int32) (requestBiz, itemBiz string, scopeID int64) {
		requestBiz, itemBiz = uuid.NewString(), uuid.NewString()
		if _, e := db.Exec(`INSERT INTO product_requests(biz_id,product_code,title,problem_statement,source_type,urgency_level,decision_status,revision,created_by,updated_by,created_at,updated_at) VALUES(?,? ,?,'问题','internal','P2','accepted',1,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, requestBiz, code, title); e != nil {
			t.Fatal(e)
		}
		var requestID int64
		if e := db.QueryRow(`SELECT id FROM product_requests WHERE biz_id=?`, requestBiz).Scan(&requestID); e != nil {
			t.Fatal(e)
		}
		r, e := db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,urgency_level,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,'原范围','growth','P2','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, itemBiz, code, title)
		if e != nil {
			t.Fatal(e)
		}
		itemID, _ := r.LastInsertId()
		if _, e = db.Exec(`INSERT INTO product_planning_item_requests(product_code,planning_item_id,request_id,created_by,created_at) VALUES(?,?,?,?,UTC_TIMESTAMP(3))`, code, itemID, requestID, "pm"); e != nil {
			t.Fatal(e)
		}
		r, e = db.Exec(`INSERT INTO product_version_features(version_id,title,description,status,is_public,sort_order,created_by,created_at,updated_at,planning_item_id,change_type,acceptance_criteria) VALUES(201,?,'原范围','planned',0,?,'pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),?,'enhancement','验收标准')`, title, order, itemID)
		if e != nil {
			t.Fatal(e)
		}
		scopeID, _ = r.LastInsertId()
		if _, e = db.Exec(`INSERT INTO product_version_plan_scopes(version_feature_id,version_id,product_code,request_id,planning_item_id,scope_summary,estimate_person_days,created_by,updated_by,created_at,updated_at) VALUES(?,201,?,?,?,'原范围',1,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, scopeID, code, requestID, itemID); e != nil {
			t.Fatal(e)
		}
		return requestBiz, itemBiz, scopeID
	}
	// The predecessor initially follows the dependent. This is a confirmed,
	// valid plan before the legacy dependency writer changes its facts.
	_, predecessorBiz, predecessorScope := insertScope("前置", 1)
	requestBiz, dependentBiz, dependentScope := insertScope("依赖项", 0)
	if _, e := db.Exec(`INSERT INTO product_version_plan_confirmations(version_id,plan_revision,scope_revision,snapshot,confirmed_by,confirmed_at) VALUES(201,1,1,'{}','pm',UTC_TIMESTAMP(3))`); e != nil {
		t.Fatal(e)
	}
	ctx := context.Background()
	permit := func(resource, action string) AuthorizationPermit {
		p := workspacePermit(t, db, code, "pm", action)
		p.Resource = resource
		return p
	}
	firstPage, e := ListLightweightVersionPlanItems(ctx, db, code, "pm", 201, permit("product_versions", "view"), permit("product_requests", "view"), LightweightVersionPlanItemQuery{Page: 1, PageSize: 10})
	if e != nil || len(firstPage.Items) != 2 {
		t.Fatalf("first list=%+v err=%v", firstPage, e)
	}
	secondPage, e := ListLightweightVersionPlanItems(ctx, db, code, "pm", 201, permit("product_versions", "view"), permit("product_requests", "view"), LightweightVersionPlanItemQuery{Page: 1, PageSize: 10})
	if e != nil || firstPage.Items[0].BizID == "" || firstPage.Items[0].BizID != secondPage.Items[0].BizID || firstPage.Items[1].BizID != secondPage.Items[1].BizID {
		t.Fatalf("unstable scope identity first=%+v second=%+v err=%v", firstPage.Items, secondPage.Items, e)
	}
	if _, e = EditPlanningDependencies(ctx, db, CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_priorities:dependencies-edit", IdempotencyKey: "deps"}, permit("product_priorities", "edit"), PlanningDependenciesEdit{ItemBizID: dependentBiz, ExpectedRevision: 1, ExpectedItemRevision: 1, PredecessorBizIDs: []string{predecessorBiz}, Reason: "补充前置依赖"}); e != nil {
		t.Fatal(e)
	}
	var active, stale int
	if e = db.QueryRow(`SELECT COUNT(CASE WHEN invalidated_at IS NULL THEN 1 END),COUNT(CASE WHEN invalidated_at IS NOT NULL THEN 1 END) FROM product_version_plan_confirmations WHERE version_id=201`).Scan(&active, &stale); e != nil || active != 0 || stale != 1 {
		t.Fatalf("confirmation invalidation active=%d stale=%d err=%v", active, stale, e)
	}
	_, e = ConfirmLightweightVersionPlan(ctx, db, CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_versions:plan-confirm", IdempotencyKey: "blocked-confirm"}, permit("product_versions", "edit"), permit("product_priorities", "prioritize"), LightweightVersionPlanConfirm{VersionID: 201, ExpectedRevision: 2, ExpectedVersionRevision: 1, ExpectedPlanRevision: 1, ExpectedScopeRevision: 1})
	requireProductRule(t, e, "product_version_plan_confirm_invalid")
	_, e = TransitionProductVersion(ctx, db, CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_versions:transition", IdempotencyKey: "blocked-transition"}, permit("product_versions", "edit"), ProductVersionTransitionInput{VersionID: 201, ExpectedRevision: 2, ExpectedVersionRevision: 1, ToStatus: "developing", Reason: "开发"})
	requireProductRule(t, e, "product_version_plan_confirmation_required")
	_, e = HandoffPlanningItem(ctx, db, CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_priorities:handoff", IdempotencyKey: "blocked-handoff"}, permit("product_priorities", "handoff"), permit("product_requests", "handoff"), PlanningHandoffInput{PlanningDeliveryCheck: PlanningDeliveryCheck{ExpectedRevision: 2, ItemBizID: dependentBiz, ExpectedItemRevision: 2}, RequestBizID: requestBiz, ExpectedRequestRevision: 1, ProjectCode: "PJT", SliceKey: "blocked", Operation: "create", Title: "依赖项", ScopeSummary: "原范围", Reason: "交付", PlannedVersionID: 201, PlannedVersionFeatureID: dependentScope}, PlanningHandoffTarget{AuthorizeProject: func(context.Context, *sql.Tx) (int64, error) { return 1, nil }, ResolveRequirement: func(context.Context, *sql.Tx) (int64, error) { return 1, nil }})
	requireProductRule(t, e, "product_version_plan_confirmation_required")
	_, e = EditPlanningItem(ctx, db, CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_priorities:edit", IdempotencyKey: "legacy-edit"}, permit("product_priorities", "edit"), PlanningItemEdit{PlanningItemDraft: PlanningItemDraft{ExpectedRevision: 2, Title: "前置", ScopeSummary: "绕过范围", InvestmentCategory: "growth", UrgencyLevel: "P2", Requests: []PlanningRequestRef{{BizID: requestBiz, Revision: 1}}}, BizID: dependentBiz, ExpectedItemRevision: 2, Reason: "尝试旧入口"})
	requireProductRule(t, e, "product_version_plan_locked")
	updatedScope := "前置范围已调整"
	one, _ := ParseHundredths("1")
	if _, e = EditLightweightVersionPlanItem(ctx, db, CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_versions:plan-item-edit", IdempotencyKey: "reorder"}, permit("product_versions", "edit"), LightweightVersionPlanItemEdit{VersionID: 201, ScopeID: predecessorScope, ExpectedRevision: 2, ExpectedVersionRevision: 1, ExpectedPlanRevision: 1, ExpectedScopeRevision: 1, ScopeSummary: updatedScope, EstimatePersonDays: &one, AcceptanceCriteria: "验收标准", SortOrder: -1, Reason: "调整依赖顺序"}); e != nil {
		t.Fatal(e)
	}
	item, e := ReadPlanningItem(ctx, db, code, "pm", predecessorBiz, permit("product_priorities", "view"))
	if e != nil || item.ScopeSummary != updatedScope {
		t.Fatalf("scope synchronization item=%+v err=%v", item, e)
	}
	if _, e = ConfirmLightweightVersionPlan(ctx, db, CommandIdentity{ProductCode: code, ActorUID: "pm", Action: "product_versions:plan-confirm", IdempotencyKey: "reconfirm"}, permit("product_versions", "edit"), permit("product_priorities", "prioritize"), LightweightVersionPlanConfirm{VersionID: 201, ExpectedRevision: 3, ExpectedVersionRevision: 2, ExpectedPlanRevision: 1, ExpectedScopeRevision: 2}); e != nil {
		t.Fatal(e)
	}
}
