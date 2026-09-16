package productcenter

import (
	"context"
	"database/sql"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// RequestRecord keeps product decisions separate from execution status.
type RequestRecord struct {
	ScheduledVersionID   *int64             `json:"scheduled_version_id,omitempty"`
	ScheduledVersionCode *string            `json:"scheduled_version_code,omitempty"`
	ScheduledPlanStatus  *string            `json:"scheduled_plan_status,omitempty"`
	ComponentID          *int64             `json:"component_id,omitempty"`
	ComponentBizID       *string            `json:"component_biz_id,omitempty"`
	ComponentName        *string            `json:"component_name,omitempty"`
	MergeTrail           []RequestMergeLink `json:"merge_trail,omitempty"`
	MergeTrailTruncated  bool               `json:"merge_trail_truncated,omitempty"`
	ID                   int64              `json:"id"`
	BizID                string             `json:"biz_id"`
	ProductCode          string             `json:"product_code"`
	Title                string             `json:"title"`
	ProblemStatement     *string            `json:"problem_statement"`
	SourceType           string             `json:"source_type"`
	UrgencyLevel         string             `json:"urgency_level"`
	DecisionStatus       string             `json:"decision_status"`
	DecisionReason       *string            `json:"decision_reason"`
	DecidedBy            *string            `json:"decided_by"`
	DecidedAt            *string            `json:"decided_at"`
	MergedIntoID         *int64             `json:"merged_into_id"`
	Revision             uint64             `json:"revision"`
	CreatedBy            string             `json:"created_by"`
	UpdatedBy            string             `json:"updated_by"`
	CreatedAt            string             `json:"created_at"`
	UpdatedAt            string             `json:"updated_at"`
}

const requestColumns = `id,biz_id,product_code,component_id,(SELECT biz_id FROM product_components c WHERE c.id=product_requests.component_id AND BINARY c.product_code=BINARY product_requests.product_code),(SELECT name FROM product_components c WHERE c.id=product_requests.component_id AND BINARY c.product_code=BINARY product_requests.product_code),(SELECT s.version_id FROM product_version_plan_scopes s WHERE s.request_id=product_requests.id ORDER BY s.version_id DESC LIMIT 1),(SELECT v.version_code FROM product_version_plan_scopes s JOIN product_versions v ON v.id=s.version_id WHERE s.request_id=product_requests.id ORDER BY s.version_id DESC LIMIT 1),(SELECT CASE WHEN EXISTS(SELECT 1 FROM product_version_plan_confirmations pc JOIN product_version_plans p ON p.version_id=pc.version_id WHERE pc.version_id=s.version_id AND pc.invalidated_at IS NULL AND pc.plan_revision=p.revision AND pc.scope_revision=p.scope_revision) THEN 'confirmed' ELSE 'draft_or_stale' END FROM product_version_plan_scopes s WHERE s.request_id=product_requests.id ORDER BY s.version_id DESC LIMIT 1),title,problem_statement,source_type,urgency_level,decision_status,decision_reason,decided_by,
CONCAT(LEFT(DATE_FORMAT(decided_at,'%Y-%m-%dT%H:%i:%s.%f'),23),'Z'),merged_into_id,revision,created_by,updated_by,
CONCAT(LEFT(DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%f'),23),'Z'),CONCAT(LEFT(DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%s.%f'),23),'Z')`

func scanRequest(row interface{ Scan(...any) error }) (RequestRecord, error) {
	var r RequestRecord
	err := row.Scan(&r.ID, &r.BizID, &r.ProductCode, &r.ComponentID, &r.ComponentBizID, &r.ComponentName, &r.ScheduledVersionID, &r.ScheduledVersionCode, &r.ScheduledPlanStatus, &r.Title, &r.ProblemStatement, &r.SourceType, &r.UrgencyLevel, &r.DecisionStatus, &r.DecisionReason, &r.DecidedBy, &r.DecidedAt, &r.MergedIntoID, &r.Revision, &r.CreatedBy, &r.UpdatedBy, &r.CreatedAt, &r.UpdatedAt)
	return r, err
}

type RequestPageQuery struct {
	ComponentID        *int64 `json:"component_id,omitempty"`
	Unassigned         bool   `json:"unassigned"`
	IncludeDescendants bool   `json:"include_descendants"`
	MergedIntoBizID    string `json:"merged_into_biz_id"`
	Page               int    `json:"page"`
	PageSize           int    `json:"page_size"`
	Keyword            string `json:"keyword"`
	DecisionStatus     string `json:"decision_status"`
	SourceType         string `json:"source_type"`
	UrgencyLevel       string `json:"urgency_level"`
}
type RequestPage struct {
	Items             []RequestRecord `json:"items"`
	Total             int             `json:"total"`
	UnmergedTotal     int             `json:"unmerged_total"`
	Page              int             `json:"page"`
	PageSize          int             `json:"pageSize"`
	WorkspaceRevision uint64          `json:"workspace_revision"`
}

func ValidateRequestPageQuery(q RequestPageQuery) error {
	if q.ComponentID != nil && *q.ComponentID <= 0 || q.Unassigned && q.ComponentID != nil || q.IncludeDescendants && q.ComponentID == nil {
		return invalid("product_request_query_invalid", "需求模块筛选条件无效")
	}
	if q.MergedIntoBizID != "" {
		parsed, err := uuid.Parse(q.MergedIntoBizID)
		if err != nil || parsed.String() != q.MergedIntoBizID {
			return invalid("product_request_query_invalid", "合并目标标识无效")
		}
	}

	if q.Page < 1 || q.Page > 1000000 || q.PageSize < 1 || q.PageSize > 100 || !utf8.ValidString(q.Keyword) || utf8.RuneCountInString(q.Keyword) > 200 || strings.ContainsRune(q.Keyword, '\x00') {
		return invalid("product_request_query_invalid", "需求分页或关键词无效")
	}
	for _, pair := range []struct {
		value   string
		allowed []string
	}{
		{q.DecisionStatus, []string{"", "submitted", "evaluating", "accepted", "deferred", "rejected", "merged"}},
		{q.SourceType, []string{"", "customer", "internal", "engineering", "other"}},
		{q.UrgencyLevel, []string{"", "P0", "P1", "P2", "P3"}},
	} {
		found := false
		for _, v := range pair.allowed {
			if pair.value == v {
				found = true
				break
			}
		}
		if !found {
			return invalid("product_request_query_invalid", "需求筛选条件无效")
		}
	}
	return nil
}
func ListProductRequests(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q RequestPageQuery) (RequestPage, error) {
	var out RequestPage
	if err := ValidateRequestPageQuery(q); err != nil {
		return out, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	// Every request mutation uses this same root lock: authorization, total and
	// rows remain consistent without creating receipts or writing on a read.
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_requests", "view", permit); err != nil {
		return out, err
	}
	where := ` FROM product_requests WHERE product_code=? AND (?='' OR decision_status=?) AND (?='' OR source_type=?) AND (?='' OR urgency_level=?) AND (?='' OR LOCATE(?,title)>0 OR LOCATE(?,COALESCE(problem_statement,''))>0)`
	args := []any{code, q.DecisionStatus, q.DecisionStatus, q.SourceType, q.SourceType, q.UrgencyLevel, q.UrgencyLevel, q.Keyword, q.Keyword, q.Keyword}
	if q.MergedIntoBizID != "" {
		var targetID int64
		if err := tx.QueryRowContext(ctx, `SELECT id FROM product_requests WHERE product_code=? AND biz_id=?`, code, q.MergedIntoBizID).Scan(&targetID); err != nil {
			return out, err
		}
		where += ` AND merged_into_id=?`
		args = append(args, targetID)
	}
	if q.Unassigned {
		where += ` AND component_id IS NULL`
	} else if q.ComponentID != nil {
		if q.IncludeDescendants {
			where += ` AND component_id IN (WITH RECURSIVE descendants AS (SELECT id FROM product_components WHERE id=? AND BINARY product_code=BINARY ? UNION ALL SELECT c2.id FROM product_components c2 JOIN descendants d ON c2.parent_id=d.id WHERE BINARY c2.product_code=BINARY ?) SELECT id FROM descendants)`
			args = append(args, *q.ComponentID, code, code)
		} else {
			where += ` AND component_id=?`
			args = append(args, *q.ComponentID)
		}
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*),COALESCE(SUM(decision_status<>'merged'),0)`+where, args...).Scan(&out.Total, &out.UnmergedTotal); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT `+requestColumns+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, append(args, q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return out, err
	}
	out.Items = []RequestRecord{}
	for rows.Next() {
		r, err := scanRequest(rows)
		if err != nil {
			rows.Close()
			return out, err
		}
		out.Items = append(out.Items, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	out.Page, out.PageSize, out.WorkspaceRevision = q.Page, q.PageSize, permit.Facts.Revision
	return out, tx.Commit()
}
func ReadProductRequest(ctx context.Context, db *sql.DB, code, uid, bizID string, permit AuthorizationPermit) (RequestRecord, error) {
	var out RequestRecord
	parsed, err := uuid.Parse(bizID)
	if err != nil || parsed.String() != bizID {
		return out, invalid("product_request_id_invalid", "需求标识无效")
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_requests", "view", permit); err != nil {
		return out, err
	}
	out, err = scanRequest(tx.QueryRowContext(ctx, `SELECT `+requestColumns+` FROM product_requests WHERE product_code=? AND biz_id=?`, code, bizID))
	if err != nil {
		return out, err
	}
	out.MergeTrail, out.MergeTrailTruncated, err = readRequestMergeTrail(ctx, tx, code, out)
	if err != nil {
		return RequestRecord{}, err
	}
	return out, tx.Commit()
}
