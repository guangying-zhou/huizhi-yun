package unified

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
)

func stringID(id int64) string { return strconv.FormatInt(id, 10) }

func contractObject(raw []byte) (map[string]any, error) {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var m map[string]any
	err := d.Decode(&m)
	return m, err
}
func contractKeys(m map[string]any, keys string) bool {
	if m == nil {
		return false
	}
	allowed := map[string]bool{}
	for _, k := range strings.Fields(keys) {
		allowed[k] = true
	}
	for k := range m {
		if !allowed[k] {
			return false
		}
	}
	return true
}
func contractInt(v any) int64 {
	n, ok := v.(json.Number)
	if !ok {
		return -1
	}
	i, e := n.Int64()
	if e != nil {
		return -1
	}
	return i
}
func contractText(v any) bool { s, ok := v.(string); return ok && strings.TrimSpace(s) != "" }
func contractJSONEqual(a, b any) bool {
	x, e := json.Marshal(a)
	if e != nil {
		return false
	}
	y, e := json.Marshal(b)
	return e == nil && bytes.Equal(x, y)
}
func releaseSnapshotHash(scope, acceptance []byte) (string, error) {
	s, e := contractObject(scope)
	if e != nil {
		return "", e
	}
	a, e := contractObject(acceptance)
	if e != nil {
		return "", e
	}
	raw, e := json.Marshal(map[string]any{"scope": s, "acceptance": a})
	if e != nil {
		return "", e
	}
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:]), nil
}

func contractReference(ctx context.Context, q querier, schema, table, condition string, args ...any) (bool, error) {
	ok, e := hasTables(ctx, q, schema, table)
	if e != nil || !ok {
		return false, e
	}
	rows, e := q.QueryContext(ctx, "SELECT 1 FROM "+qualified(schema, table)+" WHERE "+condition+" LIMIT 1", args...)
	if e != nil {
		return false, e
	}
	defer rows.Close()
	found := rows.Next()
	return found, rows.Err()
}

func reviewedVersionContract(ctx context.Context, q querier, schema string, value any, id, scope int64) (string, bool, error) {
	v, ok := value.(map[string]any)
	if !ok || !contractKeys(v, "planning_mode business_owner_uid id product_code version_code name description status planned_release_date owner_project_id revision scope_revision current_release_record_id") || contractInt(v["id"]) != id || contractInt(v["scope_revision"]) != scope || contractInt(v["revision"]) < 1 || !contractText(v["product_code"]) {
		return "", false, nil
	}
	product := v["product_code"].(string)
	found, e := contractReference(ctx, q, schema, "product_versions", "id=? AND BINARY product_code=BINARY ? AND revision>=? AND scope_revision>=?", id, product, contractInt(v["revision"]), scope)
	return product, found, e
}

func acceptanceScopesContract(ctx context.Context, q querier, schema, product string, version int64, value any, historicalRevision ...int64) (bool, error) {
	scopes, ok := value.([]any)
	if !ok {
		return false, nil
	}
	seen := map[int64]bool{}
	for _, item := range scopes {
		s, ok := item.(map[string]any)
		id := contractInt(s["id"])
		if !ok || id < 1 || seen[id] || !contractKeys(s, "category is_public sort_order deferred_from_feature_id id title description status acceptance_criteria product_feature_biz_id planning_item_biz_id change_type legacy_unscored") || !contractText(s["title"]) {
			return false, nil
		}
		seen[id] = true
		removedByProof := false
		found, e := contractReference(ctx, q, schema, "product_version_features", "id=? AND version_id=?", id, version)
		if e != nil {
			return false, e
		}
		if !found && len(historicalRevision) == 2 {
			live, err := contractReference(ctx, q, schema, "product_version_features", "id=?", id)
			if err != nil {
				return false, err
			}
			if !live {
				found, e = planDeletedScopeProof(ctx, q, schema, product, version, id, historicalRevision[0], historicalRevision[1], s["planning_item_biz_id"], nil)
				removedByProof = found
			}
		}
		if e != nil || !found {
			return false, e
		}
		for _, ref := range []struct{ field, table string }{{"product_feature_biz_id", "product_features"}, {"planning_item_biz_id", "product_planning_items"}} {
			if s[ref.field] != nil {
				if !contractText(s[ref.field]) {
					return false, nil
				}
				found, e = contractReference(ctx, q, schema, ref.table, "BINARY biz_id=BINARY ? AND BINARY product_code=BINARY ?", s[ref.field], product)
				if e == nil && !found && removedByProof && ref.field == "planning_item_biz_id" {
					live, err := contractReference(ctx, q, schema, ref.table, "BINARY biz_id=BINARY ?", s[ref.field])
					if err != nil {
						return false, err
					}
					found = !live
				}
				if e != nil || !found {
					return false, e
				}
			}
		}
	}
	return true, nil
}

func manualAcceptanceChecks(value any) bool {
	checks, ok := value.([]any)
	if !ok || len(checks) != 3 {
		return false
	}
	required := map[string]bool{"execution-review": false, "blocking-defects-review": false, "release-readiness": false}
	for _, v := range checks {
		m, ok := v.(map[string]any)
		if !ok || !contractKeys(m, "code evidence") || !contractText(m["evidence"]) {
			return false
		}
		code, ok := m["code"].(string)
		seen, known := required[code]
		if !ok || !known || seen {
			return false
		}
		required[code] = true
	}
	return true
}
func acceptanceExceptions(value any) bool {
	list, ok := value.([]any)
	if !ok || len(list) > 50 {
		return false
	}
	seen := map[string]bool{}
	for _, v := range list {
		m, ok := v.(map[string]any)
		if !ok || !contractKeys(m, "code reason responsible_uid impact") {
			return false
		}
		for _, k := range []string{"code", "reason", "responsible_uid", "impact"} {
			if !contractText(m[k]) {
				return false
			}
		}
		code := m["code"].(string)
		if seen[code] {
			return false
		}
		seen[code] = true
	}
	return true
}

func inspectAcceptanceReleaseSnapshots(ctx context.Context, q querier, schema string) ([]MigrationConflict, error) {
	ok, e := hasTables(ctx, q, schema, "product_version_acceptances", "product_release_records", "product_versions")
	if e != nil || !ok {
		return nil, e
	}
	// Some isolated tests use deliberately narrow schemas. Registration cannot
	// treat those as the real snapshot contract: require the actual JSON columns.
	columns, e := q.QueryContext(ctx, "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='product_release_records' AND COLUMN_NAME IN ('scope_snapshot','acceptance_snapshot','content_hash')", schema)
	if e != nil {
		return nil, e
	}
	count := 0
	for columns.Next() {
		count++
	}
	e = columns.Err()
	columns.Close()
	if e != nil || count != 3 {
		return nil, e
	}
	type accepted struct {
		id, version, scope    int64
		actor                 string
		checklist, exceptions []byte
	}
	acceptedRows := []accepted{}
	rows, e := q.QueryContext(ctx, "SELECT id,version_id,scope_revision,accepted_by,checklist,exceptions FROM "+qualified(schema, "product_version_acceptances")+" ORDER BY id")
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var a accepted
		if e = rows.Scan(&a.id, &a.version, &a.scope, &a.actor, &a.checklist, &a.exceptions); e != nil {
			rows.Close()
			return nil, e
		}
		acceptedRows = append(acceptedRows, a)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	issues := []MigrationConflict{}
	valid := map[int64]accepted{}
	for _, a := range acceptedRows {
		checklist, e := contractObject(a.checklist)
		var exceptions any
		d := json.NewDecoder(bytes.NewReader(a.exceptions))
		d.UseNumber()
		exceptionErr := d.Decode(&exceptions)
		good := e == nil && exceptionErr == nil && contractKeys(checklist, "version review_mode reviewed_version scope_snapshot execution_snapshot checks") && contractInt(checklist["version"]) == 1 && checklist["review_mode"] == "manual" && manualAcceptanceChecks(checklist["checks"]) && acceptanceExceptions(exceptions) && contractText(a.actor)
		if good {
			product, found, err := reviewedVersionContract(ctx, q, schema, checklist["reviewed_version"], a.version, a.scope)
			if err != nil {
				return nil, err
			}
			good = found
			reviewed, _ := checklist["reviewed_version"].(map[string]any)
			history, proofErr := acceptanceHistoryProof(ctx, q, schema, a.id, a.version, a.scope, contractInt(reviewed["revision"]), a.actor)
			if proofErr != nil {
				return nil, proofErr
			}
			good = good && history
			if good {
				good, err = acceptanceScopesContract(ctx, q, schema, product, a.version, checklist["scope_snapshot"], contractInt(reviewed["revision"]), a.scope)
				if err != nil {
					return nil, err
				}
			}
			if good {
				good, err = executionSnapshotContractValid(ctx, q, schema, checklist["execution_snapshot"], a.version, checklist["scope_snapshot"], history)
				if err != nil {
					return nil, err
				}
			}
		}
		if good {
			valid[a.id] = a
		} else {
			issues = append(issues, MigrationConflict{Kind: "acceptance_snapshot_contract_invalid", Source: "aims.product_version_acceptances", KeySHA256: redactedBusinessKey("acceptance", stringID(a.id)), RowCount: 1})
		}
	}
	type release struct {
		id, version, scope   int64
		hash                 string
		snapshot, acceptance []byte
	}
	records := []release{}
	rows, e = q.QueryContext(ctx, "SELECT id,version_id,scope_revision,content_hash,scope_snapshot,acceptance_snapshot FROM "+qualified(schema, "product_release_records")+" WHERE scope_snapshot IS NOT NULL ORDER BY id")
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var r release
		if e = rows.Scan(&r.id, &r.version, &r.scope, &r.hash, &r.snapshot, &r.acceptance); e != nil {
			rows.Close()
			return nil, e
		}
		records = append(records, r)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	for _, r := range records {
		s, se := contractObject(r.snapshot)
		a, ae := contractObject(r.acceptance)
		hash, he := releaseSnapshotHash(r.snapshot, r.acceptance)
		good := se == nil && ae == nil && he == nil && hash == r.hash && contractKeys(s, "version reviewed_version scopes features execution") && contractInt(s["version"]) == 1 && contractKeys(a, "acceptance_id accepted_by accepted_at checklist exceptions")
		accepted, exists := valid[contractInt(a["acceptance_id"])]
		good = good && exists && accepted.version == r.version && accepted.scope == r.scope && a["accepted_by"] == accepted.actor
		if good {
			check, _ := contractObject(accepted.checklist)
			var exceptions any
			decoder := json.NewDecoder(bytes.NewReader(accepted.exceptions))
			decoder.UseNumber()
			_ = decoder.Decode(&exceptions)
			good = contractJSONEqual(a["checklist"], check) && contractJSONEqual(a["exceptions"], exceptions)
		}
		if good {
			product, found, err := reviewedVersionContract(ctx, q, schema, s["reviewed_version"], r.version, r.scope)
			if err != nil {
				return nil, err
			}
			good = found
			if good {
				reviewed, _ := s["reviewed_version"].(map[string]any)
				good, err = acceptanceScopesContract(ctx, q, schema, product, r.version, s["scopes"], contractInt(reviewed["revision"]), r.scope)
				if err != nil {
					return nil, err
				}
			}
			if good {
				check, _ := contractObject(accepted.checklist)
				reviewed, _ := check["reviewed_version"].(map[string]any)
				history, proofErr := acceptanceHistoryProof(ctx, q, schema, accepted.id, accepted.version, accepted.scope, contractInt(reviewed["revision"]), accepted.actor)
				if proofErr != nil {
					return nil, proofErr
				}
				good, err = executionSnapshotContractValid(ctx, q, schema, s["execution"], r.version, s["scopes"], history)
				if err != nil {
					return nil, err
				}
			}
			features, ok := s["features"].([]any)
			good = good && ok
			for _, feature := range features {
				f, ok := feature.(map[string]any)
				if !ok || !contractKeys(f, "product_feature_biz_id status") || !contractText(f["product_feature_biz_id"]) {
					good = false
					break
				}
				found, err = contractReference(ctx, q, schema, "product_features", "BINARY biz_id=BINARY ? AND BINARY product_code=BINARY ?", f["product_feature_biz_id"], product)
				if err != nil {
					return nil, err
				}
				good = good && found
			}
		}
		if !good {
			issues = append(issues, MigrationConflict{Kind: "release_snapshot_contract_invalid", Source: "aims.product_release_records", KeySHA256: redactedBusinessKey("release", stringID(r.id)), RowCount: 1})
		}
	}
	return issues, nil
}
