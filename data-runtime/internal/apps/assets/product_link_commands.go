package assets

import (
	"context"
	"database/sql"
	"net/url"
)

// Shared owning commands retain original target checks and audit writes.
// The caller owns commit/rollback, including any enclosing receipt.
func LinkProductBaseInTransaction(ctx context.Context, tx *sql.Tx, id int64, body map[string]any, query url.Values) error {
	operatorUID := query.Get("current_user")
	baseID, err := requireIDBody(body, "technology_base_id", "缺少 technology_base_id")
	if err != nil {
		return err
	}
	if err := requireProductWriteScopeTx(ctx, tx, id, query); err != nil {
		return err
	}
	if err := requireProductTargetBaseTx(ctx, tx, baseID, query); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO product_asset_bases (product_asset_id, technology_base_id, created_by) VALUES (?, ?, ?)`,
		id, baseID, nullableString(operatorUID),
	); err != nil {
		return err
	}
	if err := insertEvent(ctx, tx, "product_asset", id, "base_bound", operatorUID, map[string]any{"summary": "产品已关联技术底座", "technology_base_id": baseID}); err != nil {
		return err
	}
	return nil
}

func LinkProductAssetInTransaction(ctx context.Context, tx *sql.Tx, id int64, body map[string]any, query url.Values) error {
	operatorUID := query.Get("current_user")
	assetID, err := requireIDBody(body, "asset_id", "缺少 asset_id")
	if err != nil {
		return err
	}
	if err := requireProductWriteScopeTx(ctx, tx, id, query); err != nil {
		return err
	}
	if err := requireProductTargetAssetTx(ctx, tx, assetID, query); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO product_asset_resources (product_asset_id, asset_id, relation_type, is_primary, created_by)
		VALUES (?, ?, ?, COALESCE(?,0), ?)`,
		id, assetID, coalesceText(body, "relation_type", "runtime"), boolIntFromAny(body["is_primary"]), nullableString(operatorUID),
	); err != nil {
		return err
	}
	if err := insertEvent(ctx, tx, "product_asset", id, "asset_bound", operatorUID, map[string]any{"summary": "产品已关联资产", "asset_id": assetID}); err != nil {
		return err
	}
	return nil
}

func LinkProductDocumentInTransaction(ctx context.Context, tx *sql.Tx, objectID int64, body map[string]any, query url.Values) error {
	documentUUID, err := productDocumentIdentity(body)
	if err != nil {
		return err
	}
	reader := productMasterReader{tx: tx}
	hasArtifactType, err := reader.tableColumnExists(ctx, "asset_documents", "artifact_type")
	if err != nil {
		return err
	}
	hasSourceContext, err := reader.tableColumnExists(ctx, "asset_documents", "source_context")
	if err != nil {
		return err
	}
	if err := requireProductWriteScopeTx(ctx, tx, objectID, query); err != nil {
		return err
	}
	if err := requireProductDocumentProofTx(ctx, tx, objectID, documentUUID, query); err != nil {
		return err
	}
	return linkDocumentWithSchema(ctx, tx, "product_asset", objectID, body, query.Get("current_user"), hasArtifactType, hasSourceContext)
}
