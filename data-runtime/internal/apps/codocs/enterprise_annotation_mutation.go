package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const enterpriseAnnotationMutationOperation = "codocs.document-annotations.mutate.v1"

// MutateEnterpriseAnnotation is the durable Enterprise write boundary for
// annotations. The document ACL, annotation row and owning-domain receipt are
// locked and committed together, so a retry cannot create a second annotation
// or reply and a reused key with different content fails closed.
func (a *Adapter) MutateEnterpriseAnnotation(ctx context.Context, identity PersonalFolderCreationIdentity, action, uuid, annotationID, replyID string, payload map[string]any) (map[string]any, error) {
	if identity.Tenant == "" || identity.Deployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Key == "" || len(identity.Key) > 200 {
		return nil, httperror.New(403, "annotation_identity_invalid", "Bound annotation identity required")
	}
	if uuid == "" || len(uuid) > 100 || strings.ContainsAny(uuid, "\x00\r\n") {
		return nil, httperror.New(400, "annotation_input_invalid", "Invalid document annotation input")
	}
	allowedActions := map[string]string{"create": "create", "update": "edit", "reply-create": "edit", "reply-delete": "edit"}
	permitAction, ok := allowedActions[action]
	if !ok {
		return nil, httperror.New(400, "annotation_action_invalid", "Invalid document annotation action")
	}

	command := map[string]any{"action": action, "uuid": uuid, "annotation_id": annotationID, "reply_id": replyID, "payload": payload, "actor": identity.Actor}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	ns := sha256.Sum256([]byte(strings.Join([]string{enterpriseAnnotationMutationOperation, identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	operationID := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	input := io.OwnedReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: "codocs", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.Deployment, TargetDeploymentCode: identity.Deployment, TargetApp: "codocs", OperationID: operationID,
		OperationCode: enterpriseAnnotationMutationOperation, RequiredCapability: "codocs:document-annotations:" + permitAction, IdempotencyKey: key,
		CommandSchemaVersion: "codocs-annotation-mutation.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
	}
	repo, err := io.NewReceiptRepository(a.db)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	body := cloneBody(payload)
	body["actorUid"] = identity.Actor
	if _, err = requireDocumentWriteFrom(ctx, tx, uuid, body, false, false, true); err != nil {
		return nil, err
	}

	receipt, err := repo.ExecuteOwnedInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		return mutateEnterpriseAnnotationInTx(ctx, tx, action, uuid, annotationID, replyID, identity.Actor, payload)
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "annotation_idempotency_conflict", "Idempotency key was used for another annotation mutation")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizType == "" || receipt.TargetBizCode == "" {
		return nil, httperror.New(503, "annotation_receipt_invalid", "Invalid annotation mutation receipt")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	if action == "create" || action == "reply-create" {
		id, parseErr := strconv.ParseInt(receipt.TargetBizCode, 10, 64)
		if parseErr != nil || id < 1 {
			return nil, httperror.New(503, "annotation_receipt_invalid", "Invalid annotation mutation receipt")
		}
		return map[string]any{"id": id}, nil
	}
	return map[string]any{"updated": true}, nil
}

func cloneBody(payload map[string]any) map[string]any {
	out := make(map[string]any, len(payload)+1)
	for key, value := range payload {
		out[key] = value
	}
	return out
}

func mutateEnterpriseAnnotationInTx(ctx context.Context, tx *sql.Tx, action, uuid, annotationID, replyID, actor string, payload map[string]any) (io.ReceiptBusinessResult, error) {
	if action == "create" {
		selected, content := strings.TrimSpace(stringValue(payload["selected_text"])), strings.TrimSpace(stringValue(payload["content"]))
		if selected == "" || content == "" {
			return io.ReceiptBusinessResult{}, httperror.New(400, "annotation_input_invalid", "Selected text and content are required")
		}
		mentions, err := jsonBodyValue(payload["mentioned_users"], []any{})
		if err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO document_annotations
          (document_uuid, selected_text, context_before, context_after, position_hint, content, mentioned_users, author_id, author_name)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, uuid, selected, stringValue(payload["context_before"]), stringValue(payload["context_after"]), int64Value(payload["position_hint"]), content, mentions, actor, actor)
		return annotationInsertReceipt(result, err, "annotation")
	}
	if annotationID == "" {
		return io.ReceiptBusinessResult{}, httperror.New(400, "annotation_input_invalid", "Annotation id is required")
	}
	var found int
	if err := tx.QueryRowContext(ctx, `SELECT 1 FROM document_annotations WHERE id = ? AND document_uuid = ? AND status <> 'deleted' LIMIT 1 FOR UPDATE`, annotationID, uuid).Scan(&found); errors.Is(err, sql.ErrNoRows) {
		return io.ReceiptBusinessResult{}, httperror.New(404, "annotation_not_found", "Annotation not found")
	} else if err != nil {
		return io.ReceiptBusinessResult{}, err
	}
	switch action {
	case "update":
		status := stringValue(payload["status"])
		if status != "open" && status != "resolved" && status != "deleted" {
			return io.ReceiptBusinessResult{}, httperror.New(400, "annotation_status_invalid", "Invalid annotation status")
		}
		_, err := tx.ExecContext(ctx, `UPDATE document_annotations SET status = ?,
          resolved_at = CASE WHEN ? = 'resolved' THEN NOW() ELSE NULL END,
          resolved_by = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END,
          deleted_at = CASE WHEN ? = 'deleted' THEN NOW() ELSE NULL END,
          deleted_by = CASE WHEN ? = 'deleted' THEN ? ELSE NULL END,
          updated_at = NOW() WHERE id = ? AND document_uuid = ?`, status, status, status, actor, status, status, actor, annotationID, uuid)
		if err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		return io.ReceiptBusinessResult{TargetBizType: "annotation", TargetBizCode: annotationID, HTTPStatus: 200}, nil
	case "reply-create":
		content := strings.TrimSpace(stringValue(payload["content"]))
		if content == "" {
			return io.ReceiptBusinessResult{}, httperror.New(400, "annotation_reply_input_invalid", "Reply content is required")
		}
		mentions, err := jsonBodyValue(payload["mentioned_users"], []any{})
		if err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO annotation_replies (annotation_id, content, mentioned_users, author_id, author_name) VALUES (?, ?, ?, ?, ?)`, annotationID, content, mentions, actor, actor)
		return annotationInsertReceipt(result, err, "annotation-reply")
	case "reply-delete":
		if replyID == "" {
			return io.ReceiptBusinessResult{}, httperror.New(400, "annotation_reply_input_invalid", "Reply id is required")
		}
		result, err := tx.ExecContext(ctx, `UPDATE annotation_replies SET deleted_at = NOW() WHERE id = ? AND annotation_id = ? AND deleted_at IS NULL`, replyID, annotationID)
		if err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			return io.ReceiptBusinessResult{}, httperror.New(404, "reply_not_found", "Annotation reply not found")
		}
		return io.ReceiptBusinessResult{TargetBizType: "annotation-reply", TargetBizCode: replyID, HTTPStatus: 200}, nil
	default:
		return io.ReceiptBusinessResult{}, httperror.New(400, "annotation_action_invalid", "Invalid document annotation action")
	}
}

func annotationInsertReceipt(result sql.Result, err error, kind string) (io.ReceiptBusinessResult, error) {
	if err != nil {
		return io.ReceiptBusinessResult{}, err
	}
	id, err := result.LastInsertId()
	if err != nil || id < 1 {
		if err == nil {
			err = errors.New("annotation insert did not return an id")
		}
		return io.ReceiptBusinessResult{}, err
	}
	return io.ReceiptBusinessResult{TargetBizType: kind, TargetBizCode: strconv.FormatInt(id, 10), HTTPStatus: 200}, nil
}
