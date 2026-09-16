package assets

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"strings"
)

// Product master ownership is distinct from AIMS workspace membership. There is
// no canonical department column on product_assets: never drop that constraint.
func productObjectScopeWhere(alias, actor string, units []assetsScopeUnit) (string, []any) {
	return ownedCatalogScopeWhere(alias, "business_owner_uid", actor, units)
}

// Column names are internal schema constants, never request parameters.
func ownedCatalogScopeWhere(alias, ownerColumn, actor string, units []assetsScopeUnit) (string, []any) {
	branches, args := []string{}, []any{}
	for _, unit := range units {
		if len(unit.DepartmentCodes) > 0 {
			continue
		}
		parts, branchArgs := []string{}, []any{}
		if unit.DirectRelation {
			if strings.TrimSpace(actor) == "" {
				continue
			}
			permitted := false
			for _, predicate := range normalizedAssetRelationPredicates(unit.RelationPredicates) {
				if predicate == "self" || predicate == "owner" || predicate == "assigned" {
					permitted = true
				}
			}
			if !permitted {
				continue
			}
			parts = append(parts, "? IN (COALESCE("+alias+"."+ownerColumn+",''),COALESCE("+alias+".technical_owner_uid,''))")
			branchArgs = append(branchArgs, actor)
		}
		if len(unit.ProjectCodes) > 0 {
			parts = append(parts, alias+".project_code IN ("+placeholders(unit.ProjectCodes)+")")
			for _, code := range unit.ProjectCodes {
				branchArgs = append(branchArgs, code)
			}
		}
		if len(parts) == 0 {
			continue
		}
		branches = append(branches, "("+strings.Join(parts, " AND ")+")")
		args = append(args, branchArgs...)
	}
	if len(branches) == 0 {
		return "(1=0)", args
	}
	return "(" + strings.Join(branches, " OR ") + ")", args
}

// Lock and check inside the mutation transaction; recheck after ownership edits.
func requireProductWriteScopeTx(ctx context.Context, tx *sql.Tx, id int64, query url.Values) error {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return err
	}
	if query.Get(assetsPermissionActionQueryKey) != "edit" {
		return httperror.New(403, "assets_product_edit_scope_required", "product edit scope required")
	}
	where, args := "1=1", []any{id}
	if access != "all" {
		units, err := assetsScopeUnits(query)
		if err != nil {
			return err
		}
		var scopeArgs []any
		where, scopeArgs = productObjectScopeWhere("p", actor, units)
		args = append(args, scopeArgs...)
	}
	var found int64
	err = tx.QueryRowContext(ctx, "SELECT p.id FROM product_assets p WHERE p.id=? AND "+where+" FOR UPDATE", args...).Scan(&found)
	if err == sql.ErrNoRows {
		return httperror.New(403, "assets_product_scope_forbidden", "product outside authorized scope")
	}
	return err
}

// Target scope is separately derived for asset_items:view, never from products.
func requireProductTargetAssetTx(ctx context.Context, tx *sql.Tx, id int64, query url.Values) error {
	target := url.Values{"current_user": {query.Get("current_user")}, assetsObjectAccessQueryKey: {query.Get("current_user_product_target_access")}, assetsScopeUnitsQueryKey: {query.Get("current_user_product_target_units")}}
	access, actor, err := assetsObjectAccess(target)
	if err != nil {
		return err
	}
	where, args := "1=1", []any{id}
	if access != "all" {
		units, err := assetsScopeUnits(target)
		if err != nil {
			return err
		}
		var scopeArgs []any
		where, scopeArgs = assetItemScopeWhere("ai", actor, units)
		args = append(args, scopeArgs...)
	}
	var found int64
	err = tx.QueryRowContext(ctx, "SELECT ai.id FROM asset_items ai WHERE ai.id=? AND ai.archived_at IS NULL AND "+where+" FOR UPDATE", args...).Scan(&found)
	if err == sql.ErrNoRows {
		return httperror.New(403, "assets_product_target_forbidden", "target asset outside authorized scope")
	}
	return err
}

// Target scope is separately derived for technology_bases:view, never from products.
func requireProductTargetBaseTx(ctx context.Context, tx *sql.Tx, id int64, query url.Values) error {
	target := url.Values{"current_user": {query.Get("current_user")}, assetsObjectAccessQueryKey: {query.Get("current_user_product_target_access")}, assetsScopeUnitsQueryKey: {query.Get("current_user_product_target_units")}}
	access, actor, err := assetsObjectAccess(target)
	if err != nil {
		return err
	}
	where, args := "1=1", []any{id}
	if access != "all" {
		units, err := assetsScopeUnits(target)
		if err != nil {
			return err
		}
		var scopeArgs []any
		where, scopeArgs = ownedCatalogScopeWhere("tb", "owner_uid", actor, units)
		args = append(args, scopeArgs...)
	}
	var found int64
	err = tx.QueryRowContext(ctx, "SELECT tb.id FROM technology_bases tb WHERE tb.id=? AND "+where+" FOR UPDATE", args...).Scan(&found)
	if err == sql.ErrNoRows {
		return httperror.New(403, "assets_product_target_forbidden", "target base outside authorized scope")
	}
	return err
}
