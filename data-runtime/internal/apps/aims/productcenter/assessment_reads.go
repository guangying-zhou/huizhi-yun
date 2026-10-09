package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
)

type PlanningAssessmentQuery struct {
	CycleBizID string `json:"cycle_biz_id"`
	ItemBizID  string `json:"item_biz_id"`
	Page       int    `json:"page"`
	PageSize   int    `json:"page_size"`
}
type PlanningAssessmentRecord struct {
	ModelMethod           string          `json:"model_method"`
	RICEImpact            *string         `json:"rice_impact"`
	ReachObservationBizID *string         `json:"reach_observation_biz_id"`
	ID                    int64           `json:"id"`
	ScopeRevision         uint64          `json:"scope_revision"`
	EvidenceRevision      uint64          `json:"evidence_revision"`
	ModelVersion          string          `json:"model_version"`
	ModelSnapshot         json.RawMessage `json:"model_snapshot"`
	Strategic             *int            `json:"strategic"`
	UserValue             *int            `json:"user_value"`
	Business              *int            `json:"business"`
	Risk                  *int            `json:"risk"`
	Confidence            *string         `json:"confidence"`
	Effort                *string         `json:"effort_person_days"`
	EffortUnit            string          `json:"effort_unit"`
	ValueScore            *int            `json:"value_score"`
	PriorityScore         *string         `json:"priority_score"`
	EvidenceSnapshot      json.RawMessage `json:"evidence_snapshot"`
	Rationale             json.RawMessage `json:"rationale"`
	AssessedBy            string          `json:"assessed_by"`
	EstimatedBy           *string         `json:"estimated_by"`
	AssessedAt            string          `json:"assessed_at"`
	IsCurrent             bool            `json:"is_current"`
	Stale                 bool            `json:"stale"`
}
type PlanningAssessmentPage struct {
	Items             []PlanningAssessmentRecord `json:"items"`
	Total             int                        `json:"total"`
	Page              int                        `json:"page"`
	PageSize          int                        `json:"pageSize"`
	CycleBizID        string                     `json:"cycle_biz_id"`
	ItemBizID         string                     `json:"item_biz_id"`
	CycleStatus       string                     `json:"cycle_status"`
	WorkspaceRevision uint64                     `json:"workspace_revision"`
	CycleRevision     uint64                     `json:"cycle_revision"`
	ItemRevision      uint64                     `json:"item_revision"`
}

func ValidatePlanningAssessmentQuery(q PlanningAssessmentQuery) error {
	for _, value := range []string{q.CycleBizID, q.ItemBizID} {
		id, err := uuid.Parse(value)
		if err != nil || id.String() != value {
			return invalid("assessment_identity_invalid", "评估周期或事项标识无效")
		}
	}
	return ValidatePlanningPageQuery(PlanningPageQuery{Page: q.Page, PageSize: q.PageSize})
}
func ListPlanningAssessments(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q PlanningAssessmentQuery) (PlanningAssessmentPage, error) {
	var out PlanningAssessmentPage
	if err := ValidatePlanningAssessmentQuery(q); err != nil {
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
	item, err := loadPlanningItemDetail(ctx, tx, code, q.ItemBizID)
	if err != nil {
		return out, err
	}
	var current sql.NullInt64
	if err = tx.QueryRowContext(ctx, `SELECT current_assessment_id FROM product_planning_cycle_items WHERE product_code=? AND cycle_id=? AND planning_item_id=?`, code, cycle.ID, item.ID).Scan(&current); err != nil {
		return out, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_priority_assessments WHERE cycle_id=? AND planning_item_id=?`, cycle.ID, item.ID).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,scope_revision,evidence_revision,model_version,model_snapshot,strategic,user_value,business,risk,confidence,effort_person_days,effort_unit,value_score,priority_score,evidence_snapshot,rationale,assessed_by,estimated_by,DATE_FORMAT(assessed_at,'%Y-%m-%dT%H:%i:%s.%fZ'),model_method,rice_impact,(SELECT o.biz_id FROM product_rice_reach_observations o WHERE o.id=product_priority_assessments.reach_observation_id AND o.planning_item_id=product_priority_assessments.planning_item_id) FROM product_priority_assessments WHERE cycle_id=? AND planning_item_id=? ORDER BY id DESC LIMIT ? OFFSET ?`, cycle.ID, item.ID, q.PageSize, (q.Page-1)*q.PageSize)
	if err != nil {
		return out, err
	}
	out.Items = []PlanningAssessmentRecord{}
	for rows.Next() {
		var record PlanningAssessmentRecord
		var model, evidence, rationale []byte
		if err = rows.Scan(&record.ID, &record.ScopeRevision, &record.EvidenceRevision, &record.ModelVersion, &model, &record.Strategic, &record.UserValue, &record.Business, &record.Risk, &record.Confidence, &record.Effort, &record.EffortUnit, &record.ValueScore, &record.PriorityScore, &evidence, &rationale, &record.AssessedBy, &record.EstimatedBy, &record.AssessedAt, &record.ModelMethod, &record.RICEImpact, &record.ReachObservationBizID); err != nil {
			rows.Close()
			return PlanningAssessmentPage{}, err
		}
		if !json.Valid(model) || !json.Valid(evidence) || !json.Valid(rationale) {
			rows.Close()
			return PlanningAssessmentPage{}, invalid("assessment_snapshot_invalid", "历史评估快照无效")
		}
		record.ModelSnapshot = model
		record.EvidenceSnapshot = evidence
		record.Rationale = rationale
		record.IsCurrent = current.Valid && current.Int64 == record.ID
		record.Stale = record.ScopeRevision != item.ScopeRevision || record.EvidenceRevision != item.EvidenceRevision || record.ModelVersion != cycle.ModelVersion
		out.Items = append(out.Items, record)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return PlanningAssessmentPage{}, err
	}
	out.Page = q.Page
	out.PageSize = q.PageSize
	out.CycleBizID = cycle.BizID
	out.ItemBizID = item.BizID
	out.CycleStatus = cycle.Status
	out.WorkspaceRevision = permit.Facts.Revision
	out.CycleRevision = cycle.Revision
	out.ItemRevision = item.Revision
	return out, tx.Commit()
}
