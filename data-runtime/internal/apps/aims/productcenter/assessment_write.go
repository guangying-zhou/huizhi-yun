package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// AssessmentEvidence is an attributed manual observation, not a verified external record.
type AssessmentEvidence struct {
	Key        string `json:"key"`
	Summary    string `json:"summary"`
	ObservedOn string `json:"observed_on"`
	Kind       string `json:"kind"`
	Polarity   string `json:"polarity"`
}
type PlanningAssessmentCreate struct {
	PlanningCycleCandidateAdd
	ExpectedScopeRevision    uint64               `json:"expected_scope_revision"`
	ExpectedEvidenceRevision uint64               `json:"expected_evidence_revision"`
	Assessment               AssessmentInput      `json:"assessment"`
	EvidenceReferences       map[string][]string  `json:"evidence_references"`
	Rationale                map[string]string    `json:"rationale"`
	Evidence                 []AssessmentEvidence `json:"evidence"`
	EstimateConfirmed        bool                 `json:"estimate_confirmed"`
}

var assessmentEvidenceKey = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)

func ValidatePlanningAssessmentCreate(input PlanningAssessmentCreate) (AssessmentScore, error) {
	return validatePlanningAssessmentWithModel(input, DefaultWeightedAssessmentModel())
}

func validatePlanningAssessmentWithModel(input PlanningAssessmentCreate, model WeightedAssessmentModel) (AssessmentScore, error) {
	if err := ValidatePlanningCycleCandidateAdd(input.PlanningCycleCandidateAdd); err != nil {
		return AssessmentScore{}, err
	}
	if input.ExpectedScopeRevision == 0 || input.ExpectedEvidenceRevision == 0 {
		return AssessmentScore{}, invalid("assessment_revision_required", "必须提供范围与证据版本")
	}
	score, err := CalculateAssessmentWithModel(input.Assessment, model)
	if err != nil {
		return score, err
	}
	dimensions := map[string]bool{"strategic": input.Assessment.Strategic != nil, "user_value": input.Assessment.UserValue != nil, "business": input.Assessment.Business != nil, "risk": input.Assessment.Risk != nil, "confidence": input.Assessment.Confidence != nil, "effort_person_days": input.Assessment.Effort != nil}
	return score, validateAssessmentEvidence(dimensions, input.Rationale, input.EvidenceReferences, input.Evidence, input.Assessment.Effort != nil, input.EstimateConfirmed)
}

func validateAssessmentEvidence(dimensions map[string]bool, rationale map[string]string, references map[string][]string, evidence []AssessmentEvidence, effortPresent, estimateConfirmed bool) error {
	validText := func(s string, max int) bool {
		return strings.TrimSpace(s) != "" && utf8.ValidString(s) && !strings.ContainsRune(s, '\x00') && utf8.RuneCountInString(s) <= max
	}
	for key, reason := range rationale {
		if _, ok := dimensions[key]; !ok || !validText(reason, 2000) {
			return invalid("assessment_rationale_invalid", "评估依据字段或内容无效")
		}
	}
	for key, present := range dimensions {
		if present && !validText(rationale[key], 2000) {
			return invalid("assessment_rationale_required", "已填写的评估维度必须说明依据")
		}
	}
	if effortPresent && !estimateConfirmed {
		return invalid("assessment_estimate_confirmation_required", "请确认本次范围的总投入估计")
	}
	if !effortPresent && estimateConfirmed {
		return invalid("assessment_estimate_confirmation_invalid", "未知投入不能标记已确认")
	}
	if evidence == nil || len(evidence) > 100 {
		return invalid("assessment_evidence_invalid", "必须显式提供最多 100 条证据说明，未知可为空数组")
	}
	if len(rationale) > 0 && len(evidence) == 0 {
		return invalid("assessment_evidence_required", "评估依据至少关联一条事实或假设说明")
	}
	evidenceKeys := make(map[string]bool, len(evidence))
	for _, e := range evidence {
		if !assessmentEvidenceKey.MatchString(e.Key) || evidenceKeys[e.Key] {
			return invalid("assessment_evidence_key_invalid", "证据标识必须有效且在本次评估内唯一")
		}
		evidenceKeys[e.Key] = true
		date, err := time.Parse("2006-01-02", e.ObservedOn)
		if err != nil || date.Year() < 1000 || date.Format("2006-01-02") != e.ObservedOn || !validText(e.Summary, 2000) || (e.Kind != "fact" && e.Kind != "hypothesis") || (e.Polarity != "supporting" && e.Polarity != "opposing" && e.Polarity != "neutral") {
			return invalid("assessment_evidence_invalid", "证据需要有效日期、摘要、事实或假设分类和正反立场")
		}
	}
	for dimension, refs := range references {
		if _, known := dimensions[dimension]; !known || len(refs) == 0 || len(refs) > 100 {
			return invalid("assessment_evidence_reference_invalid", "证据引用维度或数量无效")
		}
		if !validText(rationale[dimension], 2000) {
			return invalid("assessment_rationale_required", "引用证据时须说明该维度依据")
		}
		seen := map[string]bool{}
		for _, key := range refs {
			if !evidenceKeys[key] || seen[key] {
				return invalid("assessment_evidence_reference_invalid", "证据引用不存在或重复")
			}
			seen[key] = true
		}
	}
	for dimension, present := range dimensions {
		if (present || rationale[dimension] != "") && len(references[dimension]) == 0 {
			return invalid("assessment_evidence_reference_required", "每项评分及依据必须关联具体证据")
		}
	}
	return nil
}

func CreatePlanningAssessment(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input PlanningAssessmentCreate) (CommandResult, error) {
	if identity.Action != "product_priorities:assess" {
		return CommandResult{}, invalid("product_command_identity_invalid", "评估命令不匹配")
	}
	validationInput := input
	validationInput.Assessment.ModelVersion = AssessmentModel
	_, err := ValidatePlanningAssessmentCreate(validationInput)
	if err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_priorities", "assess", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品空间已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请刷新后重试")
		}
		cycle, err := loadPlanningCycle(ctx, tx, identity.ProductCode, input.CycleBizID)
		if err != nil {
			return nil, err
		}
		if cycle.Revision != input.ExpectedCycleRevision {
			return nil, invalid("planning_cycle_revision_conflict", "周期已变化，请刷新后重试")
		}
		if cycle.Status != "open" {
			return nil, invalid("planning_cycle_readonly", "仅开放周期可以追加评估")
		}
		if cycle.ModelVersion != input.Assessment.ModelVersion {
			return nil, invalid("assessment_model_mismatch", "周期评估模型不匹配")
		}
		frozenModel, err := loadFrozenWeightedModel(ctx, tx, identity.ProductCode, cycle.ModelVersion, cycle.ModelSnapshot)
		if err != nil {
			return nil, err
		}
		score, err := validatePlanningAssessmentWithModel(input, frozenModel)
		if err != nil {
			return nil, err
		}

		item, err := loadPlanningItemDetail(ctx, tx, identity.ProductCode, input.ItemBizID)
		if err != nil {
			return nil, err
		}
		if item.Revision != input.ExpectedItemRevision || item.ScopeRevision != input.ExpectedScopeRevision || item.EvidenceRevision != input.ExpectedEvidenceRevision {
			return nil, invalid("product_planning_revision_conflict", "事项范围或证据已变化，请重新评估")
		}
		if item.Lifecycle != "proposed" && item.Lifecycle != "in_delivery" {
			return nil, invalid("product_planning_readonly", "当前事项不可评估")
		}
		var member int64
		if err = tx.QueryRowContext(ctx, `SELECT planning_item_id FROM product_planning_cycle_items WHERE cycle_id=? AND planning_item_id=? AND product_code=?`, cycle.ID, item.ID, identity.ProductCode).Scan(&member); err != nil {
			return nil, err
		}
		rationale, err := json.Marshal(map[string]any{"reasons": input.Rationale, "evidence_references": input.EvidenceReferences})
		if err != nil {
			return nil, err
		}
		evidence, err := json.Marshal(map[string]any{"manual_observations": input.Evidence, "requests": item.Requests, "scope_summary": item.ScopeSummary, "investment_category": item.InvestmentCategory, "recorded_by": identity.ActorUID})
		if err != nil {
			return nil, err
		}
		model, err := json.Marshal(map[string]any{"cycle_model": cycle.ModelSnapshot, "dimension_scale": "integer_0_to_5", "value_scale": 100, "priority_decimal_places": 8, "rounding": "half_up", "scope": "same_product_cycle_category", "missing": "null", "effort_includes": []string{"design", "development", "testing", "release_preparation"}})
		if err != nil {
			return nil, err
		}
		var estimator any
		if input.EstimateConfirmed {
			estimator = identity.ActorUID
		}
		var confidence, effort any
		if input.Assessment.Confidence != nil {
			confidence = input.Assessment.Confidence.String()
		}
		if input.Assessment.Effort != nil {
			effort = input.Assessment.Effort.String()
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO product_priority_assessments(cycle_id,planning_item_id,scope_revision,evidence_revision,model_version,model_snapshot,strategic,user_value,business,risk,confidence,effort_person_days,effort_unit,value_score,priority_score,evidence_snapshot,rationale,assessed_by,estimated_by,assessed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, cycle.ID, item.ID, item.ScopeRevision, item.EvidenceRevision, cycle.ModelVersion, model, input.Assessment.Strategic, input.Assessment.UserValue, input.Assessment.Business, input.Assessment.Risk, confidence, effort, "person_day", score.Value, score.PriorityDecimal(), evidence, rationale, identity.ActorUID, estimator)
		if err != nil {
			return nil, err
		}
		assessmentID, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycle_items SET current_assessment_id=? WHERE cycle_id=? AND planning_item_id=?`, assessmentID, cycle.ID, item.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_planning_cycles SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?`, identity.ActorUID, cycle.ID); err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"assessment_id": assessmentID, "item_biz_id": item.BizID, "cycle_biz_id": cycle.BizID, "score": score, "workspace_revision": root.Revision + 1, "cycle_revision": cycle.Revision + 1, "queue_revision": cycle.QueueRevision}
		changes, err := json.Marshal(map[string]any{"after": out})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'planning_item',?,'assess',?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, item.BizID, identity.ActorUID, cycle.Revision+1, changes, identity.IdempotencyKey)
		return out, err
	})
}
