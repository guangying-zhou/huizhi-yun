package assets

import (
	"context"
	"database/sql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"strconv"
	"time"
)

// Product references use Codocs UUIDs. Keep aliases compatible, but reject
// conflicting identities rather than silently selecting the first field.
func productDocumentIdentity(body map[string]any) (string, error) {
	result := ""
	for _, key := range []string{"document_id", "documentUuid", "document_uuid"} {
		raw, present := body[key]
		if !present {
			continue
		}
		value, ok := raw.(string)
		parsed, err := uuid.Parse(value)
		if !ok || err != nil || parsed == uuid.Nil || parsed.String() != value || (result != "" && result != value) {
			return "", httperror.New(400, "invalid_product_document_uuid", "请提供一致的 Codocs 文档 UUID")
		}
		result = value
	}
	if result == "" {
		return "", httperror.New(400, "invalid_product_document_uuid", "缺少 Codocs 文档 UUID")
	}
	return result, nil
}

func requireProductDocumentProofTx(ctx context.Context, tx *sql.Tx, id int64, documentUUID string, query url.Values) error {
	expires, err := strconv.ParseInt(query.Get("current_user_product_document_expires"), 10, 64)
	now := time.Now().UnixMilli()
	if err != nil || expires <= now || expires > now+15000 || query.Get("current_user_product_document_id") != strconv.FormatInt(id, 10) || query.Get("current_user_product_document_uuid") != documentUUID || query.Get("current_user_product_document_actor") == "" || query.Get("current_user_product_document_actor") != query.Get("current_user") || query.Get("current_user_product_document_code") == "" {
		return httperror.New(403, "product_document_authorization_required", "fresh bound document authorization required")
	}
	var code string
	if err := tx.QueryRowContext(ctx, "SELECT product_code FROM product_assets WHERE id=? FOR UPDATE", id).Scan(&code); err != nil {
		return err
	}
	if code != query.Get("current_user_product_document_code") {
		return httperror.New(403, "product_document_product_changed", "product identity changed since document authorization")
	}
	return nil
}
