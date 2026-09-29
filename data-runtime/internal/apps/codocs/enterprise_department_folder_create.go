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

type EnterpriseDepartmentFolderIdentity struct {
	Tenant, SourceDeployment, TargetDeployment, Actor, Client, RequestID, Key, Department string
}

// The callback verifies the server-held Directory lease before receipt access.
// Directory locks are held on its own schema until this Codocs transaction ends.
type EnterpriseDepartmentManagerCheck func(context.Context, *sql.Tx, string, string) error

func (a *Adapter) CreateEnterpriseDepartmentFolder(ctx context.Context, identity EnterpriseDepartmentFolderIdentity, payload map[string]any, check EnterpriseDepartmentManagerCheck) (map[string]any, error) {
	if identity.Tenant == "" || identity.SourceDeployment == "" || identity.TargetDeployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Department == "" || identity.Key == "" || len(identity.Key) > 200 || check == nil {
		return nil, httperror.New(403, "department_folder_identity_invalid", "Bound department folder identity required")
	}
	for key := range payload {
		if key != "name" && key != "parent_id" && key != "folder_type" && key != "dept_code" {
			return nil, httperror.New(400, "department_folder_input_invalid", "Invalid department folder input")
		}
	}
	name, ok := payload["name"].(string)
	name = strings.TrimSpace(name)
	if !ok || name == "" || len([]rune(name)) > 100 || payload["folder_type"] != "department" || payload["dept_code"] != identity.Department {
		return nil, httperror.New(400, "department_folder_input_invalid", "Invalid department folder input")
	}
	var parent int64
	if value := payload["parent_id"]; value != nil {
		n, valid := value.(float64)
		if !valid || n < 1 || n > 9007199254740991 || n != float64(int64(n)) {
			return nil, httperror.New(400, "department_folder_parent_invalid", "Invalid parent folder")
		}
		parent = int64(n)
	}
	command := map[string]any{"actor": identity.Actor, "department": identity.Department, "name": name, "parent_id": parent}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	namespace := sha256.Sum256([]byte(strings.Join([]string{"codocs.department-folders.create.v1", identity.Tenant, identity.SourceDeployment, identity.TargetDeployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(namespace[:])
	namespace[6] = (namespace[6] & 0x0f) | 0x40
	namespace[8] = (namespace[8] & 0x3f) | 0x80
	operationID := fmt.Sprintf("%x-%x-%x-%x-%x", namespace[:4], namespace[4:6], namespace[6:8], namespace[8:10], namespace[10:16])
	input := io.ReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.SourceDeployment, SourceApp: "enterprise", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.SourceDeployment, TargetDeploymentCode: identity.TargetDeployment, TargetApp: "codocs", OperationID: operationID,
		OperationCode: "codocs.department-folders.create.v1", RequiredCapability: "codocs:enterprise-host:execute", IdempotencyKey: key,
		CommandSchemaVersion: "codocs-dept-folder.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
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
	if parent > 0 {
		row, err := readFolderScope(ctx, tx, parent, true)
		if err != nil {
			return nil, err
		}
		if row.Kind != "department" || row.Department.String != identity.Department || row.Project.String != "" {
			return nil, httperror.New(403, "department_folder_parent_scope_denied", "Parent is outside the department")
		}
	}
	receipt, err := repo.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		result, err := tx.ExecContext(ctx, `INSERT INTO folders
			(name,folder_type,owner_uid,dept_code,project_code,parent_id,sort_order)
			VALUES (?,'department',?, ?,NULL,?,0)`, name, identity.Actor, identity.Department, nullableInt64(parent))
		if err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		id, err := result.LastInsertId()
		return io.ReceiptBusinessResult{TargetBizType: "folder", TargetBizCode: strconv.FormatInt(id, 10), HTTPStatus: 200}, err
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "department_folder_key_conflict", "Idempotency key was used for different folder content")
	}
	if err != nil {
		return nil, err
	}
	id, err := strconv.ParseInt(receipt.TargetBizCode, 10, 64)
	if err != nil || id < 1 {
		return nil, httperror.New(503, "department_folder_receipt_invalid", "Folder receipt is invalid")
	}
	row, err := readFolderScope(ctx, tx, id, true)
	if err != nil {
		return nil, err
	}
	if row.Kind != "department" || row.Department.String != identity.Department || row.Project.String != "" {
		return nil, httperror.New(403, "department_folder_replay_scope_denied", "Folder receipt does not preserve department scope")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "name": row.Name, "folder_type": row.Kind, "dept_code": identity.Department, "parent_id": nullableInt64(row.Parent.Int64)}, nil
}
