package assets

import (
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// EnterpriseProductReadPredicate reuses the Assets owning-domain scope rules.
// Its query must be compiled by the authenticated BFF, bound to the signed user
// and checked for freshness by the enterprise route. It never accepts SQL or
// identifiers from that query. The returned predicate uses the fixed alias p.
func EnterpriseProductReadPredicate(query url.Values, signedActor string) (string, []any, error) {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return "", nil, err
	}
	if strings.TrimSpace(signedActor) == "" || actor != signedActor || query.Get(assetsPermissionActionQueryKey) != "view" {
		return "", nil, httperror.New(403, "enterprise_product_scope_mismatch", "Product scope must match the signed user and view action")
	}
	if access == "all" {
		return "1=1", nil, nil
	}
	units, err := assetsScopeUnits(query)
	if err != nil {
		return "", nil, err
	}
	where, args := productObjectScopeWhere("p", actor, units)
	return where, args, nil
}
