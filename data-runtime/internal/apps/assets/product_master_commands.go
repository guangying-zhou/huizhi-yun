package assets

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
)

// CreateProductInTransaction preserves the owning domain's input defaults,
// object scope and creation event. The caller owns commit and rollback.
func CreateProductInTransaction(ctx context.Context, tx *sql.Tx, body map[string]any, query url.Values) (int64, error) {
	access, operatorUID, err := assetsObjectAccess(query)
	if err != nil {
		return 0, err
	}
	if query.Get(assetsPermissionActionQueryKey) != "edit" {
		return 0, httperror.New(403, "assets_product_edit_scope_required", "product edit scope required")
	}
	if access != "all" {
		if _, err := assetsScopeUnits(query); err != nil {
			return 0, err
		}
	}

	insert, err := tx.ExecContext(ctx, `
		INSERT INTO product_assets (
		  product_code, product_name, product_line, customer_domain, business_domain, product_level,
		  asset_level, status, build_stage, current_version, target_version, productization_value_level,
		  supported_terminals, summary, built_at, business_owner_uid, technical_owner_uid, project_code,
		  covered_legacy_systems, notes, created_by, updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		coalesceText(body, "product_code", buildCode("PROD")),
		coalesceText(body, "product_name", "未命名产品"),
		coalesceText(body, "product_line", "FC"),
		jsonStringListOrFallback(body["customer_domain"], []string{"G"}),
		coalesceText(body, "business_domain", "pending"),
		nullableBodyText(body, "product_level"),
		nullableBodyText(body, "asset_level"),
		coalesceText(body, "status", "mvp"),
		nullableBodyText(body, "build_stage"),
		nullableBodyText(body, "current_version"),
		nullableBodyText(body, "target_version"),
		nullableBodyText(body, "productization_value_level"),
		jsonStringListOrNil(body["supported_terminals"]),
		nullableBodyText(body, "summary"),
		nullableBodyText(body, "built_at"),
		nullableBodyText(body, "business_owner_uid"),
		nullableBodyText(body, "technical_owner_uid"),
		nullableBodyText(body, "project_code"),
		jsonStringListOrNil(body["covered_legacy_systems"]),
		nullableBodyText(body, "notes"),
		nullableString(operatorUID),
		nullableString(operatorUID),
	)
	if err != nil {
		return 0, err
	}
	id, err := insert.LastInsertId()
	if err != nil {
		return 0, err
	}
	if err := requireProductWriteScopeTx(ctx, tx, id, query); err != nil {
		return 0, err
	}
	if err := insertEvent(ctx, tx, "product_asset", id, "created", operatorUID, map[string]any{"summary": "产品主档已创建"}); err != nil {
		return 0, err
	}
	return id, nil
}

// UpdateProductInTransaction locks and checks scope both before and after editing.
func UpdateProductInTransaction(ctx context.Context, tx *sql.Tx, id int64, body map[string]any, query url.Values) error {
	operatorUID := query.Get("current_user")

	if err := requireProductWriteScopeTx(ctx, tx, id, query); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
	UPDATE product_assets
	SET product_code = COALESCE(?, product_code),
	    product_name = COALESCE(?, product_name),
	    product_line = COALESCE(?, product_line),
	    customer_domain = COALESCE(?, customer_domain),
	    business_domain = COALESCE(?, business_domain),
	    product_level = ?,
	    asset_level = ?,
	    status = COALESCE(?, status),
	    build_stage = ?,
	    current_version = ?,
	    target_version = ?,
	    productization_value_level = ?,
	    supported_terminals = ?,
	    summary = ?,
	    built_at = COALESCE(?, built_at),
	    business_owner_uid = COALESCE(?, business_owner_uid),
	    technical_owner_uid = COALESCE(?, technical_owner_uid),
	    project_code = COALESCE(?, project_code),
	    covered_legacy_systems = ?,
	    notes = ?,
	    updated_by = ?
	WHERE id = ?`,
		nullableBodyText(body, "product_code"),
		nullableBodyText(body, "product_name"),
		nullableBodyText(body, "product_line"),
		jsonStringListOrNil(body["customer_domain"]),
		nullableBodyText(body, "business_domain"),
		nullableBodyText(body, "product_level"),
		nullableBodyText(body, "asset_level"),
		nullableBodyText(body, "status"),
		nullableBodyText(body, "build_stage"),
		nullableBodyText(body, "current_version"),
		nullableBodyText(body, "target_version"),
		nullableBodyText(body, "productization_value_level"),
		jsonStringListOrNil(body["supported_terminals"]),
		nullableBodyText(body, "summary"),
		nullableBodyText(body, "built_at"),
		nullableBodyText(body, "business_owner_uid"),
		nullableBodyText(body, "technical_owner_uid"),
		nullableBodyText(body, "project_code"),
		jsonStringListOrNil(body["covered_legacy_systems"]),
		nullableBodyText(body, "notes"),
		nullableString(operatorUID),
		id,
	)
	if err != nil {
		return err
	}
	if err := requireProductWriteScopeTx(ctx, tx, id, query); err != nil {
		return err
	}
	// This runs inside the owning receipt's business callback: a replay must
	// not append another event, and an audit failure rolls back the mutation.
	return insertEvent(ctx, tx, "product_asset", id, "updated", operatorUID, map[string]any{"summary": "产品主档已更新"})
}
