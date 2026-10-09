package codocs

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) requireDocumentAnnotationRead(ctx context.Context, uuid string, query url.Values) (map[string]any, error) {
	actorUID, err := requireTrustedAnnotationActor(query)
	if err != nil {
		return nil, err
	}
	doc, err := a.documentByUUID(ctx, uuid, false)
	if err != nil || actorUID == stringValue(doc["owner_uid"]) {
		return doc, err
	}
	if departmentDocumentReadAllowedByTrustedContext(doc, query) {
		return doc, nil
	}
	permission, err := a.sharePermission(ctx, int64Value(doc["id"]), actorUID)
	if err != nil {
		return nil, err
	}
	if permission != "" {
		return doc, nil
	}
	allowed, err := a.relationCanRead(ctx, int64Value(doc["id"]), actorUID)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, httperror.New(http.StatusForbidden, "permission_denied", "Permission denied")
	}
	return doc, nil
}

func requireTrustedAnnotationActor(query url.Values) (string, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return "", httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	if query.Get("hzy_runtime_actor_delegated") != "1" {
		return "", httperror.New(http.StatusForbidden, "trusted_actor_required", "Trusted runtime actor delegation is required")
	}
	return actorUID, nil
}

func (a *Adapter) documentAnnotations(ctx context.Context, uuid string, query url.Values) ([]map[string]any, error) {
	if _, err := a.requireDocumentAnnotationRead(ctx, uuid, query); err != nil {
		return nil, err
	}
	rows, err := a.db.QueryContext(ctx, `
      SELECT *
      FROM document_annotations
      WHERE document_uuid = ? AND status != 'deleted'
      ORDER BY status, created_at ASC`, uuid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	annotations, err := rowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(annotations) == 0 {
		return []map[string]any{}, nil
	}

	ids := make([]any, 0, len(annotations))
	placeholders := make([]string, 0, len(annotations))
	for _, annotation := range annotations {
		ids = append(ids, int64Value(annotation["id"]))
		placeholders = append(placeholders, "?")
	}
	replyRows, err := a.db.QueryContext(ctx, `
      SELECT *
      FROM annotation_replies
	      WHERE annotation_id IN (`+strings.Join(placeholders, ",")+`) AND deleted_at IS NULL
      ORDER BY created_at ASC`, ids...)
	if err != nil {
		return nil, err
	}
	defer replyRows.Close()
	replies, err := rowsToMaps(replyRows)
	if err != nil {
		return nil, err
	}
	replyMap := map[int64][]map[string]any{}
	for _, reply := range replies {
		annotationID := int64Value(reply["annotation_id"])
		replyMap[annotationID] = append(replyMap[annotationID], reply)
	}
	for _, annotation := range annotations {
		replies := replyMap[int64Value(annotation["id"])]
		if replies == nil {
			replies = []map[string]any{}
		}
		annotation["replies"] = replies
	}
	return annotations, nil
}

func (a *Adapter) createDocumentAnnotation(ctx context.Context, uuid string, query url.Values, body map[string]any) (map[string]any, error) {
	if _, err := requireTrustedAnnotationActor(query); err != nil {
		return nil, err
	}
	selectedText := stringValue(body["selected_text"])
	content := stringValue(body["content"])
	authorID := actorFromBody(body)
	if uuid == "" || selectedText == "" || content == "" || authorID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "document uuid, selected_text, content and author_id are required")
	}
	if _, err := a.requireDocumentWrite(ctx, uuid, body, false); err != nil {
		return nil, err
	}
	mentionedUsers, err := jsonBodyValue(body["mentioned_users"], []any{})
	if err != nil {
		return nil, err
	}
	result, err := a.db.ExecContext(ctx, `
      INSERT INTO document_annotations
        (document_uuid, selected_text, context_before, context_after, position_hint,
         content, mentioned_users, author_id, author_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		uuid,
		selectedText,
		stringValue(body["context_before"]),
		stringValue(body["context_after"]),
		int64Value(body["position_hint"]),
		content,
		mentionedUsers,
		authorID,
		authorID,
	)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	return map[string]any{"id": id}, nil
}

func (a *Adapter) requireDocumentAnnotationWrite(ctx context.Context, uuid string, annotationID string, query url.Values, body map[string]any) error {
	if _, err := requireTrustedAnnotationActor(query); err != nil {
		return err
	}
	if _, err := a.requireDocumentWrite(ctx, uuid, body, false); err != nil {
		return err
	}
	var found int
	err := a.db.QueryRowContext(ctx, "SELECT 1 FROM document_annotations WHERE id = ? AND document_uuid = ? AND status <> 'deleted' LIMIT 1", annotationID, uuid).Scan(&found)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "annotation_not_found", "Annotation not found")
	}
	return err
}

func (a *Adapter) updateDocumentAnnotation(ctx context.Context, uuid string, annotationID string, query url.Values, body map[string]any) (map[string]any, error) {
	status := stringValue(body["status"])
	if annotationID == "" || status == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "annotation id and status are required")
	}
	if err := a.requireDocumentAnnotationWrite(ctx, uuid, annotationID, query, body); err != nil {
		return nil, err
	}
	actorUID := actorFromBody(body)
	fields := map[string]any{"status": status, "updated_at": sqlLiteral("NOW()")}
	if status == "resolved" {
		fields["resolved_at"] = sqlLiteral("NOW()")
		fields["resolved_by"] = actorUID
	} else if status == "deleted" {
		fields["deleted_at"] = sqlLiteral("NOW()")
		fields["deleted_by"] = actorUID
	} else {
		fields["resolved_at"] = nil
		fields["deleted_at"] = nil
	}
	return a.updateByID(ctx, "document_annotations", annotationID, fields)
}

func (a *Adapter) createAnnotationReply(ctx context.Context, uuid string, annotationID string, query url.Values, body map[string]any) (map[string]any, error) {
	content := stringValue(body["content"])
	authorID := actorFromBody(body)
	if annotationID == "" || content == "" || authorID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "annotation id, content and author_id are required")
	}
	if err := a.requireDocumentAnnotationWrite(ctx, uuid, annotationID, query, body); err != nil {
		return nil, err
	}
	mentionedUsers, err := jsonBodyValue(body["mentioned_users"], []any{})
	if err != nil {
		return nil, err
	}
	result, err := a.db.ExecContext(ctx, `
      INSERT INTO annotation_replies
        (annotation_id, content, mentioned_users, author_id, author_name)
      VALUES (?, ?, ?, ?, ?)`,
		annotationID,
		content,
		mentionedUsers,
		authorID,
		authorID,
	)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	return map[string]any{"id": id}, nil
}

func (a *Adapter) deleteAnnotationReply(ctx context.Context, uuid string, annotationID string, replyID string, query url.Values, body map[string]any) (map[string]any, error) {
	if replyID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "reply id is required")
	}
	if err := a.requireDocumentAnnotationWrite(ctx, uuid, annotationID, query, body); err != nil {
		return nil, err
	}
	result, err := a.db.ExecContext(ctx, `
		UPDATE annotation_replies r
		JOIN document_annotations a ON a.id = r.annotation_id
		SET r.deleted_at = NOW()
		WHERE r.id = ? AND r.annotation_id = ? AND a.document_uuid = ? AND a.status <> 'deleted'`, replyID, annotationID, uuid)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "reply_not_found", "Annotation reply not found")
	}
	return map[string]any{"updated": true}, nil
}
