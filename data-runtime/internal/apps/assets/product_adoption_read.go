package assets

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type ProductAdoptionPage struct {
	ProductCode string                    `json:"productCode"`
	QueriedAt   time.Time                 `json:"queriedAt"`
	Summary     ProductAdoptionSummary    `json:"summary"`
	Items       []ProductAdoptionInstance `json:"items"`
	Total       int                       `json:"total"`
	Page        int                       `json:"page"`
	PageSize    int                       `json:"pageSize"`
}

// Internal reader only: callers must verify product access and derive both
// object scopes for the delegated user before invoking this function.
// One SELECT supplies both totals and details from the same database snapshot.
// adoptionRunner lets the legacy pool and the unified snapshot transaction share
// one query; the unified schema exposes the same table names as compatibility
// views, so no predicate or table name changes between the two paths.
type adoptionRunner interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func readProductAdoption(ctx context.Context, db adoptionRunner, productCode string, deliveryScope, environmentScope url.Values, page, pageSize int) (ProductAdoptionPage, error) {
	result := ProductAdoptionPage{}
	if productCode == "" || strings.TrimSpace(productCode) != productCode || !utf8.ValidString(productCode) || utf8.RuneCountInString(productCode) > 100 || strings.ContainsRune(productCode, 0) {
		return result, httperror.New(http.StatusBadRequest, "product_adoption_product_invalid", "A valid product code is required")
	}
	if page < 1 || pageSize < 1 || pageSize > 200 {
		return result, httperror.New(http.StatusBadRequest, "product_adoption_page_invalid", "A positive page and page size between 1 and 200 are required")
	}
	where, args, err := productAdoptionScopeWhere(deliveryScope, environmentScope)
	if err != nil {
		return result, err
	}
	queriedAt := time.Now().UTC()
	rows, err := db.QueryContext(ctx, `SELECT delivery.delivery_asset_code, environment.environment_code,
 delivery.customer_code, relation.relation_type, relation.deployment_status,
 COALESCE(relation.deployed_version, '')
 FROM customer_delivery_asset_environment_rel relation
 JOIN customer_delivery_assets delivery ON delivery.id=relation.delivery_asset_id
 JOIN asset_environments environment ON environment.id=relation.environment_id
 WHERE BINARY delivery.product_code=BINARY ? AND delivery.deleted_at IS NULL
 AND relation.deleted_at IS NULL AND relation.status='active'
 AND (relation.effective_from IS NULL OR relation.effective_from<=CURRENT_TIMESTAMP)
 AND (relation.effective_to IS NULL OR relation.effective_to>CURRENT_TIMESTAMP)
 AND `+where, append([]any{productCode}, args...)...)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	relations := []ProductAdoptionRelation{}
	for rows.Next() {
		var row ProductAdoptionRelation
		if err := rows.Scan(&row.DeliveryAssetCode, &row.EnvironmentCode, &row.CustomerCode, &row.Role, &row.DeploymentStatus, &row.DeployedVersion); err != nil {
			return result, err
		}
		relations = append(relations, row)
	}
	if err := rows.Err(); err != nil {
		return result, err
	}
	instances := aggregateProductAdoption(relations)
	result = ProductAdoptionPage{ProductCode: productCode, QueriedAt: queriedAt,
		Summary: summarizeProductAdoption(relations), Items: []ProductAdoptionInstance{}, Total: len(instances), Page: page, PageSize: pageSize}
	// Check the page before multiplication so a large user-supplied page cannot
	// overflow into a valid slice offset.
	if len(instances) == 0 || page-1 > (len(instances)-1)/pageSize {
		return result, nil
	}
	start := (page - 1) * pageSize
	end := start + pageSize
	if end > len(instances) {
		end = len(instances)
	}
	result.Items = instances[start:end]
	return result, nil
}
