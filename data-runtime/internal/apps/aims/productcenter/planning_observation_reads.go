package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/google/uuid"
)

type PlanningObservationQuery struct {
	CycleBizID string `json:"cycle_biz_id"`
	Page       int    `json:"page"`
	PageSize   int    `json:"page_size"`
}
type PlanningObservationRecord struct {
	ID             int64           `json:"id"`
	MetricSnapshot json.RawMessage `json:"metric_snapshot"`
	ObservedValue  *string         `json:"observed_value"`
	ObservedAt     string          `json:"observed_at"`
	Evidence       json.RawMessage `json:"evidence"`
	Conclusion     string          `json:"conclusion"`
	CorrectionOfID *int64          `json:"correction_of_id"`
	CorrectedByID  *int64          `json:"corrected_by_id"`
	RecordedBy     string          `json:"recorded_by"`
	RecordedAt     string          `json:"recorded_at"`
}
type PlanningObservationPage struct {
	Items             []PlanningObservationRecord `json:"items"`
	Total             int                         `json:"total"`
	Page              int                         `json:"page"`
	PageSize          int                         `json:"pageSize"`
	CycleBizID        string                      `json:"cycle_biz_id"`
	CycleStatus       string                      `json:"cycle_status"`
	WorkspaceRevision uint64                      `json:"workspace_revision"`
	CycleRevision     uint64                      `json:"cycle_revision"`
}

func ValidatePlanningObservationQuery(q PlanningObservationQuery) error {
	id, err := uuid.Parse(q.CycleBizID)
	if err != nil || id.String() != q.CycleBizID {
		return invalid("planning_cycle_id_invalid", "周期标识无效")
	}
	return ValidatePlanningPageQuery(PlanningPageQuery{Page: q.Page, PageSize: q.PageSize})
}
func ListPlanningObservations(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q PlanningObservationQuery) (PlanningObservationPage, error) {
	var out PlanningObservationPage
	if err := ValidatePlanningObservationQuery(q); err != nil {
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
	out = PlanningObservationPage{Items: []PlanningObservationRecord{}, Page: q.Page, PageSize: q.PageSize, CycleBizID: cycle.BizID, CycleStatus: cycle.Status, WorkspaceRevision: permit.Facts.Revision, CycleRevision: cycle.Revision}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_outcome_observations WHERE cycle_id=?`, cycle.ID).Scan(&out.Total); err != nil {
		return out, err
	}
	// Determine supersession across the whole cycle, not only the visible page.
	rows, err := tx.QueryContext(ctx, planningObservationSelect+` ORDER BY o.id DESC LIMIT ? OFFSET ?`, cycle.ID, q.PageSize, (q.Page-1)*q.PageSize)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var r PlanningObservationRecord
		if err = rows.Scan(&r.ID, &r.MetricSnapshot, &r.ObservedValue, &r.ObservedAt, &r.Evidence, &r.Conclusion, &r.CorrectionOfID, &r.CorrectedByID, &r.RecordedBy, &r.RecordedAt); err != nil {
			rows.Close()
			return out, err
		}
		if !json.Valid(r.MetricSnapshot) || !json.Valid(r.Evidence) {
			rows.Close()
			return out, invalid("planning_observation_invalid", "观测快照格式无效")
		}
		out.Items = append(out.Items, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

const planningObservationSelect = `SELECT o.id,o.metric_snapshot,o.observed_value,DATE_FORMAT(o.observed_at,'%Y-%m-%dT%H:%i:%s.%fZ'),o.evidence,o.conclusion,o.correction_of_id,(SELECT MIN(c.id) FROM product_outcome_observations c WHERE c.cycle_id=o.cycle_id AND c.correction_of_id=o.id),o.recorded_by,DATE_FORMAT(o.recorded_at,'%Y-%m-%dT%H:%i:%s.%fZ') FROM product_outcome_observations o WHERE o.cycle_id=?`

type PlanningObservationDetailQuery struct {
	CycleBizID    string `json:"cycle_biz_id"`
	ObservationID int64  `json:"observation_id"`
}
type PlanningObservationDetail struct {
	PlanningObservationRecord
	CycleBizID        string `json:"cycle_biz_id"`
	CycleStatus       string `json:"cycle_status"`
	WorkspaceRevision uint64 `json:"workspace_revision"`
	CycleRevision     uint64 `json:"cycle_revision"`
}

func ReadPlanningObservation(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q PlanningObservationDetailQuery) (PlanningObservationDetail, error) {
	var out PlanningObservationDetail
	if err := ValidatePlanningObservationQuery(PlanningObservationQuery{CycleBizID: q.CycleBizID, Page: 1, PageSize: 1}); err != nil {
		return out, err
	}
	if q.ObservationID < 1 {
		return out, invalid("planning_observation_invalid", "观测标识无效")
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
	r := &out.PlanningObservationRecord
	err = tx.QueryRowContext(ctx, planningObservationSelect+` AND o.id=?`, cycle.ID, q.ObservationID).Scan(&r.ID, &r.MetricSnapshot, &r.ObservedValue, &r.ObservedAt, &r.Evidence, &r.Conclusion, &r.CorrectionOfID, &r.CorrectedByID, &r.RecordedBy, &r.RecordedAt)
	if err != nil {
		return out, err
	}
	if !json.Valid(r.MetricSnapshot) || !json.Valid(r.Evidence) {
		return out, invalid("planning_observation_invalid", "观测快照格式无效")
	}
	out.CycleBizID = cycle.BizID
	out.CycleStatus = cycle.Status
	out.WorkspaceRevision = permit.Facts.Revision
	out.CycleRevision = cycle.Revision
	return out, tx.Commit()
}
