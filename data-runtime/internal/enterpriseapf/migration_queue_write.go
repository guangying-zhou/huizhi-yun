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

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Queue writes (W1 §1.5 as revised): Runtime may only UPDATE the fixed work-state
// columns of mig_exception and mig_identity_map, inside the owning domain's
// write transaction. It never inserts or deletes ledger rows and never touches
// the evidence tables. TestMigrationLedgerWritesAreClosed pins the two statements.
const (
	migrationExceptionUpdate = "UPDATE %s SET status=?,resolution_json=?,resolved_by=?,resolved_at=CURRENT_TIMESTAMP(3),row_version=row_version+1 WHERE id=? AND row_version=?"
	migrationIdentityUpdate  = "UPDATE %s SET directory_uid=?,match_status=?,match_basis=?,directory_status=?,matched_by=?,matched_at=CURRENT_TIMESTAMP(3) WHERE source_system=? AND source_user_id=? AND match_status=?"
)

// MigrationResolveInput is a closed command on one queue item.
type MigrationResolveInput struct {
	ID              string `json:"id"`
	ExpectedVersion int64  `json:"expectedVersion"`
	Method          string `json:"method"`
	Reason          string `json:"reason"`
	CustomerID      string `json:"customerId"`
	ContactCode     string `json:"contactCode"`
	// The caller's customer:edit data scope, computed by the Host from its own
	// authorization and bound into the signed command. Required exactly when the
	// method touches a customer.
	CustomerScope *altoc.BasicReadScope `json:"customerScope,omitempty"`
	// record_balance only: the account to register on (required when the item
	// has none) and the amount, which must be one the item itself lists.
	AccountCode string `json:"accountCode"`
	Amount      string `json:"amount"`
}

// MigrationIdentityInput confirms or rejects one source person's match.
type MigrationIdentityInput struct {
	SourceUserID   string `json:"sourceUserId"`
	ExpectedStatus string `json:"expectedStatus"`
	DirectoryUID   string `json:"directoryUid"`
}

// Namespaced identity key written by the migration tool.
var migrationIdentityKey = regexp.MustCompile(`^(employee|user):[0-9]{1,20}$`)

func MigrationResolveIntent(i MigrationResolveInput) []any {
	scope := []any{}
	if i.CustomerScope != nil {
		departments := i.CustomerScope.DepartmentCodes
		if departments == nil {
			departments = []string{}
		}
		scope = []any{i.CustomerScope.Access, departments}
	}
	return []any{i.ID, i.ExpectedVersion, i.Method, i.Reason, i.CustomerID, i.ContactCode, scope, i.AccountCode, i.Amount}
}
func MigrationIdentityIntent(i MigrationIdentityInput) []any {
	return []any{i.SourceUserID, i.ExpectedStatus, i.DirectoryUID}
}

func MigrationQueueWritePermission(op string) (string, string, bool) {
	switch op {
	case "migration-exceptions-resolve", "migration-identities-confirm", "migration-identities-reject", "migration-identities-apply":
		return "migration_exceptions", "resolve", true
	}
	return "", "", false
}

// method → kinds it applies to, source status and target status.
var migrationMethods = map[string]struct {
	kinds    []string
	from, to string
}{
	"accept":          {[]string{"contact_without_customer", "contact_orphan", "contract_contact_mismatch", "primary_contact_mismatch", "effective_amount_exceeds_total", "identity_source_missing", "balance_without_account"}, "open", "accepted"},
	"reopen":          {[]string{"contact_without_customer", "contact_orphan", "contract_contact_mismatch", "primary_contact_mismatch", "effective_amount_exceeds_total", "identity_source_missing", "balance_without_account"}, "accepted", "open"},
	"mark_done":       {[]string{"contact_orphan", "contract_contact_mismatch", "primary_contact_mismatch"}, "open", "resolved"},
	"assign_customer": {[]string{"contact_without_customer"}, "open", "resolved"},
	"link_existing":   {[]string{"contact_without_customer"}, "open", "resolved"},
	"record_balance":  {[]string{"balance_without_account", "balance_latest_conflict"}, "open", "resolved"},
	// Written only by the batch reassignment; never accepted as a resolve method.
	"reassign_owner": {[]string{"owner_unmatched"}, "open", "resolved"},
}

func ValidateMigrationResolveInput(domain string, i MigrationResolveInput) error {
	if domain != "altoc" && domain != "finance" || !validCustomerID(i.ID) || i.ExpectedVersion < 1 || i.ExpectedVersion > 4294967295 || !stringValue(i.Reason, 500, true) {
		return migrationInvalid()
	}
	if _, ok := migrationMethods[i.Method]; !ok || i.Method == "reassign_owner" {
		return migrationInvalid()
	}
	contact := i.Method == "assign_customer" || i.Method == "link_existing"
	if contact != (i.CustomerID != "") || contact && (domain != "altoc" || !validCustomerID(i.CustomerID)) {
		return migrationInvalid()
	}
	if (i.Method == "link_existing") != (i.ContactCode != "") || i.ContactCode != "" && !financeCode.MatchString(i.ContactCode) {
		return migrationInvalid()
	}
	if contact != (i.CustomerScope != nil) {
		return migrationInvalid()
	}
	if i.Method == "record_balance" {
		if domain != "finance" || !decimalValid(strings.TrimPrefix(i.Amount, "-"), 18, 2) || i.AccountCode != "" && !financeCode.MatchString(i.AccountCode) {
			return migrationInvalid()
		}
	} else if i.AccountCode != "" || i.Amount != "" {
		return migrationInvalid()
	}
	if i.CustomerScope != nil {
		if e := i.CustomerScope.Validate(); e != nil || i.CustomerScope.Access == "none" {
			return httperror.New(403, "altoc_customer_scope_denied", "Customer outside authorized scope")
		}
	}
	return nil
}

func ValidateMigrationIdentityInput(op string, i MigrationIdentityInput) error {
	if !migrationIdentityKey.MatchString(i.SourceUserID) {
		return migrationInvalid()
	}
	switch i.ExpectedStatus {
	case "candidate", "unmatched", "rejected", "confirmed":
	default:
		return migrationInvalid()
	}
	if op == "migration-identities-confirm" {
		if i.ExpectedStatus == "confirmed" || ownerShapeInvalid(i.DirectoryUID) || ReservedOwner(i.DirectoryUID) {
			return migrationInvalid()
		}
		return nil
	}
	if op != "migration-identities-reject" || i.DirectoryUID != "" || i.ExpectedStatus == "rejected" {
		return migrationInvalid()
	}
	return nil
}

func (s *Service) migrationPhysical(name string) (string, error) {
	physical := s.binding.Domains["migration"].Tables[name]
	if physical == "" {
		return "", migrationUnavailable()
	}
	return "`" + physical + "`", nil
}

type migrationException struct {
	id, version                  int64
	kind, status, sourcePK, raw  string
	resolution                   map[string]any
	sourceTable, exceptionDomain string
	targetKey                    string
	detail                       map[string]any
}

func lockMigrationException(ctx context.Context, tx *sql.Tx, table, id string) (migrationException, error) {
	var x migrationException
	var resolution, detail []byte
	e := tx.QueryRowContext(ctx, "SELECT id,owning_domain,kind,source_table,source_pk,status,row_version,resolution_json,COALESCE(target_key,''),detail_json FROM "+table+" WHERE id=? FOR UPDATE", id).Scan(&x.id, &x.exceptionDomain, &x.kind, &x.sourceTable, &x.sourcePK, &x.status, &x.version, &resolution, &x.targetKey, &detail)
	if e == sql.ErrNoRows {
		return x, httperror.New(404, "migration_exception_not_found", "Queue item unavailable")
	}
	if e == nil && len(resolution) > 0 {
		_ = json.Unmarshal(resolution, &x.resolution)
	}
	if e == nil && len(detail) > 0 {
		_ = json.Unmarshal(detail, &x.detail)
	}
	return x, e
}

// checkMigrationException applies the closed method table. replay reports that
// this exact command already produced the current state.
func checkMigrationException(x migrationException, domain string, i MigrationResolveInput, who Identity) (replay bool, err error) {
	// An item of the other domain is indistinguishable from a missing one.
	if x.exceptionDomain != domain {
		return false, httperror.New(404, "migration_exception_not_found", "Queue item unavailable")
	}
	method := migrationMethods[i.Method]
	applies := false
	for _, kind := range method.kinds {
		applies = applies || kind == x.kind
	}
	if !applies || migrationKinds[x.kind].domain != domain {
		return false, httperror.New(409, "migration_exception_method_not_applicable", "This handling is not available for the item")
	}
	if x.status == method.to && x.resolution["key"] == who.Key && x.resolution["method"] == i.Method && who.Key != "" {
		return true, nil
	}
	if x.version != i.ExpectedVersion {
		return false, httperror.New(409, "migration_exception_version_conflict", "Queue item changed")
	}
	if x.status != method.from {
		return false, httperror.New(409, "migration_exception_state_conflict", "Queue item is not in the expected state")
	}
	if i.Method == "accept" && x.kind == "effective_amount_exceeds_total" && i.Reason == "" {
		return false, httperror.New(400, "migration_queue_input_invalid", "A reason is required")
	}
	return false, nil
}

func writeMigrationException(ctx context.Context, tx *sql.Tx, table, audit string, x migrationException, i MigrationResolveInput, who Identity, extra map[string]any) error {
	resolution := map[string]any{"method": i.Method, "by": who.Actor, "key": who.Key}
	if i.Reason != "" {
		resolution["reason"] = i.Reason
	}
	for k, v := range extra {
		resolution[k] = v
	}
	raw, _ := json.Marshal(resolution)
	result, e := tx.ExecContext(ctx, fmt.Sprintf(migrationExceptionUpdate, table), migrationMethods[i.Method].to, string(raw), who.Actor, x.id, x.version)
	if e != nil {
		return e
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return httperror.New(409, "migration_exception_version_conflict", "Queue item changed")
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO "+audit+"(entity_type,entity_id,entity_code,action,new_value,operator_uid,channel,request_id) VALUES ('migration_exception',?,?,?,?,?,'user',?)", x.id, x.kind+":"+x.sourcePK, i.Method, string(raw), who.Actor, who.RequestID)
	return e
}

func migrationWriter(who Identity, s *Service, domain string) error {
	if e := migrationIdentity(who, s, domain); e != nil {
		return e
	}
	if who.Key == "" {
		return migrationInvalid()
	}
	return nil
}

// MigrationResolve handles one queue item.
func (s *Service) MigrationResolve(ctx context.Context, domain string, i MigrationResolveInput, who Identity) (any, error) {
	if e := ValidateMigrationResolveInput(domain, i); e != nil {
		return nil, e
	}
	scope := altoc.BasicReadScope{Access: "none"}
	if i.CustomerScope != nil {
		scope = *i.CustomerScope
	}
	if e := migrationWriter(who, s, domain); e != nil {
		return nil, e
	}
	exceptions, e := s.migrationPhysical("mig_exception")
	if e != nil {
		return nil, e
	}
	done := func(x migrationException, status string, extra map[string]any) map[string]any {
		out := map[string]any{"id": x.id, "kind": x.kind, "status": status}
		for k, v := range extra {
			out[k] = v
		}
		return map[string]any{"data": out}
	}
	if i.Method == "assign_customer" {
		return s.migrationAssignCustomer(ctx, exceptions, i, who, scope, done)
	}
	if i.Method == "record_balance" {
		return s.migrationRecordBalance(ctx, exceptions, i, who, done)
	}
	req, e := s.request(domain, enterprise.Write)
	if e != nil {
		return nil, e
	}
	tx, resolved, e := s.registry.BeginWriteTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	audit, e := resolved[0].Table(domain + "_audit_log")
	if e != nil {
		return nil, e
	}
	x, e := lockMigrationException(ctx, tx, exceptions, i.ID)
	if e != nil {
		return nil, e
	}
	replay, e := checkMigrationException(x, domain, i, who)
	if e != nil {
		return nil, e
	}
	extra := map[string]any{}
	if i.Method == "link_existing" {
		extra["contactCode"] = i.ContactCode
		if !replay {
			contact, e := resolved[0].Table("altoc_contact")
			if e != nil {
				return nil, e
			}
			customer, e := resolved[0].Table("altoc_customer")
			if e != nil {
				return nil, e
			}
			var owner, dept string
			if e = tx.QueryRowContext(ctx, "SELECT c.owner_uid,COALESCE(c.owner_dept_code,'') FROM "+contact+" k JOIN "+customer+" c ON c.id=k.customer_id WHERE BINARY k.code=BINARY ? AND k.customer_id=? AND k.deleted_at IS NULL AND c.deleted_at IS NULL FOR SHARE", i.ContactCode, i.CustomerID).Scan(&owner, &dept); e == sql.ErrNoRows {
				return nil, httperror.New(409, "migration_contact_invalid", "Contact does not belong to the customer")
			} else if e != nil {
				return nil, e
			}
			if !altocScopeAllows(scope, who.Actor, owner, dept) {
				return nil, httperror.New(403, "altoc_customer_scope_denied", "Customer outside authorized scope")
			}
		}
	}
	if !replay {
		if e = writeMigrationException(ctx, tx, exceptions, audit, x, i, who, extra); e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return done(x, migrationMethods[i.Method].to, extra), nil
}

// Source contact columns → contact fields the normal create path accepts.
var migrationContactCreate = [][2]string{{"cm_name", "name"}, {"department", "dept_name"}, {"post", "job_title"}, {"phone", "phone"}, {"mobile", "mobile"}, {"mobile2", "alternate_mobile"}, {"weixin_number", "wechat"}, {"address", "mailing_address"}, {"remarks", "remark"}}

func (s *Service) physicalTable(domain, name string) (string, error) {
	physical := s.binding.Domains[domain].Tables[name]
	if physical == "" {
		return "", enterprise.ErrBindingMismatch
	}
	return "`" + physical + "`", nil
}

// migrationAssignCustomer turns an unassigned source contact into a contact of
// the chosen customer through the normal contact-create path, and resolves the
// queue item in that same transaction.
func (s *Service) migrationAssignCustomer(ctx context.Context, exceptions string, i MigrationResolveInput, who Identity, scope altoc.BasicReadScope, done func(migrationException, string, map[string]any) map[string]any) (any, error) {
	sources, e := s.migrationPhysical("mig_source_row")
	if e != nil {
		return nil, e
	}
	contacts, e := s.physicalTable("altoc", "altoc_contact")
	if e != nil {
		return nil, e
	}
	audit, e := s.physicalTable("altoc", "altoc_audit_log")
	if e != nil {
		return nil, e
	}
	// Unlocked look first: it builds the command and answers an exact replay.
	req, e := s.request("altoc", enterprise.Read)
	if e != nil {
		return nil, e
	}
	read, _, e := s.registry.BeginSnapshotReadTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	x, e := lockFreeMigrationException(ctx, read, exceptions, i.ID)
	var rowRaw []byte
	if e == nil {
		e = read.QueryRowContext(ctx, "SELECT row_json FROM "+sources+" WHERE source_system=? AND source_table=? AND source_pk=? ORDER BY id DESC LIMIT 1", migrationSourceSystem, x.sourceTable, x.sourcePK).Scan(&rowRaw)
		if e == sql.ErrNoRows {
			e = httperror.New(409, "migration_contact_source_invalid", "Source contact is unavailable")
		}
	}
	read.Rollback()
	if e != nil {
		return nil, e
	}
	replay, e := checkMigrationException(x, "altoc", i, who)
	if e != nil {
		return nil, e
	}
	if replay {
		return done(x, "resolved", map[string]any{"contactCode": x.resolution["contactCode"]}), nil
	}
	var source map[string]any
	if json.Unmarshal(rowRaw, &source) != nil {
		return nil, httperror.New(409, "migration_contact_source_invalid", "Source contact is unavailable")
	}
	// The contact's content comes from the ledger row, never from the browser.
	payload := map[string]any{}
	for _, pair := range migrationContactCreate {
		if v, ok := source[pair[0]].(string); ok && strings.TrimSpace(v) != "" {
			payload[pair[1]] = strings.TrimSpace(v)
		}
	}
	input := CustomerInput{CustomerID: i.CustomerID, Payload: payload}
	if ValidateCustomerInput("contacts-create", input) != nil {
		// A source value the contact model cannot hold stays in the ledger; it is
		// not truncated to fit.
		return nil, httperror.New(409, "migration_contact_source_invalid", "Source contact cannot be created as is")
	}
	name, _ := payload["name"].(string)
	mobile, _ := payload["mobile"].(string)
	contactCode := ""
	hooks := customerHooks{
		before: func(ctx context.Context, tx *sql.Tx) error {
			locked, e := lockMigrationException(ctx, tx, exceptions, i.ID)
			if e != nil {
				return e
			}
			if _, e = checkMigrationException(locked, "altoc", i, who); e != nil {
				return e
			}
			if locked.status != "open" {
				return httperror.New(409, "migration_exception_state_conflict", "Queue item is not in the expected state")
			}
			x = locked
			var duplicate int
			if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+contacts+" WHERE customer_id=? AND name=? AND COALESCE(mobile,'')=? AND deleted_at IS NULL", i.CustomerID, name, mobile).Scan(&duplicate); e != nil {
				return e
			}
			if duplicate != 0 {
				return httperror.New(409, "migration_contact_duplicate", "The customer already has this contact")
			}
			return nil
		},
		after: func(ctx context.Context, tx *sql.Tx, code string) error {
			contactCode = code
			// Two source facts the create payload has no field for.
			if source["chief"] == "1" {
				if _, e := tx.ExecContext(ctx, "UPDATE "+contacts+" SET is_key_contact=1 WHERE BINARY code=BINARY ?", code); e != nil {
					return e
				}
			}
			if stars, ok := source["stars"].(string); ok {
				if n, e := strconv.Atoi(stars); e == nil && n >= 1 && n <= 6 {
					if has, e := financeHasColumn(ctx, tx, contacts, "star_level"); e != nil {
						return e
					} else if has {
						if _, e = tx.ExecContext(ctx, "UPDATE "+contacts+" SET star_level=? WHERE BINARY code=BINARY ?", n, code); e != nil {
							return e
						}
					}
				}
			}
			return writeMigrationException(ctx, tx, exceptions, audit, x, i, who, map[string]any{"contactCode": code, "customerId": i.CustomerID})
		},
	}
	if _, e = s.customer(ctx, "contacts-create", input, who, scope, hooks); e != nil {
		return nil, e
	}
	return done(x, "resolved", map[string]any{"contactCode": contactCode}), nil
}

func lockFreeMigrationException(ctx context.Context, tx *sql.Tx, table, id string) (migrationException, error) {
	var x migrationException
	var resolution, detail []byte
	e := tx.QueryRowContext(ctx, "SELECT id,owning_domain,kind,source_table,source_pk,status,row_version,resolution_json,COALESCE(target_key,''),detail_json FROM "+table+" WHERE id=?", id).Scan(&x.id, &x.exceptionDomain, &x.kind, &x.sourceTable, &x.sourcePK, &x.status, &x.version, &resolution, &x.targetKey, &detail)
	if e == sql.ErrNoRows {
		return x, httperror.New(404, "migration_exception_not_found", "Queue item unavailable")
	}
	if e == nil && len(resolution) > 0 {
		_ = json.Unmarshal(resolution, &x.resolution)
	}
	if e == nil && len(detail) > 0 {
		_ = json.Unmarshal(detail, &x.detail)
	}
	return x, e
}

// MigrationIdentityDecision confirms or rejects one source person's match.
func (s *Service) MigrationIdentityDecision(ctx context.Context, op string, i MigrationIdentityInput, who Identity) (any, error) {
	if e := ValidateMigrationIdentityInput(op, i); e != nil {
		return nil, e
	}
	if e := migrationWriter(who, s, "altoc"); e != nil {
		return nil, e
	}
	identities, e := s.migrationPhysical("mig_identity_map")
	if e != nil {
		return nil, e
	}
	status, basis, directoryStatus := "rejected", any(nil), any(nil)
	var uid any
	if op == "migration-identities-confirm" {
		// Matching someone's historical objects to yourself needs a second person.
		if i.DirectoryUID == who.Actor {
			return nil, httperror.New(409, "migration_identity_self_match", "A source person cannot be matched to the operator")
		}
		if s.ownerDirectory == nil {
			return nil, httperror.New(503, "apf_owner_directory_unavailable", "Directory is required to confirm a match")
		}
		active, e := s.ownerDirectory(ctx, i.DirectoryUID)
		if e != nil {
			return nil, e
		}
		if !active {
			return nil, httperror.New(409, "migration_identity_target_invalid", "The Directory user is missing or inactive")
		}
		status, basis, directoryStatus, uid = "confirmed", "manual", "active", i.DirectoryUID
	}
	req, e := s.request("altoc", enterprise.Write)
	if e != nil {
		return nil, e
	}
	tx, resolved, e := s.registry.BeginWriteTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	audit, e := resolved[0].Table("altoc_audit_log")
	if e != nil {
		return nil, e
	}
	var current string
	var currentUID sql.NullString
	if e = tx.QueryRowContext(ctx, "SELECT match_status,directory_uid FROM "+identities+" WHERE source_system=? AND source_user_id=? FOR UPDATE", migrationSourceSystem, i.SourceUserID).Scan(&current, &currentUID); e == sql.ErrNoRows {
		return nil, httperror.New(404, "migration_identity_not_found", "Source person unavailable")
	} else if e != nil {
		return nil, e
	}
	out := map[string]any{"data": map[string]any{"source_user_id": i.SourceUserID, "match_status": status, "directory_uid": uid}}
	// Same decision already recorded: answer without writing again.
	if current == status && (status == "rejected" || currentUID.String == i.DirectoryUID) {
		return out, tx.Commit()
	}
	if current == "source_missing" {
		return nil, httperror.New(409, "migration_identity_state_conflict", "This source person cannot be matched")
	}
	if current != i.ExpectedStatus {
		return nil, httperror.New(409, "migration_identity_state_conflict", "Source person changed")
	}
	result, e := tx.ExecContext(ctx, fmt.Sprintf(migrationIdentityUpdate, identities), uid, status, basis, directoryStatus, who.Actor, migrationSourceSystem, i.SourceUserID, i.ExpectedStatus)
	if e != nil {
		return nil, e
	}
	if n, _ := result.RowsAffected(); n != 1 {
		return nil, httperror.New(409, "migration_identity_state_conflict", "Source person changed")
	}
	entry, _ := json.Marshal(map[string]any{"from": current, "to": status, "directoryUid": uid})
	if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+"(entity_type,entity_id,entity_code,action,new_value,operator_uid,channel,request_id) VALUES ('migration_identity',0,?,?,?,?,'user',?)", i.SourceUserID, strings.TrimPrefix(op, "migration-identities-"), string(entry), who.Actor, who.RequestID); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return out, nil
}

// MigrationApplyInput reassigns the open items of one confirmed source person.
type MigrationApplyInput struct {
	SourceUserID string `json:"sourceUserId"`
	Limit        int    `json:"limit"`
	// The caller's own customer:edit and contract:edit scopes, bound into the
	// signed command by the Host.
	CustomerScope altoc.BasicReadScope `json:"customerScope"`
	ContractScope altoc.BasicReadScope `json:"contractScope"`
}

func MigrationApplyIntent(i MigrationApplyInput) []any {
	scope := func(v altoc.BasicReadScope) []any {
		departments := v.DepartmentCodes
		if departments == nil {
			departments = []string{}
		}
		return []any{v.Access, departments}
	}
	return []any{i.SourceUserID, i.Limit, scope(i.CustomerScope), scope(i.ContractScope)}
}

func ValidateMigrationApplyInput(i MigrationApplyInput) error {
	// Owners come from salespeople, i.e. employee keys; operator accounts own nothing.
	if !strings.HasPrefix(i.SourceUserID, migrationEmployeePrefix) || !migrationIdentityKey.MatchString(i.SourceUserID) || i.Limit < 1 || i.Limit > 100 {
		return migrationInvalid()
	}
	for _, scope := range []altoc.BasicReadScope{i.CustomerScope, i.ContractScope} {
		if e := scope.Validate(); e != nil {
			return e
		}
	}
	return nil
}

// MigrationApply hands the open owner_unmatched items of a confirmed source
// person to the matched Directory user, one item per transaction, through the
// normal owner-change commands. A failing item does not stop the others.
func (s *Service) MigrationApply(ctx context.Context, i MigrationApplyInput, who Identity) (any, error) {
	if e := ValidateMigrationApplyInput(i); e != nil {
		return nil, e
	}
	if e := migrationWriter(who, s, "altoc"); e != nil {
		return nil, e
	}
	exceptions, e := s.migrationPhysical("mig_exception")
	if e != nil {
		return nil, e
	}
	identities, e := s.migrationPhysical("mig_identity_map")
	if e != nil {
		return nil, e
	}
	audit, e := s.physicalTable("altoc", "altoc_audit_log")
	if e != nil {
		return nil, e
	}
	tables := map[string]string{}
	for _, name := range []string{"altoc_customer", "altoc_contract"} {
		if tables[name], e = s.physicalTable("altoc", name); e != nil {
			return nil, e
		}
	}
	req, e := s.request("altoc", enterprise.Read)
	if e != nil {
		return nil, e
	}
	read, _, e := s.registry.BeginSnapshotReadTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	var status string
	var uid, confirmedBy sql.NullString
	e = read.QueryRowContext(ctx, "SELECT match_status,directory_uid,matched_by FROM "+identities+" WHERE source_system=? AND source_user_id=?", migrationSourceSystem, i.SourceUserID).Scan(&status, &uid, &confirmedBy)
	type pending struct {
		id, version, targetID, targetVersion int64
		table, key                           string
	}
	var items []pending
	bare := strings.TrimPrefix(i.SourceUserID, migrationEmployeePrefix)
	if e == nil && status == "confirmed" && uid.Valid {
		var rows *sql.Rows
		rows, e = read.QueryContext(ctx, "SELECT id,row_version,COALESCE(target_table,''),COALESCE(target_key,'') FROM "+exceptions+" WHERE owning_domain='altoc' AND kind='owner_unmatched' AND status='open' AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.sourceUserId'))=? ORDER BY id LIMIT ?", bare, i.Limit)
		for e == nil && rows.Next() {
			var p pending
			if e = rows.Scan(&p.id, &p.version, &p.table, &p.key); e == nil {
				items = append(items, p)
			}
		}
		if rows != nil {
			rows.Close()
		}
		for n := range items {
			if table, ok := tables[items[n].table]; ok && e == nil {
				// A missing target is reported per item below, not as a failure of the batch.
				if scanErr := read.QueryRowContext(ctx, "SELECT id,row_version FROM "+table+" WHERE BINARY code=BINARY ? AND deleted_at IS NULL", items[n].key).Scan(&items[n].targetID, &items[n].targetVersion); scanErr != nil && scanErr != sql.ErrNoRows {
					e = scanErr
				}
			}
		}
	}
	read.Rollback()
	if e == sql.ErrNoRows {
		return nil, httperror.New(404, "migration_identity_not_found", "Source person unavailable")
	}
	if e != nil {
		return nil, e
	}
	if status != "confirmed" || !uid.Valid {
		return nil, httperror.New(409, "migration_identity_state_conflict", "The match is not confirmed")
	}
	// Re-checked here, not only at confirmation: the row may have been changed
	// since, or written directly. Nobody hands historical objects to themselves
	// on their own say-so; who runs the batch is not restricted.
	if !confirmedBy.Valid || confirmedBy.String == "" || confirmedBy.String == uid.String {
		return nil, httperror.New(409, "migration_identity_self_match", "The match must be confirmed by someone other than the target user")
	}
	// Checked on every run: a confirmation may be older than the person's status.
	if s.ownerDirectory == nil {
		return nil, httperror.New(503, "apf_owner_directory_unavailable", "Directory is required to assign an owner")
	}
	if active, e := s.ownerDirectory(ctx, uid.String); e != nil {
		return nil, e
	} else if !active {
		return nil, httperror.New(409, "migration_identity_target_invalid", "The Directory user is missing or inactive")
	}
	results := []map[string]any{}
	done := 0
	for _, item := range items {
		result := map[string]any{"id": item.id, "target_table": item.table, "target_key": item.key}
		itemErr := func() error {
			if item.targetID == 0 {
				return httperror.New(409, "migration_target_unavailable", "Target object unavailable")
			}
			x := migrationException{}
			command := MigrationResolveInput{ID: strconv.FormatInt(item.id, 10), ExpectedVersion: item.version, Method: "reassign_owner"}
			digest := sha256.Sum256([]byte(who.Key + "|" + command.ID))
			actor := who
			actor.Key = "mq-" + hex.EncodeToString(digest[:20])
			hooks := customerHooks{
				before: func(ctx context.Context, tx *sql.Tx) error {
					locked, e := lockMigrationException(ctx, tx, exceptions, command.ID)
					if e != nil {
						return e
					}
					if _, e = checkMigrationException(locked, "altoc", command, actor); e != nil {
						return e
					}
					if locked.status != "open" {
						return httperror.New(409, "migration_exception_state_conflict", "Queue item is not in the expected state")
					}
					x = locked
					return nil
				},
				after: func(ctx context.Context, tx *sql.Tx, _ string) error {
					return writeMigrationException(ctx, tx, exceptions, audit, x, command, actor, map[string]any{"assignedTo": uid.String, "confirmedBy": confirmedBy.String, "appliedBy": who.Actor})
				},
			}
			payload := map[string]any{"owner_uid": uid.String, "expectedVersion": float64(item.targetVersion)}
			target := strconv.FormatInt(item.targetID, 10)
			if item.table == "altoc_customer" {
				_, e := s.customer(ctx, "customers-set-owner", CustomerInput{CustomerID: target, Payload: payload}, actor, i.CustomerScope, hooks)
				return e
			}
			_, e := s.contract(ctx, "contracts-set-owner", ContractInput{ID: target, Payload: payload}, actor, i.ContractScope, hooks)
			return e
		}()
		if itemErr == nil {
			result["status"] = "resolved"
			done++
		} else {
			result["status"] = "failed"
			var known httperror.Error
			if errors.As(itemErr, &known) {
				result["code"] = known.Code
			} else {
				// An unexpected failure is not explained to the caller item by item.
				result["code"] = "migration_reassign_failed"
			}
		}
		results = append(results, result)
	}
	remaining, e := s.migrationOpenOwnerItems(ctx, exceptions, bare)
	if e != nil {
		return nil, e
	}
	return map[string]any{"data": map[string]any{"source_user_id": i.SourceUserID, "owner_uid": uid.String, "items": results, "resolved": done, "remaining": remaining}}, nil
}

func (s *Service) migrationOpenOwnerItems(ctx context.Context, exceptions, bare string) (int64, error) {
	req, e := s.request("altoc", enterprise.Read)
	if e != nil {
		return 0, e
	}
	read, _, e := s.registry.BeginSnapshotReadTransaction(ctx, req)
	if e != nil {
		return 0, e
	}
	defer read.Rollback()
	var n int64
	e = read.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+exceptions+" WHERE owning_domain='altoc' AND kind='owner_unmatched' AND status='open' AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.sourceUserId'))=?", bare).Scan(&n)
	return n, e
}

// migrationRecordBalance settles a balance item with one manual registration:
// the day and the candidate amounts come from the item, never from the caller.
func (s *Service) migrationRecordBalance(ctx context.Context, exceptions string, i MigrationResolveInput, who Identity, done func(migrationException, string, map[string]any) map[string]any) (any, error) {
	audit, e := s.physicalTable("finance", "finance_audit_log")
	if e != nil {
		return nil, e
	}
	req, e := s.request("finance", enterprise.Read)
	if e != nil {
		return nil, e
	}
	read, _, e := s.registry.BeginSnapshotReadTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	x, e := lockFreeMigrationException(ctx, read, exceptions, i.ID)
	read.Rollback()
	if e != nil {
		return nil, e
	}
	replay, e := checkMigrationException(x, "finance", i, who)
	if e != nil {
		return nil, e
	}
	account := i.AccountCode
	if x.kind == "balance_latest_conflict" {
		// The item already names its account; the caller cannot move it elsewhere.
		if account != "" && account != x.targetKey {
			return nil, httperror.New(409, "migration_balance_account_invalid", "The item belongs to another account")
		}
		account = x.targetKey
	}
	if account == "" {
		return nil, httperror.New(400, "migration_queue_input_invalid", "An account is required")
	}
	if replay {
		return done(x, "resolved", map[string]any{"accountCode": x.resolution["accountCode"], "amount": x.resolution["amount"]}), nil
	}
	date, _ := x.detail["balanceDate"].(string)
	listed := false
	if amounts, ok := x.detail["latestAmounts"].([]any); ok {
		for _, amount := range amounts {
			listed = listed || amount == i.Amount
		}
	}
	if !dateValid(date) || !listed {
		return nil, httperror.New(409, "migration_balance_amount_invalid", "The amount is not one the item lists")
	}
	extra := map[string]any{"accountCode": account, "amount": i.Amount, "balanceDate": date}
	hooks := customerHooks{
		before: func(ctx context.Context, tx *sql.Tx) error {
			locked, e := lockMigrationException(ctx, tx, exceptions, i.ID)
			if e != nil {
				return e
			}
			if _, e = checkMigrationException(locked, "finance", i, who); e != nil {
				return e
			}
			if locked.status != "open" {
				return httperror.New(409, "migration_exception_state_conflict", "Queue item is not in the expected state")
			}
			x = locked
			return nil
		},
		after: func(ctx context.Context, tx *sql.Tx, _ string) error {
			return writeMigrationException(ctx, tx, exceptions, audit, x, i, who, extra)
		},
	}
	input := FinanceInput{AccountCode: account, Payload: map[string]any{"balanceDate": date, "balanceAmount": i.Amount, "note": "迁移事项 #" + i.ID}}
	if _, e = s.balanceEntryCreate(ctx, input, who, hooks); e != nil {
		return nil, e
	}
	return done(x, "resolved", extra), nil
}
