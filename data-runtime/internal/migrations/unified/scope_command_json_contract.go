package unified

import (
	"context"
	"encoding/json"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
)

func scopeDecisionBasisValid(ctx context.Context, q querier, schema, product string, value any, input map[string]any, itemRevision int64) (bool, error) {
	b, ok := value.(map[string]any)
	if !ok || !contractKeys(b, "item_id item_biz_id cycle_biz_id scope_revision evidence_revision decision") || contractInt(b["item_id"]) < 1 || b["item_biz_id"] != input["item_biz_id"] || b["cycle_biz_id"] != input["cycle_biz_id"] || contractInt(b["scope_revision"]) < 1 || contractInt(b["evidence_revision"]) < 1 {
		return false, nil
	}
	d, ok := b["decision"].(map[string]any)
	if !ok || !contractKeys(d, "capacity assessment_id scope_revision evidence_revision model_version exceptions pending_consumption") || contractInt(d["assessment_id"]) < 1 || !contractJSONEqual(d["scope_revision"], b["scope_revision"]) || !contractJSONEqual(d["evidence_revision"], b["evidence_revision"]) || !contractText(d["model_version"]) {
		return false, nil
	}
	if pending, present := d["pending_consumption"]; present {
		rules, err := newConsumptionRules(ctx, q, schema)
		if err != nil {
			return false, err
		}
		cycle, _ := b["cycle_biz_id"].(string)
		item, _ := b["item_biz_id"].(string)
		_, valid, err := rules.confirmationShape(pending, product, cycle, item, 0)
		if err != nil || !valid {
			return false, err
		}
		valid, err = rules.confirmationEvidence(product, pending)
		if err != nil || !valid {
			return false, err
		}
	}
	c, ok := d["capacity"].(map[string]any)
	if !ok || !contractKeys(c, "version item_biz_id investment_category effort_person_days") || contractInt(c["version"]) != 1 || c["item_biz_id"] != b["item_biz_id"] {
		return false, nil
	}
	category, ok := c["investment_category"].(string)
	if !ok || !productcenter.ValidInvestmentCategory(productcenter.InvestmentCategory(category)) {
		return false, nil
	}
	if _, explicit := c["effort_person_days"]; !explicit {
		return false, nil
	}
	if c["effort_person_days"] != nil {
		amount, valid := planAmount(c["effort_person_days"])
		if !valid || amount < 50 || amount > 100000000 {
			return false, nil
		}
	}
	var exceptions []productcenter.DecisionException
	raw, _ := json.Marshal(d["exceptions"])
	if json.Unmarshal(raw, &exceptions) != nil || productcenter.ValidateDecisionExceptions(exceptions) != nil {
		return false, nil
	}
	list, ok := d["exceptions"].([]any)
	if !ok {
		return false, nil
	}
	for _, v := range list {
		m, ok := v.(map[string]any)
		if !ok || !contractKeys(m, "code item_id predecessor_id category reason responsible_uid impact") {
			return false, nil
		}
	}
	ref, e := contractReference(ctx, q, schema, "product_planning_items", "id=? AND BINARY biz_id=BINARY ? AND BINARY product_code=BINARY ? AND revision>=?", b["item_id"], b["item_biz_id"], product, itemRevision)
	if e != nil || !ref {
		return false, e
	}
	ref, e = contractReference(ctx, q, schema, "product_planning_cycles", "BINARY biz_id=BINARY ? AND BINARY product_code=BINARY ? AND revision>=? AND queue_revision>=?", b["cycle_biz_id"], product, input["expected_cycle_revision"], input["expected_queue_revision"])
	if e != nil || !ref {
		return false, e
	}
	return contractReference(ctx, q, schema, "product_priority_assessments", "id=? AND planning_item_id=? AND scope_revision=? AND evidence_revision=? AND BINARY model_version=BINARY ? AND cycle_id IN (SELECT id FROM "+qualified(schema, "product_planning_cycles")+" WHERE BINARY biz_id=BINARY ? AND BINARY product_code=BINARY ?)", d["assessment_id"], b["item_id"], b["scope_revision"], b["evidence_revision"], d["model_version"], b["cycle_biz_id"], product)
}

func inspectScopeCommandJSON(ctx context.Context, q querier, schema string) ([]MigrationConflict, error) {
	r := qualified(schema, "product_command_receipts")
	a := qualified(schema, "product_activity_logs")
	rows, e := q.QueryContext(ctx, "SELECT id,product_code,action,actor_uid,idempotency_key,request_hash,status,result_json FROM "+r+" WHERE action IN ('product_versions:scope-create','product_versions:scope-edit','product_versions:scope-reopen','product_versions:scope-deliver') ORDER BY id")
	if e != nil {
		return nil, e
	}
	receipts := []planningReceipt{}
	for rows.Next() {
		var v planningReceipt
		var raw []byte
		if e = rows.Scan(&v.id, &v.product, &v.action, &v.actor, &v.key, &v.hash, &v.status, &raw); e != nil {
			rows.Close()
			return nil, e
		}
		v.result, _ = contractObject(raw)
		receipts = append(receipts, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	rows, e = q.QueryContext(ctx, "SELECT id,product_code,action,actor_uid,request_id,object_type,object_id,revision,changes FROM "+a+" WHERE action IN ('scope-create','scope-edit','scope-reopen','scope-deliver','scope-defer') ORDER BY id")
	if e != nil {
		return nil, e
	}
	audits := []planningAudit{}
	for rows.Next() {
		var v planningAudit
		var raw []byte
		if e = rows.Scan(&v.id, &v.product, &v.action, &v.actor, &v.key, &v.kind, &v.object, &v.revision, &raw); e != nil {
			rows.Close()
			return nil, e
		}
		v.changes, _ = contractObject(raw)
		audits = append(audits, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	issues := []MigrationConflict{}
	used := map[int64]bool{}
	for _, r := range receipts {
		version, scope, revision, scopeRevision, workspace := contractInt(r.result["version_id"]), contractInt(r.result["id"]), contractInt(r.result["revision"]), contractInt(r.result["scope_revision"]), contractInt(r.result["workspace_revision"])
		valid := r.status == "succeeded" && len(r.hash) == 64 && hexOnlySnapshot(r.hash) && version > 0 && scope > 0 && revision > 1 && scopeRevision > 1 && workspace > 1 && r.result["product_code"] == r.product && contractText(r.actor) && contractText(r.key)
		var paired *planningAudit
		for i := range audits {
			v := audits[i]
			field := "after"
			if r.action == "product_versions:scope-edit" {
				field = "result"
			}
			if "product_versions:"+v.action == r.action && v.kind == "version" && v.object == stringID(version) && v.product == r.product && v.actor == r.actor && v.key == r.key && v.revision == revision && contractJSONEqual(v.changes[field], r.result) {
				if paired != nil {
					valid = false
				}
				paired = &audits[i]
			}
		}
		if paired == nil {
			valid = false
		} else {
			v := *paired
			keys := "id version_id product_code revision scope_revision workspace_revision"
			auditKeys := ""
			input := map[string]any{}
			switch r.action {
			case "product_versions:scope-create", "product_versions:scope-edit":
				inputField := "input"
				if r.action == "product_versions:scope-edit" {
					inputField = "after"
				}
				input, _ = v.changes[inputField].(map[string]any)
				keys += " item_revision"
				auditKeys = "before after result decision_basis"
				if r.action == "product_versions:scope-create" {
					keys += " planning_item_biz_id status"
					auditKeys = "after input decision_basis"
					var typed productcenter.ProductVersionScopeDraft
					valid = valid && typedPayloadValid(input, &typed, r.hash) && productcenter.ValidateProductVersionScopeDraft(typed) == nil && r.result["status"] == "planned" && r.result["planning_item_biz_id"] == input["item_biz_id"]
					if typed.DeferredFrom != nil {
						source, err := contractReference(ctx, q, schema, "product_versions", "id=? AND BINARY product_code=BINARY ? AND revision>=? AND scope_revision>=?", typed.DeferredFrom.VersionID, r.product, typed.DeferredFrom.ExpectedVersionRevision+1, typed.DeferredFrom.ExpectedScopeRevision+1)
						if err != nil {
							return nil, err
						}
						sourceScope, err := contractReference(ctx, q, schema, "product_version_features", "id=? AND version_id=?", typed.DeferredFrom.ScopeID, typed.DeferredFrom.VersionID)
						if err != nil {
							return nil, err
						}
						valid = valid && source && sourceScope
						deferred := false
						for _, d := range audits {
							if d.action == "scope-defer" && d.kind == "version" && d.object == stringID(typed.DeferredFrom.VersionID) && d.product == r.product && d.actor == r.actor && d.key == r.key && d.revision == int64(typed.DeferredFrom.ExpectedVersionRevision)+1 && contractJSONEqual(d.changes, v.changes) {
								deferred = true
								used[d.id] = true
							}
						}
						valid = valid && deferred
					}
				} else {
					var typed productcenter.ProductVersionScopeEdit
					valid = valid && typedPayloadValid(input, &typed, r.hash) && productcenter.ValidateProductVersionScopeDraft(typed.ProductVersionScopeDraft) == nil && typed.DeferredFrom == nil && typed.ScopeID == scope
					before, ok := v.changes["before"].(map[string]any)
					valid = valid && ok && contractKeys(before, "title description acceptance_criteria change_type status") && before["status"] == "planned" && contractText(before["title"])
				}
				valid = valid && contractInt(input["version_id"]) == version && contractInt(input["expected_version_revision"])+1 == revision && contractInt(input["expected_revision"])+1 == workspace && contractInt(input["expected_item_revision"])+1 == contractInt(r.result["item_revision"])
				basis, err := scopeDecisionBasisValid(ctx, q, schema, r.product, v.changes["decision_basis"], input, contractInt(r.result["item_revision"]))
				if err != nil {
					return nil, err
				}
				valid = valid && basis
			case "product_versions:scope-reopen", "product_versions:scope-deliver":
				keys += " status"
				auditKeys = "before after reason withdrawn_scope_revision"
				expectedStatus := "delivered"
				wantedStatus := "planned"
				field := "withdrawn_scope_revision"
				if r.action == "product_versions:scope-deliver" {
					auditKeys = "before after evidence reason accepted_scope_revision"
					expectedStatus = "planned"
					wantedStatus = "delivered"
					field = "accepted_scope_revision"
				}
				before, ok := v.changes["before"].(map[string]any)
				valid = valid && ok && contractKeys(before, "id title description acceptance_criteria status") && contractInt(before["id"]) == scope && contractText(before["title"]) && contractText(before["acceptance_criteria"]) && before["status"] == expectedStatus && r.result["status"] == wantedStatus && contractText(v.changes["reason"]) && contractInt(v.changes[field])+1 == scopeRevision
				if r.action == "product_versions:scope-deliver" {
					valid = valid && contractText(v.changes["evidence"])
					typed := productcenter.ProductVersionScopeDelivery{VersionID: version, ScopeID: scope, ExpectedRevision: uint64(workspace - 1), ExpectedVersionRevision: uint64(revision - 1), ExpectedScopeRevision: uint64(scopeRevision - 1)}
					typed.Reason, _ = v.changes["reason"].(string)
					typed.Evidence, _ = v.changes["evidence"].(string)
					valid = valid && typedPayloadValid(typed, &productcenter.ProductVersionScopeDelivery{}, r.hash) && productcenter.ValidateProductVersionScopeDelivery(typed) == nil
				} else {
					typed := productcenter.ProductVersionScopeReopen{VersionID: version, ScopeID: scope, ExpectedRevision: uint64(workspace - 1), ExpectedVersionRevision: uint64(revision - 1), ExpectedScopeRevision: uint64(scopeRevision - 1)}
					typed.Reason, _ = v.changes["reason"].(string)
					valid = valid && typedPayloadValid(typed, &productcenter.ProductVersionScopeReopen{}, r.hash) && productcenter.ValidateProductVersionScopeReopen(typed) == nil
				}
			}
			valid = valid && contractKeys(r.result, keys) && contractKeys(v.changes, auditKeys)
			if valid {
				used[v.id] = true
			}
		}
		ref, err := contractReference(ctx, q, schema, "product_versions", "id=? AND BINARY product_code=BINARY ? AND revision>=? AND scope_revision>=?", version, r.product, revision, scopeRevision)
		if err != nil {
			return nil, err
		}
		valid = valid && ref
		ref, err = contractReference(ctx, q, schema, "product_workspaces", "BINARY product_code=BINARY ? AND revision>=?", r.product, workspace)
		if err != nil {
			return nil, err
		}
		valid = valid && ref
		ref, err = contractReference(ctx, q, schema, "product_version_features", "id=? AND version_id=?", scope, version)
		if err != nil {
			return nil, err
		}
		if !ref {
			live, err := contractReference(ctx, q, schema, "product_version_features", "id=?", scope)
			if err != nil {
				return nil, err
			}
			if !live {
				ref, err = planDeletedScopeProof(ctx, q, schema, r.product, version, scope, revision, scopeRevision, nil, nil)
				if err != nil {
					return nil, err
				}
			}
		}
		valid = valid && ref
		if !valid {
			if paired != nil {
				delete(used, paired.id)
			}
			issues = append(issues, MigrationConflict{Kind: "scope_command_receipt_contract_invalid", Source: "aims.product_command_receipts", KeySHA256: redactedBusinessKey("scope-receipt", stringID(r.id)), RowCount: 1})
		}
	}
	for _, a := range audits {
		if !used[a.id] {
			issues = append(issues, MigrationConflict{Kind: "scope_command_audit_contract_invalid", Source: "aims.product_activity_logs", KeySHA256: redactedBusinessKey("scope-audit", stringID(a.id)), RowCount: 1})
		}
	}
	return issues, nil
}
