package altoc

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type documentEntitySpec struct {
	Entity           string
	Table            string
	Alias            string
	Resource         string
	OwnerColumn      string
	DepartmentColumn string
}

var documentEntitySpecs = map[string]documentEntitySpec{
	"customer":    {Entity: "customer", Table: "customer", Alias: "cu", Resource: "customer", OwnerColumn: "owner_user_id", DepartmentColumn: "owner_dept_code"},
	"lead":        {Entity: "lead", Table: "`lead`", Alias: "le", Resource: "lead", OwnerColumn: "owner_user_id", DepartmentColumn: "owner_dept_code"},
	"opportunity": {Entity: "opportunity", Table: "opportunity", Alias: "op", Resource: "opportunity", OwnerColumn: "owner_user_id", DepartmentColumn: "owner_dept_code"},
	"quotation":   {Entity: "quotation", Table: "quotation", Alias: "q", Resource: "quotation", OwnerColumn: "owner_user_id", DepartmentColumn: "owner_dept_code"},
	"contract":    {Entity: "contract", Table: "contract", Alias: "ct", Resource: "contract", OwnerColumn: "owner_user_id", DepartmentColumn: "owner_dept_code"},
	"tender":      {Entity: "tender", Table: "tender", Alias: "td", Resource: "quotation", OwnerColumn: "owner_user_id"},
}

func (a *Adapter) listDocumentLinks(ctx context.Context, query url.Values) (map[string]any, error) {
	spec, entityID, err := documentEntityFromQuery(query)
	if err != nil {
		return nil, err
	}
	if err := a.requireDocumentEntityScope(ctx, spec, entityID, http.MethodGet, query, nil); err != nil {
		return nil, err
	}
	page := altocGetPageParams(query)
	where := []string{"entity_type = ?", "entity_id = ?"}
	args := []any{spec.Entity, entityID}

	if linkType := strings.TrimSpace(query.Get("link_type")); linkType != "" {
		where = append(where, "link_type = ?")
		args = append(args, linkType)
	}
	if sourceType := strings.TrimSpace(query.Get("source_type")); sourceType != "" {
		where = append(where, "source_type = ?")
		args = append(args, sourceType)
	}
	whereSQL := strings.Join(where, " AND ")

	countRow, err := altocQueryOneMap(ctx, a.DB(), "SELECT COUNT(*) AS total FROM document_link WHERE "+whereSQL, args...)
	if err != nil {
		return nil, err
	}
	items, err := altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM document_link
		WHERE `+whereSQL+`
		ORDER BY created_at DESC, id DESC
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items":    items,
		"total":    numberValue(countRow["total"], 0),
		"page":     page.page,
		"pageSize": page.pageSize,
	}, nil
}

func (a *Adapter) getDocumentLink(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	linkID, err := altocIdentifierID(identifier, "document_link_id")
	if err != nil {
		return nil, err
	}
	link, spec, entityID, err := a.documentLinkWithSpec(ctx, linkID)
	if err != nil {
		return nil, err
	}
	if err := a.requireDocumentEntityScope(ctx, spec, entityID, http.MethodGet, query, nil); err != nil {
		return nil, err
	}
	return link, nil
}

func (a *Adapter) createDocumentLink(ctx context.Context, body map[string]any) (map[string]any, error) {
	spec, entityID, err := documentEntityFromBody(body)
	if err != nil {
		return nil, err
	}
	if err := a.requireDocumentEntityScope(ctx, spec, entityID, http.MethodPost, nil, body); err != nil {
		return nil, err
	}
	fields, err := documentLinkFields(spec, entityID, body)
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	id, err := altocInsertRecordTx(ctx, tx, "document_link", fields)
	if err != nil {
		return nil, err
	}
	operator := firstNonEmptyText(altocActor(body), altocMapText(fields, "created_by"))
	if err := insertAltocAuditTx(ctx, tx, "document_link", id, "create", nil, fields, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id}, nil
}

func (a *Adapter) deleteDocumentLink(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	linkID, err := altocIdentifierID(identifier, "document_link_id")
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	link, spec, entityID, err := a.documentLinkWithSpecTx(ctx, tx, linkID)
	if err != nil {
		return nil, err
	}
	if err := a.requireDocumentEntityScopeTx(ctx, tx, spec, entityID, http.MethodDelete, nil, body); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM document_link WHERE id = ?", linkID); err != nil {
		return nil, err
	}
	operator := altocActor(body)
	if err := insertAltocAuditTx(ctx, tx, "document_link", linkID, "delete", link, nil, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": linkID, "changed": true}, nil
}

func documentEntityFromQuery(query url.Values) (documentEntitySpec, int64, error) {
	entityType := strings.TrimSpace(query.Get("entity_type"))
	entityID := altocPositiveID(firstNonEmptyText(query.Get("entity_id"), query.Get("entityId")))
	return documentEntitySpecAndID(entityType, entityID)
}

func documentEntityFromBody(body map[string]any) (documentEntitySpec, int64, error) {
	entityType := firstBodyText(body, "entity_type", "entityType")
	entityID := altocPositiveID(firstNonEmptyBodyValue(body, "entity_id", "entityId"))
	return documentEntitySpecAndID(entityType, entityID)
}

func documentEntitySpecAndID(entityType string, entityID int64) (documentEntitySpec, int64, error) {
	entityType = strings.TrimSpace(entityType)
	if entityType == "" {
		return documentEntitySpec{}, 0, httperror.New(http.StatusBadRequest, "missing_document_entity_type", "entity_type is required")
	}
	spec, ok := documentEntitySpecs[entityType]
	if !ok {
		return documentEntitySpec{}, 0, httperror.New(http.StatusBadRequest, "invalid_document_entity_type", "unsupported document entity type")
	}
	if entityID <= 0 {
		return documentEntitySpec{}, 0, httperror.New(http.StatusBadRequest, "missing_document_entity_id", "entity_id is required")
	}
	return spec, entityID, nil
}

func documentLinkFields(spec documentEntitySpec, entityID int64, body map[string]any) (map[string]any, error) {
	fields := map[string]any{
		"entity_type": spec.Entity,
		"entity_id":   entityID,
	}
	for _, field := range []string{
		"document_uuid",
		"external_url",
		"external_mime_type",
		"document_title",
		"link_type",
		"source_type",
		"created_by",
	} {
		if value, ok := altocBodyValue(body, field); ok {
			fields[field] = documentNullableText(value)
		}
	}
	if fields["link_type"] == nil || strings.TrimSpace(fmt.Sprint(fields["link_type"])) == "" {
		fields["link_type"] = "general"
	}
	if fields["source_type"] == nil || strings.TrimSpace(fmt.Sprint(fields["source_type"])) == "" {
		fields["source_type"] = "codocs"
	}
	if documentNullableText(fields["document_uuid"]) == nil && documentNullableText(fields["external_url"]) == nil {
		return nil, httperror.New(http.StatusBadRequest, "missing_document_reference", "document_uuid or external_url is required")
	}
	return fields, nil
}

func documentNullableText(value any) any {
	if value == nil {
		return nil
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return nil
	}
	return text
}

func (a *Adapter) documentLinkWithSpec(ctx context.Context, linkID int64) (map[string]any, documentEntitySpec, int64, error) {
	return a.documentLinkWithSpecFromConn(ctx, a.DB(), linkID)
}

func (a *Adapter) documentLinkWithSpecTx(ctx context.Context, tx *sql.Tx, linkID int64) (map[string]any, documentEntitySpec, int64, error) {
	return a.documentLinkWithSpecFromConn(ctx, tx, linkID)
}

func (a *Adapter) documentLinkWithSpecFromConn(ctx context.Context, conn altocQueryer, linkID int64) (map[string]any, documentEntitySpec, int64, error) {
	link, err := altocQueryOneMap(ctx, conn, `
		SELECT *
		FROM document_link
		WHERE id = ?
		LIMIT 1
	`, linkID)
	if err != nil {
		return nil, documentEntitySpec{}, 0, err
	}
	if link == nil {
		return nil, documentEntitySpec{}, 0, httperror.New(http.StatusNotFound, "record_not_found", "document link not found")
	}
	entityID := altocPositiveID(link["entity_id"])
	spec, entityID, err := documentEntitySpecAndID(altocMapText(link, "entity_type"), entityID)
	if err != nil {
		return nil, documentEntitySpec{}, 0, err
	}
	return link, spec, entityID, nil
}

func (a *Adapter) requireDocumentEntityScope(ctx context.Context, spec documentEntitySpec, entityID int64, method string, query url.Values, body map[string]any) error {
	return a.requireDocumentEntityScopeWithConn(ctx, a.DB(), spec, entityID, method, query, body)
}

func (a *Adapter) requireDocumentEntityScopeTx(ctx context.Context, tx *sql.Tx, spec documentEntitySpec, entityID int64, method string, query url.Values, body map[string]any) error {
	return a.requireDocumentEntityScopeWithConn(ctx, tx, spec, entityID, method, query, body)
}

func (a *Adapter) requireDocumentEntityScopeWithConn(ctx context.Context, conn altocQueryer, spec documentEntitySpec, entityID int64, method string, query url.Values, body map[string]any) error {
	scopeBody := altocRuntimeBodyFromRequest(query, body)
	action := "view"
	if !altocIsReadMethod(method) {
		action = "edit"
	}
	if err := altocRequireActionScope(scopeBody, spec.Resource, action); err != nil {
		return err
	}
	record, err := documentScopedEntityRecord(ctx, conn, spec, entityID, scopeBody)
	if err != nil {
		return err
	}
	if altocIsReadMethod(method) {
		return nil
	}
	return altocRequireRecordWrite(scopeBody, spec.Resource, record, spec.OwnerColumn, spec.DepartmentColumn)
}

func documentScopedEntityRecord(ctx context.Context, conn altocQueryer, spec documentEntitySpec, entityID int64, scopeBody map[string]any) (map[string]any, error) {
	where := []string{spec.Alias + ".id = ?", spec.Alias + ".deleted_at IS NULL"}
	args := []any{entityID}
	scopeWhere, scopeArgs, err := altocReadScopeWhereFromBody(scopeBody, spec.Resource, spec.Alias, spec.OwnerColumn, spec.DepartmentColumn)
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)
	record, err := altocQueryOneMap(ctx, conn, `
		SELECT `+spec.Alias+`.*
		FROM `+spec.Table+` `+spec.Alias+`
		WHERE `+strings.Join(where, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, httperror.New(http.StatusNotFound, spec.Resource+"_not_found", spec.Resource+" not found")
	}
	return record, nil
}
