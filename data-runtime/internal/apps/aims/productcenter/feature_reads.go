package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// FeatureRecord is a long-lived capability, independent of delivery progress.
type FeatureRecord struct {
	ComponentID       *int64          `json:"component_id"`
	ID                int64           `json:"id"`
	BizID             string          `json:"biz_id"`
	ProductCode       string          `json:"product_code"`
	Title             string          `json:"title"`
	Description       *string         `json:"description"`
	Lifecycle         string          `json:"lifecycle"`
	LifecycleEvidence json.RawMessage `json:"lifecycle_evidence"`
	Revision          uint64          `json:"revision"`
	CreatedBy         string          `json:"created_by"`
	UpdatedBy         string          `json:"updated_by"`
	CreatedAt         string          `json:"created_at"`
	UpdatedAt         string          `json:"updated_at"`
}

const featureColumns = `id,biz_id,product_code,component_id,title,description,lifecycle,lifecycle_evidence,revision,created_by,updated_by,
CONCAT(LEFT(DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%f'),23),'Z'),CONCAT(LEFT(DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%s.%f'),23),'Z')`

func scanFeature(row interface{ Scan(...any) error }) (FeatureRecord, error) {
	var r FeatureRecord
	var evidence []byte
	err := row.Scan(&r.ID, &r.BizID, &r.ProductCode, &r.ComponentID, &r.Title, &r.Description, &r.Lifecycle, &evidence, &r.Revision, &r.CreatedBy, &r.UpdatedBy, &r.CreatedAt, &r.UpdatedAt)
	r.LifecycleEvidence = json.RawMessage(evidence)
	return r, err
}

type FeaturePageQuery struct {
	ComponentID *int64 `json:"component_id"`
	Ungrouped   bool   `json:"ungrouped"`
	Page        int    `json:"page"`
	PageSize    int    `json:"page_size"`
	Keyword     string `json:"keyword"`
	Lifecycle   string `json:"lifecycle"`
}
type FeaturePage struct {
	Items             []FeatureRecord `json:"items"`
	Total             int             `json:"total"`
	Page              int             `json:"page"`
	PageSize          int             `json:"pageSize"`
	WorkspaceRevision uint64          `json:"workspace_revision"`
}

func ValidateFeaturePageQuery(q FeaturePageQuery) error {
	if (q.ComponentID != nil && *q.ComponentID < 1) || (q.ComponentID != nil && q.Ungrouped) {
		return invalid("product_feature_query_invalid", "模块筛选条件无效")
	}

	if q.Page < 1 || q.Page > 1000000 || q.PageSize < 1 || q.PageSize > 100 || !utf8.ValidString(q.Keyword) || utf8.RuneCountInString(q.Keyword) > 200 || strings.ContainsRune(q.Keyword, '\x00') {
		return invalid("product_feature_query_invalid", "功能分页或关键词无效")
	}
	for _, pair := range []struct {
		value   string
		allowed []string
	}{
		{q.Lifecycle, []string{"", "candidate", "active", "deprecated"}},
	} {
		found := false
		for _, v := range pair.allowed {
			if pair.value == v {
				found = true
				break
			}
		}
		if !found {
			return invalid("product_feature_query_invalid", "功能筛选条件无效")
		}
	}
	return nil
}
func ListProductFeatures(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit, q FeaturePageQuery) (FeaturePage, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return FeaturePage{}, err
	}
	defer tx.Rollback()
	out, err := ListProductFeaturesInTransaction(ctx, tx, code, uid, permit, q)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func ListProductFeaturesInTransaction(ctx context.Context, tx *sql.Tx, code, uid string, permit AuthorizationPermit, q FeaturePageQuery) (FeaturePage, error) {
	var out FeaturePage
	if err := ValidateFeaturePageQuery(q); err != nil {
		return out, err
	}
	if tx == nil {
		return out, invalid("product_transaction_required", "事务不可用")
	}
	// Every feature mutation uses this same root lock: authorization, total and
	// rows remain consistent without creating receipts or writing on a read.
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_features", "view", permit); err != nil {
		return out, err
	}
	where := ` FROM product_features WHERE product_code=? AND (?='' OR lifecycle=?) AND (?='' OR LOCATE(?,title)>0 OR LOCATE(?,COALESCE(description,''))>0)`
	args := []any{code, q.Lifecycle, q.Lifecycle, q.Keyword, q.Keyword, q.Keyword}
	if q.ComponentID != nil {
		var found int64
		if err := tx.QueryRowContext(ctx, `SELECT id FROM product_components WHERE id=? AND BINARY product_code=BINARY ?`, *q.ComponentID, code).Scan(&found); err != nil {
			return out, err
		}
		where += " AND component_id=?"
		args = append(args, *q.ComponentID)
	} else if q.Ungrouped {
		where += " AND component_id IS NULL"
	}
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*)`+where, args...).Scan(&out.Total); err != nil {
		return out, err
	}

	rows, err := tx.QueryContext(ctx, `SELECT `+featureColumns+where+` ORDER BY id DESC LIMIT ? OFFSET ?`, append(args, q.PageSize, (q.Page-1)*q.PageSize)...)
	if err != nil {
		return out, err
	}
	out.Items = []FeatureRecord{}
	for rows.Next() {
		r, err := scanFeature(rows)
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
	return out, nil
}
func ReadProductFeature(ctx context.Context, db *sql.DB, code, uid, bizID string, permit AuthorizationPermit) (FeatureRecord, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return FeatureRecord{}, err
	}
	defer tx.Rollback()
	out, err := ReadProductFeatureInTransaction(ctx, tx, code, uid, bizID, permit)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func ReadProductFeatureInTransaction(ctx context.Context, tx *sql.Tx, code, uid, bizID string, permit AuthorizationPermit) (FeatureRecord, error) {
	var out FeatureRecord
	parsed, err := uuid.Parse(bizID)
	if err != nil || parsed.String() != bizID {
		return out, invalid("product_feature_id_invalid", "功能标识无效")
	}
	if tx == nil {
		return out, invalid("product_transaction_required", "事务不可用")
	}
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_features", "view", permit); err != nil {
		return out, err
	}
	out, err = scanFeature(tx.QueryRowContext(ctx, `SELECT `+featureColumns+` FROM product_features WHERE product_code=? AND biz_id=?`, code, bizID))
	if err != nil {
		return out, err
	}

	return out, nil
}
