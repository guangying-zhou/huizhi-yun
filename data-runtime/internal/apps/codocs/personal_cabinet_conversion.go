package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var cabinetConversionCode = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

func ValidatePersonalCabinetConversion(payload map[string]any, commit bool) error {
	invalid := httperror.New(400, "invalid_cabinet_conversion", "Invalid cabinet conversion")
	for key := range payload {
		if key != "title" && key != "folder_id" && !(commit && (key == "source_state" || key == "content_sha256" || key == "content_size")) {
			return invalid
		}
	}
	// Reuse personal creation limits, without accepting its ownership/type/path.
	facts := map[string]any{"title": payload["title"], "folder_id": payload["folder_id"], "doc_type": "private", "content_sha256": strings.Repeat("0", 64), "content_size": float64(0)}
	if commit {
		state, ok := payload["source_state"].(string)
		if !ok || !personalDocumentContentHash.MatchString(state) {
			return invalid
		}
		facts["content_sha256"], facts["content_size"] = payload["content_sha256"], payload["content_size"]
	}
	return ValidatePersonalDocumentCreation(facts)
}

func cabinetConversionFacts(identity PersonalFolderCreationIdentity, source string, payload map[string]any, commit bool) (map[string]any, error) {
	if identity.Tenant == "" || identity.Deployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Key == "" || len(identity.Key) > 200 {
		return nil, httperror.New(403, "cabinet_conversion_identity_invalid", "Bound conversion identity required")
	}
	if !cabinetConversionCode.MatchString(source) {
		return nil, httperror.New(400, "invalid_cabinet_conversion", "Invalid source file")
	}
	if err := ValidatePersonalCabinetConversion(payload, commit); err != nil {
		return nil, err
	}
	var folder int64
	if value := payload["folder_id"]; value != nil {
		folder = int64(value.(float64))
	}
	facts := map[string]any{"source_uuid": source, "title": strings.TrimSpace(payload["title"].(string)), "folder_id": nullableInt64(folder)}
	raw, _ := json.Marshal(facts)
	digest := sha256.Sum256(raw)
	ns := sha256.Sum256([]byte(strings.Join([]string{"codocs.personal-cabinet.convert.v1", identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	uuid := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	facts["uuid"], facts["owner_uid"] = uuid, identity.Actor
	facts["target_prefix"] = "codocs/cabinet-conversions/" + uuid + "/" + hex.EncodeToString(digest[:]) + "/"
	return facts, nil
}

// A plan is read-only. The UUID binds the request key; its immutable path binds
// the original intent. Replays never overwrite later document edits or reset a
// cabinet link changed by a subsequent conversion.
func checkCabinetConversion(ctx context.Context, db documentReadDB, facts map[string]any, lock bool) error {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	var owner, path, ext string
	var size int64
	var status int
	var dept, project, converted, updated sql.NullString
	var deleted sql.NullTime
	err := db.QueryRowContext(ctx, `SELECT owner_uid, dept_code, project_code, oss_path, file_ext, file_size, status, deleted_at, converted_doc_uuid, updated_at FROM cabinet_files WHERE uuid = ? LIMIT 1`+suffix, facts["source_uuid"]).Scan(&owner, &dept, &project, &path, &ext, &size, &status, &deleted, &converted, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(404, "cabinet_not_found", "Cabinet file not found")
	}
	if err != nil {
		return err
	}
	if owner != facts["owner_uid"] || dept.Valid || project.Valid {
		return httperror.New(403, "cabinet_conversion_scope_denied", "File is outside personal scope")
	}
	if status != 1 || deleted.Valid {
		return httperror.New(409, "cabinet_conversion_source_changed", "Source file is deleted")
	}
	if ext != "doc" && ext != "docx" {
		return httperror.New(400, "cabinet_conversion_unsupported", "File cannot be converted")
	}
	if size < 0 || size > 100*1024*1024 {
		return httperror.New(413, "cabinet_conversion_too_large", "Source file is too large")
	}
	raw, _ := json.Marshal([]any{facts["source_uuid"], owner, path, ext, size, status, converted, updated})
	state := sha256.Sum256(raw)
	facts["source_state"], facts["source_path"], facts["source_ext"], facts["source_size"] = hex.EncodeToString(state[:]), path, ext, size
	var targetOwner, targetKind, targetPath, targetTitle string
	var targetDept, targetProject sql.NullString
	var targetStatus int
	err = db.QueryRowContext(ctx, `SELECT owner_uid, doc_type, dept_code, project_code, oss_path, title, status FROM documents WHERE uuid = ? LIMIT 1`+suffix, facts["uuid"]).Scan(&targetOwner, &targetKind, &targetDept, &targetProject, &targetPath, &targetTitle, &targetStatus)
	if err == nil {
		if targetOwner != owner || targetKind != "private" || targetDept.Valid || targetProject.Valid {
			return httperror.New(403, "cabinet_conversion_target_scope_denied", "Target is outside personal scope")
		}
		if targetStatus == 0 || !strings.HasPrefix(targetPath, facts["target_prefix"].(string)) {
			return httperror.New(409, "cabinet_conversion_key_conflict", "Conversion key refers to a changed or deleted document")
		}
		facts["replayed"], facts["title"], facts["oss_path"] = true, targetTitle, targetPath
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if folder, ok := facts["folder_id"].(int64); ok && folder > 0 {
		row, err := readFolderScope(ctx, db, folder, lock)
		if err != nil {
			return err
		}
		if row.Kind != "private" || !folderScopeAllowed(row, owner, nil, true) {
			return httperror.New(403, "cabinet_conversion_folder_denied", "Target folder is outside personal scope")
		}
	}
	if err := ensureDocumentTitleAvailableFrom(ctx, db, facts["uuid"].(string), map[string]any{"owner_uid": owner, "doc_type": "private"}, facts["title"].(string), facts["folder_id"]); err != nil {
		return err
	}
	facts["replayed"] = false
	return nil
}

func (a *Adapter) PlanPersonalCabinetConversion(ctx context.Context, identity PersonalFolderCreationIdentity, source string, payload map[string]any) (map[string]any, error) {
	facts, err := cabinetConversionFacts(identity, source, payload, false)
	if err != nil {
		return nil, err
	}
	if err := checkCabinetConversion(ctx, a.db, facts, false); err != nil {
		return nil, err
	}
	return facts, nil
}

func (a *Adapter) CommitPersonalCabinetConversion(ctx context.Context, identity PersonalFolderCreationIdentity, source string, payload map[string]any) (map[string]any, error) {
	facts, err := cabinetConversionFacts(identity, source, payload, true)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := checkCabinetConversion(ctx, tx, facts, true); err != nil {
		return nil, err
	}
	if facts["replayed"] == true {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return facts, nil
	}
	if facts["source_state"] != payload["source_state"] {
		return nil, httperror.New(409, "cabinet_conversion_source_changed", "Source file changed since planning")
	}
	path := facts["target_prefix"].(string) + facts["source_state"].(string) + "/" + payload["content_sha256"].(string) + ".md"
	result, err := tx.ExecContext(ctx, `INSERT INTO documents (uuid, title, doc_type, oss_path, owner_uid, dept_code, project_code, folder_id, content_size, status) VALUES (?, ?, 'private', ?, ?, NULL, NULL, ?, ?, 1)`, facts["uuid"], facts["title"], path, identity.Actor, facts["folder_id"], payload["content_size"])
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	if err := upsertDocumentRelationTx(ctx, tx, documentRelationInput{DocumentID: id, DocumentUUID: facts["uuid"].(string), RelatedUID: identity.Actor, RelationType: "created_by_me", SourceType: "document", SourceID: strconv.FormatInt(id, 10), CanRead: true, CanEdit: true, Metadata: map[string]any{"docType": "private", "deptCode": nil, "projectCode": nil, "folderId": facts["folder_id"], "sourceApp": "codocs", "sourceBiz": source}}); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE cabinet_files SET converted_doc_uuid = ?, updated_at = NOW() WHERE uuid = ?`, facts["uuid"], source); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	facts["oss_path"] = path
	return facts, nil
}
