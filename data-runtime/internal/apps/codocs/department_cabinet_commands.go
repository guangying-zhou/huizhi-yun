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
	"regexp"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type EnterpriseDepartmentCabinetIdentity struct {
	Tenant, SourceDeployment, TargetDeployment, Actor, Client, RequestID, Key, Department string
}
type EnterpriseDepartmentCabinetManagerCheck func(context.Context, *sql.Tx, string, string) error

var departmentCabinetCode = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

func departmentCabinetInput(identity EnterpriseDepartmentCabinetIdentity, action string, payload map[string]any) (io.ReceiptCommandInput, error) {
	if identity.Tenant == "" || identity.SourceDeployment == "" || identity.TargetDeployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || !departmentCabinetCode.MatchString(identity.Department) || identity.Key == "" || len(identity.Key) > 191 {
		return io.ReceiptCommandInput{}, httperror.New(403, "department_cabinet_identity_invalid", "Bound department cabinet identity required")
	}
	command := map[string]any{"actor": identity.Actor, "department": identity.Department, "action": action, "payload": payload}
	raw, err := json.Marshal(command)
	if err != nil {
		return io.ReceiptCommandInput{}, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return io.ReceiptCommandInput{}, err
	}
	ns := sha256.Sum256([]byte(strings.Join([]string{"codocs.department-cabinet." + action + ".v1", identity.Tenant, identity.SourceDeployment, identity.TargetDeployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	return io.ReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.SourceDeployment, SourceApp: "enterprise", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.SourceDeployment, TargetDeploymentCode: identity.TargetDeployment, TargetApp: "codocs",
		OperationID:   fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16]),
		OperationCode: "codocs.department-cabinet." + action + ".v1", RequiredCapability: "codocs:enterprise-host:execute", IdempotencyKey: key,
		CommandSchemaVersion: "codocs-dept-cabinet.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
	}, nil
}

func stringField(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return strings.TrimSpace(value)
}
func idField(payload map[string]any, key string) (int64, error) {
	value, ok := payload[key]
	if !ok || value == nil {
		return 0, nil
	}
	n, ok := value.(float64)
	if !ok || n < 1 || n > 9007199254740991 || n != float64(int64(n)) {
		return 0, httperror.New(400, "department_cabinet_id_invalid", "Invalid identifier")
	}
	return int64(n), nil
}
func onlyDepartmentCabinetFields(payload map[string]any, allowed ...string) error {
	set := map[string]bool{}
	for _, key := range allowed {
		set[key] = true
	}
	for key := range payload {
		if !set[key] {
			return httperror.New(400, "department_cabinet_input_invalid", "Invalid department cabinet input")
		}
	}
	return nil
}
func checkDepartmentCabinetFolder(ctx context.Context, tx *sql.Tx, department string, id int64) error {
	if id == 0 {
		return nil
	}
	var dept string
	err := tx.QueryRowContext(ctx, `SELECT dept_code FROM cabinet_folders WHERE id=? FOR UPDATE`, id).Scan(&dept)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && dept != department) {
		return httperror.New(403, "department_cabinet_folder_scope_denied", "Folder is outside department")
	}
	return err
}
func lockDepartmentCabinetFile(ctx context.Context, tx *sql.Tx, department, uuid string) (int, error) {
	var status int
	var deleted sql.NullTime
	err := tx.QueryRowContext(ctx, `SELECT status,deleted_at FROM cabinet_files WHERE uuid=? AND dept_code=? AND project_code IS NULL FOR UPDATE`, uuid, department).Scan(&status, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, httperror.New(404, "cabinet_not_found", "Cabinet file not found")
	}
	if err != nil {
		return 0, err
	}
	if status != 1 && status != 0 {
		return 0, httperror.New(409, "cabinet_file_changed", "Cabinet file status changed")
	}
	if status == 1 && deleted.Valid {
		return 0, httperror.New(409, "cabinet_file_changed", "Cabinet file has been deleted")
	}
	return status, nil
}

// Every mutation checks the server-held Directory lease before consulting the
// receipt table. Browser department/owner
// fields are never used as authority; the signed route code is the scope.
func (a *Adapter) EnterpriseDepartmentCabinetCommand(ctx context.Context, identity EnterpriseDepartmentCabinetIdentity, action string, payload map[string]any, check EnterpriseDepartmentCabinetManagerCheck) (map[string]any, error) {
	if check == nil {
		return nil, httperror.New(503, "department_cabinet_check_missing", "Department check unavailable")
	}
	if payload == nil {
		payload = map[string]any{}
	}
	if action == "upload-plan" {
		return a.planEnterpriseDepartmentCabinetUpload(ctx, identity, payload, check)
	}
	if action == "conversion-plan" {
		return a.planEnterpriseDepartmentCabinetConversion(ctx, identity, payload, check)
	}
	if action == "convert" {
		return a.convertEnterpriseDepartmentCabinet(ctx, identity, payload, check)
	}
	if action == "publish-record" {
		return a.publishEnterpriseDepartmentCabinet(ctx, identity, payload, check)
	}
	if action == "upload" {
		return a.commitEnterpriseDepartmentCabinetUpload(ctx, identity, payload, check)
	}
	input, err := departmentCabinetInput(identity, action, payload)
	if err != nil {
		return nil, err
	}
	if err := validateDepartmentCabinetMutation(action, payload); err != nil {
		return nil, err
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
	if err := check(ctx, tx, identity.Actor, identity.Department); err != nil {
		return nil, err
	}
	// Lock and verify the currently scoped object before replaying a receipt.
	if action == "update" || action == "delete" {
		status, err := lockDepartmentCabinetFile(ctx, tx, identity.Department, stringField(payload, "uuid"))
		if err != nil {
			return nil, err
		}
		if action == "update" && status != 1 {
			return nil, httperror.New(409, "cabinet_file_changed", "Cabinet file has been deleted")
		}
	}
	if action == "folder-update" {
		id, _ := idField(payload, "id")
		if err := checkDepartmentCabinetFolder(ctx, tx, identity.Department, id); err != nil {
			return nil, err
		}
	}
	if action == "update" || action == "folder-create" || action == "folder-update" {
		id, _ := idField(payload, "folder_id")
		if err := checkDepartmentCabinetFolder(ctx, tx, identity.Department, id); err != nil {
			return nil, err
		}
	}
	if action == "folder-update" {
		id, _ := idField(payload, "id")
		parent, _ := idField(payload, "folder_id")
		if _, ok := payload["folder_id"]; ok {
			if err := checkDepartmentCabinetFolderCycle(ctx, tx, identity.Department, id, parent); err != nil {
				return nil, err
			}
		}
	}
	receipt, err := repo.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		return runDepartmentCabinetMutation(ctx, tx, identity, action, payload)
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "department_cabinet_key_conflict", "Idempotency key was used for another command")
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": receipt.TargetBizCode}, nil
}

func validateDepartmentCabinetMutation(action string, payload map[string]any) error {
	switch action {
	case "update":
		if err := onlyDepartmentCabinetFields(payload, "uuid", "filename", "folder_id"); err != nil {
			return err
		}
		_, hasFolder := payload["folder_id"]
		if !departmentCabinetCode.MatchString(stringField(payload, "uuid")) || (stringField(payload, "filename") == "" && !hasFolder) {
			return httperror.New(400, "department_cabinet_input_invalid", "Invalid file update")
		}
		if name := stringField(payload, "filename"); name != "" && (len([]rune(name)) > 255 || strings.ContainsAny(name, "/\\")) {
			return httperror.New(400, "department_cabinet_name_invalid", "Invalid file name")
		}
		_, err := idField(payload, "folder_id")
		return err
	case "delete":
		if err := onlyDepartmentCabinetFields(payload, "uuid"); err != nil {
			return err
		}
		if !departmentCabinetCode.MatchString(stringField(payload, "uuid")) {
			return httperror.New(400, "department_cabinet_uuid_invalid", "Invalid file ID")
		}
		return nil
	case "folder-create", "folder-update":
		if err := onlyDepartmentCabinetFields(payload, "id", "name", "folder_id"); err != nil {
			return err
		}
		name := stringField(payload, "name")
		if name == "" || len([]rune(name)) > 255 || strings.ContainsAny(name, "/\\") {
			return httperror.New(400, "department_cabinet_name_invalid", "Invalid folder name")
		}
		if action == "folder-update" {
			id, err := idField(payload, "id")
			if err != nil || id == 0 {
				return httperror.New(400, "department_cabinet_id_invalid", "Invalid folder ID")
			}
		}
		_, err := idField(payload, "folder_id")
		return err
	case "folder-delete":
		if err := onlyDepartmentCabinetFields(payload, "id"); err != nil {
			return err
		}
		id, err := idField(payload, "id")
		if err != nil || id == 0 {
			return httperror.New(400, "department_cabinet_id_invalid", "Invalid folder ID")
		}
		return nil
	default:
		return httperror.New(400, "department_cabinet_action_invalid", "Invalid cabinet action")
	}
}

func checkDepartmentCabinetFolderCycle(ctx context.Context, tx *sql.Tx, department string, folderID, parentID int64) error {
	seen := map[int64]bool{}
	for current := parentID; current != 0; {
		if current == folderID || seen[current] {
			return httperror.New(409, "department_cabinet_folder_cycle", "Folder cannot be moved under itself")
		}
		seen[current] = true
		if len(seen) > 10000 {
			return httperror.New(409, "department_cabinet_folder_cycle", "Folder ancestry is too deep")
		}
		var parent sql.NullInt64
		var scope string
		err := tx.QueryRowContext(ctx, `SELECT dept_code,parent_id FROM cabinet_folders WHERE id=? FOR UPDATE`, current).Scan(&scope, &parent)
		if errors.Is(err, sql.ErrNoRows) || err == nil && scope != department {
			return httperror.New(403, "department_cabinet_folder_scope_denied", "Folder is outside department")
		}
		if err != nil {
			return err
		}
		current = parent.Int64
	}
	return nil
}

func runDepartmentCabinetMutation(ctx context.Context, tx *sql.Tx, identity EnterpriseDepartmentCabinetIdentity, action string, payload map[string]any) (io.ReceiptBusinessResult, error) {
	code := stringField(payload, "uuid")
	var result sql.Result
	var err error
	switch action {
	case "update":
		sets := []string{}
		args := []any{}
		if name := stringField(payload, "filename"); name != "" {
			sets = append(sets, "filename=?", "original_name=?")
			args = append(args, name, name)
		}
		if _, ok := payload["folder_id"]; ok {
			id, _ := idField(payload, "folder_id")
			sets = append(sets, "folder_id=?")
			args = append(args, nullableInt64(id))
		}
		args = append(args, code, identity.Department)
		result, err = tx.ExecContext(ctx, `UPDATE cabinet_files SET `+strings.Join(sets, ",")+` WHERE uuid=? AND dept_code=? AND project_code IS NULL AND status=1 AND deleted_at IS NULL`, args...)
	case "delete":
		var status int
		if err = tx.QueryRowContext(ctx, `SELECT status FROM cabinet_files WHERE uuid=? AND dept_code=? AND project_code IS NULL FOR UPDATE`, code, identity.Department).Scan(&status); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		if status != 1 {
			return io.ReceiptBusinessResult{}, httperror.New(409, "cabinet_file_changed", "File is already deleted")
		}
		result, err = tx.ExecContext(ctx, `UPDATE cabinet_files SET status=0,deleted_at=NOW() WHERE uuid=? AND dept_code=? AND project_code IS NULL AND status=1 AND deleted_at IS NULL`, code, identity.Department)
	case "folder-create":
		parent, _ := idField(payload, "folder_id")
		result, err = tx.ExecContext(ctx, `INSERT INTO cabinet_folders(name,parent_id,owner_uid,dept_code) VALUES (?,?,?,?)`, stringField(payload, "name"), nullableInt64(parent), identity.Actor, identity.Department)
	case "folder-update":
		id, _ := idField(payload, "id")
		parent, hasParent := payload["folder_id"]
		if hasParent {
			_ = parent
			parentID, _ := idField(payload, "folder_id")
			result, err = tx.ExecContext(ctx, `UPDATE cabinet_folders SET name=?,parent_id=? WHERE id=? AND dept_code=?`, stringField(payload, "name"), nullableInt64(parentID), id, identity.Department)
		} else {
			result, err = tx.ExecContext(ctx, `UPDATE cabinet_folders SET name=? WHERE id=? AND dept_code=?`, stringField(payload, "name"), id, identity.Department)
		}
	case "folder-delete":
		id, _ := idField(payload, "id")
		if err = checkDepartmentCabinetFolder(ctx, tx, identity.Department, id); err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		var children, files int
		if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM cabinet_folders WHERE parent_id=? AND dept_code=?`, id, identity.Department).Scan(&children); err == nil {
			err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM cabinet_files WHERE folder_id=? AND dept_code=? AND status=1 AND deleted_at IS NULL`, id, identity.Department).Scan(&files)
		}
		if err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		if children+files > 0 {
			return io.ReceiptBusinessResult{}, httperror.New(409, "department_cabinet_folder_not_empty", "Folder is not empty")
		}
		result, err = tx.ExecContext(ctx, `DELETE FROM cabinet_folders WHERE id=? AND dept_code=?`, id, identity.Department)
	}
	if err != nil {
		return io.ReceiptBusinessResult{}, err
	}
	if result == nil {
		return io.ReceiptBusinessResult{}, httperror.New(http.StatusBadRequest, "department_cabinet_action_invalid", "Invalid cabinet action")
	}
	if action == "folder-create" {
		id, e := result.LastInsertId()
		if e != nil {
			return io.ReceiptBusinessResult{}, e
		}
		code = strconv.FormatInt(id, 10)
	}
	if action == "folder-update" || action == "folder-delete" {
		id, _ := idField(payload, "id")
		code = strconv.FormatInt(id, 10)
	}
	if code == "" {
		return io.ReceiptBusinessResult{}, httperror.New(503, "department_cabinet_result_invalid", "Invalid mutation result")
	}
	return io.ReceiptBusinessResult{TargetBizType: "department-cabinet", TargetBizCode: code, HTTPStatus: 200}, nil
}
