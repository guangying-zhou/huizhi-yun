package codocs

import (
	"context"
	"database/sql"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// createCollaborationVersion keeps the document lock, write ACL and version
// allocation in one transaction. Moving any of these steps outside the
// transaction would reintroduce concurrent duplicate versions or a write ACL
// time-of-check/time-of-use gap.
func (a *Adapter) createCollaborationVersion(ctx context.Context, body map[string]any) (map[string]any, error) {
	docID := int64Value(body["docId"])
	documentUUID := ""
	if docID == 0 {
		documentUUID = stringValue(body["uuid"])
	}
	actorUID := actorFromBody(body)
	if actorUID == "" {
		return nil, httperror.New(http.StatusUnauthorized, "unauthorized", "Actor uid is required")
	}
	ossVersionID := stringValue(body["ossVersionId"])
	contentSize := int64Value(body["contentSize"])
	contentSHA256 := strings.ToLower(strings.TrimSpace(stringValue(body["contentSha256"])))
	decodedHash, hashErr := hex.DecodeString(contentSHA256)
	if hashErr != nil || len(decodedHash) != 32 {
		return nil, httperror.New(http.StatusBadRequest, "content_sha256_required", "A valid contentSha256 is required for every new document version")
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var lockedDocumentID int64
	var lockedDocumentUUID, ownerUID string
	var readonlyFlag, status int64
	lockQuery := `
		SELECT id, uuid, owner_uid, readonly_flag, status
		FROM documents
		WHERE id = ? AND status <> 0
		LIMIT 1
		FOR UPDATE`
	lockArg := any(docID)
	if docID == 0 {
		lockQuery = `
			SELECT id, uuid, owner_uid, readonly_flag, status
			FROM documents
			WHERE uuid = ? AND status <> 0
			LIMIT 1
			FOR UPDATE`
		lockArg = documentUUID
	}
	if err := tx.QueryRowContext(ctx, lockQuery, lockArg).Scan(&lockedDocumentID, &lockedDocumentUUID, &ownerUID, &readonlyFlag, &status); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "document_not_found", "Document not found")
		}
		return nil, err
	}
	if status == 2 || readonlyFlag == 1 {
		return nil, httperror.New(http.StatusForbidden, "document_readonly", "Document is readonly")
	}
	if actorUID != ownerUID {
		var permission string
		err := tx.QueryRowContext(ctx, `
			SELECT permission
			FROM document_shares
			WHERE document_id = ? AND shared_to_uid = ?
			LIMIT 1`, lockedDocumentID, actorUID).Scan(&permission)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if err == sql.ErrNoRows || permission != "write" {
			return nil, httperror.New(http.StatusForbidden, "permission_denied", "Permission denied")
		}
	}

	var maxVersion sql.NullInt64
	if err := tx.QueryRowContext(ctx, "SELECT MAX(version_num) FROM document_versions WHERE document_id = ?", lockedDocumentID).Scan(&maxVersion); err != nil {
		return nil, err
	}
	nextVersion := maxVersion.Int64 + 1
	if !maxVersion.Valid {
		nextVersion = 1
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO document_versions
			(document_id, version_num, oss_version_id, editor_uid, content_size, content_sha256)
		VALUES (?, ?, ?, ?, ?, ?)`, lockedDocumentID, nextVersion, ossVersionID, actorUID, contentSize, contentSHA256)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	return map[string]any{
		"id":            id,
		"documentId":    lockedDocumentID,
		"documentUuid":  lockedDocumentUUID,
		"versionNum":    nextVersion,
		"contentSha256": contentSHA256,
	}, nil
}
