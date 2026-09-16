package codocs

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// documentIDByUUID is intentionally scoped to the share/read/version
// compatibility endpoints. Other document domains use documentByUUID so they
// retain their existing projection and access checks.
func (a *Adapter) documentIDByUUID(ctx context.Context, uuid string) (int64, error) {
	var id int64
	if err := a.db.QueryRowContext(ctx, "SELECT id FROM documents WHERE uuid = ? AND status <> 0 LIMIT 1", uuid).Scan(&id); err != nil {
		if err == sql.ErrNoRows {
			return 0, httperror.New(http.StatusNotFound, "document_not_found", "Document not found")
		}
		return 0, err
	}
	return id, nil
}

func (a *Adapter) documentShares(ctx context.Context, uuid string, query url.Values) (map[string]any, error) {
	actorUID, _, err := requireTrustedDocumentListActor(query)
	if err != nil {
		return nil, err
	}
	doc, err := a.documentByUUID(ctx, uuid, false)
	if err != nil {
		return nil, err
	}
	if actorUID != stringValue(doc["owner_uid"]) {
		return nil, httperror.New(http.StatusForbidden, "permission_denied", "Only document owner can list shares")
	}
	return queryPaged(ctx, a.db, "SELECT * FROM document_shares WHERE document_id = ? ORDER BY created_at DESC, id DESC", int64Value(doc["id"]))
}

func (a *Adapter) documentVersions(ctx context.Context, uuid string, query url.Values) (map[string]any, error) {
	if _, _, err := requireTrustedDocumentListActor(query); err != nil {
		return nil, err
	}
	if _, err := a.documentAccess(ctx, uuid, query); err != nil {
		return nil, err
	}
	docID, err := a.documentIDByUUID(ctx, uuid)
	if err != nil {
		return nil, err
	}
	return queryPaged(ctx, a.db, "SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_num DESC, id DESC", docID)
}

func (a *Adapter) createDocumentShare(ctx context.Context, uuid string, body map[string]any) (map[string]any, error) {
	doc, err := a.documentByUUID(ctx, uuid, false)
	if err != nil {
		return nil, err
	}
	docID := int64Value(doc["id"])
	ownerUID := stringValue(doc["owner_uid"])
	actorUID := actorFromBody(body)
	if actorUID == "" {
		return nil, httperror.New(http.StatusUnauthorized, "unauthorized", "Actor uid is required")
	}
	if actorUID != ownerUID {
		return nil, httperror.New(http.StatusForbidden, "permission_denied", "Only document owner can manage shares")
	}
	if int64Value(doc["readonly_flag"]) == 1 {
		return nil, httperror.New(http.StatusForbidden, "document_readonly", "Document is readonly")
	}
	targetUID := firstNonEmpty(stringValue(body["sharedToUid"]), stringValue(body["shared_to_uid"]), stringValue(body["uid"]))
	if targetUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_request", "Target uid is required")
	}
	permission := normalizePermission(firstNonEmpty(stringValue(body["permission"]), "read"))
	message := firstNonEmpty(stringValue(body["message"]), stringValue(body["remark"]))

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var shareID int64
	err = tx.QueryRowContext(ctx, `
      SELECT id
      FROM document_shares
      WHERE document_id = ? AND shared_to_uid = ?
      LIMIT 1`, docID, targetUID).Scan(&shareID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if shareID > 0 {
		_, err = tx.ExecContext(ctx, `
        UPDATE document_shares
        SET permission = ?, message = ?, updated_at = NOW()
        WHERE id = ? AND document_id = ?`, permission, nullableString(message), shareID, docID)
	} else {
		result, execErr := tx.ExecContext(ctx, `
        INSERT INTO document_shares
          (document_id, owner_uid, shared_to_uid, permission, message, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
			docID,
			ownerUID,
			targetUID,
			permission,
			nullableString(message),
		)
		err = execErr
		if err == nil {
			shareID, _ = result.LastInsertId()
		}
	}
	if err != nil {
		return nil, err
	}
	if err := a.syncShareRelationTx(ctx, tx, docID, uuid, ownerUID, targetUID, shareID, permission); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"notifiedOnly": false, "shareId": shareID}, nil
}

func (a *Adapter) updateDocumentShare(ctx context.Context, uuid string, shareID string, body map[string]any) (map[string]any, error) {
	doc, err := a.documentByUUID(ctx, uuid, false)
	if err != nil {
		return nil, err
	}
	docID := int64Value(doc["id"])
	ownerUID := stringValue(doc["owner_uid"])
	if err := requireOwnerActor(ownerUID, actorFromBody(body), int64Value(doc["readonly_flag"])); err != nil {
		return nil, err
	}
	permission := normalizePermission(firstNonEmpty(stringValue(body["permission"]), "read"))
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	result, err := tx.ExecContext(ctx, `
      UPDATE document_shares
      SET permission = ?, updated_at = NOW()
      WHERE id = ? AND document_id = ?`, permission, shareID, docID)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "share_not_found", "Share not found")
	}
	var sharedToUID string
	if err := tx.QueryRowContext(ctx, "SELECT shared_to_uid FROM document_shares WHERE id = ? AND document_id = ? LIMIT 1", shareID, docID).Scan(&sharedToUID); err != nil {
		return nil, err
	}
	if err := a.syncShareRelationTx(ctx, tx, docID, uuid, ownerUID, sharedToUID, int64Value(shareID), permission); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"updated": true}, nil
}

func (a *Adapter) deleteDocumentShare(ctx context.Context, uuid string, shareID string, body map[string]any) (map[string]any, error) {
	doc, err := a.documentByUUID(ctx, uuid, false)
	if err != nil {
		return nil, err
	}
	docID := int64Value(doc["id"])
	if err := requireOwnerActor(stringValue(doc["owner_uid"]), actorFromBody(body), int64Value(doc["readonly_flag"])); err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, "DELETE FROM document_shares WHERE id = ? AND document_id = ?", shareID, docID); err != nil {
		return nil, err
	}
	if err := a.deactivateRelationsBySourceTx(ctx, tx, "document_share", shareID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"deleted": true}, nil
}

func (a *Adapter) markDocumentRead(ctx context.Context, uuid string, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, _, err := requireTrustedDocumentListActor(query)
	if err != nil {
		return nil, err
	}
	if bodyActorUID := actorFromBody(body); bodyActorUID != "" && bodyActorUID != actorUID {
		return nil, httperror.New(http.StatusForbidden, "actor_mismatch", "Trusted actor does not match request body")
	}
	docID, err := a.documentIDByUUID(ctx, uuid)
	if err != nil {
		return nil, err
	}
	result, err := a.db.ExecContext(ctx, `
      UPDATE document_shares
      SET is_opened = 1, opened_at = IF(opened_at IS NULL, NOW(), opened_at)
      WHERE document_id = ? AND shared_to_uid = ? AND is_opened = 0`,
		docID,
		actorUID,
	)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	return map[string]any{"read": true, "firstRead": affected > 0}, nil
}

func (a *Adapter) deleteDocumentVersion(ctx context.Context, uuid string, versionID string, query url.Values, body map[string]any) (map[string]any, error) {
	if _, _, err := requireTrustedDocumentListActor(query); err != nil {
		return nil, err
	}
	doc, err := a.requireDocumentWrite(ctx, uuid, body, false)
	if err != nil {
		return nil, err
	}
	if _, err := a.db.ExecContext(ctx, "DELETE FROM document_versions WHERE id = ? AND document_id = ?", versionID, int64Value(doc["id"])); err != nil {
		return nil, err
	}
	return map[string]any{"deleted": true}, nil
}

func (a *Adapter) syncShareRelation(ctx context.Context, docID int64, uuid string, ownerUID string, sharedToUID string, shareID int64, permission string) error {
	return a.upsertDocumentRelation(ctx, documentRelationInput{
		DocumentID:   docID,
		DocumentUUID: uuid,
		RelatedUID:   sharedToUID,
		RelationType: "shared_with_me",
		SourceType:   "document_share",
		SourceID:     strconv.FormatInt(shareID, 10),
		CanRead:      true,
		CanEdit:      permission == "write",
		Metadata: map[string]any{
			"ownerUid":     ownerUID,
			"permission":   permission,
			"documentUuid": uuid,
		},
	})
}

func (a *Adapter) syncShareRelationTx(ctx context.Context, tx *sql.Tx, docID int64, uuid string, ownerUID string, sharedToUID string, shareID int64, permission string) error {
	metadata, err := json.Marshal(map[string]any{
		"ownerUid":     ownerUID,
		"permission":   permission,
		"documentUuid": uuid,
	})
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
      INSERT INTO document_relations
        (document_id, document_uuid, related_uid, relation_type, source_type, source_id,
         can_read, can_edit, can_comment, status, metadata)
      VALUES (?, ?, ?, 'shared_with_me', 'document_share', ?, 1, ?, 0, 1, ?)
      ON DUPLICATE KEY UPDATE
        document_uuid = VALUES(document_uuid),
        can_read = VALUES(can_read),
        can_edit = VALUES(can_edit),
        can_comment = VALUES(can_comment),
        status = 1,
        metadata = VALUES(metadata),
        updated_at = NOW()`,
		docID,
		uuid,
		sharedToUID,
		strconv.FormatInt(shareID, 10),
		boolInt(permission == "write"),
		string(metadata),
	)
	return err
}

func (a *Adapter) deactivateRelationsBySource(ctx context.Context, sourceType string, sourceID string) error {
	exists, err := a.tableExists(ctx, "document_relations")
	if err != nil || !exists {
		return err
	}
	_, err = a.db.ExecContext(ctx, "UPDATE document_relations SET status = 0, updated_at = NOW() WHERE source_type = ? AND source_id = ?", sourceType, sourceID)
	return err
}

func (a *Adapter) deactivateRelationsBySourceTx(ctx context.Context, tx *sql.Tx, sourceType string, sourceID string) error {
	_, err := tx.ExecContext(ctx, "UPDATE document_relations SET status = 0, updated_at = NOW() WHERE source_type = ? AND source_id = ?", sourceType, sourceID)
	return err
}
