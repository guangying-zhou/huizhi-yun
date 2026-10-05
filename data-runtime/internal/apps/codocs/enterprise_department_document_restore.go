package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func validateEnterpriseDepartmentRestore(payload map[string]any, commit bool) error {
	for field, value := range payload {
		switch field {
		case "new_title":
			title, ok := value.(string)
			if !ok || strings.TrimSpace(title) == "" || len([]rune(title)) > 255 {
				return httperror.New(400, "department_restore_input_invalid", "Invalid restore title")
			}
		case "state_sha256":
			hash, ok := value.(string)
			if !commit || !ok || !personalDocumentContentHash.MatchString(hash) {
				return httperror.New(400, "department_restore_input_invalid", "Invalid restore state")
			}
		default:
			return httperror.New(400, "department_restore_input_invalid", "Invalid restore field")
		}
	}
	if commit && payload["state_sha256"] == nil {
		return httperror.New(400, "department_restore_input_invalid", "Restore state required")
	}
	return nil
}

func departmentRestoreIdentityValid(identity EnterpriseDepartmentFolderIdentity, check EnterpriseDepartmentManagerCheck, keyRequired bool) bool {
	return identity.Tenant != "" && identity.SourceDeployment != "" && identity.TargetDeployment != "" && identity.Actor != "" && identity.Client == "enterprise.runtime" && identity.Department != "" && check != nil && (!keyRequired || identity.Key != "" && len(identity.Key) <= 190)
}

func departmentRestoreFolder(ctx context.Context, tx *sql.Tx, doc map[string]any, department string, lock bool) (int64, error) {
	folderID := int64Value(doc["folder_id"])
	if folderID == 0 {
		return 0, nil
	}
	var kind, dept string
	var project sql.NullString
	query := `SELECT folder_type,dept_code,project_code FROM folders WHERE id=?`
	if lock {
		query += " FOR UPDATE"
	}
	err := tx.QueryRowContext(ctx, query, folderID).Scan(&kind, &dept, &project)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil // Original directory was deleted: restore to department root.
	}
	if err != nil {
		return 0, err
	}
	if kind != "department" || dept != department || project.String != "" {
		return 0, httperror.New(403, "department_restore_folder_denied", "Original folder is outside department scope")
	}
	return folderID, nil
}

func departmentRestorePlan(doc map[string]any, folderID int64, newTitle string) (map[string]any, error) {
	path := stringValue(doc["oss_path"])
	if (!strings.HasPrefix(path, "codocs/") && !strings.HasPrefix(path, "recycle.bin/")) || strings.Contains(path, "\\") || strings.ContainsAny(path, "\x00\r\n") {
		return nil, httperror.New(409, "department_restore_path_invalid", "Document storage path cannot be restored")
	}
	for _, segment := range strings.Split(path, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return nil, httperror.New(409, "department_restore_path_invalid", "Document storage path cannot be restored")
		}
	}
	title := firstNonEmpty(strings.TrimSpace(newTitle), stringValue(doc["title"]))
	state0 := map[string]any{
		"uuid": doc["uuid"], "owner": doc["owner_uid"], "kind": doc["doc_type"], "department": doc["dept_code"], "folder": doc["folder_id"], "restore_folder": folderID,
		"title": doc["title"], "path": path, "status": doc["status"], "deleted_at": stringValue(doc["deleted_at"]), "updated_at": stringValue(doc["updated_at"]),
	}
	// A snapshot-backed (v2) document keeps its head; the plan is bound to the
	// generation so a conversion between preflight and commit is a 409.
	generation := int64Value(doc["snapshot_generation"])
	if generation > 0 {
		state0["snapshot_generation"] = generation
	}
	stateBytes, err := json.Marshal(state0)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256(stateBytes)
	state := hex.EncodeToString(hash[:])
	target := path
	if strings.HasPrefix(path, "recycle.bin/") {
		target = "codocs/document-restores/" + stringValue(doc["uuid"]) + "/" + state + ".md"
	}
	return map[string]any{"uuid": doc["uuid"], "title": title, "doc_type": "department", "dept_code": doc["dept_code"], "folder_id": nullableInt64(folderID), "source_path": path, "target_path": target, "state_sha256": state, "deleted": int64Value(doc["status"]) == 0, "snapshot_backed": generation > 0}, nil
}

func (a *Adapter) PlanEnterpriseDepartmentDocumentRestore(ctx context.Context, identity EnterpriseDepartmentFolderIdentity, uuid string, payload map[string]any, check EnterpriseDepartmentManagerCheck) (map[string]any, error) {
	if !departmentRestoreIdentityValid(identity, check, false) {
		return nil, httperror.New(403, "department_restore_identity_invalid", "Bound department manager identity required")
	}
	if !uuidPattern.MatchString(uuid) {
		return nil, httperror.New(400, "department_restore_uuid_invalid", "Invalid document identifier")
	}
	if err := validateEnterpriseDepartmentRestore(payload, false); err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = check(ctx, tx, identity.Actor, identity.Department); err != nil {
		return nil, err
	}
	doc, err := readDocumentByUUID(ctx, tx, uuid, true, false)
	if err != nil {
		return nil, err
	}
	if stringValue(doc["doc_type"]) != "department" || stringValue(doc["dept_code"]) != identity.Department || stringValue(doc["project_code"]) != "" {
		return nil, httperror.New(403, "department_document_scope_denied", "Document is outside department scope")
	}
	if doc["snapshot_generation"], err = currentSnapshotGeneration(ctx, tx, uuid); err != nil {
		return nil, err
	}
	folder, err := departmentRestoreFolder(ctx, tx, doc, identity.Department, false)
	if err != nil {
		return nil, err
	}
	return departmentRestorePlan(doc, folder, stringValue(payload["new_title"]))
}

func (a *Adapter) RestoreEnterpriseDepartmentDocument(ctx context.Context, identity EnterpriseDepartmentFolderIdentity, uuid string, payload map[string]any, check EnterpriseDepartmentManagerCheck) (map[string]any, error) {
	if !departmentRestoreIdentityValid(identity, check, true) {
		return nil, httperror.New(403, "department_restore_identity_invalid", "Bound department manager identity required")
	}
	if !uuidPattern.MatchString(uuid) {
		return nil, httperror.New(400, "department_restore_uuid_invalid", "Invalid document identifier")
	}
	if err := validateEnterpriseDepartmentRestore(payload, true); err != nil {
		return nil, err
	}
	titleHash := sha256.Sum256([]byte(strings.TrimSpace(stringValue(payload["new_title"]))))
	command := map[string]any{"uuid": uuid, "actor": identity.Actor, "department": identity.Department, "new_title_sha256": hex.EncodeToString(titleHash[:])}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	namespace := sha256.Sum256([]byte(strings.Join([]string{"codocs.department-documents.restore.v1", identity.Tenant, identity.SourceDeployment, identity.TargetDeployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(namespace[:])
	namespace[6] = (namespace[6] & 0x0f) | 0x40
	namespace[8] = (namespace[8] & 0x3f) | 0x80
	opID := fmt.Sprintf("%x-%x-%x-%x-%x", namespace[:4], namespace[4:6], namespace[6:8], namespace[8:10], namespace[10:16])
	input := io.ReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.SourceDeployment, SourceApp: "enterprise", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.SourceDeployment, TargetDeploymentCode: identity.TargetDeployment, TargetApp: "codocs", OperationID: opID,
		OperationCode: "codocs.department-documents.restore.v1", RequiredCapability: "codocs:enterprise-host:execute", IdempotencyKey: key,
		CommandSchemaVersion: "codocs-dept-restore.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
	}
	repo, err := io.NewReceiptRepository(a.db)
	if err != nil {
		return nil, err
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = check(ctx, tx, identity.Actor, identity.Department); err != nil {
		return nil, err
	}
	doc, err := readDocumentByUUID(ctx, tx, uuid, true, true)
	if err != nil {
		return nil, err
	}
	if stringValue(doc["doc_type"]) != "department" || stringValue(doc["dept_code"]) != identity.Department || stringValue(doc["project_code"]) != "" {
		return nil, httperror.New(403, "department_document_scope_denied", "Document is outside department scope")
	}
	// Read under the document row lock. Restore only flips the status: the
	// snapshot head, its objects and any mirror are never touched.
	if doc["snapshot_generation"], err = currentSnapshotGeneration(ctx, tx, uuid); err != nil {
		return nil, err
	}
	folder, err := departmentRestoreFolder(ctx, tx, doc, identity.Department, true)
	if err != nil {
		return nil, err
	}
	plan, err := departmentRestorePlan(doc, folder, stringValue(payload["new_title"]))
	if err != nil {
		return nil, err
	}
	receipt, err := repo.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		if int64Value(doc["status"]) != 0 {
			return io.ReceiptBusinessResult{}, httperror.New(409, "department_document_not_deleted", "Document is not deleted")
		}
		if plan["state_sha256"] != payload["state_sha256"] {
			return io.ReceiptBusinessResult{}, httperror.New(409, "department_restore_state_changed", "Document changed since restore preflight")
		}
		if err := ensureDocumentTitleAvailableFrom(ctx, tx, uuid, doc, stringValue(plan["title"]), nullableInt64(folder)); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		_, err := tx.ExecContext(ctx, `UPDATE documents SET status=1,deleted_at=NULL,title=?,folder_id=?,oss_path=?,updated_at=NOW()
			WHERE uuid=? AND doc_type='department' AND dept_code=? AND status=0`, plan["title"], nullableInt64(folder), plan["target_path"], uuid, identity.Department)
		return io.ReceiptBusinessResult{TargetBizType: "document", TargetBizCode: uuid, HTTPStatus: http.StatusOK}, err
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "department_restore_key_conflict", "Idempotency key was used for another restore")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != uuid {
		return nil, httperror.New(503, "department_restore_receipt_invalid", "Document receipt is invalid")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"uuid": uuid, "restored": true, "replayed": receipt.Existing}, nil
}
