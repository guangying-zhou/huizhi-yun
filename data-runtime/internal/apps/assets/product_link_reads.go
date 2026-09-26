package assets

import (
	"context"
	"database/sql"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Purpose-specific candidate projection excludes unrelated administrative
// metadata and all reverse product counts. Scope filtering precedes paging.
func ListProductLinkCandidatesInTransaction(ctx context.Context, tx *sql.Tx, kind string, q url.Values) (map[string]any, error) {
	alias, table, fields := "tb", "technology_bases", "tb.id,tb.base_code,tb.base_name,tb.base_type,tb.status"
	if kind == "asset" {
		alias, table, fields = "ai", "asset_items", "ai.id,ai.asset_code,ai.asset_name,ai.asset_category,ai.asset_subtype,ai.status"
	}
	if kind != "base" && kind != "asset" {
		return nil, httperror.New(400, "invalid_product_target", "Unsupported target")
	}
	where, args, err := ProductTargetReadPredicate(kind, q, alias)
	if err != nil {
		return nil, err
	}
	if kind == "asset" {
		where = "ai.archived_at IS NULL AND " + where
	}
	// The product selector consumes this minimal owned projection, not a general
	// SQL/catalog endpoint. All results belong to the independently permitted scope.
	items, err := (productMasterReader{tx: tx}).queryMaps(ctx, "SELECT "+fields+" FROM "+table+" "+alias+" WHERE "+where+" ORDER BY "+alias+".id DESC", args...)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": len(items)}, nil
}

// Optional trusted relation scopes are used by the composed Host. Independent
// standalone projections remain compatible until their BFF sends these scopes.
func productRelatedReadPredicate(q url.Values, kind, alias string) (string, []any, error) {
	if q.Get("current_user_product_relations_scoped") != "true" {
		return "1=1", nil, nil
	}
	access := q.Get("current_user_product_" + kind + "_access")
	if access == "none" {
		return "1=0", nil, nil
	}
	return ProductTargetReadPredicate(kind, url.Values{"current_user": {q.Get("current_user")}, assetsObjectAccessQueryKey: {access}, assetsScopeUnitsQueryKey: {q.Get("current_user_product_" + kind + "_units")}}, alias)
}
