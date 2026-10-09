package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The migration queue is one of the two reviewed runtime reads of the source
// ledger (W1 §1.4, §6.2). It never returns a ledger row as a whole: every kind
// has a closed projection (W2 tool contract §10.1).

// MigrationQueueInput is a closed read command.
type MigrationQueueInput struct {
	Options     *MigrationQueryOptions
	ExceptionID string `json:"exceptionId,omitempty"`
	Kind        string `json:"kind"`
	Status      string `json:"status"`
	Search      string `json:"search"`
	Page        int    `json:"page"`
	PageSize    int    `json:"pageSize"`
}

const migrationSourceSystem = "wizbiz"

// Identity keys are namespaced by source table (tool contract: "employee:<id>"
// for wb_employee, "user:<id>" for sys_user). Queue items carry the bare
// employee id of the salesperson, so it is prefixed before any identity lookup.
const migrationEmployeePrefix = "employee:"

// kind → owning domain and the detail_json keys the queue may return.
var migrationKinds = map[string]struct {
	domain string
	detail []string
}{
	"owner_unmatched":                {"altoc", []string{"sourceUserId"}},
	"contact_without_customer":       {"altoc", []string{"sourceUserId"}},
	"contract_contact_mismatch":      {"altoc", []string{"sourceContactId", "contactSourceOrgId"}},
	"contact_orphan":                 {"altoc", []string{"sourceContactId"}},
	"primary_contact_mismatch":       {"altoc", []string{"sourceContactId", "contactSourceOrgId"}},
	"effective_amount_exceeds_total": {"altoc", []string{"totalAmount", "effectiveAmount"}},
	"identity_source_missing":        {"altoc", []string{"referencedBy"}},
	"contract_balance_mismatch":      {"finance", []string{"recomputedAmount", "cachedAmount", "difference"}},
	"balance_without_account":        {"finance", []string{"balanceDate", "entryCount", "latestAmounts", "sourceEntryIds"}},
	"balance_latest_conflict":        {"finance", []string{"balanceDate", "latestAmounts", "sourceEntryIds"}},
}

// Source contact columns shown for an unassigned contact; nothing else of the
// ledger row is ever returned.
var migrationContactFields = []string{"cm_name", "department", "post", "phone", "mobile", "mobile2", "stars", "chief"}

func MigrationQueuePermission(op string) (string, string, bool) {
	switch op {
	case "migration-exceptions-page", "migration-identities-page":
		return "migration_exceptions", "view", true
	}
	return "", "", false
}

func migrationUnavailable() error {
	return httperror.New(503, "migration_ledger_unavailable", "Migration ledger is not installed")
}
func migrationInvalid() error {
	return httperror.New(400, "migration_queue_input_invalid", "Invalid migration queue query")
}

func ValidateMigrationQueueInput(domain, op string, i MigrationQueueInput) error {
	if q := i.Options; q != nil {
		if q.EventsFor != "" && (!regexp.MustCompile(`^(exception:[1-9][0-9]{0,15}|identity:(employee|user):[0-9]{1,20})$`).MatchString(q.EventsFor) || domain == "finance" && !strings.HasPrefix(q.EventsFor, "exception:") || i.Kind != "" || i.Status != "" || i.Search != "" || i.ExceptionID != "" || q.ObjectSearch != "" || q.CreatedFrom != "" || q.CreatedTo != "" || q.Sort != "") {
			return migrationInvalid()
		}
		if op != "migration-exceptions-page" || !stringValue(q.ObjectSearch, 100, true) || q.CreatedFrom != "" && !dateValid(q.CreatedFrom) || q.CreatedTo != "" && !dateValid(q.CreatedTo) || q.CreatedFrom != "" && q.CreatedTo != "" && q.CreatedFrom > q.CreatedTo || q.Sort != "" && q.Sort != "created_desc" && q.Sort != "created_asc" {
			return migrationInvalid()
		}
	}
	if _, _, ok := MigrationQueuePermission(op); !ok || domain != "altoc" && domain != "finance" {
		return migrationInvalid()
	}
	if i.ExceptionID != "" && (domain != "finance" || op != "migration-exceptions-page" || !validCustomerID(i.ExceptionID) || i.Kind != "balance_without_account" || i.Status != "" || i.Search != "") {
		return migrationInvalid()
	}
	if i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 || !stringValue(i.Search, 100, true) {
		return migrationInvalid()
	}
	if op == "migration-identities-page" {
		// Identity matching belongs to Altoc, whose objects carry the owners.
		if domain != "altoc" || i.Kind != "" {
			return migrationInvalid()
		}
		if migrationStatusesValid(i.Status, true) {
			return nil
		}
		return migrationInvalid()
	}
	if i.Kind != "" {
		if k, ok := migrationKinds[i.Kind]; !ok || k.domain != domain {
			return migrationInvalid()
		}
	}
	if !migrationStatusesValid(i.Status, false) {
		return migrationInvalid()
	}
	// Free-text search exists only for the unassigned-contact list.
	if i.Search != "" && i.Kind != "contact_without_customer" {
		return migrationInvalid()
	}
	return nil
}

func (s *Service) migrationTables(ctx context.Context, domain string) (*sql.Tx, map[string]string, error) {
	if who := s.binding.Domains[domain]; who.OwnerDeployment == "" {
		return nil, nil, enterprise.ErrBindingMismatch
	}
	owning, e := s.request(domain, enterprise.Read)
	if e != nil {
		return nil, nil, e
	}
	ledger, e := s.request("migration", enterprise.Read)
	if e != nil {
		return nil, nil, migrationUnavailable()
	}
	tx, resolved, e := s.registry.BeginSnapshotReadTransaction(ctx, owning, ledger)
	if e != nil {
		if errors.Is(e, enterprise.ErrBindingMismatch) {
			return nil, nil, migrationUnavailable()
		}
		return nil, nil, e
	}
	tables := map[string]string{}
	audit, e := resolved[0].Table(domain + "_audit_log")
	if e != nil {
		tx.Rollback()
		return nil, nil, e
	}
	tables["audit"] = audit
	for _, name := range []string{"mig_exception", "mig_source_row", "mig_identity_map", "mig_batch"} {
		if tables[name], e = resolved[1].Table(name); e != nil {
			tx.Rollback()
			return nil, nil, migrationUnavailable()
		}
	}
	return tx, tables, nil
}

func migrationIdentity(who Identity, s *Service, domain string) error {
	if who.Actor == "" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains[domain].OwnerDeployment || who.Client != "enterprise.runtime" {
		return httperror.New(403, "migration_queue_identity_invalid", "Invalid reader")
	}
	return nil
}

// MigrationExceptions pages the open or handled items of one owning domain.
func (s *Service) MigrationExceptions(ctx context.Context, domain string, i MigrationQueueInput, who Identity) (any, error) {
	if e := ValidateMigrationQueueInput(domain, "migration-exceptions-page", i); e != nil {
		return nil, e
	}
	if e := migrationIdentity(who, s, domain); e != nil {
		return nil, e
	}
	tx, t, e := s.migrationTables(ctx, domain)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	if i.Options != nil && i.Options.EventsFor != "" {
		result, err := migrationEvents(ctx, tx, t, domain, i)
		if err != nil {
			return nil, err
		}
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return result, nil
	}
	if i.ExceptionID != "" {
		return migrationBalanceDetails(ctx, tx, t, i)
	}

	// Open counts per kind for the tab badges, restricted to this domain's kinds.
	counts := map[string]int64{}
	for kind, k := range migrationKinds {
		if k.domain == domain {
			counts[kind] = 0
		}
	}
	rows, e := tx.QueryContext(ctx, "SELECT kind,COUNT(*) FROM "+t["mig_exception"]+" WHERE owning_domain=? AND status='open' GROUP BY kind", domain)
	if e != nil {
		return nil, e
	}
	for rows.Next() {
		var kind string
		var n int64
		if e = rows.Scan(&kind, &n); e != nil {
			rows.Close()
			return nil, e
		}
		if _, known := counts[kind]; known {
			counts[kind] = n
		}
	}
	if e = rows.Close(); e != nil {
		return nil, e
	}

	where, args := "e.owning_domain=?", []any{domain}
	if i.Kind != "" {
		where += " AND e.kind=?"
		args = append(args, i.Kind)
	} else {
		// Never list a kind this build has no projection for.
		kinds := []string{}
		for kind, k := range migrationKinds {
			if k.domain == domain {
				kinds = append(kinds, kind)
				args = append(args, kind)
			}
		}
		where += " AND e.kind IN (" + strings.TrimSuffix(strings.Repeat("?,", len(kinds)), ",") + ")"
	}
	if i.Status != "" {
		values := strings.Split(i.Status, ",")
		where += " AND e.status IN (" + strings.TrimSuffix(strings.Repeat("?,", len(values)), ",") + ")"
		for _, value := range values {
			args = append(args, value)
		}
	}
	order := "e.id"
	if q := i.Options; q != nil {
		if q.ObjectSearch != "" {
			where += " AND (LOCATE(?,COALESCE(e.target_key,''))>0 OR LOCATE(?,e.source_pk)>0)"
			args = append(args, q.ObjectSearch, q.ObjectSearch)
		}
		for _, f := range []struct{ value, op string }{{q.CreatedFrom, ">="}, {q.CreatedTo, "<="}} {
			if f.value != "" {
				where += " AND DATE(e.created_at)" + f.op + "?"
				args = append(args, f.value)
			}
		}
		if q.Sort == "created_desc" {
			order = "e.created_at DESC,e.id DESC"
		} else if q.Sort == "created_asc" {
			order = "e.created_at,e.id"
		}
	}
	from := t["mig_exception"] + " e"
	contacts := i.Kind == "contact_without_customer"
	if contacts {
		// The ledger row is joined only for this kind, and only searched through
		// the whitelisted name and phone keys.
		from += " JOIN " + t["mig_source_row"] + " r ON r.id=(SELECT MAX(x.id) FROM " + t["mig_source_row"] + " x WHERE x.source_system=? AND x.source_table=e.source_table AND x.source_pk=e.source_pk)"
		args = append([]any{migrationSourceSystem}, args...)
		if i.Search != "" {
			where += " AND (LOCATE(?,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.row_json,'$.cm_name')),''))>0 OR LOCATE(?,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.row_json,'$.mobile')),''))>0 OR LOCATE(?,COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.row_json,'$.phone')),''))>0)"
			args = append(args, i.Search, i.Search, i.Search)
		}
	}
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+from+" WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	selects := "e.id,e.kind,e.source_table,e.source_pk,e.target_table,e.target_key,e.detail_json,e.status,e.resolved_by,CAST(e.resolved_at AS CHAR),e.row_version,CAST(e.created_at AS CHAR)"
	if contacts {
		selects += ",r.row_json"
	} else {
		selects += ",NULL"
	}
	rows, e = tx.QueryContext(ctx, "SELECT "+selects+" FROM "+from+" WHERE "+where+" ORDER BY "+order+" LIMIT ? OFFSET ?", append(args, i.PageSize, (i.Page-1)*i.PageSize)...)
	if e != nil {
		return nil, e
	}
	items, users := []map[string]any{}, map[string]bool{}
	for rows.Next() {
		var id, version int64
		var kind, sourceTable, sourcePK, status string
		var targetTable, targetKey, resolvedBy, resolvedAt, createdAt sql.NullString
		var detailRaw, rowRaw []byte
		if e = rows.Scan(&id, &kind, &sourceTable, &sourcePK, &targetTable, &targetKey, &detailRaw, &status, &resolvedBy, &resolvedAt, &version, &createdAt, &rowRaw); e != nil {
			rows.Close()
			return nil, e
		}
		var detail map[string]any
		if json.Unmarshal(detailRaw, &detail) != nil {
			detail = nil
		}
		projected := map[string]any{}
		for _, key := range migrationKinds[kind].detail {
			if v, ok := detail[key]; ok {
				projected[key] = v
			}
		}
		item := map[string]any{"id": id, "kind": kind, "source_table": sourceTable, "source_pk": sourcePK, "target_table": nullString(targetTable), "target_key": nullString(targetKey), "detail": projected, "status": status, "resolved_by": nullString(resolvedBy), "resolved_at": nullString(resolvedAt), "row_version": version, "created_at": nullString(createdAt)}
		if contacts {
			var source map[string]any
			contact := map[string]any{}
			if json.Unmarshal(rowRaw, &source) == nil {
				for _, key := range migrationContactFields {
					if v, ok := source[key]; ok {
						contact[key] = v
					}
				}
			}
			item["contact"] = contact
		}
		if uid, ok := projected["sourceUserId"].(string); ok && uid != "" {
			users[uid] = true
		}
		items = append(items, item)
	}
	if e = rows.Close(); e != nil {
		return nil, e
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	names, e := migrationDisplayNames(ctx, tx, t["mig_identity_map"], users)
	if e != nil {
		return nil, e
	}
	for _, item := range items {
		if uid, ok := item["detail"].(map[string]any)["sourceUserId"].(string); ok {
			if name, found := names[uid]; found {
				item["source_user_name"] = name
			}
		}
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize, "openCounts": counts}, nil
}

func migrationDisplayNames(ctx context.Context, tx *sql.Tx, table string, ids map[string]bool) (map[string]string, error) {
	return migrationNamesByNamespace(ctx, tx, table, ids, migrationEmployeePrefix)
}
func migrationNamesByNamespace(ctx context.Context, tx *sql.Tx, table string, ids map[string]bool, prefix string) (map[string]string, error) {
	out := map[string]string{}
	if len(ids) == 0 {
		return out, nil
	}
	args := []any{migrationSourceSystem}
	for id := range ids {
		args = append(args, prefix+id)
	}
	rows, e := tx.QueryContext(ctx, "SELECT source_user_id,display_name FROM "+table+" WHERE source_system=? AND source_user_id IN ("+strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")+")", args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var id, name string
		if e = rows.Scan(&id, &name); e != nil {
			return nil, e
		}
		out[strings.TrimPrefix(id, prefix)] = name
	}
	return out, rows.Err()
}

// MigrationIdentities pages source people with their match state and the number
// of open owner_unmatched items waiting on each of them.
func (s *Service) MigrationIdentities(ctx context.Context, i MigrationQueueInput, who Identity) (any, error) {
	if e := ValidateMigrationQueueInput("altoc", "migration-identities-page", i); e != nil {
		return nil, e
	}
	if e := migrationIdentity(who, s, "altoc"); e != nil {
		return nil, e
	}
	tx, t, e := s.migrationTables(ctx, "altoc")
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	where, args := "m.source_system=?", []any{migrationSourceSystem}
	if i.Status != "" {
		values := strings.Split(i.Status, ",")
		where += " AND m.match_status IN (" + strings.TrimSuffix(strings.Repeat("?,", len(values)), ",") + ")"
		for _, value := range values {
			args = append(args, value)
		}
	}
	if i.Search != "" {
		where += " AND LOCATE(?,m.display_name)>0"
		args = append(args, i.Search)
	}
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t["mig_identity_map"]+" m WHERE "+where, args...).Scan(&total); e != nil {
		return nil, e
	}
	open := "(SELECT COUNT(*) FROM " + t["mig_exception"] + " e WHERE e.owning_domain='altoc' AND e.kind='owner_unmatched' AND e.status='open' AND CONCAT('" + migrationEmployeePrefix + "',JSON_UNQUOTE(JSON_EXTRACT(e.detail_json,'$.sourceUserId')))=m.source_user_id)"
	rows, e := tx.QueryContext(ctx, "SELECT m.source_user_id,m.display_name,m.source_status,m.directory_uid,m.match_status,m.match_basis,m.directory_status,m.matched_by,CAST(m.matched_at AS CHAR),"+open+" FROM "+t["mig_identity_map"]+" m WHERE "+where+" ORDER BY m.id LIMIT ? OFFSET ?", append(args, i.PageSize, (i.Page-1)*i.PageSize)...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id, name, status string
		var sourceStatus, uid, basis, directoryStatus, matchedBy, matchedAt sql.NullString
		var waiting int64
		if e = rows.Scan(&id, &name, &sourceStatus, &uid, &status, &basis, &directoryStatus, &matchedBy, &matchedAt, &waiting); e != nil {
			return nil, e
		}
		items = append(items, map[string]any{"source_user_id": id, "display_name": name, "source_status": nullString(sourceStatus), "directory_uid": nullString(uid), "match_status": status, "match_basis": nullString(basis), "directory_status": nullString(directoryStatus), "matched_by": nullString(matchedBy), "matched_at": nullString(matchedAt), "open_owner_items": waiting})
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	rows.Close()
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize}, nil
}

func nullString(v sql.NullString) any {
	if v.Valid {
		return v.String
	}
	return nil
}

// Detail read is scoped by the Finance migration queue's all permit. Source IDs
// are read from the chosen exception, never accepted as browser row selectors.
func migrationBalanceDetails(ctx context.Context, tx *sql.Tx, t map[string]string, i MigrationQueueInput) (any, error) {
	var batch int64
	var raw []byte
	err := tx.QueryRowContext(ctx, "SELECT batch_id,detail_json FROM "+t["mig_exception"]+" WHERE id=? AND owning_domain='finance' AND kind='balance_without_account' AND source_table='wb_account_balance'", i.ExceptionID).Scan(&batch, &raw)
	if err == sql.ErrNoRows {
		return nil, httperror.New(404, "migration_exception_unavailable", "Item unavailable")
	}
	if err != nil {
		return nil, err
	}
	var detail struct {
		BalanceDate    string   `json:"balanceDate"`
		SourceEntryIDs []string `json:"sourceEntryIds"`
	}
	if json.Unmarshal(raw, &detail) != nil || !dateValid(detail.BalanceDate) || len(detail.SourceEntryIDs) > 10000 {
		return nil, migrationUnavailable()
	}
	if len(detail.SourceEntryIDs) == 0 {
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"data": []map[string]any{}, "total": int64(0), "page": i.Page, "pageSize": i.PageSize}, nil
	}
	ids := []any{migrationSourceSystem, batch}
	for _, id := range detail.SourceEntryIDs {
		if !validCustomerID(id) {
			return nil, migrationUnavailable()
		}
		ids = append(ids, id)
	}
	// Snapshot batch and source table are fixed; later imports cannot supersede the
	// frozen evidence, and IDs from another batch/day/account cannot be displayed.
	where := "source_system=? AND source_snapshot=(SELECT source_snapshot FROM " + t["mig_batch"] + " WHERE id=? AND source_system='wizbiz') AND source_table='wb_account_balance' AND source_pk IN (" + strings.TrimSuffix(strings.Repeat("?,", len(detail.SourceEntryIDs)), ",") + ") AND JSON_UNQUOTE(JSON_EXTRACT(row_json,'$.ba_id'))='0' AND JSON_UNQUOTE(JSON_EXTRACT(row_json,'$.check_date'))=?"
	ids = append(ids, detail.BalanceDate)
	var total int64
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t["mig_source_row"]+" WHERE "+where, ids...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT source_pk,row_json FROM "+t["mig_source_row"]+" WHERE "+where+" ORDER BY source_pk LIMIT ? OFFSET ?", append(ids, i.PageSize, (i.Page-1)*i.PageSize)...)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	operators := map[string]string{}
	users := map[string]bool{}
	for rows.Next() {
		var pk string
		var evidence []byte
		if err = rows.Scan(&pk, &evidence); err != nil {
			rows.Close()
			return nil, err
		}
		var source map[string]any
		if json.Unmarshal(evidence, &source) != nil {
			rows.Close()
			return nil, migrationUnavailable()
		}
		item := map[string]any{"sourceEntryId": pk}
		if uid, ok := source["operator_id"].(string); ok && validCustomerID(uid) {
			operators[pk] = uid
			users[uid] = true
		}
		for _, pair := range [][2]string{{"check_date", "balanceDate"}, {"balance", "amount"}, {"operate_time", "recordedAt"}, {"operator_name", "recordedByName"}} {
			if value, ok := source[pair[0]]; ok {
				if value != nil {
					if _, ok = value.(string); !ok {
						rows.Close()
						return nil, migrationUnavailable()
					}
				}
				item[pair[1]] = value
			}
		}
		items = append(items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	names, e := migrationNamesByNamespace(ctx, tx, t["mig_identity_map"], users, "user:")
	if e != nil {
		return nil, e
	}
	for _, item := range items {
		if name, ok := names[operators[item["sourceEntryId"].(string)]]; ok {
			item["recordedByName"] = name
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"data": items, "total": total, "page": i.Page, "pageSize": i.PageSize}, nil
}

func migrationStatusesValid(value string, identity bool) bool {
	if value == "" {
		return true
	}
	allowed := map[string]bool{"open": true, "resolved": true, "accepted": true, "superseded": true}
	if identity {
		allowed = map[string]bool{"candidate": true, "confirmed": true, "rejected": true, "unmatched": true, "source_missing": true}
	}
	seen := map[string]bool{}
	for _, v := range strings.Split(value, ",") {
		if !allowed[v] || seen[v] {
			return false
		}
		seen[v] = true
	}
	return true
}
