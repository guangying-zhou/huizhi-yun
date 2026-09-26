package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const personalCabinetExtensions = "doc docx ppt pptx pdf txt csv rtf zip rar 7z tar gz png jpg jpeg gif bmp webp svg mp4 mp3 wav avi mov json xml yaml yml html css js ts java py go rs c cpp h sql sh bat"

func ValidatePersonalCabinetUpload(payload map[string]any) error {
	invalid := httperror.New(400, "invalid_cabinet_upload", "Invalid personal cabinet upload")
	for key := range payload {
		if key != "original_name" && key != "file_ext" && key != "file_size" && key != "content_sha256" && key != "folder_id" {
			return invalid
		}
	}
	name, ok := payload["original_name"].(string)
	if !ok || strings.TrimSpace(name) == "" || len([]rune(name)) > 255 || strings.ContainsAny(name, "/\\") || strings.IndexFunc(name, func(r rune) bool { return r < 32 || r == 127 }) >= 0 {
		return invalid
	}
	ext, ok := payload["file_ext"].(string)
	if !ok || ext == "" || strings.ContainsAny(ext, " \t\r\n") || !strings.Contains(" "+personalCabinetExtensions+" ", " "+ext+" ") || !strings.HasSuffix(strings.ToLower(name), "."+ext) {
		return invalid
	}
	hash, ok := payload["content_sha256"].(string)
	if !ok || !personalDocumentContentHash.MatchString(hash) {
		return invalid
	}
	size, ok := payload["file_size"].(float64)
	if !ok || size < 0 || size > 100*1024*1024 || size != float64(int64(size)) {
		return invalid
	}
	if value := payload["folder_id"]; value != nil {
		id, ok := value.(float64)
		if !ok || id < 1 || id > 9007199254740991 || id != float64(int64(id)) {
			return invalid
		}
	}
	return nil
}

func personalCabinetUploadFacts(identity PersonalFolderCreationIdentity, payload map[string]any) (map[string]any, error) {
	if identity.Tenant == "" || identity.Deployment == "" || identity.Actor == "" || len([]rune(identity.Actor)) > 64 || identity.Actor == "." || identity.Actor == ".." || strings.ContainsAny(identity.Actor, "/\\") || strings.IndexFunc(identity.Actor, func(r rune) bool { return r < 32 || r == 127 }) >= 0 || identity.Client != "enterprise.runtime" || identity.Key == "" || len(identity.Key) > 200 {
		return nil, httperror.New(403, "cabinet_upload_identity_invalid", "Bound cabinet upload identity required")
	}
	if err := ValidatePersonalCabinetUpload(payload); err != nil {
		return nil, err
	}
	var folder int64
	if v := payload["folder_id"]; v != nil {
		folder = int64(v.(float64))
	}
	// JSON hashing accepts legitimate punctuation in filenames. The facts carry
	// no service credentials or arbitrary paths; the UUID/key are server derived.
	normalized := map[string]any{"original_name": payload["original_name"], "file_ext": payload["file_ext"], "file_size": payload["file_size"], "content_sha256": payload["content_sha256"], "folder_id": nullableInt64(folder)}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(raw)
	ns := sha256.Sum256([]byte(strings.Join([]string{"codocs.personal-cabinet.upload.v1", identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	uuid := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	normalized["uuid"] = uuid
	normalized["owner_uid"] = identity.Actor
	normalized["filename"] = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/:*?"<>|`, r) {
			return '_'
		}
		return r
	}, payload["original_name"].(string))
	normalized["oss_path"] = "codocs/users/" + identity.Actor + "/cabinet/" + uuid + "/" + hex.EncodeToString(digest[:]) + "." + payload["file_ext"].(string)
	return normalized, nil
}

// Plan never creates metadata. Commit repeats the same checks under row locks
// after the Host has conditionally stored the bytes. The unique UUID and the
// immutable, complete-payload digest path provide durable upload idempotency.
func (a *Adapter) PlanPersonalCabinetUpload(ctx context.Context, identity PersonalFolderCreationIdentity, payload map[string]any) (map[string]any, error) {
	facts, err := personalCabinetUploadFacts(identity, payload)
	if err != nil {
		return nil, err
	}
	_, err = checkPersonalCabinetUpload(ctx, a.db, facts, false)
	return facts, err
}

func checkPersonalCabinetUpload(ctx context.Context, db folderQuerier, facts map[string]any, lock bool) (int64, error) {
	if folder, ok := facts["folder_id"].(int64); ok && folder > 0 {
		row, err := readFolderScope(ctx, db, folder, lock)
		if err != nil {
			return 0, err
		}
		if row.Kind != "private" || !folderScopeAllowed(row, facts["owner_uid"].(string), nil, true) {
			return 0, httperror.New(403, "cabinet_folder_scope_denied", "Folder is outside the personal cabinet scope")
		}
	}
	query := "SELECT id, owner_uid, dept_code, project_code, oss_path, original_name, file_ext, file_size, folder_id, status, deleted_at FROM cabinet_files WHERE uuid = ? LIMIT 1"
	if lock {
		query += " FOR UPDATE"
	}
	var id, size int64
	var status int
	var owner, path, name, ext string
	var dept, project sql.NullString
	var folder sql.NullInt64
	var deleted sql.NullTime
	err := db.QueryRowContext(ctx, query, facts["uuid"]).Scan(&id, &owner, &dept, &project, &path, &name, &ext, &size, &folder, &status, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if owner != facts["owner_uid"] || dept.Valid || project.Valid {
		return 0, httperror.New(403, "cabinet_upload_scope_denied", "File is outside the personal cabinet scope")
	}
	expectedFolder, _ := facts["folder_id"].(int64)
	if status != 1 || deleted.Valid || path != facts["oss_path"] || name != facts["original_name"] || ext != facts["file_ext"] || size != int64(facts["file_size"].(float64)) || folder.Int64 != expectedFolder {
		return 0, httperror.New(409, "cabinet_upload_key_conflict", "Upload key refers to a changed or deleted file")
	}
	return id, nil
}

func (a *Adapter) CommitPersonalCabinetUpload(ctx context.Context, identity PersonalFolderCreationIdentity, payload map[string]any) (map[string]any, error) {
	facts, err := personalCabinetUploadFacts(identity, payload)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	id, err := checkPersonalCabinetUpload(ctx, tx, facts, true)
	if err != nil {
		return nil, err
	}
	if id == 0 {
		result, err := tx.ExecContext(ctx, `INSERT INTO cabinet_files (uuid, filename, original_name, file_ext, file_size, oss_path, owner_uid, dept_code, project_code, folder_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1)`, facts["uuid"], facts["filename"], facts["original_name"], facts["file_ext"], facts["file_size"], facts["oss_path"], facts["owner_uid"], facts["folder_id"])
		if err != nil {
			return nil, err
		}
		id, err = result.LastInsertId()
		if err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	facts["id"] = id
	return facts, nil
}
