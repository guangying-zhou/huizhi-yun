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
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const personalDocumentDepartmentTransferOperation = "codocs.personal-documents.department-transfer.v1"

// CreatePersonalDocumentDepartmentTransfer creates the pending hand-off from a
// user's private document to a department. The Host supplies a
// PersonalFolderCreationIdentity, so the actor and idempotency namespace cannot
// be selected by the request body. The document lock, pending check, share row,
// and owning-domain receipt all live in one transaction.
func (a *Adapter) CreatePersonalDocumentDepartmentTransfer(ctx context.Context, identity PersonalFolderCreationIdentity, uuid, deptCode, message string) (map[string]any, error) {
	if identity.Tenant == "" || identity.Deployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || identity.Key == "" || len(identity.Key) > 200 {
		return nil, httperror.New(403, "department_transfer_identity_invalid", "Bound department transfer identity required")
	}
	uuid = strings.TrimSpace(uuid)
	deptCode = strings.TrimSpace(deptCode)
	message = strings.TrimSpace(message)
	if uuid == "" || len(uuid) > 100 || strings.ContainsAny(uuid, "\x00\r\n") || deptCode == "" || len(deptCode) > 50 || strings.ContainsAny(deptCode, "\x00\r\n") {
		return nil, httperror.New(400, "invalid_department_transfer", "Document uuid and target department are required")
	}
	if len([]rune(message)) > 2000 || strings.ContainsAny(message, "\x00") {
		return nil, httperror.New(400, "invalid_department_transfer_message", "Transfer message is too long or invalid")
	}

	command := map[string]any{"uuid": uuid, "actor": identity.Actor, "dept_code": deptCode, "message": message}
	raw, err := json.Marshal(command)
	if err != nil {
		return nil, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	ns := sha256.Sum256([]byte(strings.Join([]string{personalDocumentDepartmentTransferOperation, identity.Tenant, identity.Deployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	operationID := fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16])
	input := io.OwnedReceiptCommandInput{
		TrustedContext:       io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: "codocs", ServiceClientID: identity.Client, RequestID: identity.RequestID},
		SourceDeploymentCode: identity.Deployment, TargetDeploymentCode: identity.Deployment, TargetApp: "codocs", OperationID: operationID,
		OperationCode: personalDocumentDepartmentTransferOperation, RequiredCapability: "codocs:document-transfer:department", IdempotencyKey: key,
		CommandSchemaVersion: "codocs-dept-transfer.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor,
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

	var documentID int64
	var ownerUID, docType string
	var readonlyFlag int
	var fromDeptCode sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT id, owner_uid, doc_type, readonly_flag, dept_code
		FROM documents
		WHERE uuid = ? AND status <> 0
		LIMIT 1 FOR UPDATE`, uuid).Scan(&documentID, &ownerUID, &docType, &readonlyFlag, &fromDeptCode)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(404, "document_not_found", "Document not found")
	}
	if err != nil {
		return nil, err
	}
	if ownerUID != identity.Actor {
		return nil, httperror.New(403, "department_transfer_owner_required", "Only document owner can transfer")
	}
	if docType != "private" {
		return nil, httperror.New(400, "department_transfer_scope_denied", "Only private documents can be transferred")
	}
	if readonlyFlag != 0 {
		return nil, httperror.New(403, "department_transfer_document_readonly", "Readonly documents cannot be transferred")
	}

	receipt, err := repo.ExecuteOwnedInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		var pendingID int64
		pendingErr := tx.QueryRowContext(ctx, `
			SELECT id
			FROM department_shares
			WHERE document_id = ? AND dept_code = ? AND status = 'pending'
			LIMIT 1 FOR UPDATE`, documentID, deptCode).Scan(&pendingID)
		if pendingErr == nil {
			return io.ReceiptBusinessResult{}, httperror.New(409, "department_transfer_pending", "A pending transfer already exists")
		}
		if !errors.Is(pendingErr, sql.ErrNoRows) {
			return io.ReceiptBusinessResult{}, pendingErr
		}

		result, insertErr := tx.ExecContext(ctx, `
			INSERT INTO department_shares
				(document_id, from_dept_code, dept_code, shared_by, status, message)
			VALUES (?, ?, ?, ?, 'pending', ?)`,
			// department_shares.from_dept_code is NOT NULL. A private document
			// has no source department; the legacy Codocs route records "".
			documentID, fromDeptCode.String, deptCode, identity.Actor, nullableString(message))
		if insertErr != nil {
			return io.ReceiptBusinessResult{}, insertErr
		}
		shareID, insertErr := result.LastInsertId()
		if insertErr != nil || shareID < 1 {
			if insertErr == nil {
				insertErr = errors.New("department share insert did not return an id")
			}
			return io.ReceiptBusinessResult{}, insertErr
		}
		return io.ReceiptBusinessResult{TargetBizType: "department-share", TargetBizCode: fmt.Sprintf("%d", shareID), HTTPStatus: 200}, nil
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "department_transfer_key_conflict", "Idempotency key was used for another transfer")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizType != "department-share" || receipt.TargetBizCode == "" {
		return nil, httperror.New(503, "department_transfer_receipt_invalid", "Invalid department transfer receipt")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"shareId": receipt.TargetBizCode, "documentUuid": uuid, "deptCode": deptCode, "status": "pending"}, nil
}
