package aims

import (
	"context"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const productVersionSummaryCapability = "aims:product-version-summary:read"

func (a *Adapter) serviceProductVersionSummaries(ctx context.Context, productCode string, query url.Values) (map[string]any, error) {
	allowed := false
	for _, scope := range strings.Fields(query.Get("current_user_scopes")) {
		if scope == productVersionSummaryCapability {
			allowed = true
		}
	}
	if !allowed || query.Get("hzy_runtime_source_app") != "aims" || query.Get("hzy_runtime_service_client_id") != "aims.runtime" ||
		query.Get("hzy_runtime_tenant_code") == "" || query.Get("hzy_runtime_deployment_code") == "" {
		return nil, httperror.New(403, "product_version_summary_forbidden", "Trusted summary capability required")
	}
	if !utf8.ValidString(productCode) || strings.IndexFunc(productCode, unicode.IsControl) >= 0 || productCode == "" || strings.TrimSpace(productCode) != productCode || strings.ContainsAny(productCode, "/\\") || len([]rune(productCode)) > 64 {
		return nil, httperror.New(400, "product_code_invalid", "Invalid product code")
	}
	rows, err := a.DB().QueryContext(ctx, `SELECT pv.id,pv.product_code,pv.version_code,pv.name,pv.status,
 DATE_FORMAT(pv.planned_release_date,'%Y-%m-%d') AS planned_release_date,
 DATE_FORMAT(pv.released_at,'%Y-%m-%d %H:%i:%s') AS released_at,
 COALESCE(f.feature_count,0) AS feature_count, COALESCE(f.delivered_feature_count,0) AS delivered_feature_count
 FROM product_versions pv
 LEFT JOIN (SELECT version_id,COUNT(*) AS feature_count,SUM(status='delivered') AS delivered_feature_count
 FROM product_version_features WHERE is_public=1 GROUP BY version_id) f ON f.version_id=pv.id
 WHERE BINARY pv.product_code=BINARY ? ORDER BY pv.sort_order,pv.created_at DESC,pv.id DESC`, productCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}
