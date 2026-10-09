package people

import (
	"context"
	"database/sql"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// Each target command has its own fixed U prepare/confirm pair. No generic action API.
var HRSourceContracts = map[string][2]string{
	"mappings":    {"console:hr-source-sync:admin", "people.hr-source-sync.dingtalk.department-mappings.apply"},
	"changes":     {"console:hr-source-sync:admin", "people.hr-source-sync.dingtalk.department-changes.apply"},
	"jobs-start":  {"console:hr-source-sync:execute", "people.hr-source-sync.dingtalk.jobs.start"},
	"jobs-cancel": {"console:hr-source-sync:execute", "people.hr-source-sync.dingtalk.jobs.cancel"},
	"jobs-retry":  {"console:hr-source-sync:execute", "people.hr-source-sync.dingtalk.jobs.retry"},
}

func HRSourcePermission(op string) (string, string, bool) {
	if op == "hr-state" {
		return "hr_source_sync", "view", true
	}
	for kind, p := range HRSourceContracts {
		if op == "hr-"+kind+"-prepare" || op == "hr-"+kind+"-confirm" {
			action := "execute"
			if p[0] == "console:hr-source-sync:admin" {
				action = "admin"
			}
			return "hr_source_sync", action, true
		}
	}
	return "", "", false
}
func IsHRSourceOperation(op string) bool { _, _, ok := HRSourcePermission(op); return ok }
func HRSourceKind(op string) string {
	return strings.TrimSuffix(strings.TrimSuffix(strings.TrimPrefix(op, "hr-"), "-prepare"), "-confirm")
}

var hrCode = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

func ValidateHRSourceInput(op string, i EnterpriseFactsInput) error {
	if !IsHRSourceOperation(op) || i.ID != "dingtalk" || i.EmployeeUID != "" || i.Page != 0 || i.PageSize != 0 || i.Search != "" || i.SensitiveAllowed {
		return factsError("people_hr_input_invalid")
	}
	if op == "hr-state" {
		if len(i.Payload) != 0 {
			return factsError("people_hr_input_invalid")
		}
		return nil
	}
	if strings.HasSuffix(op, "-confirm") {
		if len(i.Payload) != 2 || FactsString(i.Payload, "operationKey") == "" {
			return factsError("people_hr_confirmation_invalid")
		}
		if _, ok := i.Payload["confirmation"].(map[string]any); !ok {
			return factsError("people_hr_confirmation_invalid")
		}
		return nil
	}
	if FactsVersion(i.Payload) == 0 {
		return factsError("people_hr_version_required")
	}
	command, ok := i.Payload["command"].(map[string]any)
	count := 2
	if op == "hr-jobs-start-prepare" {
		if _, ok := i.Payload["sourceReady"].(bool); !ok {
			return factsError("people_hr_readiness_required")
		}
		count = 3
	}
	if !ok || len(i.Payload) != count {
		return factsError("people_hr_input_invalid")
	}
	_, e := NormalizeHRSourceCommand(HRSourceKind(op), command)
	return e
}
func NormalizeHRSourceCommand(kind string, raw map[string]any) (map[string]any, error) {
	out := map[string]any{}
	bad := func() (map[string]any, error) { return nil, factsError("people_hr_command_invalid") }
	switch kind {
	case "mappings":
		if len(raw) != 1 {
			return bad()
		}
		rows, ok := raw["mappings"].([]any)
		if !ok || len(rows) == 0 || len(rows) > 500 {
			return bad()
		}
		out["mappings"] = rows
		// Console owns exact mapping/snapshot validation; this layer does not invent another Directory policy.
		for _, r := range rows {
			m, ok := r.(map[string]any)
			if !ok || len(m) != 2 || !regexp.MustCompile(`^[A-Za-z0-9._-]{1,255}$`).MatchString(FactsString(m, "externalDepartmentId")) || !hrCode.MatchString(FactsString(m, "canonicalDeptCode")) {
				return bad()
			}
		}
	case "changes":
		if len(raw) != 3 || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(FactsString(raw, "snapshotHash")) {
			return bad()
		}
		var n uint64
		switch v := raw["snapshotRunId"].(type) {
		case json.Number:
			n, _ = strconv.ParseUint(v.String(), 10, 53)
		case float64:
			if v > 0 && v <= 9007199254740991 && v == float64(uint64(v)) {
				n = uint64(v)
			}
		case int:
			if v > 0 {
				n = uint64(v)
			}
		}
		if n == 0 {
			return bad()
		}
		codes, ok := raw["departmentCodes"].([]any)
		if !ok || len(codes) == 0 || len(codes) > 500 {
			return bad()
		}
		seen := map[string]bool{}
		for _, v := range codes {
			s, ok := v.(string)
			if !ok || !hrCode.MatchString(s) || seen[s] {
				return bad()
			}
			seen[s] = true
		}
		out["snapshotRunId"] = n
		out["snapshotHash"] = raw["snapshotHash"]
		out["departmentCodes"] = codes
	case "jobs-start":
		if len(raw) != 0 {
			return bad()
		}
		out["objectScopes"] = []string{"organization", "people"}
	case "jobs-cancel", "jobs-retry":
		if len(raw) != 1 || !regexp.MustCompile(`^crj_[A-Za-z0-9_-]{20,64}$`).MatchString(FactsString(raw, "jobId")) {
			return bad()
		}
		out["jobId"] = raw["jobId"]
	default:
		return bad()
	}
	return out, nil
}

// Source and target aliases are server-confirmed Console facts, never public body input.
func RemapHRSourceDepartmentsTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), raw any) (int, error) {
	aliases, ok := raw.([]any)
	if !ok || len(aliases) > 500 {
		return 0, factsError("people_department_alias_invalid")
	}
	pairs := [][2]string{}
	seen := map[string]bool{}
	for _, v := range aliases {
		m, ok := v.(map[string]any)
		if !ok {
			return 0, factsError("people_department_alias_invalid")
		}
		a, c := FactsString(m, "aliasDeptCode"), FactsString(m, "canonicalDeptCode")
		if !hrCode.MatchString(a) || !hrCode.MatchString(c) || a == c || seen[a] {
			return 0, factsError("people_department_alias_invalid")
		}
		seen[a] = true
		pairs = append(pairs, [2]string{a, c})
	}
	sort.Slice(pairs, func(i, j int) bool { return pairs[i][0] < pairs[j][0] })
	// Resolve every table before mutations; caller owns generation, transaction and receipt.
	e, err := table("people_employees")
	if err != nil {
		return 0, err
	}
	a, err := table("people_assignments")
	if err != nil {
		return 0, err
	}
	// Complete employee roots first, then assignments; a concurrent source change cannot escape the frozen set.
	for _, t := range []string{e, a} {
		for _, p := range pairs {
			rows, err := tx.QueryContext(ctx, "SELECT id FROM "+t+" WHERE dept_code=? AND BINARY dept_code=BINARY ? ORDER BY id FOR UPDATE", p[0], p[0])
			if err != nil {
				return 0, err
			}
			for rows.Next() {
				var id uint64
				if err = rows.Scan(&id); err != nil {
					rows.Close()
					return 0, err
				}
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return 0, err
			}
		}
	}
	for _, t := range []string{e, a} {
		for _, p := range pairs {
			if _, err = tx.ExecContext(ctx, "UPDATE "+t+" SET dept_code=?,row_version=row_version+1,updated_at=UTC_TIMESTAMP(3) WHERE dept_code=? AND BINARY dept_code=BINARY ?", p[1], p[0], p[0]); err != nil {
				return 0, err
			}
		}
	}
	return len(pairs), nil
}
func HRSourcePendingError() error {
	return httperror.New(409, "people_hr_remap_pending", "部门映射或来源命令尚未确认，请按原键恢复后再同步")
}
