package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type PlanningCycleRecord struct {
	ID                 int64                `json:"id"`
	BizID              string               `json:"biz_id"`
	ProductCode        string               `json:"product_code"`
	Title              string               `json:"title"`
	StartsOn           string               `json:"starts_on"`
	EndsOn             string               `json:"ends_on"`
	GoalSummary        string               `json:"goal_summary"`
	Budget             *PlanningCycleBudget `json:"budget"`
	ModelVersion       string               `json:"model_version"`
	ModelSnapshot      json.RawMessage      `json:"model_snapshot"`
	MetricDefinition   json.RawMessage      `json:"metric_definition"`
	BaselineValue      *string              `json:"baseline_value"`
	TargetValue        *string              `json:"target_value"`
	ReviewIntervalDays int                  `json:"review_interval_days"`
	NextReviewAt       *string              `json:"next_review_at"`
	Status             string               `json:"status"`
	Revision           uint64               `json:"revision"`
	QueueRevision      uint64               `json:"queue_revision"`
}

type PlanningCycleDetail struct {
	PlanningCycleRecord
	WorkspaceRevision uint64 `json:"workspace_revision"`
}

type PlanningCyclePageQuery struct {
	ReviewDue bool   `json:"review_due"`
	Page      int    `json:"page"`
	PageSize  int    `json:"page_size"`
	Keyword   string `json:"keyword"`
	Status    string `json:"status"`
}

type PlanningCyclePage struct {
	Items             []PlanningCycleRecord `json:"items"`
	Total             int                   `json:"total"`
	Page              int                   `json:"page"`
	PageSize          int                   `json:"pageSize"`
	WorkspaceRevision uint64                `json:"workspace_revision"`
}

func ValidatePlanningCyclePageQuery(q PlanningCyclePageQuery) error {
	if q.Page < 1 || q.Page > 1000000 || q.PageSize < 1 || q.PageSize > 100 || !utf8.ValidString(q.Keyword) || utf8.RuneCountInString(q.Keyword) > 200 || strings.ContainsRune(q.Keyword, '\x00') {
		return invalid("planning_cycle_query_invalid", "周期分页或关键词无效")
	}
	switch q.Status {
	case "", "draft", "open", "closed":
	default:
		return invalid("planning_cycle_query_invalid", "周期状态无效")
	}
	return nil
}

const planningCycleColumns = `id,biz_id,product_code,title,DATE_FORMAT(starts_on,'%Y-%m-%d'),DATE_FORMAT(ends_on,'%Y-%m-%d'),goal_summary,total_person_days,reserve_person_days,reliability_person_days,usability_person_days,growth_person_days,model_version,model_snapshot,metric_definition,baseline_value,target_value,review_interval_days,DATE_FORMAT(next_review_at,'%Y-%m-%dT%H:%i:%s.%fZ'),status,revision,queue_revision`

func scanPlanningCycle(row interface{ Scan(...any) error }) (PlanningCycleRecord, error) {
	var out PlanningCycleRecord
	var amounts [5]sql.NullString
	var model, metric []byte
	err := row.Scan(&out.ID, &out.BizID, &out.ProductCode, &out.Title, &out.StartsOn, &out.EndsOn, &out.GoalSummary, &amounts[0], &amounts[1], &amounts[2], &amounts[3], &amounts[4], &out.ModelVersion, &model, &metric, &out.BaselineValue, &out.TargetValue, &out.ReviewIntervalDays, &out.NextReviewAt, &out.Status, &out.Revision, &out.QueueRevision)
	if err != nil {
		return PlanningCycleRecord{}, err
	}
	if !json.Valid(model) || (metric != nil && !json.Valid(metric)) {
		return PlanningCycleRecord{}, invalid("planning_cycle_data_invalid", "周期快照数据无效")
	}
	out.ModelSnapshot = json.RawMessage(model)
	out.MetricDefinition = json.RawMessage(metric)
	var values [5]*Hundredths
	for i, amount := range amounts {
		if !amount.Valid {
			continue
		}
		parsed, err := ParseHundredths(amount.String)
		if err != nil {
			return PlanningCycleRecord{}, err
		}
		values[i] = &parsed
	}
	// Preserve partially specified legacy drafts without filling missing amounts
	// with zero. Opening requires the separate complete-budget validation.
	for _, value := range values {
		if value != nil {
			out.Budget = &PlanningCycleBudget{Total: values[0], Reserve: values[1], Reliability: values[2], Usability: values[3], Growth: values[4]}
			break
		}
	}
	return out, nil
}

// Caller holds the product root lock and has authorized its own action.
func loadPlanningCycle(ctx context.Context, tx *sql.Tx, code, bizID string) (PlanningCycleRecord, error) {
	return scanPlanningCycle(tx.QueryRowContext(ctx, `SELECT `+planningCycleColumns+` FROM product_planning_cycles WHERE product_code=? AND biz_id=?`, code, bizID))
}

func ReadPlanningCycle(ctx context.Context, db *sql.DB, code, uid, bizID string, permit AuthorizationPermit) (PlanningCycleDetail, error) {
	var out PlanningCycleDetail
	id, err := uuid.Parse(bizID)
	if err != nil || id.String() != bizID {
		return out, invalid("planning_cycle_id_invalid", "周期标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	record, err := loadPlanningCycle(ctx, tx, code, bizID)
	if err != nil {
		return out, err
	}
	out.PlanningCycleRecord = record
	out.WorkspaceRevision = permit.Facts.Revision
	return out, tx.Commit()
}

func ListPlanningCycles(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q PlanningCyclePageQuery) (PlanningCyclePage, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return PlanningCyclePage{}, err
	}
	defer tx.Rollback()
	out, err := ListPlanningCyclesInTransaction(ctx, tx, code, uid, permit, q)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func ListPlanningCyclesInTransaction(ctx context.Context, tx *sql.Tx, code, uid string, permit AuthorizationPermit, q PlanningCyclePageQuery) (PlanningCyclePage, error) {
	var out PlanningCyclePage
	if err := ValidatePlanningCyclePageQuery(q); err != nil {
		return out, err
	}
	if tx == nil {
		return out, invalid("product_transaction_required", "事务不可用")
	}
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", "view", permit); err != nil {
		return out, err
	}
	where := ` FROM product_planning_cycles WHERE product_code=? AND (?='' OR status=?) AND (?='' OR LOCATE(?,title)>0 OR LOCATE(?,goal_summary)>0)`
	args := []any{code, q.Status, q.Status, q.Keyword, q.Keyword, q.Keyword}
	if q.ReviewDue {
		var cutoff string
		if err := tx.QueryRowContext(ctx, `SELECT DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%d %H:%i:%s.%f')`).Scan(&cutoff); err != nil {
			return out, err
		}
		where += " AND status='open' AND next_review_at IS NOT NULL AND next_review_at<=?"
		args = append(args, cutoff)
	}

	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT `+planningCycleColumns+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, append(args, q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return out, err
	}
	out.Items = []PlanningCycleRecord{}
	for rows.Next() {
		record, err := scanPlanningCycle(rows)
		if err != nil {
			rows.Close()
			return PlanningCyclePage{}, err
		}
		out.Items = append(out.Items, record)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return PlanningCyclePage{}, err
	}
	out.Page = q.Page
	out.PageSize = q.PageSize
	out.WorkspaceRevision = permit.Facts.Revision
	return out, nil
}
