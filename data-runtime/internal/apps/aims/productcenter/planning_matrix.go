package productcenter

import (
	"context"
	"database/sql"
)

type PlanningMatrixQuery struct {
	CycleBizID         string `json:"cycle_biz_id"`
	Keyword            string `json:"keyword"`
	InvestmentCategory string `json:"investment_category"`
	SelectionStatus    string `json:"selection_status"`
}
type PlanningMatrix struct {
	ModelMethod       string                         `json:"model_method"`
	Points            []PlanningCycleCandidateRecord `json:"points"`
	Unplotted         []PlanningCycleCandidateRecord `json:"unplotted"`
	Total             int                            `json:"total"`
	Returned          int                            `json:"returned"`
	Limit             int                            `json:"limit"`
	Truncated         bool                           `json:"truncated"`
	CycleBizID        string                         `json:"cycle_biz_id"`
	WorkspaceRevision uint64                         `json:"workspace_revision"`
	CycleRevision     uint64                         `json:"cycle_revision"`
	QueueRevision     uint64                         `json:"queue_revision"`
	ValueThreshold    string                         `json:"value_threshold"`
	EffortThreshold   string                         `json:"effort_threshold_person_days"`
}

func ReadPlanningMatrix(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, input PlanningMatrixQuery) (PlanningMatrix, error) {
	var out PlanningMatrix
	query := PlanningCycleCandidateQuery{CycleBizID: input.CycleBizID, Keyword: input.Keyword, InvestmentCategory: input.InvestmentCategory, SelectionStatus: input.SelectionStatus, Page: 1, PageSize: 100}
	if err := ValidatePlanningCycleCandidateQuery(query); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	cycle, err := loadPlanningCycle(ctx, tx, code, input.CycleBizID)
	if err != nil {
		return out, err
	}
	query.PageSize = 200
	candidates, err := loadPlanningCycleCandidates(ctx, tx, code, permit, cycle, query)
	if err != nil {
		return out, err
	}
	out = PlanningMatrix{Points: []PlanningCycleCandidateRecord{}, Unplotted: []PlanningCycleCandidateRecord{}, Total: candidates.Total, Returned: len(candidates.Items), Limit: 200, Truncated: candidates.Total > 200, CycleBizID: cycle.BizID, WorkspaceRevision: permit.Facts.Revision, CycleRevision: cycle.Revision, QueueRevision: cycle.QueueRevision}
	if err = tx.QueryRowContext(ctx, `SELECT matrix_value_threshold,matrix_effort_threshold FROM product_planning_cycles WHERE id=? AND product_code=?`, cycle.ID, code).Scan(&out.ValueThreshold, &out.EffortThreshold); err != nil {
		return PlanningMatrix{}, err
	}
	out.ModelMethod = "weighted-value-effort"
	if cycle.ModelVersion != "weighted-value-effort-v1" {
		if err = tx.QueryRowContext(ctx, "SELECT method FROM product_priority_model_versions WHERE product_code=? AND version=?", code, cycle.ModelVersion).Scan(&out.ModelMethod); err != nil {
			return PlanningMatrix{}, err
		}
	}
	if out.ModelMethod != "rice" && out.ModelMethod != "weighted-value-effort" {
		return PlanningMatrix{}, invalid("assessment_model_mismatch", "矩阵模型方法不受支持")
	}
	for _, candidate := range candidates.Items {
		assessment := candidate.Assessment
		if assessment == nil || assessment.Stale || (out.ModelMethod == "weighted-value-effort" && assessment.ValueScore == nil) || assessment.ModelMethod != out.ModelMethod || assessment.Effort == nil || assessment.Confidence == nil || assessment.PriorityScore == nil {
			out.Unplotted = append(out.Unplotted, candidate)
		} else {
			out.Points = append(out.Points, candidate)
		}
	}
	return out, tx.Commit()
}
