package productcenter

import (
	"context"
	"database/sql"
	"sort"
)

// Call from ExecuteCommand's authorization callback, before receipt or root locks.
// The source may edit dependencies; the predecessor only grants visibility.
func authorizeCrossDependencyTransaction(ctx context.Context, tx *sql.Tx, source, target, uid string, sourcePermit, targetPermit AuthorizationPermit) error {
	if source == target {
		return invalid("planning_cross_dependency_invalid", "跨产品依赖必须属于不同产品")
	}
	if _, err := lockProductDependencyGraph(ctx, tx); err != nil {
		return err
	}
	products := []string{source, target}
	sort.Strings(products)
	for _, code := range products {
		action, permit := "view", targetPermit
		if code == source {
			action, permit = "edit", sourcePermit
		}
		if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_priorities", action, permit); err != nil {
			return err
		}
	}
	return nil
}
