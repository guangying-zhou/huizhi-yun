package codocs

import (
	"context"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"
)

const aimsProductDocumentSearchOperation = "aims.codocs.product-document.search.v1"

func productDocumentSearchCommand(body map[string]any, query url.Values) (string, productDocumentSearchQuery, error) {
	invalid := func() (string, productDocumentSearchQuery, error) {
		return "", productDocumentSearchQuery{}, httperror.New(403, "product_document_search_command_invalid", "Invalid signed product document search")
	}
	allowed := false
	for _, scope := range strings.Fields(query.Get("current_user_scopes")) {
		if scope == aimsProductDocumentReadCapability {
			allowed = true
		}
	}
	if !allowed {
		return "", productDocumentSearchQuery{}, httperror.New(403, "insufficient_scope", "Product document read capability required")
	}
	envelope, ok := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	if !ok {
		return invalid()
	}
	command, ok := envelope["command"].(map[string]any)
	if !ok || len(command) != 6 {
		return invalid()
	}
	for _, key := range []string{"actorUid", "productCode", "action", "search", "page", "pageSize"} {
		if _, ok := command[key]; !ok {
			return invalid()
		}
	}
	for _, key := range []string{"actorUid", "productCode", "action", "search"} {
		value, ok := command[key].(string)
		if !ok || !utf8.ValidString(value) {
			return invalid()
		}
	}
	var payload struct {
		ActorUID    string `json:"actorUid"`
		ProductCode string `json:"productCode"`
		Action      string `json:"action"`
		Search      string `json:"search"`
		Page        int    `json:"page"`
		PageSize    int    `json:"pageSize"`
	}
	raw, err := json.Marshal(command)
	if err != nil {
		return invalid()
	}
	if err = json.Unmarshal(raw, &payload); err != nil {
		return invalid()
	}
	for _, value := range []string{payload.ActorUID, payload.ProductCode} {
		if value == "" || strings.TrimSpace(value) != value || !utf8.ValidString(value) || utf8.RuneCountInString(value) > 64 || strings.ContainsFunc(value, unicode.IsControl) {
			return invalid()
		}
	}
	if strings.Contains(payload.ProductCode, "/") || payload.Action != "search" || payload.Page < 1 || payload.Page > 1000000 || payload.PageSize < 1 || payload.PageSize > 100 || strings.TrimSpace(payload.Search) != payload.Search || utf8.RuneCountInString(payload.Search) > 200 || strings.ContainsFunc(payload.Search, unicode.IsControl) {
		return invalid()
	}
	actor, _, err := scopedDocumentServiceCommand(body, "", query, documentServiceContract{ContextField: "productCode", Capability: aimsProductDocumentReadCapability, Operation: aimsProductDocumentSearchOperation, Schema: aimsProductDocumentSearchOperation, Action: "search"})
	return actor, productDocumentSearchQuery{Search: payload.Search, Page: payload.Page, PageSize: payload.PageSize}, err
}

func (a *Adapter) productDocumentServiceSearch(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	actor, input, err := productDocumentSearchCommand(body, query)
	if err != nil {
		return nil, err
	}
	return a.searchVisibleProductDocuments(ctx, actor, input)
}
