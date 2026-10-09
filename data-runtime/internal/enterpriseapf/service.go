// Package enterpriseapf owns the first-wave APF object samples. No legacy
// adapter, generic table name or caller-supplied SQL enters this service.
package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"github.com/huizhi-yun/data-runtime/internal/projectcost"
	"github.com/huizhi-yun/data-runtime/internal/workflowapproval"
)

type Service struct {
	costCalendar          projectcost.CalendarReader
	approvalReader        workflowapproval.Reader
	financeApprovalReader workflowapproval.FinanceReader
	registry              *enterprise.Registry
	binding               enterprise.Binding
	ownerDirectory        OwnerDirectory
	accountNoVault        AccountNoVault
}
type Identity struct{ Actor, Tenant, Deployment, Client, RequestID, Key string }
type MigrationQueryOptions struct {
	EventsFor    string `json:"eventsFor,omitempty"`
	ObjectSearch string `json:"objectSearch,omitempty"`
	CreatedFrom  string `json:"createdFrom,omitempty"`
	CreatedTo    string `json:"createdTo,omitempty"`
	Sort         string `json:"sort,omitempty"`
}

func MigrationQueryIntent(q *MigrationQueryOptions) []any {
	return []any{q.ObjectSearch, q.CreatedFrom, q.CreatedTo, q.Sort, q.EventsFor}
}

type Input struct {
	MigrationQuery *MigrationQueryOptions `json:"migrationQuery,omitempty"`
	ID             string                 `json:"id"`
	Code           string                 `json:"code"`
	Name           string                 `json:"name"`
	RowVersion     int64                  `json:"rowVersion"`
	Page           int                    `json:"page"`
	PageSize       int                    `json:"pageSize"`
	Search         string                 `json:"search"`
}
type spec struct {
	table, code, name, resource, action string
	soft                                bool
}

var specs = map[string]spec{
	"altoc":   {"altoc_customer", "code", "name", "customer", "edit", true},
	"finance": {"finance_bank_account", "code", "account_name", "bank_accounts", "admin", true},
	"people":  {"people_positions", "position_code", "position_name", "positions", "", false},
}

func Resource(domain string) (string, string, bool) {
	v, ok := specs[domain]
	return v.resource, v.action, ok
}
func New(registry *enterprise.Registry, b enterprise.Binding) (*Service, error) {
	if registry == nil || b.Generation == 0 {
		return nil, enterprise.ErrBindingMismatch
	}
	for domain, d := range b.Domains {
		if _, ok := specs[domain]; ok && !domaininstall.IsAPFDomain(domain, d) {
			return nil, enterprise.ErrBindingMismatch
		}
	}
	return &Service{registry: registry, binding: b}, nil
}
func (s *Service) request(domain string, op enterprise.Operation) (enterprise.ResolveRequest, error) {
	d, ok := s.binding.Domains[domain]
	if !ok {
		return enterprise.ResolveRequest{}, enterprise.ErrBindingMismatch
	}
	return enterprise.ResolveRequest{Key: s.binding.Key, Domain: domain, OwnerDeployment: d.OwnerDeployment, Generation: s.binding.Generation, SchemaVersion: s.binding.SchemaVersion, Operation: op}, nil
}
func ValidateInput(domain, op string, i Input) error {
	_, _, ok := Resource(domain)
	if !ok {
		return httperror.New(403, "apf_domain_invalid", "Unknown domain")
	}
	if op != "list" && op != "view" && op != "save" {
		return httperror.New(400, "apf_input_invalid", "Unknown operation")
	}
	if op == "save" && domain == "people" {
		return httperror.New(403, "apf_people_write_disabled", "People writes are not enabled")
	}
	if op == "list" {
		if i.ID != "" || i.Code != "" || i.Name != "" || i.RowVersion != 0 || i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 || len(i.Search) > 200 || strings.ContainsAny(i.Search, "\x00\r\n") {
			return httperror.New(400, "apf_input_invalid", "Invalid page")
		}
	} else {
		if i.Page != 0 || i.PageSize != 0 || i.Search != "" {
			return httperror.New(400, "apf_input_invalid", "Unexpected page")
		}
		if i.ID != "" {
			n, e := strconv.ParseInt(i.ID, 10, 53)
			if e != nil || n < 1 || strconv.FormatInt(n, 10) != i.ID {
				return httperror.New(400, "apf_input_invalid", "Invalid ID")
			}
		}
		if op == "view" && (i.ID == "" || i.Code != "" || i.Name != "" || i.RowVersion != 0) {
			return httperror.New(400, "apf_input_invalid", "Invalid detail")
		}
		if op == "save" && (!regexp.MustCompile(`^[A-Za-z0-9_-]{1,50}$`).MatchString(i.Code) || strings.TrimSpace(i.Name) != i.Name || i.Name == "" || len([]rune(i.Name)) > 200 || strings.ContainsAny(i.Name, "\x00\r\n") || i.ID == "" && i.RowVersion != 0 || i.ID != "" && i.RowVersion < 1) {
			return httperror.New(400, "apf_input_invalid", "Invalid metadata")
		}
	}
	return nil
}
func scopeSQL(domain, actor string, scope altoc.BasicReadScope) (string, []any, error) {
	if err := scope.Validate(); err != nil {
		return "", nil, err
	}
	if domain != "altoc" {
		if scope.Access != "all" || len(scope.DepartmentCodes) != 0 {
			return "", nil, httperror.New(403, "apf_scope_invalid", "Dictionary/account scope is not authorized")
		}
		return "1=1", nil, nil
	}
	switch scope.Access {
	case "all":
		return "1=1", nil, nil
	case "self":
		return "BINARY owner_uid=BINARY ?", []any{actor}, nil
	case "dept", "self_dept":
		placeholders := strings.TrimSuffix(strings.Repeat("BINARY ?,", len(scope.DepartmentCodes)), ",")
		condition := "BINARY owner_dept_code IN (" + placeholders + ")"
		args := []any{}
		for _, code := range scope.DepartmentCodes {
			args = append(args, code)
		}
		if scope.Access == "self_dept" {
			condition = "(" + condition + " OR BINARY owner_uid=BINARY ?)"
			args = append(args, actor)
		}
		return condition, args, nil
	default:
		return "0=1", nil, nil
	}
}
func (s *Service) Read(ctx context.Context, domain, op string, i Input, actor string, scope altoc.BasicReadScope) (any, error) {
	if err := ValidateInput(domain, op, i); err != nil {
		return nil, err
	}
	req, err := s.request(domain, enterprise.Read)
	if err != nil {
		return nil, err
	}
	tx, resolved, err := s.registry.BeginSnapshotReadTransaction(ctx, req)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	v := specs[domain]
	table, err := resolved[0].Table(v.table)
	if err != nil {
		return nil, err
	}
	where, args, err := scopeSQL(domain, actor, scope)
	if err != nil {
		return nil, err
	}
	if v.soft {
		where += " AND deleted_at IS NULL"
	}
	if op == "view" {
		where += " AND id=?"
		args = append(args, i.ID)
	}
	if i.Search != "" {
		where += " AND " + v.name + " LIKE ?"
		args = append(args, "%"+i.Search+"%")
	}
	var total int64
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE "+where, args...).Scan(&total); err != nil {
		return nil, err
	}
	cols := "id," + v.code + "," + v.name + ",row_version"
	var positionColumns []string
	if domain == "people" {
		// Keep the M1 route and aliases, but share the 09a owning whitelist.
		_, positionColumns = people.MasterColumns("positions-list")
		cols = people.MasterSelect(positionColumns)
	}
	query := "SELECT " + cols + " FROM " + table + " WHERE " + where + " ORDER BY id"
	if op == "list" {
		query += " LIMIT ? OFFSET ?"
		args = append(args, i.PageSize, (i.Page-1)*i.PageSize)
	}
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	items := []any{}
	if domain == "people" {
		positions, e := people.MasterRows(rows, positionColumns)
		if e != nil {
			return nil, e
		}
		for _, row := range positions {
			row["id"] = fmt.Sprint(row["id"])
			row["code"], row["name"], row["rowVersion"] = row["position_code"], row["position_name"], row["row_version"]
			items = append(items, row)
		}
	} else {
		for rows.Next() {
			var id, version int64
			var code, name string
			if err = rows.Scan(&id, &code, &name, &version); err != nil {
				rows.Close()
				return nil, err
			}
			items = append(items, map[string]any{"id": strconv.FormatInt(id, 10), "code": code, "name": name, "rowVersion": version})
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if op == "view" {
		if len(items) != 1 {
			return nil, httperror.New(404, "apf_object_not_found", "Object is unavailable")
		}
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return items[0], nil
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": i.Page, "pageSize": i.PageSize}, nil
}
func (s *Service) Save(ctx context.Context, domain string, i Input, identity Identity, scope altoc.BasicReadScope) (any, error) {
	if err := ValidateInput(domain, "save", i); err != nil {
		return nil, err
	}
	if identity.Actor == "" || identity.Tenant != s.binding.Key.Tenant || identity.Deployment != s.binding.Domains[domain].OwnerDeployment || identity.Client != "enterprise.runtime" || identity.Key == "" {
		return nil, httperror.New(403, "apf_identity_invalid", "Invalid writer")
	}
	req, err := s.request(domain, enterprise.Write)
	if err != nil {
		return nil, err
	}
	tx, resolved, err := s.registry.BeginWriteTransaction(ctx, req)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	v := specs[domain]
	table, err := resolved[0].Table(v.table)
	if err != nil {
		return nil, err
	}
	where, args, err := scopeSQL(domain, identity.Actor, scope)
	if err != nil {
		return nil, err
	}
	if i.ID != "" {
		var id int64
		args = append(args, i.ID)
		// Object scope is rechecked before receipt lookup, including old-key replay.
		if err = tx.QueryRowContext(ctx, "SELECT id FROM "+table+" WHERE ("+where+") AND id=? AND deleted_at IS NULL FOR UPDATE", args...).Scan(&id); err == sql.ErrNoRows {
			return nil, httperror.New(403, "apf_object_forbidden", "Object is not writable")
		} else if err != nil {
			return nil, err
		}
	} else if domain == "altoc" && scope.Access != "all" && scope.Access != "self" && scope.Access != "self_dept" {
		return nil, httperror.New(403, "apf_create_scope_forbidden", "New owner is outside the write scope")
	}
	receiptName, err := resolved[0].Table("service_command_receipt")
	if err != nil {
		return nil, err
	}
	repo, err := integrationoperation.NewReceiptRepository(resolved[0].DB, integrationoperation.WithReceiptTable(receiptName))
	if err != nil {
		return nil, err
	}
	command := map[string]any{"id": i.ID, "code": i.Code, "name": i.Name, "rowVersion": i.RowVersion, "actor": identity.Actor}
	digest, err := integrationoperation.ValidateAndDigestCommand(command)
	if err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(command)
	operationID := uuid.NewHash(sha256.New(), uuid.NameSpaceOID, []byte(domain+"|"+identity.Tenant+"|"+identity.Deployment+"|"+identity.Actor+"|"+identity.Key), 4).String()
	input := integrationoperation.ReceiptCommandInput{TrustedContext: integrationoperation.TrustedContext{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: "enterprise", ServiceClientID: identity.Client, RequestID: identity.RequestID}, SourceDeploymentCode: identity.Deployment, TargetDeploymentCode: identity.Deployment, TargetApp: domain, OperationID: operationID, OperationCode: domain + ".apf.metadata-save.v1", RequiredCapability: domain + ":enterprise-host:execute", IdempotencyKey: identity.Key, CommandSchemaVersion: "v1", CommandSHA256: digest, Command: raw, OriginalActorUID: identity.Actor}
	result, err := repo.ExecuteInTransaction(ctx, tx, input, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		id := i.ID
		if id == "" {
			cols := "code," + v.name + ",created_by,updated_by"
			values := []any{i.Code, i.Name, identity.Actor, identity.Actor}
			marks := "?,?,?,?"
			if domain == "altoc" {
				cols += ",owner_uid"
				marks += ",?"
				values = append(values, identity.Actor)
			}
			r, e := tx.ExecContext(ctx, "INSERT INTO "+table+" ("+cols+") VALUES ("+marks+")", values...)
			if e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
			n, e := r.LastInsertId()
			if e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
			id = strconv.FormatInt(n, 10)
		} else {
			r, e := tx.ExecContext(ctx, "UPDATE "+table+" SET "+v.name+"=?,updated_by=?,row_version=row_version+1 WHERE id=? AND BINARY code=BINARY ? AND row_version=? AND deleted_at IS NULL", i.Name, identity.Actor, id, i.Code, i.RowVersion)
			if e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
			n, _ := r.RowsAffected()
			if n != 1 {
				return integrationoperation.ReceiptBusinessResult{}, httperror.New(409, "apf_version_conflict", "Object version changed")
			}
		}
		audit, e := resolved[0].Table(domain + "_audit_log")
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+" (entity_type,entity_id,entity_code,action,new_value,operator_uid,channel,request_id) VALUES (?,?,?,'metadata-save',?,?,'user',?)", v.resource, id, i.Code, string(raw), identity.Actor, identity.RequestID); e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		summary := sha256.Sum256([]byte(id + "|" + digest))
		return integrationoperation.ReceiptBusinessResult{TargetBizType: v.resource, TargetBizCode: id, HTTPStatus: 200, ResponseSummarySHA256: hex.EncodeToString(summary[:])}, nil
	})
	if errors.Is(err, integrationoperation.ErrIdempotencyPayloadMismatch) {
		return nil, httperror.New(409, "apf_idempotency_conflict", "Intent changed")
	}
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": result.TargetBizCode, "receiptId": result.ReceiptID, "replayed": result.Existing}, nil
}

// Inspect is the bounded scheduler sample, not a new dispatcher. It claims
// nothing, does no network I/O, and cannot run under read/write Registry modes.
func (s *Service) Inspect(ctx context.Context, domain string) (any, error) {
	req, err := s.request(domain, enterprise.Scheduler)
	if err != nil {
		return nil, err
	}
	tx, r, err := s.registry.BeginSchedulerTransaction(ctx, req)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	table, err := r[0].Table("integration_operation")
	if err != nil {
		return nil, err
	}
	var n int
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM (SELECT operation_id FROM "+table+" WHERE status='pending' AND next_attempt_at<=UTC_TIMESTAMP(3) LIMIT 100) apf_due").Scan(&n); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"pendingUpTo100": n}, nil
}
func (s *Service) Authorize(ctx context.Context, domain string, i Input, actor string, scope altoc.BasicReadScope) (any, error) {
	_, err := s.Read(ctx, domain, "view", i, actor, scope)
	var known httperror.Error
	if errors.As(err, &known) && (known.Status == 403 || known.Status == 404) {
		return map[string]any{"allowed": false}, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"allowed": true}, nil
}

var _ = fmt.Sprintf
