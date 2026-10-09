package codocs

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// ReadProductDocumentForEnterprise performs Codocs ACL independently of an
// Aims relation permit. The caller must be the authenticated Enterprise
// Runtime route, which supplies the signed actor and verifies the relation.
// oss_path is returned only for the trusted Host content adapter.
func (a *Adapter) ReadProductDocumentForEnterprise(ctx context.Context, documentUUID, actorUID string, includePath bool) (map[string]any, error) {
	doc, err := a.documentAccess(ctx, documentUUID, url.Values{"current_user": {actorUID}})
	if err != nil {
		return nil, err
	}
	if int64Value(doc["status"]) != 1 {
		return nil, httperror.New(http.StatusForbidden, "product_document_inactive", "Document is not active")
	}
	result := map[string]any{
		"uuid":       strings.TrimSpace(firstTextValue(doc, "uuid")),
		"title":      strings.TrimSpace(firstTextValue(doc, "title")),
		"doc_type":   strings.TrimSpace(firstTextValue(doc, "doc_type")),
		"updated_at": strings.TrimSpace(firstTextValue(doc, "updated_at")),
	}
	if includePath {
		result["oss_path"] = strings.TrimSpace(firstTextValue(doc, "oss_path"))
		result["content_size"] = int64Value(doc["content_size"])
		result["readonly"] = true
	}
	return result, nil
}
