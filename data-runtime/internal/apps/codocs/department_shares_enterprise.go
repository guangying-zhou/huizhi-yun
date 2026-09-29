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

type EnterpriseDepartmentShareIdentity struct {
	Tenant, SourceDeployment, TargetDeployment, Actor, Client, RequestID, Key, Department string
}

type EnterpriseDepartmentShareManagerCheck func(context.Context, *sql.Tx, string, string) error

// DepartmentSharesForEnterprise only returns the target department. The
// delegated route has already checked the current Directory R before SQL.
func (a *Adapter) DepartmentSharesForEnterprise(ctx context.Context, department string, page, pageSize int) (map[string]any, error) {
	if !departmentCabinetCode.MatchString(department) || page < 1 || pageSize < 1 || pageSize > 200 {
		return nil, httperror.New(400, "department_share_list_invalid", "Invalid department share list")
	}
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var total int64
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM department_shares WHERE dept_code=? AND status='pending'`, department).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT ds.id,ds.document_id,ds.dept_code,ds.shared_by,ds.status,ds.created_at,
		COALESCE(d.uuid,''),COALESCE(d.title,'') FROM department_shares ds
		LEFT JOIN documents d ON d.id=ds.document_id
		WHERE ds.dept_code=? AND ds.status='pending'
		ORDER BY ds.created_at DESC,ds.id DESC LIMIT ? OFFSET ?`, department, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, documentID int64
		var dept, sender, status, uuid, title string
		var createdAt any
		if err = rows.Scan(&id, &documentID, &dept, &sender, &status, &createdAt, &uuid, &title); err != nil {
			break
		}
		items = append(items, map[string]any{"id": id, "document_id": documentID, "dept_code": dept, "from_uid": sender, "status": status, "mode": "transfer", "created_at": createdAt, "document_uuid": uuid, "document_title": title})
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, nil
}

func departmentShareReceiptInput(identity EnterpriseDepartmentShareIdentity, shareID int64, action string) (io.ReceiptCommandInput, error) {
	if identity.Tenant == "" || identity.SourceDeployment == "" || identity.TargetDeployment == "" || identity.Actor == "" || identity.Client != "enterprise.runtime" || !departmentCabinetCode.MatchString(identity.Department) || identity.Key == "" || len(identity.Key) > 200 || shareID < 1 || (action != "accept" && action != "reject") {
		return io.ReceiptCommandInput{}, httperror.New(403, "department_share_identity_invalid", "Bound department share identity required")
	}
	command := map[string]any{"shareId": shareID, "actor": identity.Actor, "department": identity.Department, "action": action}
	raw, err := json.Marshal(command)
	if err != nil {
		return io.ReceiptCommandInput{}, err
	}
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		return io.ReceiptCommandInput{}, err
	}
	ns := sha256.Sum256([]byte(strings.Join([]string{"codocs.department-shares.decide.v1", identity.Tenant, identity.SourceDeployment, identity.TargetDeployment, identity.Actor, identity.Key}, "\x00")))
	key := hex.EncodeToString(ns[:])
	ns[6] = (ns[6] & 0x0f) | 0x40
	ns[8] = (ns[8] & 0x3f) | 0x80
	return io.ReceiptCommandInput{TrustedContext: io.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.SourceDeployment, SourceApp: "enterprise", ServiceClientID: identity.Client, RequestID: identity.RequestID}, SourceDeploymentCode: identity.SourceDeployment, TargetDeploymentCode: identity.TargetDeployment, TargetApp: "codocs", OperationID: fmt.Sprintf("%x-%x-%x-%x-%x", ns[:4], ns[4:6], ns[6:8], ns[8:10], ns[10:16]), OperationCode: "codocs.department-shares.decide.v1", RequiredCapability: "codocs:enterprise-host:execute", IdempotencyKey: key, CommandSchemaVersion: "codocs-dept-share-decide.v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor}, nil
}

// DecideEnterpriseDepartmentShare checks current manager R in the same
// Serializable transaction before even consulting the old receipt. The share
// row is the sole source of the target department; no body department is used.
func (a *Adapter) DecideEnterpriseDepartmentShare(ctx context.Context, identity EnterpriseDepartmentShareIdentity, shareID int64, action string, check EnterpriseDepartmentShareManagerCheck) (map[string]any, error) {
	if check == nil {
		return nil, httperror.New(503, "department_share_directory_unavailable", "Department relationship unavailable")
	}
	input, err := departmentShareReceiptInput(identity, shareID, action)
	if err != nil {
		return nil, err
	}
	repo, err := io.NewReceiptRepository(a.db)
	if err != nil {
		return nil, err
	}
	// Fetch the document ID without a transaction lock. The transfer creator
	// locks document then share, so the serializable decision follows that same
	// order and verifies every preflight fact again after both rows are locked.
	var documentID int64
	var dept string
	preflightErr := a.db.QueryRowContext(ctx, `SELECT document_id,dept_code FROM department_shares WHERE id=?`, shareID).Scan(&documentID, &dept)
	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err = check(ctx, tx, identity.Actor, identity.Department); err != nil {
		return nil, err
	}
	var status, sender, uuid, owner, kind, title string
	var lockedDocumentID int64
	var documentStatus int
	var deleted sql.NullTime
	var project, currentDept sql.NullString
	if errors.Is(preflightErr, sql.ErrNoRows) {
		return nil, httperror.New(404, "department_share_not_found", "Department share not found")
	}
	if preflightErr != nil {
		return nil, preflightErr
	}
	if dept != identity.Department {
		return nil, httperror.New(403, "department_share_scope_denied", "Share belongs to another department")
	}
	err = tx.QueryRowContext(ctx, `SELECT uuid,owner_uid,doc_type,title,status,deleted_at,project_code,dept_code FROM documents WHERE id=? FOR UPDATE`, documentID).Scan(&uuid, &owner, &kind, &title, &documentStatus, &deleted, &project, &currentDept)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(409, "department_share_source_changed", "Transfer source has changed")
	}
	if err != nil {
		return nil, err
	}
	var lockedDept string
	err = tx.QueryRowContext(ctx, `SELECT document_id,dept_code,status,shared_by FROM department_shares WHERE id=? FOR UPDATE`, shareID).Scan(&lockedDocumentID, &lockedDept, &status, &sender)
	if errors.Is(err, sql.ErrNoRows) || lockedDocumentID != documentID || lockedDept != dept {
		return nil, httperror.New(409, "department_share_source_changed", "Transfer record has changed")
	}
	if err != nil {
		return nil, err
	}
	if uuid == "" || owner == "" || owner != sender || documentStatus == 0 || documentStatus == -1 || deleted.Valid || project.Valid {
		return nil, httperror.New(409, "department_share_source_changed", "Transfer source has changed")
	}
	if status == "pending" && (kind != "private" || currentDept.String != "") || status == "accepted" && (action != "accept" || kind != "department") || status == "rejected" && action != "reject" || status != "pending" && status != "accepted" && status != "rejected" {
		return nil, httperror.New(409, "department_share_source_changed", "Transfer source has changed")
	}
	if status == "accepted" {
		if currentDept.String != dept {
			return nil, httperror.New(409, "department_share_source_changed", "Transferred document has moved")
		}
	}
	receipt, err := repo.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
		if status != "pending" {
			return io.ReceiptBusinessResult{}, httperror.New(409, "department_share_already_handled", "Department share has already been handled")
		}
		if action == "accept" {
			res, e := tx.ExecContext(ctx, `UPDATE documents SET doc_type='department',dept_code=?,project_code=NULL,folder_id=NULL,updated_at=NOW()
				WHERE id=? AND owner_uid=? AND doc_type='private' AND status<>0 AND deleted_at IS NULL AND project_code IS NULL`, dept, documentID, sender)
			if e != nil {
				return io.ReceiptBusinessResult{}, e
			}
			count, e := res.RowsAffected()
			if e != nil {
				return io.ReceiptBusinessResult{}, e
			}
			if count != 1 {
				return io.ReceiptBusinessResult{}, httperror.New(409, "department_share_source_changed", "Transfer source has changed")
			}
			// The document changes authorization policy (private -> department):
			// end any personal collaboration session and advance the epoch. The
			// snapshot head is kept, so a v2 document keeps its authoritative
			// content and needs no second conversion.
			if e = invalidateCollaboration(ctx, tx, uuid); e != nil {
				return io.ReceiptBusinessResult{}, e
			}
			if e = upsertDocumentRelationTx(ctx, tx, documentRelationInput{DocumentID: documentID, DocumentUUID: uuid, RelatedUID: sender, RelationType: "department_transfer", SourceType: "department_share", SourceID: strconv.FormatInt(shareID, 10), CanRead: true, Metadata: map[string]any{"departmentCode": dept}}); e != nil {
				return io.ReceiptBusinessResult{}, e
			}
		}
		res, e := tx.ExecContext(ctx, `UPDATE department_shares SET status=?,handled_by=?,handled_at=NOW() WHERE id=? AND dept_code=? AND status='pending'`, map[bool]string{true: "accepted", false: "rejected"}[action == "accept"], identity.Actor, shareID, dept)
		if e != nil {
			return io.ReceiptBusinessResult{}, e
		}
		count, e := res.RowsAffected()
		if e != nil {
			return io.ReceiptBusinessResult{}, e
		}
		if count != 1 {
			return io.ReceiptBusinessResult{}, httperror.New(409, "department_share_already_handled", "Department share has already been handled")
		}
		detail, _ := json.Marshal(map[string]any{"departmentCode": dept, "documentUuid": uuid, "shareId": shareID, "senderUid": sender})
		if _, e = tx.ExecContext(ctx, `INSERT INTO operation_logs(operator_uid,action,target_type,target_id,target_name,detail) VALUES(?,?,?,?,?,?)`, identity.Actor, "department_share_"+action, "department_share", shareID, title, string(detail)); e != nil {
			return io.ReceiptBusinessResult{}, e
		}
		return io.ReceiptBusinessResult{TargetBizType: "department-share", TargetBizCode: strconv.FormatInt(shareID, 10), HTTPStatus: 200}, nil
	})
	if errors.Is(err, io.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "department_share_key_conflict", "Idempotency key was used for another decision")
	}
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizType != "department-share" || receipt.TargetBizCode != strconv.FormatInt(shareID, 10) {
		return nil, httperror.New(409, "department_share_receipt_conflict", "Decision receipt does not match share")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"shareId": shareID, "documentUuid": uuid, "documentTitle": title, "senderUid": sender, "departmentCode": dept, "status": map[bool]string{true: "accepted", false: "rejected"}[action == "accept"]}, nil
}
