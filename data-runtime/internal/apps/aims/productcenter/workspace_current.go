package productcenter

import (
	"context"
	"database/sql"
)

// ReadWorkspaceInTransaction preserves owning workspace authorization while
// taking current display identity only from the independently scoped Assets CTE.
// Historical projection/source/line labels remain separate stored facts.
func ReadWorkspaceInTransaction(ctx context.Context, tx *sql.Tx, code, uid string, permit AuthorizationPermit, source CurrentCatalogSource) (WorkspaceDetail, error) {
	detail := WorkspaceDetail{ManagementKind: "product"}
	abort := func(err error) (WorkspaceDetail, error) {
		if tx != nil {
			_ = tx.Rollback()
		}
		return detail, err
	}
	if tx == nil {
		return abort(invalid("product_command_configuration", "缺少产品空间事务"))
	}
	if source.products == "" || source.actor != uid {
		return abort(invalid("product_authorization_invalid", "当前目录授权无效"))
	}
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "products", "view", permit); err != nil {
		return abort(err)
	}
	var now int64
	if err := tx.QueryRowContext(ctx, "SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED)").Scan(&now); err != nil {
		return abort(err)
	}
	if source.expiresAt <= now || source.expiresAt > now+30000 {
		return abort(invalid("product_authorization_expired", "当前目录授权过期"))
	}
	var err error
	detail.Workspace, err = loadWorkspace(ctx, tx, code)
	if err != nil {
		return abort(err)
	}
	prefix, args := source.cte()
	var line string
	err = tx.QueryRowContext(ctx, "SELECT line_code FROM product_line_workspaces WHERE product_code=?", code).Scan(&line)
	if err == nil {
		detail.ManagementKind = "product_line"
		// The management identity itself is an Aims fact. Current line metadata is
		// visible only through an explicitly onboarded, independently visible source.
		err = tx.QueryRowContext(ctx, prefix+"SELECT c.product_line,MAX(NULLIF(TRIM(c.product_line_label),'')) FROM current_catalog c JOIN product_component_sources s ON BINARY s.source_product_code=BINARY c.product_code WHERE s.product_code=? AND BINARY c.product_line=BINARY ? GROUP BY c.product_line", append(args, code, line)...).Scan(&detail.ProductLine, &detail.ProductLineLabel)
		detail.ProductName = detail.ProductLineLabel
	} else if err == sql.ErrNoRows {
		err = tx.QueryRowContext(ctx, prefix+"SELECT product_name,product_line,product_line_label FROM current_catalog WHERE BINARY product_code=BINARY ?", append(args, code)...).Scan(&detail.ProductName, &detail.ProductLine, &detail.ProductLineLabel)
	}
	if err != nil && err != sql.ErrNoRows {
		return abort(err)
	}
	return detail, nil
}
