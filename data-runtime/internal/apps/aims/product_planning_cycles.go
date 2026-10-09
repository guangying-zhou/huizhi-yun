package aims

import (
	"context"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProductPlanningCycleListRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-cycles:list")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.cycle-list"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningCyclePageQuery
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ListPlanningCycles(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningCycleViewRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-cycles:view")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.cycle-view"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input struct {
		BizID string `json:"biz_id"`
	}
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ReadPlanningCycle(ctx, a.DB(), code, query.Get("current_user"), input.BizID, permit)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningCycleCreateRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-cycles:create")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.cycle-create"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:create"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningCycleDraft
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:cycle-create", IdempotencyKey: key}
	result, err := productcenter.CreatePlanningCycle(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningCycleEditRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-cycles:edit")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.cycle-edit"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:edit"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningCycleEdit
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:cycle-edit", IdempotencyKey: key}
	result, err := productcenter.EditPlanningCycle(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningCycleOpenRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-cycles:open")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.cycle-open"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:cycle-open"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningCycleTransition
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:cycle-open", IdempotencyKey: key}
	result, err := productcenter.OpenPlanningCycle(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningCandidateListRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-candidates:list")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.candidate-list"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningCycleCandidateQuery
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ListPlanningCycleCandidates(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningCandidateAddRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-candidates:add")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.candidate-add"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:edit"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningCycleCandidateAdd
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:candidate-add", IdempotencyKey: key}
	result, err := productcenter.AddPlanningCycleCandidate(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningAssessmentCreateRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-assessments:create")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.assess"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:assess"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningAssessmentCreate
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:assess", IdempotencyKey: key}
	result, err := productcenter.CreatePlanningAssessment(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningRICEAssessmentCreateRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-assessments:rice-create")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.rice-assess"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:rice-assess"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningRICEAssessmentCreate
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:rice-assess", IdempotencyKey: key}
	result, err := productcenter.CreatePlanningRICEAssessment(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningAssessmentListRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-assessments:list")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.assessment-list"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningAssessmentQuery
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ListPlanningAssessments(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningQueueMoveRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-queue:move")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.move"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:move"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningQueueMove
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:move", IdempotencyKey: key}
	result, err := productcenter.MovePlanningQueue(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningQueuePreviewRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-queue:preview")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.move-preview"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningQueueMove
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.PreviewPlanningQueueMove(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningMatrixRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-matrix:view")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.matrix-view"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningMatrixQuery
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ReadPlanningMatrix(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningCapacityRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-capacity:view")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.capacity-view"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input struct {
		CycleBizID string `json:"cycle_biz_id"`
	}
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ReadPlanningCapacity(ctx, a.DB(), code, query.Get("current_user"), input.CycleBizID, permit)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningSelectionPreviewRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-selection:preview")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.selection-preview"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningSelection
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.PreviewPlanningSelection(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningSelectionRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-selection:select")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.select"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:select"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningSelection
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:select", IdempotencyKey: key}
	result, err := productcenter.SelectPlanningCandidate(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningDependenciesReadRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-dependencies:view")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.dependencies-view"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input struct {
		ItemBizID string `json:"item_biz_id"`
	}
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ReadPlanningDependencies(ctx, a.DB(), code, query.Get("current_user"), input.ItemBizID, permit)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningDependenciesEditRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-dependencies:edit")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.dependencies-edit"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:edit"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningDependenciesEdit
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:dependencies-edit", IdempotencyKey: key}
	result, err := productcenter.EditPlanningDependencies(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningCycleCloseRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-cycles:close")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.cycle-close"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:cycle-close"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningCycleTransition
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:cycle-close", IdempotencyKey: key}
	result, err := productcenter.ClosePlanningCycle(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningObservationListRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-observations:list")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.observation-list"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningObservationQuery
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ListPlanningObservations(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningObservationCreateRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-observations:create")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.observe"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:observe"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningObservationCreate
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:observation-create", IdempotencyKey: key}
	result, err := productcenter.CreatePlanningObservation(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningObservationViewRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-observations:view")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.observation-view"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningObservationDetailQuery
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ReadPlanningObservation(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningBudgetChangeRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-budget:change")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.budget-change"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:budget-change"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningBudgetChange
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:budget-change", IdempotencyKey: key}
	result, err := productcenter.ChangePlanningBudget(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningBudgetPreviewRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-budget:preview")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.budget-preview"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningBudgetChange
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.PreviewPlanningBudget(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningWithdrawalRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-withdrawal:withdraw")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.withdraw"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:withdraw"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningWithdrawal
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:withdraw", IdempotencyKey: key}
	result, err := productcenter.WithdrawPlanningCandidate(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningWithdrawalPreviewRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-withdrawal:preview")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.withdrawal-preview"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningWithdrawal
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.PreviewPlanningWithdrawal(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningConsumptionConfirmRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-consumption:confirm")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.consumption-confirm"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:consumption-confirm"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningConsumptionConfirm
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:consumption-confirm", IdempotencyKey: key}
	result, err := productcenter.ConfirmPlanningConsumption(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningConsumptionViewRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-consumption:view")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.consumption-view"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input struct {
		CycleID string `json:"cycle_biz_id"`
		ItemID  string `json:"item_biz_id"`
	}
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ReadPlanningConsumption(ctx, a.DB(), code, query.Get("current_user"), input.CycleID, input.ItemID, permit)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningCycleReviewRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-cycles:review")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.cycle-review"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:cycle-review"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningCycleTransition
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	key, _ := body["idempotency_key"].(string)
	identity := productcenter.CommandIdentity{ProductCode: code, ActorUID: query.Get("current_user"), Action: "product_priorities:cycle-review", IdempotencyKey: key}
	result, err := productcenter.ReviewPlanningCycle(ctx, a.DB(), identity, permit, input)
	return result, operation, true, productRuntimeError(err)
}

func (a *Adapter) handleProductPlanningReviewListRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	code, match := pathParam(path, "/v1/aims/internal/products/", "/planning-reviews:list")
	if !match {
		return nil, "", false, nil
	}
	operation := "aims.product-priorities.review-list"
	if method != http.MethodPost {
		return nil, operation, true, httperror.New(405, "method_not_allowed", "POST required")
	}
	if err := requireProductServiceCapability(query, "aims:product-priorities:read"); err != nil {
		return nil, operation, true, err
	}
	var input productcenter.PlanningObservationQuery
	var permit productcenter.AuthorizationPermit
	for _, part := range []struct {
		key    string
		target any
	}{{"input", &input}, {"authorization", &permit}} {
		if err := decodeProductCommandPart(body[part.key], part.target); err != nil {
			return nil, operation, true, err
		}
	}
	result, err := productcenter.ListPlanningCycleReviews(ctx, a.DB(), code, query.Get("current_user"), permit, input)
	return result, operation, true, productRuntimeError(err)
}
