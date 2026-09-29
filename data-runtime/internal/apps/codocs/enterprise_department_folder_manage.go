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
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// ManageEnterpriseDepartmentFolder keeps the Directory manager check, folder
// scope, mutation and receipt in one serializable transaction. Replays still
// recheck current manager membership before reading the old receipt.
func (a *Adapter) ManageEnterpriseDepartmentFolder(ctx context.Context, identity EnterpriseDepartmentFolderIdentity, action string, folderID int64, payload map[string]any, check EnterpriseDepartmentManagerCheck) (map[string]any, error) {
	if identity.Tenant == "" || identity.SourceDeployment == "" || identity.TargetDeployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Department == "" || identity.Key == "" || len(identity.Key) > 190 || check == nil {
		return nil, httperror.New(http.StatusForbidden, "department_folder_identity_invalid", "Bound department folder identity required")
	}
	if folderID < 1 {
		return nil, httperror.New(http.StatusBadRequest, "department_folder_id_invalid", "Invalid folder identifier")
	}
	command := map[string]any{"actor": identity.Actor, "department": identity.Department, "folder_id": folderID, "action": action}
	switch action {
	case "update":
		if len(payload) == 0 || len(payload) > 2 {
			return nil, httperror.New(400, "department_folder_input_invalid", "Invalid folder update")
		}
		for key, value := range payload {
			switch key {
			case "name":
				name, ok := value.(string)
				name = strings.TrimSpace(name)
				if !ok || name == "" || len([]rune(name)) > 100 {
					return nil, httperror.New(400, "department_folder_input_invalid", "Invalid folder name")
				}
				command["name"] = name
			case "parent_id":
				if value == nil {
					command["parent_id"] = int64(0)
					break
				}
				n, ok := value.(float64)
				if !ok || n < 1 || n > 9007199254740991 || n != float64(int64(n)) {
					return nil, httperror.New(400, "department_folder_input_invalid", "Invalid folder parent")
				}
				command["parent_id"] = int64(n)
			default:
				return nil, httperror.New(400, "department_folder_input_invalid", "Invalid folder field")
			}
		}
	case "open":
		value, ok := payload["is_open"].(bool)
		if !ok || len(payload) != 1 {
			return nil, httperror.New(400, "department_folder_input_invalid", "Invalid open state")
		}
		command["is_open"] = value
	case "delete":
		if len(payload) != 0 {
			return nil, httperror.New(400, "department_folder_input_invalid", "Delete body must be empty")
		}
	default:
		return nil, httperror.New(404, "department_folder_action_unknown", "Unknown folder action")
	}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	namespace := sha256.Sum256([]byte(strings.Join([]string{"codocs.department-folders." + action + ".v1", identity.Tenant, identity.SourceDeployment, identity.TargetDeployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(namespace[:])
	namespace[6] = (namespace[6] & 0x0f) | 0x40
	namespace[8] = (namespace[8] & 0x3f) | 0x80
	opID := fmt.Sprintf("%x-%x-%x-%x-%x", namespace[:4], namespace[4:6], namespace[6:8], namespace[8:10], namespace[10:16])
	receiptInput := io.ReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.SourceDeployment, SourceApp: "enterprise", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.SourceDeployment, TargetDeploymentCode: identity.TargetDeployment, TargetApp: "codocs", OperationID: opID,
		OperationCode: "codocs.department-folders." + action + ".v1", RequiredCapability: "codocs:enterprise-host:execute", IdempotencyKey: key,
		CommandSchemaVersion: "codocs-dept-folder-" + action + ".v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
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
	row := folderScopeRow{}
	scanErr := tx.QueryRowContext(ctx, "SELECT id,name,folder_type,owner_uid,dept_code,project_code,parent_id FROM folders WHERE id=? FOR UPDATE", folderID).Scan(&row.ID, &row.Name, &row.Kind, &row.Owner, &row.Department, &row.Project, &row.Parent)
	rowPresent := scanErr == nil
	if scanErr != nil && scanErr != sql.ErrNoRows {
		return nil, scanErr
	}
	if !rowPresent && action != "delete" {
		return nil, httperror.New(404, "folder_not_found", "Folder was not found")
	}
	if rowPresent && (row.Kind != "department" || row.Department.String != identity.Department || row.Project.String != "") {
		return nil, httperror.New(403, "department_folder_scope_denied", "Folder is outside department scope")
	}
	parent := row.Parent.Int64
	if value, ok := command["parent_id"]; ok {
		parent = value.(int64)
	}
	if action == "update" && parent != row.Parent.Int64 {
		seen := map[int64]bool{folderID: true}
		for ancestor := parent; ancestor > 0; {
			if seen[ancestor] || len(seen) > 256 {
				return nil, httperror.New(400, "department_folder_cycle", "Folder hierarchy would contain a cycle")
			}
			seen[ancestor] = true
			candidate, readErr := readFolderScope(ctx, tx, ancestor, true)
			if readErr != nil {
				return nil, readErr
			}
			if candidate.Kind != "department" || candidate.Department.String != identity.Department || candidate.Project.String != "" {
				return nil, httperror.New(403, "department_folder_parent_scope_denied", "Parent is outside department scope")
			}
			ancestor = candidate.Parent.Int64
		}
	}
	receipt, err := repo.ExecuteInTransaction(ctx, tx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		switch action {
		case "update":
			name := row.Name
			if value, ok := command["name"]; ok {
				name = value.(string)
			}
			_, err := tx.ExecContext(ctx, "UPDATE folders SET name=?,parent_id=?,updated_at=NOW() WHERE id=? AND folder_type='department' AND dept_code=?", name, nullableInt64(parent), folderID, identity.Department)
			return io.ReceiptBusinessResult{TargetBizType: "folder", TargetBizCode: strconv.FormatInt(folderID, 10), HTTPStatus: 200}, err
		case "open":
			open := 0
			if command["is_open"].(bool) {
				open = 1
			}
			_, err := tx.ExecContext(ctx, "UPDATE folders SET is_open=?,updated_at=NOW() WHERE id=? AND folder_type='department' AND dept_code=?", open, folderID, identity.Department)
			return io.ReceiptBusinessResult{TargetBizType: "folder", TargetBizCode: strconv.FormatInt(folderID, 10), HTTPStatus: 200}, err
		default:
			if !rowPresent {
				return io.ReceiptBusinessResult{}, httperror.New(404, "folder_not_found", "Folder was not found")
			}
			for _, table := range []string{"folders", "documents"} {
				query := "SELECT id FROM " + table + " WHERE "
				if table == "folders" {
					query += "parent_id=?"
				} else {
					query += "folder_id=?"
				}
				query += " LIMIT 1 FOR UPDATE"
				var child int64
				checkErr := tx.QueryRowContext(ctx, query, folderID).Scan(&child)
				if checkErr == nil {
					return io.ReceiptBusinessResult{}, httperror.New(409, "department_folder_not_empty", "Folder contains child folders or documents")
				}
				if checkErr != sql.ErrNoRows {
					return io.ReceiptBusinessResult{}, checkErr
				}
			}
			_, err := tx.ExecContext(ctx, "DELETE FROM folders WHERE id=? AND folder_type='department' AND dept_code=?", folderID, identity.Department)
			return io.ReceiptBusinessResult{TargetBizType: "folder", TargetBizCode: strconv.FormatInt(folderID, 10), HTTPStatus: 200}, err
		}
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "department_folder_key_conflict", "Idempotency key was used for different folder content")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != strconv.FormatInt(folderID, 10) {
		return nil, httperror.New(503, "department_folder_receipt_invalid", "Folder receipt is invalid")
	}
	if action != "delete" {
		current, readErr := readFolderScope(ctx, tx, folderID, true)
		if readErr != nil {
			return nil, readErr
		}
		if current.Kind != "department" || current.Department.String != identity.Department || current.Project.String != "" {
			return nil, httperror.New(403, "department_folder_replay_scope_denied", "Folder receipt is outside department scope")
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": folderID, "updated": action != "delete", "deleted": action == "delete", "replayed": receipt.Existing}, nil
}
