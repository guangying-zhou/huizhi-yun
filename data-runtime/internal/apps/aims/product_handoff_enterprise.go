package aims

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
)

// These aliases expose the existing BFF decision contract, not a new grant.
// Callers must authenticate the boundary before accepting a permit.
type ProductHandoffProjectFacts = productHandoffProjectFacts
type ProductHandoffProjectPermit = productHandoffProjectPermit

func LoadProductHandoffProjectFacts(ctx context.Context, q productcenter.AuthorizationQuery, code, uid string) (ProductHandoffProjectFacts, error) {
	return loadProductHandoffProjectFacts(ctx, q, code, uid)
}

// ProductPlanningHandoffTarget reuses the Aims owning transaction implementation.
// It contains no pool: every read/write uses the command's supplied transaction.
// Neither callback is an authorization default; project and version permits are
// rechecked from current locked facts before a receipt can be replayed.
func ProductPlanningHandoffTarget(code, uid string, input productcenter.PlanningHandoffInput, versionPermit productcenter.AuthorizationPermit, projectPermit ProductHandoffProjectPermit) productcenter.PlanningHandoffTarget {
	var projectID int64
	owner := &Adapter{}
	return productcenter.PlanningHandoffTarget{
		AuthorizeProject: func(ctx context.Context, tx *sql.Tx) (int64, error) {
			if input.PlannedVersionID > 0 {
				if err := productcenter.AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "product_versions", "view", versionPermit); err != nil {
					return 0, err
				}
			}
			var err error
			projectID, err = authorizeProductHandoffProjectTx(ctx, tx, input.ProjectCode, uid, projectPermit)
			return projectID, err
		},
		ResolveRequirement: func(ctx context.Context, tx *sql.Tx) (int64, error) {
			return owner.resolveProductHandoffRequirementTx(ctx, tx, code, uid, projectID, input)
		},
	}
}
