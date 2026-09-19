package aims

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
)

// Association uses the same source contract as the legacy single work-item PUT.
// The source helper locks both versions, checks feature binding and advances the
// scope revisions in the caller transaction; it never emits an external call.
func (a *Adapter) applyEnterpriseWorkItemAssociationTx(ctx context.Context, tx *sql.Tx, itemID string, projectID int64, query url.Values, body map[string]any) error {
	update, err := a.prepareWorkItemVersionFieldsUpdate(ctx, itemID, query, body)
	if err != nil {
		return err
	}
	if id, _, err := optionalBodyID(body, "versionId"); err != nil {
		return httperror.New(400, "invalid_version_id", "Version must be a positive integer or null")
	} else if id > 0 {
		var binding int64
		err := tx.QueryRowContext(ctx, `SELECT app.id FROM aims_project_products app JOIN product_versions pv ON pv.product_code=app.product_code WHERE app.project_id=? AND pv.id=? AND (app.version_id IS NULL OR app.version_id=pv.id) LIMIT 1 FOR UPDATE`, projectID, id).Scan(&binding)
		if err == sql.ErrNoRows {
			return httperror.New(403, "version_not_visible", "Version is not visible to project")
		}
		if err != nil {
			return err
		}
	}
	return update(ctx, tx)
}

// One range-scoped query returns choices including features; no per-version
// requests, process cache or unscoped product catalogue is involved.
func (a *Adapter) EnterpriseWorkItemAssociationOptions(ctx context.Context, itemID, actor string) ([]map[string]any, error) {
	query := url.Values{"current_user": {actor}}
	if err := a.requireWorkItemProjectMemberOrScopedAdmin(ctx, itemID, query); err != nil {
		return nil, err
	}
	rows, err := a.DB().QueryContext(ctx, `SELECT DISTINCT pv.id AS version_id,pv.product_code,pv.version_code,pv.name AS version_name,pvf.id AS feature_id,pvf.title AS feature_name FROM work_items wi JOIN aims_project_products app ON app.project_id=wi.project_id JOIN product_versions pv ON pv.product_code=app.product_code AND (app.version_id IS NULL OR app.version_id=pv.id) LEFT JOIN product_version_features pvf ON pvf.version_id=pv.id WHERE wi.id=? AND wi.tier='target' AND pv.status IN ('planning','developing') ORDER BY version_id,feature_id`, itemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return aimsRowsToMaps(rows)
}
