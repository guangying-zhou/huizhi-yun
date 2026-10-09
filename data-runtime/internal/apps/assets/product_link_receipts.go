package assets

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// ProductLinkPayload excludes transient scope and document authorization proof
// from the stable command identity. Unknown business fields fail closed.
func ProductLinkPayload(action string, body map[string]any) (map[string]any, error) {
	fields := map[string][]string{
		"link-base":     {"technology_base_id"},
		"link-asset":    {"asset_id", "relation_type", "is_primary"},
		"link-document": {"document_id", "document_type", "remark"},
	}
	keys, ok := fields[action]
	if !ok {
		return nil, httperror.New(400, "invalid_product_link_action", "Unsupported product relation")
	}
	out := map[string]any{}
	for k, v := range body {
		valid := false
		for _, allowed := range keys {
			if k == allowed {
				valid = true
			}
		}
		if !valid {
			return nil, httperror.New(400, "invalid_product_link_field", "Unsupported relation field")
		}
		out[k] = v
	}
	if action == "link-base" {
		if _, err := requireIDBody(out, "technology_base_id", "Technology base required"); err != nil {
			return nil, err
		}
	}
	if action == "link-asset" {
		if _, err := requireIDBody(out, "asset_id", "Asset required"); err != nil {
			return nil, err
		}
	}
	if action == "link-document" {
		if _, err := productDocumentIdentity(out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func validateProductLinkAuthorityTx(ctx context.Context, tx *sql.Tx, action string, id int64, payload map[string]any, q url.Values) error {
	if err := requireProductWriteScopeTx(ctx, tx, id, q); err != nil {
		return err
	}
	switch action {
	case "link-base":
		target, err := requireIDBody(payload, "technology_base_id", "Technology base required")
		if err != nil {
			return err
		}
		return requireProductTargetBaseTx(ctx, tx, target, q)
	case "link-asset":
		target, err := requireIDBody(payload, "asset_id", "Asset required")
		if err != nil {
			return err
		}
		return requireProductTargetAssetTx(ctx, tx, target, q)
	case "link-document":
		uuid, err := productDocumentIdentity(payload)
		if err != nil {
			return err
		}
		return requireProductDocumentProofTx(ctx, tx, id, uuid, q)
	}
	return httperror.New(400, "invalid_product_link_action", "Unsupported product relation")
}

func ExecuteProductLinkInTransaction(ctx context.Context, tx *sql.Tx, repo *io.ReceiptRepository, identity ProductMasterCommandIdentity, action string, id int64, body map[string]any, q url.Values) (int64, error) {
	if id <= 0 || identity.ActorUID == "" || identity.ActorUID != q.Get("current_user") || strings.TrimSpace(identity.Key) == "" {
		return 0, httperror.New(403, "invalid_product_command_identity", "Bound actor, product and key required")
	}
	payload, err := ProductLinkPayload(action, body)
	if err != nil {
		return 0, err
	}
	// Replays require current product AND target authority, not old receipt authority.
	if err = validateProductLinkAuthorityTx(ctx, tx, action, id, payload, q); err != nil {
		return 0, err
	}
	input, err := assetsOwnedReceiptInput(identity, "assets.products."+action+".v1", "assets:product:edit", id, map[string]any{"action": action, "id": id, "actor": identity.ActorUID, "input": payload})
	if err != nil {
		return 0, err
	}
	result, err := repo.ExecuteOwnedInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		var mutationErr error
		switch action {
		case "link-base":
			mutationErr = LinkProductBaseInTransaction(ctx, tx, id, payload, q)
		case "link-asset":
			mutationErr = LinkProductAssetInTransaction(ctx, tx, id, payload, q)
		case "link-document":
			mutationErr = LinkProductDocumentInTransaction(ctx, tx, id, payload, q)
		}
		return io.ReceiptBusinessResult{TargetBizType: "product_asset", TargetBizCode: strconv.FormatInt(id, 10), HTTPStatus: 200}, mutationErr
	})
	if err != nil {
		return 0, err
	}
	if result.TargetBizCode != strconv.FormatInt(id, 10) {
		return 0, httperror.New(503, "invalid_product_receipt", "Product receipt unavailable")
	}
	return id, nil
}

// VerifyOwnedProductLinkReceiptSchema is incremental: master writes remain
// compatible with their already-applied migration; links require their own one.
func VerifyOwnedProductLinkReceiptSchema(ctx context.Context, db ProductReceiptSchemaReader, registeredTable string) error {
	if err := VerifyOwnedProductReceiptSchema(ctx, db, registeredTable); err != nil {
		return err
	}
	var clause string
	err := db.QueryRowContext(ctx, `SELECT cc.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS cc JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=cc.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=cc.CONSTRAINT_NAME WHERE tc.TABLE_SCHEMA=DATABASE() AND tc.TABLE_NAME=? AND tc.CONSTRAINT_TYPE='CHECK' AND tc.ENFORCED='YES' AND cc.CHECK_CLAUSE LIKE '%assets-owned-command.v1%'`, strings.Trim(registeredTable, "`")).Scan(&clause)
	if err != nil {
		return httperror.New(503, "assets_link_receipt_schema_unavailable", "Apply Assets product link receipt migration before linking")
	}
	for _, action := range []string{"link-base", "link-asset", "link-document"} {
		if !strings.Contains(clause, "assets.products."+action+".v1") {
			return httperror.New(503, "assets_link_receipt_schema_unavailable", "Apply Assets product link receipt migration before linking")
		}
	}
	return nil
}
