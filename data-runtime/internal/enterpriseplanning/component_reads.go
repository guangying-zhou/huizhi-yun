package enterpriseplanning

import (
	"context"
	"database/sql"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
)

func (s *PlanningService) ListComponents(ctx context.Context, code, uid string, permit pc.AuthorizationPermit, parentID *int64, page, pageSize int) (any, error) {
	return s.read(ctx, func(tx *sql.Tx) (any, error) {
		return pc.ListProductComponentsInTransaction(ctx, tx, code, uid, permit, parentID, page, pageSize)
	})
}
