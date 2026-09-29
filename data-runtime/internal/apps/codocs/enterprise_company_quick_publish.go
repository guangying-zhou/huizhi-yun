package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func (a *Adapter) PrepareEnterpriseCompanyQuickPublish(ctx context.Context, identity EnterpriseCompanyCommandIdentity, body map[string]any) (map[string]any, error) {
	id, prefix, ids, err := quickPublishCommand(body)
	if err != nil {
		return nil, err
	}
	command := map[string]any{"operationId": id, "targetPrefix": prefix, "documentUuids": ids}
	payload, _ := json.Marshal([]any{identity.Actor, prefix, ids})
	hash := sha256.Sum256(payload)
	commandHash := hex.EncodeToString(hash[:])
	bodyRefs := a.prefetchBodyRefs(ctx, ids)
	receipt, err := a.enterpriseCompanyReceipt(ctx, identity, "enterprise.codocs.quick-publish.prepare.v1", "quick-publish-prepare.v1", command,
		func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
			empty, _ := json.Marshal(quickPublishPlan{OperationID: id, Items: []quickPublishItem{}})
			res, err := tx.ExecContext(ctx, `INSERT IGNORE INTO company_asset_quick_publish_operations (operation_id,actor_uid,command_sha256,plan_json) VALUES (?,?,?,?)`, id, identity.Actor, commandHash, string(empty))
			if err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			inserted, err := res.RowsAffected()
			if err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			var owner, storedHash, storedPlan string
			if err := tx.QueryRowContext(ctx, `SELECT actor_uid,command_sha256,plan_json FROM company_asset_quick_publish_operations WHERE operation_id=? FOR UPDATE`, id).Scan(&owner, &storedHash, &storedPlan); err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			if owner != identity.Actor || storedHash != commandHash {
				return io.ReceiptBusinessResult{}, httperror.New(409, "quick_publish_operation_conflict", "Operation already belongs to another publication")
			}
			if inserted > 0 {
				plan := quickPublishPlan{OperationID: id, Items: []quickPublishItem{}}
				for _, uuid := range ids {
					var title, source, dept string
					err := tx.QueryRowContext(ctx, `SELECT title,oss_path,dept_code FROM documents WHERE uuid=? AND doc_type='department' AND status=1 AND dept_code IS NOT NULL FOR UPDATE`, uuid).Scan(&title, &source, &dept)
					if errors.Is(err, sql.ErrNoRows) {
						return io.ReceiptBusinessResult{}, httperror.New(400, "quick_publish_source_invalid", "Only active department documents can be published")
					}
					if err != nil {
						return io.ReceiptBusinessResult{}, err
					}
					if dept == "" || source == "" || !strings.HasPrefix(source, "codocs/") || strings.Contains(source, "/../") {
						return io.ReceiptBusinessResult{}, httperror.New(400, "quick_publish_source_invalid", "Department document has no valid stored content")
					}
					ref, err := verifyPlannedBodyRef(ctx, tx, uuid, bodyRefs[uuid])
					if err != nil {
						return io.ReceiptBusinessResult{}, err
					}
					newUUID, err := randomUUID()
					if err != nil {
						return io.ReceiptBusinessResult{}, err
					}
					name := strings.NewReplacer("/", "-", "\\", "-", "\r", "", "\n", "", "\x00", "").Replace(title)
					name = strings.TrimSuffix(name, ".md")
					if name == "" {
						name = "document"
					}
					if len([]rune(name)) > 80 {
						name = string([]rune(name)[:80])
					}
					item := quickPublishItem{SourceUUID: uuid, SourcePath: source, Title: title, NewUUID: newUUID, OSSPath: prefix + name + "-" + newUUID + ".md"}
					if ref != nil {
						// Exact published version; the mirror path is withheld.
						item.SourcePath, item.BodyRef = "", ref.Map()
					}
					plan.Items = append(plan.Items, item)
				}
				data, _ := json.Marshal(plan)
				if _, err := tx.ExecContext(ctx, `UPDATE company_asset_quick_publish_operations SET plan_json=? WHERE operation_id=?`, string(data), id); err != nil {
					return io.ReceiptBusinessResult{}, err
				}
			}
			return io.ReceiptBusinessResult{TargetBizType: "company_publish_operation", TargetBizCode: id, HTTPStatus: http.StatusOK}, nil
		})
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != id {
		return nil, httperror.New(409, "quick_publish_receipt_conflict", "Publication receipt conflicts with request")
	}
	return a.enterpriseQuickPublishPlan(ctx, identity.Actor, id, commandHash)
}

func (a *Adapter) enterpriseQuickPublishPlan(ctx context.Context, actor, id, commandHash string) (map[string]any, error) {
	var owner, hash, rawPlan string
	var completed sql.NullString
	if err := a.db.QueryRowContext(ctx, `SELECT actor_uid,command_sha256,plan_json,result_json FROM company_asset_quick_publish_operations WHERE operation_id=?`, id).Scan(&owner, &hash, &rawPlan, &completed); err != nil {
		return nil, err
	}
	if owner != actor || hash != commandHash {
		return nil, httperror.New(409, "quick_publish_operation_conflict", "Publication operation changed")
	}
	var plan quickPublishPlan
	if err := json.Unmarshal([]byte(rawPlan), &plan); err != nil {
		return nil, err
	}
	response := map[string]any{"plan": plan, "completed": completed.Valid}
	if completed.Valid {
		var result map[string]any
		if err := json.Unmarshal([]byte(completed.String), &result); err != nil {
			return nil, err
		}
		response["result"] = result
	}
	return response, nil
}

func (a *Adapter) CompleteEnterpriseCompanyQuickPublish(ctx context.Context, identity EnterpriseCompanyCommandIdentity, body map[string]any) (map[string]any, error) {
	id := stringValue(body["operationId"])
	if id == "" {
		return nil, httperror.New(400, "operation_required", "Publication operation is required")
	}
	// Copy evidence is the result of the Host's conditional OSS writes. The
	// stable receipt key binds the exact evidence; changed evidence is a 409.
	receipt, err := a.enterpriseCompanyReceipt(ctx, identity, "enterprise.codocs.quick-publish.complete.v1", "quick-publish-complete.v1", body,
		func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (io.ReceiptBusinessResult, error) {
			var owner, rawPlan string
			var previous sql.NullString
			err := tx.QueryRowContext(ctx, `SELECT actor_uid,plan_json,result_json FROM company_asset_quick_publish_operations WHERE operation_id=? FOR UPDATE`, id).Scan(&owner, &rawPlan, &previous)
			if errors.Is(err, sql.ErrNoRows) {
				return io.ReceiptBusinessResult{}, httperror.New(404, "operation_not_found", "Publication operation not found")
			}
			if err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			if owner != identity.Actor {
				return io.ReceiptBusinessResult{}, httperror.New(403, "operation_actor_mismatch", "Publication operation belongs to another actor")
			}
			if previous.Valid {
				return io.ReceiptBusinessResult{TargetBizType: "company_publish_operation", TargetBizCode: id, HTTPStatus: http.StatusOK}, nil
			}
			var plan quickPublishPlan
			if err := json.Unmarshal([]byte(rawPlan), &plan); err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			copies, ok := body["copies"].([]any)
			if !ok || len(copies) != len(plan.Items) {
				return io.ReceiptBusinessResult{}, httperror.New(400, "copy_evidence_required", "All copied objects are required")
			}
			imported := []map[string]any{}
			for i, item := range plan.Items {
				evidence, ok := copies[i].(map[string]any)
				if !ok || stringValue(evidence["newUuid"]) != item.NewUUID || stringValue(evidence["ossPath"]) != item.OSSPath || stringValue(evidence["etag"]) == "" {
					return io.ReceiptBusinessResult{}, httperror.New(400, "copy_evidence_invalid", "Copied object binding is invalid")
				}
				size := int64Value(evidence["size"])
				if size < 0 {
					return io.ReceiptBusinessResult{}, httperror.New(400, "copy_evidence_invalid", "Copied object size is invalid")
				}
				if _, err := tx.ExecContext(ctx, `INSERT INTO documents (uuid,title,doc_type,oss_path,owner_uid,readonly_flag,status,content_size,last_editor_uid,publish_info,created_at,updated_at) VALUES (?,?,'company',?,?,1,2,?,?,?,NOW(),NOW())`, item.NewUUID, item.Title, item.OSSPath, identity.Actor, size, identity.Actor, "管理员直接发布（无审批、无通知）"); err != nil {
					return io.ReceiptBusinessResult{}, err
				}
				imported = append(imported, map[string]any{"sourceUuid": item.SourceUUID, "title": item.Title, "newUuid": item.NewUUID, "ossPath": item.OSSPath})
			}
			result := map[string]any{"operationId": id, "imported": imported, "skipped": []any{}}
			raw, _ := json.Marshal(result)
			if _, err := tx.ExecContext(ctx, `UPDATE company_asset_quick_publish_operations SET result_json=?,completed_at=NOW() WHERE operation_id=?`, string(raw), id); err != nil {
				return io.ReceiptBusinessResult{}, err
			}
			return io.ReceiptBusinessResult{TargetBizType: "company_publish_operation", TargetBizCode: id, HTTPStatus: http.StatusOK}, nil
		})
	if err != nil {
		return nil, err
	}
	if receipt.TargetBizCode != id {
		return nil, httperror.New(409, "quick_publish_receipt_conflict", "Publication receipt conflicts with request")
	}
	var owner, raw string
	if err := a.db.QueryRowContext(ctx, `SELECT actor_uid,result_json FROM company_asset_quick_publish_operations WHERE operation_id=?`, id).Scan(&owner, &raw); err != nil {
		return nil, err
	}
	if owner != identity.Actor {
		return nil, httperror.New(403, "operation_actor_mismatch", "Publication operation belongs to another actor")
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return nil, err
	}
	return result, nil
}

// Keep source ordering deterministic across retries and snapshots.
func sortedPublishIDs(ids []string) []string {
	values := append([]string(nil), ids...)
	sort.Strings(values)
	return values
}
