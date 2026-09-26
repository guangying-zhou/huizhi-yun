package codocs

import (
	"context"
	"errors"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Owning a source file does not confer access to its converted document after
// a later transfer or share revocation. Reuse the document's current read ACL.
func (a *Adapter) PersonalCabinetConvertedInfo(ctx context.Context, uuid string, query url.Values) (map[string]any, error) {
	file, err := a.cabinetFile(ctx, uuid, query, false)
	if err != nil {
		return nil, err
	}
	converted := stringValue(file["converted_doc_uuid"])
	if converted == "" {
		return nil, nil
	}
	doc, err := a.documentAccess(ctx, converted, query)
	if err != nil {
		var e httperror.Error
		if errors.As(err, &e) && e.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return map[string]any{"doc_uuid": doc["uuid"], "doc_title": doc["title"], "doc_path": "我的文档/" + stringValue(doc["title"]) + ".md"}, nil
}
