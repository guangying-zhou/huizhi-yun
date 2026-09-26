package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"

	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const EnterpriseWorkItemDeleteCapability = "aims:work-item-delete:execute"
const EnterpriseWorkItemDeleteOperation = "enterprise.aims.work-items.delete.v1"

// Public frozen types are also consumed by the migration validator. Full
// database values are retained; EditSnapshot preserves the original URL ETag.
type WorkItemDeletionSnapshot struct {
	Version      int            `json:"version"`
	Item         map[string]any `json:"item"`
	EditSnapshot map[string]any `json:"editSnapshot"`
}
type WorkItemDeletionChild struct {
	ID       int64                    `json:"id"`
	Version  string                   `json:"version"`
	Snapshot WorkItemDeletionSnapshot `json:"snapshot"`
}
type WorkItemDeletionChildren struct {
	Version  int                     `json:"version"`
	Children []WorkItemDeletionChild `json:"children"`
}

func deletionDigest(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
func deletionSnapshotTx(ctx context.Context, tx *sql.Tx, id string) (WorkItemDeletionSnapshot, string, error) {
	edit, version, err := enterpriseWorkItemSnapshot(ctx, tx, id, true)
	if err != nil {
		return WorkItemDeletionSnapshot{}, "", err
	}
	rows, err := tx.QueryContext(ctx, "SELECT * FROM work_items WHERE id=? FOR UPDATE", id)
	if err != nil {
		return WorkItemDeletionSnapshot{}, "", err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return WorkItemDeletionSnapshot{}, "", err
	}
	values := make([]any, len(columns))
	dest := make([]any, len(columns))
	for i := range values {
		dest[i] = &values[i]
	}
	if !rows.Next() {
		return WorkItemDeletionSnapshot{}, "", httperror.New(404, "work_item_not_found", "Work item not found")
	}
	if err = rows.Scan(dest...); err != nil {
		return WorkItemDeletionSnapshot{}, "", err
	}
	full := map[string]any{}
	for i, column := range columns {
		switch v := values[i].(type) {
		case []byte:
			full[column] = string(v)
		case time.Time:
			full[column] = v.UTC().Format(time.RFC3339Nano)
		default:
			full[column] = v
		}
	}
	return WorkItemDeletionSnapshot{Version: 1, Item: full, EditSnapshot: edit}, version, rows.Err()
}

func (a *Adapter) DeleteEnterpriseWorkItem(ctx context.Context, id EnterpriseProjectUpdateIdentity, projectID, itemID string, input map[string]any) (map[string]any, error) {
	expected, ok := input["expectedVersion"].(string)
	if !ok || len(input) != 1 || len(expected) != 64 || expected != strings.ToLower(expected) || len(id.Personnel) > 0 {
		return nil, httperror.New(400, "work_item_delete_input_invalid", "A content version is required")
	}
	if _, err := hex.DecodeString(expected); err != nil {
		return nil, httperror.New(400, "work_item_delete_input_invalid", "Invalid content version")
	}
	if _, err := parseID(projectID, "project_id"); err != nil {
		return nil, err
	}
	if _, err := parseID(itemID, "work_item_id"); err != nil {
		return nil, err
	}
	if err := a.requireEnterpriseWriter(); err != nil {
		return nil, err
	}
	if err := e.VerifyCompatibilityViews(ctx, a.DB(), a.enterpriseWrites.binding, "aims", []string{"work_item_deletion_evidence", "work_item_completion_requests", "work_items", "project_activity_logs"}); err != nil {
		return nil, err
	}
	base := EnterpriseProjectCreateIdentity{Tenant: id.Tenant, SourceDeployment: id.SourceDeployment, TargetDeployment: id.TargetDeployment, ActorUID: id.ActorUID, ServiceClientID: id.ServiceClientID, RequestID: id.RequestID, IdempotencyKey: id.IdempotencyKey}
	receipt, err := enterpriseProjectCreateReceiptInput(base, map[string]any{"projectId": projectID, "workItemId": itemID, "input": input})
	if err != nil {
		return nil, err
	}
	receipt.OperationCode = EnterpriseWorkItemDeleteOperation
	receipt.RequiredCapability = EnterpriseWorkItemDeleteCapability
	receipt.CommandSchemaVersion = "work-item-delete.v1"
	tx, receipts, err := a.beginEnterpriseWrite(ctx, base)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := receipts.ExecuteInTransaction(ctx, tx, receipt, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (iop.ReceiptBusinessResult, error) {
		var leader string
		if err := tx.QueryRowContext(ctx, "SELECT leader_uid FROM aims_projects WHERE id=? FOR UPDATE", projectID).Scan(&leader); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		var member int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_members WHERE project_id=? AND uid=? AND status='active' FOR UPDATE", projectID, id.ActorUID).Scan(&member); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		scope := url.Values{"current_user": {id.ActorUID}}
		for key, value := range id.ProjectScope {
			if (!strings.HasPrefix(key, "current_user_project_admin_") && key != "current_user_is_project_admin" && key != "current_user_dept_codes" && key != "current_user_management_dept_codes") || len(value) > 2000 || strings.ContainsRune(value, '\x00') {
				return iop.ReceiptBusinessResult{}, httperror.New(400, "work_item_scope_invalid", "Invalid trusted project scope")
			}
			scope.Set(key, value)
		}
		where, args := projectScopedAdminWhere(scope, "p")
		var admin int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_projects p WHERE p.id=? AND ("+where+") FOR UPDATE", append([]any{projectID}, args...)...).Scan(&admin); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if leader != id.ActorUID && member == 0 && admin == 0 {
			return iop.ReceiptBusinessResult{}, httperror.New(403, "project_access_denied", "Project membership or scoped administration is required")
		}
		snapshot, version, err := deletionSnapshotTx(ctx, tx, itemID)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if fmt.Sprint(snapshot.Item["project_id"]) != projectID {
			return iop.ReceiptBusinessResult{}, httperror.New(403, "work_item_project_mismatch", "Work item is outside the authorized project")
		}
		if version != expected {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "work_item_version_conflict", "Work item changed")
		}
		if parent := serviceBodyInt(snapshot.EditSnapshot, "parent_id"); parent > 0 {
			if _, _, err := enterpriseWorkItemSnapshot(ctx, tx, fmt.Sprint(parent), true); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
		}
		rows, err := tx.QueryContext(ctx, "SELECT id FROM work_items WHERE parent_id=? ORDER BY id FOR UPDATE", itemID)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		children := []int64{}
		for rows.Next() {
			var child int64
			if err = rows.Scan(&child); err != nil {
				rows.Close()
				return iop.ReceiptBusinessResult{}, err
			}
			children = append(children, child)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		affected := WorkItemDeletionChildren{Version: 1, Children: []WorkItemDeletionChild{}}
		guards := []map[string]any{snapshot.EditSnapshot}
		for _, child := range children {
			frozen, v, err := deletionSnapshotTx(ctx, tx, fmt.Sprint(child))
			if err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			if fmt.Sprint(frozen.Item["project_id"]) != projectID {
				return iop.ReceiptBusinessResult{}, httperror.New(409, "work_item_child_project_mismatch", "Child belongs to another project")
			}
			affected.Children = append(affected.Children, WorkItemDeletionChild{ID: child, Version: v, Snapshot: frozen})
			guards = append(guards, frozen.EditSnapshot)
		}
		for _, guard := range guards {
			if err := a.requireEnterpriseWorkItemReviewUnlockedTx(ctx, tx, guard); err != nil {
				return iop.ReceiptBusinessResult{}, err
			}
			if milestone := serviceBodyInt(guard, "milestone_id"); milestone > 0 {
				if err := requireMilestoneCompletionUnlockedTx(ctx, tx, int64(milestone)); err != nil {
					return iop.ReceiptBusinessResult{}, err
				}
			}
		}
		var references int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM work_item_completion_requests WHERE work_item_id=? FOR UPDATE", itemID).Scan(&references); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if references > 0 {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "work_item_completion_reference_restrict", "Retained completion requests prevent deleting this target")
		}
		raw, err := json.Marshal(snapshot)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		hash, err := deletionDigest(snapshot)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		childRaw, err := json.Marshal(affected)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		inserted, err := tx.ExecContext(ctx, "INSERT INTO work_item_deletion_evidence(project_id,work_item_id,parent_id,expected_version,snapshot_json,snapshot_sha256,detached_children_json,actor_uid,idempotency_key,operation_id,command_sha256,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6))", projectID, itemID, snapshot.Item["parent_id"], expected, raw, hash, childRaw, id.ActorUID, id.IdempotencyKey, receipt.OperationID, receipt.CommandSHA256)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		evidenceID, err := inserted.LastInsertId()
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		deleted, err := tx.ExecContext(ctx, "DELETE FROM work_items WHERE id=? AND project_id=?", itemID, projectID)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		count, err := deleted.RowsAffected()
		if err != nil || count != 1 {
			return iop.ReceiptBusinessResult{}, httperror.New(409, "work_item_delete_conflict", "Work item changed")
		}
		change := map[string]any{"evidenceId": evidenceID, "workItemId": snapshot.EditSnapshot["id"], "projectId": snapshot.EditSnapshot["project_id"], "expectedVersion": expected, "snapshotSha256": hash, "deletionMode": "single", "detachedChildIds": children}
		audit, err := json.Marshal(change)
		if err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO project_activity_logs(project_id,object_type,object_code,action,actor_uid,changes,request_id) VALUES(?,'work_item',?,'delete',?,?,?)", projectID, itemID, id.ActorUID, audit, id.IdempotencyKey); err != nil {
			return iop.ReceiptBusinessResult{}, err
		}
		return iop.ReceiptBusinessResult{TargetBizType: "work_item_deleted", TargetBizCode: fmt.Sprint(evidenceID), HTTPStatus: 200, Value: change}, nil
	})
	if err != nil {
		return nil, aimsContractActivationReceiptError(err)
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"receiptId": result.ReceiptID, "idempotent": result.Existing, "result": result.Value}, nil
}
