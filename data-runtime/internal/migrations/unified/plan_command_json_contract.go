package unified

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
)

type planningReceipt struct {
	id                                        int64
	product, action, actor, key, hash, status string
	result                                    map[string]any
}
type planningAudit struct {
	id, revision                              int64
	product, action, actor, key, kind, object string
	changes                                   map[string]any
}

func loadPlanningEvidence(ctx context.Context, q querier, schema string) ([]planningReceipt, []planningAudit, error) {
	actions := "'product_versions:plan-edit','product_versions:plan-item-create','product_versions:plan-item-edit','product_versions:plan-item-delete','product_versions:plan-confirm'"
	rows, e := q.QueryContext(ctx, "SELECT id,product_code,action,actor_uid,idempotency_key,request_hash,status,result_json FROM "+qualified(schema, "product_command_receipts")+" WHERE action IN ("+actions+") ORDER BY id")
	if e != nil {
		return nil, nil, e
	}
	receipts := []planningReceipt{}
	for rows.Next() {
		var r planningReceipt
		var raw []byte
		if e = rows.Scan(&r.id, &r.product, &r.action, &r.actor, &r.key, &r.hash, &r.status, &raw); e != nil {
			rows.Close()
			return nil, nil, e
		}
		r.result, _ = contractObject(raw)
		receipts = append(receipts, r)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, nil, e
	}
	rows, e = q.QueryContext(ctx, "SELECT id,product_code,action,actor_uid,request_id,object_type,object_id,revision,changes FROM "+qualified(schema, "product_activity_logs")+" WHERE action IN ('plan-edit','plan-item-create','plan-item-edit','plan-item-delete','plan-confirm') ORDER BY id")
	if e != nil {
		return nil, nil, e
	}
	audits := []planningAudit{}
	for rows.Next() {
		var a planningAudit
		var raw []byte
		if e = rows.Scan(&a.id, &a.product, &a.action, &a.actor, &a.key, &a.kind, &a.object, &a.revision, &raw); e != nil {
			rows.Close()
			return nil, nil, e
		}
		a.changes, _ = contractObject(raw)
		audits = append(audits, a)
	}
	e = rows.Err()
	rows.Close()
	return receipts, audits, e
}

func matchingPlanAudit(r planningReceipt, a planningAudit) bool {
	return a.kind == "version" && a.product == r.product && a.action == strings.TrimPrefix(r.action, "product_versions:") && a.actor == r.actor && a.key == r.key && a.revision == contractInt(r.result["version_revision"]) && contractJSONEqual(a.changes["result"], r.result)
}

// A deletion is evidence only when its frozen identities and succeeded receipt
// agree. A bare missing row or a similarly named event never proves history.
func validatedPlanDelete(r planningReceipt, a planningAudit) bool {
	d, ok := a.changes["deleted"].(map[string]any)
	valid := r.action == "product_versions:plan-item-delete" && r.status == "succeeded" && len(r.hash) == 64 && hexOnlySnapshot(r.hash) && matchingPlanAudit(r, a) && contractKeys(r.result, "id deleted workspace_revision version_revision plan_revision scope_revision") && r.result["deleted"] == true && contractInt(r.result["id"]) > 0 && contractInt(r.result["version_revision"]) > 1 && contractInt(r.result["scope_revision"]) > 1 && contractInt(r.result["plan_revision"]) > 0 && contractInt(r.result["workspace_revision"]) > 1 && contractKeys(a.changes, "deleted reason result") && contractText(a.changes["reason"]) && ok && contractKeys(d, "scope_id planning_item_biz_id request_biz_id scope_summary estimate_person_days acceptance_criteria") && contractInt(d["scope_id"]) == contractInt(r.result["id"]) && contractText(d["planning_item_biz_id"]) && contractText(d["request_biz_id"]) && contractString(d["scope_summary"], 10000) && contractText(a.object)
	version, e := strconv.ParseInt(a.object, 10, 64)
	reason, _ := a.changes["reason"].(string)
	input := productcenter.LightweightVersionPlanItemDelete{VersionID: version, ScopeID: contractInt(r.result["id"]), ExpectedRevision: uint64(contractInt(r.result["workspace_revision"]) - 1), ExpectedVersionRevision: uint64(contractInt(r.result["version_revision"]) - 1), ExpectedPlanRevision: uint64(contractInt(r.result["plan_revision"])), ExpectedScopeRevision: uint64(contractInt(r.result["scope_revision"]) - 1), Reason: reason}
	return valid && e == nil && version > 0 && typedPayloadValid(input, &productcenter.LightweightVersionPlanItemDelete{}, r.hash)
}

func planDeletedScopeProof(ctx context.Context, q querier, schema, product string, version, scope, frozenRevision, frozenScope int64, item, request any) (bool, error) {
	receipts, audits, e := loadPlanningEvidence(ctx, q, schema)
	if e != nil {
		return false, e
	}
	for _, r := range receipts {
		for _, a := range audits {
			if r.product != product || a.object != stringID(version) || contractInt(r.result["id"]) != scope || contractInt(r.result["version_revision"]) <= frozenRevision || contractInt(r.result["scope_revision"]) <= frozenScope || !validatedPlanDelete(r, a) {
				continue
			}
			d := a.changes["deleted"].(map[string]any)
			if item != nil && !contractJSONEqual(item, d["planning_item_biz_id"]) {
				continue
			}
			if request != nil && !contractJSONEqual(request, d["request_biz_id"]) {
				continue
			}
			ref, err := contractReference(ctx, q, schema, "product_versions", "id=? AND BINARY product_code=BINARY ? AND revision>=? AND scope_revision>=?", version, product, r.result["version_revision"], r.result["scope_revision"])
			if err != nil {
				return false, err
			}
			if !ref {
				continue
			}
			ref, err = contractReference(ctx, q, schema, "product_workspaces", "BINARY product_code=BINARY ? AND revision>=?", product, r.result["workspace_revision"])
			if err != nil {
				return false, err
			}
			if !ref {
				continue
			}
			return true, nil
		}
	}
	return false, nil
}

func inspectPlanCommandJSON(ctx context.Context, q querier, schema string) ([]MigrationConflict, error) {
	receipts, audits, e := loadPlanningEvidence(ctx, q, schema)
	if e != nil {
		return nil, e
	}
	issues := []MigrationConflict{}
	used := map[int64]bool{}
	for _, r := range receipts {
		valid := r.status == "succeeded" && len(r.hash) == 64 && hexOnlySnapshot(r.hash) && contractText(r.product) && contractText(r.actor) && contractText(r.key) && r.result != nil
		var paired *planningAudit
		for i := range audits {
			if matchingPlanAudit(r, audits[i]) {
				if paired != nil {
					valid = false
				}
				paired = &audits[i]
			}
		}
		valid = valid && paired != nil
		if paired == nil {
			issues = append(issues, MigrationConflict{Kind: "plan_command_receipt_contract_invalid", Source: "aims.product_command_receipts", KeySHA256: redactedBusinessKey("plan-receipt", stringID(r.id)), RowCount: 1})
			continue
		}
		a := *paired
		version, parseErr := contractObject([]byte(`{"id":` + a.object + `}`))
		versionID := contractInt(version["id"])
		valid = valid && parseErr == nil && versionID > 0
		rev, plan, scope, workspace := contractInt(r.result["version_revision"]), contractInt(r.result["plan_revision"]), contractInt(r.result["scope_revision"]), contractInt(r.result["workspace_revision"])
		ref, err := contractReference(ctx, q, schema, "product_versions", "id=? AND BINARY product_code=BINARY ? AND revision>=? AND scope_revision>=?", versionID, r.product, rev, scope)
		if err != nil {
			return nil, err
		}
		valid = valid && ref && rev > 0 && plan > 0 && scope > 0 && workspace > 0
		if r.action != "product_versions:plan-confirm" {
			valid = valid && rev > 1 && workspace > 1
		}
		ref, err = contractReference(ctx, q, schema, "product_workspaces", "BINARY product_code=BINARY ? AND revision>=?", r.product, workspace)
		if err != nil {
			return nil, err
		}
		valid = valid && ref
		ref, err = contractReference(ctx, q, schema, "product_version_plans", "version_id=? AND revision>=? AND scope_revision>=?", versionID, plan, scope)
		if err != nil {
			return nil, err
		}
		valid = valid && ref
		input, _ := a.changes["input"].(map[string]any)
		keys := "version_id expected_revision expected_version_revision expected_plan_revision"
		resultKeys := "version_id workspace_revision version_revision plan_revision scope_revision"
		auditKeys := "input result"
		switch r.action {
		case "product_versions:plan-edit":
			keys += " goal starts_on planned_release_date available_person_days reserve_person_days reason"
			valid = valid && contractInt(r.result["version_id"]) == versionID && contractInt(input["expected_plan_revision"])+1 == plan
		case "product_versions:plan-item-create":
			keys += " expected_request_revision request_biz_id scope_summary estimate_person_days acceptance_criteria sort_order adopt_request reason"
			resultKeys = "id planning_item_biz_id request_biz_id workspace_revision version_revision plan_revision scope_revision"
			valid = valid && contractInt(input["expected_request_revision"]) > 0 && contractText(input["request_biz_id"]) && input["request_biz_id"] == r.result["request_biz_id"] && contractString(input["scope_summary"], 10000) && contractSortOrder(input["sort_order"])
			ref, err = contractReference(ctx, q, schema, "product_requests", "BINARY biz_id=BINARY ? AND BINARY product_code=BINARY ? AND revision>=?", r.result["request_biz_id"], r.product, contractInt(input["expected_request_revision"]))
			if err != nil {
				return nil, err
			}
			valid = valid && ref
		case "product_versions:plan-item-edit":
			keys += " scope_id expected_scope_revision scope_summary estimate_person_days acceptance_criteria sort_order reason"
			resultKeys = "id workspace_revision version_revision plan_revision scope_revision scope_item_revision"
			auditKeys = "before input result"
			before, ok := a.changes["before"].(map[string]any)
			valid = valid && ok && contractKeys(before, "scope_summary estimate_person_days acceptance_criteria sort_order scope_revision") && contractInt(before["scope_revision"])+1 == contractInt(r.result["scope_item_revision"]) && contractInt(r.result["scope_item_revision"]) > 1 && contractInt(input["scope_id"]) == contractInt(r.result["id"]) && contractInt(input["expected_scope_revision"])+1 == scope && contractSortOrder(input["sort_order"])
		case "product_versions:plan-item-delete":
			valid = valid && validatedPlanDelete(r, a)
			resultKeys = "id deleted workspace_revision version_revision plan_revision scope_revision"
			auditKeys = "deleted reason result"
		case "product_versions:plan-confirm":
			keys += " expected_scope_revision"
			resultKeys = "confirmation_id version_id plan_status plan_revision scope_revision version_revision workspace_revision"
			auditKeys = "input snapshot result"
			valid = valid && r.result["plan_status"] == "confirmed" && contractInt(r.result["version_id"]) == versionID && contractInt(input["expected_scope_revision"]) == scope
			ref, err = contractReference(ctx, q, schema, "product_version_plan_confirmations", "id=? AND version_id=? AND plan_revision=? AND scope_revision=? AND BINARY confirmed_by=BINARY ? AND snapshot=CAST(? AS JSON)", r.result["confirmation_id"], versionID, plan, scope, r.actor, mustContractJSON(a.changes["snapshot"]))
			if err != nil {
				return nil, err
			}
			valid = valid && ref
		}
		if r.action == "product_versions:plan-item-create" {
			owned, err := contractReference(ctx, q, schema, "product_planning_items", "BINARY biz_id=BINARY ? AND BINARY product_code=BINARY ?", r.result["planning_item_biz_id"], r.product)
			if err != nil {
				return nil, err
			}
			if !owned {
				live, err := contractReference(ctx, q, schema, "product_planning_items", "BINARY biz_id=BINARY ?", r.result["planning_item_biz_id"])
				if err != nil {
					return nil, err
				}
				if !live {
					owned, err = planDeletedScopeProof(ctx, q, schema, r.product, versionID, contractInt(r.result["id"]), rev, scope, r.result["planning_item_biz_id"], r.result["request_biz_id"])
					if err != nil {
						return nil, err
					}
				}
			}
			valid = valid && owned
		}
		valid = valid && contractKeys(r.result, resultKeys) && contractKeys(a.changes, auditKeys)
		if r.action != "product_versions:plan-item-delete" {
			valid = valid && planInputFingerprint(r.action, input, r.hash)
			increment := int64(1)
			if r.action == "product_versions:plan-confirm" {
				increment = 0
			}
			valid = valid && contractKeys(input, keys) && contractInt(input["version_id"]) == versionID && contractInt(input["expected_revision"])+increment == workspace && contractInt(input["expected_version_revision"])+increment == rev
			if r.action != "product_versions:plan-edit" {
				valid = valid && contractInt(input["expected_plan_revision"]) == plan
			}
		}
		if r.action == "product_versions:plan-item-create" || r.action == "product_versions:plan-item-edit" {
			id := contractInt(r.result["id"])
			valid = valid && id > 0
			ref, err = contractReference(ctx, q, schema, "product_version_features", "id=? AND version_id=?", id, versionID)
			if err != nil {
				return nil, err
			}
			if !ref {
				live, err := contractReference(ctx, q, schema, "product_version_features", "id=?", id)
				if err != nil {
					return nil, err
				}
				if !live {
					for _, d := range receipts {
						for _, da := range audits {
							if d.product == r.product && da.object == a.object && contractInt(d.result["id"]) == id && contractInt(d.result["version_revision"]) > rev && contractInt(d.result["scope_revision"]) > scope && contractInt(d.result["workspace_revision"]) > workspace && da.id > a.id && validatedPlanDelete(d, da) {
								frozen := da.changes["deleted"].(map[string]any)
								if r.action == "product_versions:plan-item-create" && (!contractJSONEqual(frozen["planning_item_biz_id"], r.result["planning_item_biz_id"]) || !contractJSONEqual(frozen["request_biz_id"], r.result["request_biz_id"])) {
									continue
								}
								ref = true
							}
						}
					}
				}
			}
			valid = valid && ref
		}
		if valid {
			used[a.id] = true
		} else {
			issues = append(issues, MigrationConflict{Kind: "plan_command_receipt_contract_invalid", Source: "aims.product_command_receipts", KeySHA256: redactedBusinessKey("plan-receipt", stringID(r.id)), RowCount: 1})
		}
	}
	for _, a := range audits {
		if !used[a.id] {
			issues = append(issues, MigrationConflict{Kind: "plan_command_audit_contract_invalid", Source: "aims.product_activity_logs", KeySHA256: redactedBusinessKey("plan-audit", stringID(a.id)), RowCount: 1})
		}
	}
	return issues, nil
}

func mustContractJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
