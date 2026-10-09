package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Identity is constructed by the authenticated Host route, not from JSON.
type PersonalFolderCreationIdentity struct {
	Tenant, Deployment, Actor, Client, RequestID, Key string
	// Session is set only for collab.runtime calls bound to a collaboration session.
	Session string
}

func (a *Adapter) CreatePersonalFolder(ctx context.Context, identity PersonalFolderCreationIdentity, payload map[string]any) (map[string]any, error) {
	if identity.Tenant == "" || identity.Deployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Key == "" || len(identity.Key) > 200 {
		return nil, httperror.New(403, "folder_creation_identity_invalid", "Bound folder creation identity required")
	}
	for key := range payload {
		if key != "name" && key != "folder_type" && key != "parent_id" {
			return nil, httperror.New(400, "invalid_folder_field", "Unsupported folder creation field")
		}
	}
	name, nameOK := payload["name"].(string)
	kind, kindOK := payload["folder_type"].(string)
	name = strings.TrimSpace(name)
	if !nameOK || name == "" || len([]rune(name)) > 100 || !kindOK || (kind != "private" && kind != "slide") {
		return nil, httperror.New(400, "invalid_folder_input", "Invalid personal folder input")
	}
	var parent int64
	if value := payload["parent_id"]; value != nil {
		n, ok := value.(float64)
		if !ok || n < 1 || n > 9007199254740991 || n != float64(int64(n)) {
			return nil, httperror.New(400, "invalid_folder_parent", "Invalid folder parent")
		}
		parent = int64(n)
	}
	command := map[string]any{"actor": identity.Actor, "name": name, "folder_type": kind, "parent_id": parent}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	namespace := sha256.Sum256([]byte(strings.Join([]string{identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(namespace[:])
	namespace[6] = (namespace[6] & 0x0f) | 0x40
	namespace[8] = (namespace[8] & 0x3f) | 0x80
	operationID := fmt.Sprintf("%x-%x-%x-%x-%x", namespace[:4], namespace[4:6], namespace[6:8], namespace[8:10], namespace[10:16])
	input := io.OwnedReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: "codocs", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.Deployment, TargetDeploymentCode: identity.Deployment, TargetApp: "codocs", OperationID: operationID,
		OperationCode: "codocs.personal-folders.create.v1", RequiredCapability: "codocs:personal-folders:create", IdempotencyKey: key,
		CommandSchemaVersion: "codocs-personal-folder.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
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
	q := url.Values{"current_user": {identity.Actor}, "hzy_runtime_actor_delegated": {"1"}}
	if parent > 0 {
		row, err := readFolderScope(ctx, tx, parent, true)
		if err != nil {
			return nil, err
		}
		if row.Kind != kind || !folderScopeAllowed(row, identity.Actor, q, true) {
			return nil, httperror.New(403, "folder_parent_scope_mismatch", "Parent is outside the personal folder scope")
		}
	}
	receipt, err := repo.ExecuteOwnedInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		result, err := tx.ExecContext(ctx, "INSERT INTO folders (name, folder_type, owner_uid, dept_code, project_code, parent_id, sort_order) VALUES (?, ?, ?, NULL, NULL, ?, 0)", name, kind, identity.Actor, nullableInt64(parent))
		if err != nil {
			return io.ReceiptBusinessResult{}, err
		}
		id, err := result.LastInsertId()
		return io.ReceiptBusinessResult{TargetBizType: "folder", TargetBizCode: strconv.FormatInt(id, 10), HTTPStatus: 200}, err
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "folder_creation_key_conflict", "Idempotency key was used for different folder content")
	}
	if err != nil {
		return nil, err
	}
	id, err := strconv.ParseInt(receipt.TargetBizCode, 10, 64)
	if err != nil || id < 1 {
		return nil, httperror.New(503, "folder_receipt_invalid", "Folder receipt is invalid")
	}
	row, err := readFolderScope(ctx, tx, id, true)
	if err != nil {
		return nil, err
	}
	if row.Kind != kind || !folderScopeAllowed(row, identity.Actor, q, true) {
		return nil, httperror.New(403, "folder_replay_scope_denied", "Folder receipt does not preserve current authority")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "name": row.Name, "folder_type": row.Kind, "owner_uid": identity.Actor, "parent_id": nullableInt64(row.Parent.Int64)}, nil
}
