package people

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"regexp"
	"sort"
	"strings"
	"time"
)

// These are business facts only. Account reservation/provisioning is deliberately
// absent until c2. No inbound service token or claimed source enters this core.
type EnterpriseFactsInput struct {
	ID               string         `json:"id"`
	EmployeeUID      string         `json:"employeeUid"`
	Page             int            `json:"page"`
	PageSize         int            `json:"pageSize"`
	Search           string         `json:"search"`
	Payload          map[string]any `json:"payload"`
	SensitiveAllowed bool           `json:"sensitiveAllowed"`
}
type PeopleWorkflowInstance struct {
	ID, App, Resource, Action, BizID, Actor, Status string
	Form                                            map[string]any
}
type PeopleWorkflowReader interface {
	ReadPeopleWorkflowInstance(context.Context, *sql.Tx, func(string) (string, error), string) (PeopleWorkflowInstance, error)
}
type FactsContext struct {
	Tenant, Deployment, Actor, Client, RequestID, Key string
	AsOf                                              time.Time
}

var factsUID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$`)

func FactsPermission(op string) (string, string, bool) {
	if IsDirectoryRecoveryOperation(op) {
		return DirectoryRecoveryPermission(op)
	}
	if IsOffboardingOperation(op) {
		return OffboardingPermission(op)
	}
	if IsHRSourceOperation(op) {
		return HRSourcePermission(op)
	}
	if IsProvisioningOperation(op) {
		return "employees", "edit", true
	}
	switch op {
	case "employees-create", "employees-update":
		return "employees", "edit", true
	case "assignments-request-workflow", "assignments-create", "assignments-update", "assignments-delete", "assignments-change", "assignments-attach-workflow":
		return "assignments", "edit", true
	case "onboarding-list", "onboarding-view":
		return "employees", "view", true
	case "onboarding-create", "onboarding-update":
		return "employees", "edit", true
	}
	return "", "", false
}
func FactsIntent(i EnterpriseFactsInput) []any {
	keys := []string{}
	for k := range i.Payload {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	ordered := []any{}
	for _, k := range keys {
		ordered = append(ordered, []any{k, i.Payload[k]})
	}
	return []any{i.ID, i.EmployeeUID, i.Page, i.PageSize, i.Search, ordered, i.SensitiveAllowed}
}
func factsError(code string) error                  { return httperror.New(400, code, "Invalid People facts input") }
func FactsString(m map[string]any, k string) string { v, _ := m[k].(string); return v }
func FactsVersion(m map[string]any) int64 {
	v, ok := m["expectedVersion"].(float64)
	if !ok || v < 1 || v > 4294967295 || v != float64(int64(v)) {
		return 0
	}
	return int64(v)
}
func ValidateFactsInput(op string, i EnterpriseFactsInput) error {
	if IsDirectoryRecoveryOperation(op) {
		return ValidateDirectoryRecoveryInput(op, i)
	}
	if IsOffboardingOperation(op) {
		return ValidateOffboardingInput(op, i)
	}
	if IsHRSourceOperation(op) {
		return ValidateHRSourceInput(op, i)
	}
	if IsProvisioningOperation(op) {
		return ValidateProvisioningInput(op, i)
	}
	if _, _, ok := FactsPermission(op); !ok {
		return factsError("people_facts_operation_invalid")
	}
	if i.EmployeeUID != "" && (!factsUID.MatchString(i.EmployeeUID) || strings.HasPrefix(strings.ToLower(i.EmployeeUID), "dt-")) {
		return factsError("people_uid_invalid")
	}
	list := op == "onboarding-list"
	read := list || op == "onboarding-view"
	create := strings.HasSuffix(op, "-create") || op == "assignments-change"
	if list {
		if i.ID != "" || i.EmployeeUID != "" || len(i.Payload) > 0 || i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 || len(i.Search) > 100 || strings.ContainsAny(i.Search, "\x00\n\r") {
			return factsError("people_page_invalid")
		}
		return nil
	}
	if i.Page != 0 || i.PageSize != 0 || i.Search != "" || create && i.ID != "" || !create && i.ID == "" {
		return factsError("people_identity_invalid")
	}
	if i.ID != "" && !regexp.MustCompile(`^[1-9][0-9]{0,15}$`).MatchString(i.ID) {
		return factsError("people_identity_invalid")
	}
	if !strings.HasPrefix(op, "onboarding-") && i.EmployeeUID == "" {
		return factsError("people_uid_required")
	}
	if read {
		if len(i.Payload) > 0 || i.EmployeeUID != "" {
			return factsError("people_input_invalid")
		}
		return nil
	}
	if !create && FactsVersion(i.Payload) == 0 {
		return factsError("people_version_required")
	}
	employee := []string{"display_name", "initials", "mobile", "employment_type", "onboard_date", "work_location", "cost_center_code", "dept_code"}
	assignment := []string{"change_type", "effective_from", "dept_code", "position_code", "rank_code", "manager_uid", "remarks"}
	onboarding := []string{"candidate_name", "planned_onboard_date", "dept_code", "position_code", "rank_code", "employment_type", "canonical_uid", "corporate_email", "manager_uid"}
	allowed := employee
	if strings.HasPrefix(op, "assignments-") {
		allowed = assignment
	}
	if strings.HasPrefix(op, "onboarding-") {
		allowed = onboarding
	}
	if op == "assignments-attach-workflow" {
		allowed = []string{"workflowInstanceId"}
	}
	if op == "assignments-delete" || op == "assignments-request-workflow" {
		allowed = []string{}
	}
	if op == "assignments-request-workflow" {
		allowed = []string{"phase"}
		if phase, ok := i.Payload["phase"]; ok && phase != "recover" {
			return factsError("people_approval_phase_invalid")
		}
	}
	for k, v := range i.Payload {
		if !i.SensitiveAllowed && (k == "rank_code" || k == "cost_center_code") {
			return httperror.New(403, "people_sensitive_field_forbidden", "Sensitive field permission required")
		}
		if k == "expectedVersion" && !create {
			continue
		}
		found := false
		for _, a := range allowed {
			if a == k {
				found = true
			}
		}
		s, ok := v.(string)
		if !found || !ok || strings.TrimSpace(s) != s || len([]rune(s)) > 500 || strings.ContainsAny(s, "\x00\r\n") {
			return factsError("people_field_invalid")
		}
		if strings.HasSuffix(k, "date") || k == "effective_from" {
			if s != "" {
				if _, e := time.Parse("2006-01-02", s); e != nil {
					return factsError("people_date_invalid")
				}
			}
		}
		if (k == "canonical_uid" || k == "manager_uid") && s != "" && (!factsUID.MatchString(s) || strings.HasPrefix(strings.ToLower(s), "dt-")) {
			return factsError("people_uid_invalid")
		}
	}
	if op == "employees-create" && FactsString(i.Payload, "display_name") == "" {
		return factsError("people_name_required")
	}
	if strings.HasPrefix(op, "assignments-") && op != "assignments-delete" && op != "assignments-attach-workflow" {
		if create && (FactsString(i.Payload, "change_type") == "" || FactsString(i.Payload, "effective_from") == "") {
			return factsError("people_assignment_fields_required")
		}
		if v := FactsString(i.Payload, "change_type"); v != "" && v != "onboard" && v != "transfer" && v != "rank_change" && v != "leave" {
			return factsError("people_change_type_invalid")
		}
	}
	if strings.HasPrefix(op, "onboarding-") && create && FactsString(i.Payload, "candidate_name") == "" {
		return factsError("people_name_required")
	}
	if v := FactsString(i.Payload, "employment_type"); v != "" && v != "full_time" && v != "part_time" && v != "outsourced" && v != "intern" && v != "agent" {
		return factsError("people_employment_type_invalid")
	}
	if v, ok := i.Payload["display_name"]; ok && v == "" {
		return factsError("people_name_required")
	}
	if v, ok := i.Payload["candidate_name"]; ok && v == "" {
		return factsError("people_name_required")
	}
	if v, ok := i.Payload["effective_from"]; ok && v == "" {
		return factsError("people_date_invalid")
	}
	if op == "assignments-attach-workflow" && !regexp.MustCompile(`^[1-9][0-9]{0,15}$`).MatchString(FactsString(i.Payload, "workflowInstanceId")) {
		return factsError("people_workflow_id_invalid")
	}
	for _, k := range []string{"rank_code", "cost_center_code"} {
		if _, present := i.Payload[k]; present && !i.SensitiveAllowed {
			return httperror.New(403, "people_sensitive_fields_forbidden", "Global standard-cost permission required")
		}
	}
	if len(i.Payload) == 0 {
		return factsError("people_fields_required")
	}
	return nil
}
func factsNumberTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error)) (string, error) {
	seq, e := table("people_employee_number_sequences")
	if e != nil {
		return "", e
	}
	emps, e := table("people_employees")
	if e != nil {
		return "", e
	}
	onb, e := table("people_onboarding_cases")
	if e != nil {
		return "", e
	}
	// Seed only the fixed sequence row, under the caller's domain lock. Existing IDs
	// are checked, not rewritten, and both employee and candidate numbers participate.
	if _, e = tx.ExecContext(ctx, "INSERT IGNORE INTO "+seq+"(sequence_code,next_value) VALUES('employee_no',1)"); e != nil {
		return "", e
	}
	var n int64
	if e = tx.QueryRowContext(ctx, "SELECT next_value FROM "+seq+" WHERE sequence_code='employee_no' FOR UPDATE").Scan(&n); e != nil {
		return "", e
	}
	for {
		candidate := formatEmployeeNumber(n)
		n++
		var exists int
		if e = tx.QueryRowContext(ctx, "SELECT (EXISTS(SELECT 1 FROM "+emps+" WHERE employee_no=?)+EXISTS(SELECT 1 FROM "+onb+" WHERE active_employee_no=?))", candidate, candidate).Scan(&exists); e != nil {
			return "", e
		}
		if exists > 0 {
			continue
		}
		_, e = tx.ExecContext(ctx, "UPDATE "+seq+" SET next_value=? WHERE sequence_code='employee_no'", n)
		return candidate, e
	}
}
