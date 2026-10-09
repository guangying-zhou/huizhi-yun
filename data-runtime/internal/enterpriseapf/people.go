package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type PeopleInput = people.EnterpriseMasterInput

func PeoplePermission(op string) (string, string, bool) { return people.EnterpriseMasterPermission(op) }
func PeopleIntent(i PeopleInput) []any                  { return people.EnterpriseMasterIntent(i) }
func ValidatePeopleInput(op string, i PeopleInput) error {
	return people.ValidateEnterpriseMasterInput(op, i)
}
func peopleObjectScope(actor string, s altoc.BasicReadScope, alias string) (string, []any, error) {
	if e := s.Validate(); e != nil {
		return "", nil, e
	}
	col := alias + "employee_uid"
	dept := alias + "dept_code"
	switch s.Access {
	case "all":
		return "1=1", nil, nil
	case "self":
		return "BINARY " + col + "=BINARY ?", []any{actor}, nil
	case "dept", "self_dept":
		args := []any{}
		for _, d := range s.DepartmentCodes {
			args = append(args, d)
		}
		where := "BINARY " + dept + " IN (" + strings.TrimSuffix(strings.Repeat("BINARY ?,", len(args)), ",") + ")"
		if s.Access == "self_dept" {
			where = "(" + where + " OR BINARY " + col + "=BINARY ?)"
			args = append(args, actor)
		}
		return where, args, nil
	default:
		return "0=1", nil, nil
	}
}
func (s *Service) People(ctx context.Context, op string, i PeopleInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	defer func() {
		var me *mysql.MySQLError
		if errors.As(err, &me) && (me.Number == 1062 || me.Number == 1213 || me.Number == 1205) {
			err = httperror.New(409, "people_write_conflict", "Concurrent dictionary change")
		}
	}()
	if e := ValidatePeopleInput(op, i); e != nil {
		return nil, e
	}
	if e := scope.Validate(); e != nil {
		return nil, e
	}
	resource, action, _ := PeoplePermission(op)
	dictionary := resource != "employees" && resource != "assignments"
	if dictionary && (scope.Access != "all" || len(scope.DepartmentCodes) > 0) {
		return nil, httperror.New(403, "people_scope_invalid", "Global dictionary permission required")
	}
	if who.Actor == "" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["people"].OwnerDeployment || who.Client != "enterprise.runtime" {
		return nil, httperror.New(403, "people_actor_required", "User required")
	}
	requestOp := enterprise.Read
	if action == "admin" || op == "employees-private-update" {
		requestOp = enterprise.Write
	}
	req, e := s.request("people", requestOp)
	if e != nil {
		return nil, e
	}
	var tx *sql.Tx
	var resolved []enterprise.Resolved
	if action == "admin" || op == "employees-private-update" {
		tx, resolved, e = s.registry.BeginWriteTransaction(ctx, req)
	} else {
		tx, resolved, e = s.registry.BeginSnapshotReadTransaction(ctx, req)
	}
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := resolved[0]
	var result any
	if people.IsEnterprisePrivateOperation(op) {
		result, e = s.peoplePrivate(ctx, tx, r, op, i, who, scope)
	} else if action == "admin" || op == "employees-private-update" {
		result, e = s.peopleWrite(ctx, tx, r, op, i, who)
	} else {
		result, e = peopleRead(ctx, tx, r, op, i, who, scope)
	}
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return result, nil
}
func peopleRead(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, op string, i PeopleInput, who Identity, scope altoc.BasicReadScope) (any, error) {
	logical, cols := people.MasterColumns(op)
	where, args := "1=1", []any{}
	sensitive := []string{}
	assignment := strings.HasPrefix(op, "assignments-")
	alias := ""
	if assignment {
		alias = "a."
	}
	switch {
	case strings.HasPrefix(op, "employees-"):
		logical = "people_employees"
		cols = []string{"id", "employee_uid", "employee_no", "display_name", "employment_status", "employment_type", "dept_code", "dept_name", "position_code", "position_name", "manager_uid", "onboard_date", "leave_date", "initials", "work_location", "row_version"}
		sensitive = []string{"rank_code", "rank_name", "cost_center_code"}
		where, args, _ = peopleObjectScope(who.Actor, scope, "")
		where += " AND archived_at IS NULL"
		if i.ID != "" {
			where += " AND BINARY employee_uid=BINARY ?"
			args = append(args, i.ID)
		}
	case strings.HasPrefix(op, "assignments-"):
		logical = "people_assignments"
		cols = []string{"id", "assignment_code", "employee_uid", "change_type", "effective_from", "effective_to", "is_primary", "dept_code", "dept_name", "position_code", "position_name", "manager_uid", "approval_status", "workflow_instance_id", "created_by", "remarks", "row_version"}
		sensitive = []string{"rank_code", "rank_name"}
		where, args, _ = peopleObjectScope(who.Actor, scope, "e.")
		if i.ID != "" {
			where += " AND a.id=?"
			args = append(args, i.ID)
		}
	default:
		if i.ID != "" {
			where += " AND id=?"
			args = append(args, i.ID)
		}
	}
	if i.CostAllowed {
		cols = append(cols, sensitive...)
	}
	table, e := r.Table(logical)
	if e != nil {
		return nil, e
	}
	from := table
	if assignment {
		employees, err := r.Table("people_employees")
		if err != nil {
			return nil, err
		}
		from = table + " a JOIN " + employees + " e ON BINARY e.employee_uid=BINARY a.employee_uid"
		where += " AND e.archived_at IS NULL"
	}
	if i.Search != "" {
		name := "rank_name"
		code := "rank_code"
		switch logical {
		case "people_employees":
			name = "display_name"
			code = "employee_no"
		case "people_assignments":
			name = "assignment_code"
			code = "employee_uid"
		case "people_positions":
			name = "position_name"
			code = "position_code"
		case "people_standard_cost_rates":
			name = "rate_name"
			code = "rate_code"
		}
		where += " AND (LOCATE(?," + alias + name + ")>0 OR LOCATE(?," + alias + code + ")>0)"
		args = append(args, i.Search, i.Search)
	}
	list := strings.HasSuffix(op, "-list") || op == "employees-search"
	total := int64(0)
	if list {
		if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+from+" WHERE "+where, args...).Scan(&total); e != nil {
			return nil, e
		}
	}
	selection := people.MasterSelect(cols)
	if assignment {
		selections := []string{}
		for _, col := range cols {
			if strings.HasPrefix(col, "effective_") {
				selections = append(selections, "CAST(a."+col+" AS CHAR) AS "+col)
			} else {
				selections = append(selections, "a."+col)
			}
		}
		selections = append(selections, "e.dept_code AS _scope_department")
		cols = append(cols, "_scope_department")
		selection = strings.Join(selections, ",")
	}
	query := "SELECT " + selection + " FROM " + from + " WHERE " + where + " ORDER BY " + alias + "id"
	if list {
		query += " LIMIT ? OFFSET ?"
		args = append(args, i.PageSize, (i.Page-1)*i.PageSize)
	}
	rows, e := tx.QueryContext(ctx, query, args...)
	if e != nil {
		return nil, e
	}
	items, e := people.MasterRows(rows, cols)
	if e != nil {
		return nil, e
	}
	for _, row := range items {
		costRow := row
		if assignment {
			costRow = map[string]any{"employee_uid": row["employee_uid"], "dept_code": row["_scope_department"]}
			delete(row, "_scope_department")
		}
		if i.CostAllowed && !peopleCostVisible(costRow, who.Actor, i.CostScope) {
			for _, col := range sensitive {
				delete(row, col)
			}
		}
	}
	if !list {
		if len(items) != 1 {
			return nil, httperror.New(404, "people_object_not_found", "Object unavailable")
		}
		return map[string]any{"data": items[0]}, nil
	}
	return map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize}, nil
}
func peopleCostVisible(row map[string]any, actor string, scope people.EnterpriseMasterScope) bool {
	switch scope.Access {
	case "all":
		return true
	case "self":
		return row["employee_uid"] == actor
	case "dept", "self_dept":
		for _, d := range scope.DepartmentCodes {
			if row["dept_code"] == d {
				return true
			}
		}
		return scope.Access == "self_dept" && row["employee_uid"] == actor
	}
	return false
}
func (s *Service) peopleWrite(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, op string, i PeopleInput, who Identity) (any, error) {
	if who.Key == "" {
		return nil, httperror.New(400, "people_key_required", "Key required")
	}
	// Serialize domain master writers. Registry generation is fixed, never changed.
	var generation uint64
	if e := tx.QueryRowContext(ctx, "SELECT generation FROM enterprise_schema_registry WHERE id=1 FOR UPDATE").Scan(&generation); e != nil {
		return nil, e
	}
	logical, cols := people.MasterColumns(op)
	private := people.IsEnterprisePrivateOperation(op)
	if private {
		logical = "people_employees"
		cols = []string{"employee_uid", "row_version"}
	}
	table, e := r.Table(logical)
	if e != nil {
		return nil, e
	}

	if i.ID != "" {
		rows, e := tx.QueryContext(ctx, "SELECT "+people.MasterSelect(cols)+" FROM "+table+" WHERE "+func() string {
			if private {
				return "BINARY employee_uid=BINARY ?"
			}
			return "id=?"
		}()+" FOR UPDATE", i.ID)
		if e != nil {
			return nil, e
		}
		items, e := people.MasterRows(rows, cols)
		if e != nil {
			return nil, e
		}
		_ = items
	}
	intent := PeopleIntent(i)
	if private {
		intentBytes, _ := json.Marshal(intent)
		h := sha256.Sum256(intentBytes)
		intent = []any{hex.EncodeToString(h[:])}
	}
	command := map[string]any{"operation": op, "intent": intent, "actor": who.Actor}
	if private {
		command["employeeUid"] = i.ID
		command["expectedVersion"] = i.Payload["expectedVersion"]
	}
	digest, e := integrationoperation.ValidateAndDigestCommand(command)
	if e != nil {
		return nil, e
	}
	raw, _ := json.Marshal(command)
	receipt, e := r.Table("service_command_receipt")
	if e != nil {
		return nil, e
	}
	repo, e := integrationoperation.NewReceiptRepository(r.DB, integrationoperation.WithReceiptTable(receipt))
	if e != nil {
		return nil, e
	}
	oid := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte("people|"+who.Tenant+"|"+who.Deployment+"|"+who.Actor+"|"+op+"|"+who.Key), 4).String()
	in := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", ServiceClientID: who.Client, RequestID: who.RequestID}, SourceDeploymentCode: who.Deployment, TargetDeploymentCode: who.Deployment, TargetApp: "people", OperationID: oid, OperationCode: "people.apf09." + op + ".v1", RequiredCapability: "people:enterprise-host:execute", IdempotencyKey: who.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: who.Actor}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		var row map[string]any
		var e error
		if private {
			row, e = people.EnterprisePrivateWriteTx(ctx, tx, r.Table, i, who.Actor)
		} else {
			row, e = people.MasterWriteTx(ctx, tx, r.Table, op, i, who.Actor)
		}
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		snapshot, _ := json.Marshal(row)
		hash := sha256.Sum256(snapshot)
		// The existing immutable service-command receipt is the audit ledger: identity,
		// request, canonical command and before/after versions are committed atomically.
		id := fmt.Sprint(row["id"])
		if private {
			id = base64.RawURLEncoding.EncodeToString([]byte(id))
		}
		version := fmt.Sprint(row["row_version"])
		if strings.HasSuffix(op, "-delete") {
			version = "deleted"
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "people_master", TargetBizCode: id + ":v" + version, HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(hash[:])}, nil
	})
	if e != nil {
		return nil, e
	}
	parts := strings.Split(result.TargetBizCode, ":v")
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid People receipt")
	}
	id := parts[0]
	if private {
		decoded, e := base64.RawURLEncoding.DecodeString(id)
		if e != nil {
			return nil, e
		}
		id = string(decoded)
	}
	row := map[string]any{"id": id}
	if parts[1] == "deleted" {
		row["deleted"] = true
	} else {
		version, e := strconv.ParseInt(parts[1], 10, 64)
		if e != nil {
			return nil, e
		}
		row["row_version"] = version
	}
	return map[string]any{"data": row, "receiptId": result.ReceiptID, "replayed": result.Existing}, nil
}

func (s *Service) peoplePrivate(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, op string, i PeopleInput, who Identity, scope altoc.BasicReadScope) (any, error) {
	if op == "employees-private-update" {
		var generation uint64
		if e := tx.QueryRowContext(ctx, "SELECT generation FROM enterprise_schema_registry WHERE id=1 FOR UPDATE").Scan(&generation); e != nil {
			return nil, e
		}
	}
	table, e := r.Table("people_employees")
	if e != nil {
		return nil, e
	}
	filter, args, e := peopleObjectScope(who.Actor, scope, "")
	if e != nil {
		return nil, e
	}
	args = append(args, i.ID)
	query := "SELECT row_version FROM " + table + " WHERE " + filter + " AND BINARY employee_uid=BINARY ? AND archived_at IS NULL"
	if op == "employees-private-update" {
		query += " FOR UPDATE"
	}
	var version int64
	if e = tx.QueryRowContext(ctx, query, args...).Scan(&version); e == sql.ErrNoRows {
		return nil, httperror.New(404, "people_object_not_found", "Object unavailable")
	} else if e != nil {
		return nil, e
	}
	if op == "employees-private-view" {
		data, e := people.EnterprisePrivateViewTx(ctx, tx, r.Table, i.ID, version)
		return map[string]any{"data": data}, e
	}
	return s.peopleWrite(ctx, tx, r, op, i, who)
}
