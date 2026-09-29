package unified

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"time"
)

// The writer freezes Hundredths as decimal strings, never JSON floating point.
func planAmount(v any) (int64, bool) {
	s, ok := v.(string)
	if !ok {
		return 0, false
	}
	p := strings.Split(s, ".")
	if len(p) != 2 || len(p[1]) != 2 || p[0] == "" {
		return 0, false
	}
	n, e := strconv.ParseInt(strings.ReplaceAll(s, ".", ""), 10, 64)
	return n, e == nil && strconv.FormatInt(n/100, 10)+"."+p[1] == s
}

func inspectPlanConfirmationJSON(ctx context.Context, q querier, schema string) ([]MigrationConflict, error) {
	ready, e := hasTables(ctx, q, schema, "product_version_plan_confirmations", "product_version_plans", "product_versions", "product_requests", "product_planning_items", "product_version_features")
	if e != nil || !ready {
		return nil, e
	}
	ready, e = hasColumn(ctx, q, schema, "product_version_plan_confirmations", "snapshot")
	if e != nil || !ready {
		return nil, e
	}
	rows, e := q.QueryContext(ctx, "SELECT id,version_id,plan_revision,scope_revision,snapshot,invalidated_at FROM "+qualified(schema, "product_version_plan_confirmations")+" WHERE snapshot IS NOT NULL ORDER BY id")
	if e != nil {
		return nil, e
	}
	type record struct {
		id, version, plan, scope int64
		raw                      []byte
		invalidated              sql.NullString
	}
	all := []record{}
	for rows.Next() {
		var r record
		if e = rows.Scan(&r.id, &r.version, &r.plan, &r.scope, &r.raw, &r.invalidated); e != nil {
			rows.Close()
			return nil, e
		}
		all = append(all, r)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	issues := []MigrationConflict{}
	for _, r := range all {
		m, err := contractObject(r.raw)
		valid := err == nil && contractKeys(m, "version version_id version_revision business_owner_uid goal starts_on planned_release_date available_person_days reserve_person_days plan_revision scope_revision summary scopes") && contractInt(m["version"]) == 1 && contractInt(m["version_id"]) == r.version && contractInt(m["plan_revision"]) == r.plan && contractInt(m["scope_revision"]) == r.scope && r.plan > 0 && r.scope > 0 && contractInt(m["version_revision"]) > 0 && contractText(m["business_owner_uid"]) && contractText(m["goal"])
		var product string
		var revision, planRevision, scopeRevision int64
		versionRows, queryErr := q.QueryContext(ctx, "SELECT v.product_code,v.revision,p.revision,p.scope_revision FROM "+qualified(schema, "product_versions")+" v JOIN "+qualified(schema, "product_version_plans")+" p ON p.version_id=v.id WHERE v.id=?", r.version)
		if queryErr != nil {
			return nil, queryErr
		}
		err = sql.ErrNoRows
		if versionRows.Next() {
			err = versionRows.Scan(&product, &revision, &planRevision, &scopeRevision)
		}
		if rowErr := versionRows.Err(); rowErr != nil {
			err = rowErr
		}
		versionRows.Close()
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		valid = valid && err == nil && revision >= contractInt(m["version_revision"]) && planRevision >= r.plan && scopeRevision >= r.scope
		start, sok := m["starts_on"].(string)
		release, dok := m["planned_release_date"].(string)
		_, se := time.Parse("2006-01-02", start)
		_, de := time.Parse("2006-01-02", release)
		valid = valid && sok && dok && se == nil && de == nil && start <= release
		available, aok := planAmount(m["available_person_days"])
		reserve, rok := planAmount(m["reserve_person_days"])
		valid = valid && aok && rok && available >= 0 && reserve >= 0 && reserve <= available
		scopes, ok := m["scopes"].([]any)
		valid = valid && ok && len(scopes) > 0
		seen := map[int64]bool{}
		var estimate int64
		for _, value := range scopes {
			s, ok := value.(map[string]any)
			id := contractInt(s["scope_id"])
			requestRev := contractInt(s["request_revision"])
			amount, amountOK := planAmount(s["estimate_person_days"])
			valid = valid && ok && contractKeys(s, "scope_id request_biz_id request_revision request_decision planning_item_biz_id scope_summary estimate_person_days acceptance_criteria sort_order") && id > 0 && !seen[id] && requestRev > 0 && s["request_decision"] == "accepted" && contractText(s["scope_summary"]) && contractText(s["acceptance_criteria"]) && amountOK && amount > 0 && contractSortOrder(s["sort_order"])
			seen[id] = true
			estimate += amount
			ref, err := contractReference(ctx, q, schema, "product_requests", "biz_id=? AND product_code=? AND revision>=?", s["request_biz_id"], product, requestRev)
			if err != nil {
				return nil, err
			}
			valid = valid && ref
			ref, err = contractReference(ctx, q, schema, "product_planning_items", "biz_id=? AND product_code=?", s["planning_item_biz_id"], product)
			if err != nil {
				return nil, err
			}
			if !ref && r.invalidated.Valid {
				live, liveErr := contractReference(ctx, q, schema, "product_planning_items", "BINARY biz_id=BINARY ?", s["planning_item_biz_id"])
				if liveErr != nil {
					return nil, liveErr
				}
				if !live {
					ref, err = planDeletedScopeProof(ctx, q, schema, product, r.version, id, contractInt(m["version_revision"]), r.scope, s["planning_item_biz_id"], s["request_biz_id"])
					if err != nil {
						return nil, err
					}
				}
			}
			valid = valid && ref
			ref, err = contractReference(ctx, q, schema, "product_version_features", "id=? AND version_id=?", id, r.version)
			if err != nil {
				return nil, err
			}
			if !ref && r.invalidated.Valid {
				live, liveErr := contractReference(ctx, q, schema, "product_version_features", "id=?", id)
				if liveErr != nil {
					return nil, liveErr
				}
				if !live {
					ref, err = planDeletedScopeProof(ctx, q, schema, product, r.version, id, contractInt(m["version_revision"]), r.scope, s["planning_item_biz_id"], s["request_biz_id"])
					if err != nil {
						return nil, err
					}
				}
			}
			valid = valid && ref
		}
		summary, ok := m["summary"].(map[string]any)
		estimated, eok := planAmount(summary["estimated_person_days"])
		remaining, remOK := planAmount(summary["remaining_person_days"])
		problems, pok := summary["issues"].([]any)
		valid = valid && ok && contractKeys(summary, "selected_count estimated_person_days unknown_estimate_count remaining_person_days issues") && contractInt(summary["selected_count"]) == int64(len(scopes)) && contractInt(summary["unknown_estimate_count"]) == 0 && eok && estimated == estimate && remOK && remaining == available-reserve-estimate && remaining >= 0 && pok && len(problems) == 0
		if !valid {
			issues = append(issues, MigrationConflict{Kind: "plan_confirmation_snapshot_contract_invalid", Source: "aims.product_version_plan_confirmations", KeySHA256: redactedBusinessKey("plan-confirmation", stringID(r.id)), RowCount: 1})
		}
	}
	return issues, nil
}
