package productcenter

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
)

type PlanningCycleCandidateQuery struct {
	Sort               string `json:"sort"`
	InvestmentCategory string `json:"investment_category"`
	CycleBizID         string `json:"cycle_biz_id"`
	Page               int    `json:"page"`
	PageSize           int    `json:"page_size"`
	Keyword            string `json:"keyword"`
	SelectionStatus    string `json:"selection_status"`
}

type PlanningCandidateAssessment struct {
	ModelMethod   string  `json:"model_method"`
	RICEImpact    *string `json:"rice_impact"`
	ValueScore    *int    `json:"value_score"`
	PriorityScore *string `json:"priority_score"`
	Effort        *string `json:"effort_person_days"`
	Confidence    *string `json:"confidence"`
	ModelVersion  string  `json:"model_version"`
	Stale         bool    `json:"stale"`
}

type PlanningCycleCandidateRecord struct {
	Assessment *PlanningCandidateAssessment `json:"assessment"`
	PlanningItemRecord
	SelectionStatus string `json:"selection_status"`
	RoadmapBucket   string `json:"roadmap_bucket"`
	DecisionRank    uint64 `json:"decision_rank"`
	AssessmentID    *int64 `json:"current_assessment_id"`
}

type PlanningCycleCandidatePage struct {
	Items             []PlanningCycleCandidateRecord `json:"items"`
	Total             int                            `json:"total"`
	Page              int                            `json:"page"`
	PageSize          int                            `json:"pageSize"`
	CycleBizID        string                         `json:"cycle_biz_id"`
	CycleStatus       string                         `json:"cycle_status"`
	CycleRevision     uint64                         `json:"cycle_revision"`
	QueueRevision     uint64                         `json:"queue_revision"`
	WorkspaceRevision uint64                         `json:"workspace_revision"`
}

func ValidatePlanningCycleCandidateQuery(q PlanningCycleCandidateQuery) error {
	id, err := uuid.Parse(q.CycleBizID)
	if err != nil || id.String() != q.CycleBizID {
		return invalid("planning_cycle_id_invalid", "周期标识无效")
	}
	if err := ValidatePlanningPageQuery(PlanningPageQuery{Page: q.Page, PageSize: q.PageSize, Keyword: q.Keyword, InvestmentCategory: q.InvestmentCategory}); err != nil {
		return err
	}
	if q.Sort != "" && q.Sort != "decision" && q.Sort != "recommended" {
		return invalid("planning_candidate_query_invalid", "候选排序方式无效")
	}
	switch q.SelectionStatus {
	case "", "candidate", "selected", "deferred":
	default:
		return invalid("planning_candidate_query_invalid", "周期选择状态无效")
	}
	return nil
}

// Candidate reads preserve the decision order by default. Recommended sorting
// is a read-only comparison within categories and never mutates the queue.
func ListPlanningCycleCandidates(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q PlanningCycleCandidateQuery) (PlanningCycleCandidatePage, error) {
	var out PlanningCycleCandidatePage
	if err := ValidatePlanningCycleCandidateQuery(q); err != nil {
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
	cycle, err := loadPlanningCycle(ctx, tx, code, q.CycleBizID)
	if err != nil {
		return out, err
	}
	out, err = loadPlanningCycleCandidates(ctx, tx, code, permit, cycle, q)
	if err != nil {
		return PlanningCycleCandidatePage{}, err
	}
	return out, tx.Commit()
}

// Caller owns root authorization and validates query bounds. Matrix uses its fixed 200-item bound.
func loadPlanningCycleCandidates(ctx context.Context, tx *sql.Tx, code string, permit AuthorizationPermit, cycle PlanningCycleRecord, q PlanningCycleCandidateQuery) (PlanningCycleCandidatePage, error) {
	var out PlanningCycleCandidatePage
	where := ` FROM product_planning_cycle_items c JOIN product_planning_items i ON i.id=c.planning_item_id AND i.product_code=c.product_code LEFT JOIN product_priority_assessments a ON a.id=c.current_assessment_id AND a.cycle_id=c.cycle_id AND a.planning_item_id=c.planning_item_id WHERE c.product_code=? AND c.cycle_id=? AND (?='' OR i.investment_category=?) AND (?='' OR c.selection_status=?) AND (?='' OR LOCATE(?,i.title)>0 OR LOCATE(?,i.scope_summary)>0)`
	args := []any{code, cycle.ID, q.InvestmentCategory, q.InvestmentCategory, q.SelectionStatus, q.SelectionStatus, q.Keyword, q.Keyword, q.Keyword}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	order := " ORDER BY c.decision_rank,i.id"
	readArgs := append([]any{}, args...)
	if q.Sort == "recommended" {
		// Scores are comparable only within a category and for current, unstarted scopes.
		valid := "i.lifecycle='proposed' AND a.priority_score IS NOT NULL AND a.scope_revision=i.scope_revision AND a.evidence_revision=i.evidence_revision AND a.model_version=?"
		order = " ORDER BY i.investment_category,CASE WHEN " + valid + " THEN 0 ELSE 1 END,CASE WHEN " + valid + " THEN a.priority_score ELSE NULL END DESC,i.biz_id"
		readArgs = append(readArgs, cycle.ModelVersion, cycle.ModelVersion)
	}
	rows, err := tx.QueryContext(ctx, `SELECT i.id,i.biz_id,i.product_code,i.title,i.scope_summary,i.feature_id,i.urgency_level,DATE_FORMAT(i.deadline,'%Y-%m-%d'),i.investment_category,i.lifecycle,i.scope_revision,i.evidence_revision,i.revision,c.selection_status,c.roadmap_bucket,c.decision_rank,c.current_assessment_id,a.value_score,a.priority_score,a.effort_person_days,a.confidence,a.model_version,a.scope_revision,a.evidence_revision,a.model_method,a.rice_impact`+where+order+` LIMIT ? OFFSET ?`, append(readArgs, q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return out, err
	}
	out.Items = []PlanningCycleCandidateRecord{}
	for rows.Next() {
		var item PlanningCycleCandidateRecord
		var assessment PlanningCandidateAssessment
		var model, method sql.NullString
		var scopeRevision, evidenceRevision sql.NullInt64
		if err = rows.Scan(&item.ID, &item.BizID, &item.ProductCode, &item.Title, &item.ScopeSummary, &item.FeatureID, &item.UrgencyLevel, &item.Deadline, &item.InvestmentCategory, &item.Lifecycle, &item.ScopeRevision, &item.EvidenceRevision, &item.Revision, &item.SelectionStatus, &item.RoadmapBucket, &item.DecisionRank, &item.AssessmentID, &assessment.ValueScore, &assessment.PriorityScore, &assessment.Effort, &assessment.Confidence, &model, &scopeRevision, &evidenceRevision, &method, &assessment.RICEImpact); err != nil {
			rows.Close()
			return PlanningCycleCandidatePage{}, err
		}
		if item.AssessmentID != nil {
			if !method.Valid || (method.String != "rice" && method.String != "weighted-value-effort") || !model.Valid || !scopeRevision.Valid || !evidenceRevision.Valid {
				rows.Close()
				return PlanningCycleCandidatePage{}, invalid("assessment_snapshot_invalid", "当前评估引用不完整")
			}
			assessment.ModelMethod = method.String
			assessment.ModelVersion = model.String
			assessment.Stale = uint64(scopeRevision.Int64) != item.ScopeRevision || uint64(evidenceRevision.Int64) != item.EvidenceRevision || model.String != cycle.ModelVersion
			item.Assessment = &assessment
		}
		out.Items = append(out.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return PlanningCycleCandidatePage{}, err
	}
	out.Page = q.Page
	out.PageSize = q.PageSize
	out.CycleBizID = cycle.BizID
	out.CycleStatus = cycle.Status
	out.CycleRevision = cycle.Revision
	out.QueueRevision = cycle.QueueRevision
	out.WorkspaceRevision = permit.Facts.Revision
	return out, nil
}
