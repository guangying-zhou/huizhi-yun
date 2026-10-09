package wizbiztool

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
)

type rollbackRow struct {
	seal   rowSeal
	id     string
	code   string
	safe   bool
	absent bool
}

// ExecuteRollback never has a force option. Modified/externally referenced
// objects and their parents are retained; ledger and mapping history survive.
func ExecuteRollback(ctx context.Context, target *sql.DB, p Profile, plan Plan, reviewHash string) (ExecutionReceipt, error) {
	if p.Validate() != nil || ReviewPlan(plan, reviewHash) != nil {
		return ExecutionReceipt{}, ErrInput
	}
	e := newEngine(nil, target, nil, p, plan.ProfileSHA256, SnapshotManifest{}, "", nil, plan.IdentitySHA256, plan)
	receipt, err := e.rollback(ctx)
	if err != nil {
		return receipt, err
	}
	vault, err := openRuntimeVault(p)
	if err != nil {
		return receipt, err
	}
	defer vault.Close()
	codes, err := vault.BatchCodes(ctx, p)
	if err != nil {
		return receipt, err
	}
	for _, code := range codes {
		var references int
		if target.QueryRowContext(ctx, "SELECT COUNT(*) FROM finance_bank_account WHERE BINARY code=BINARY ?", code).Scan(&references) != nil {
			return receipt, ErrTarget
		}
		if references != 0 {
			continue
		}
		if err = e.stopped(ctx); err != nil {
			return receipt, err
		}
		if err = vault.Retire(ctx, code, p); err != nil {
			return receipt, err
		}
	}

	return receipt, nil
}
func (e *engine) rollback(ctx context.Context) (receipt ExecutionReceipt, err error) {
	receipt = ExecutionReceipt{BatchCode: e.profile.BatchCode, Mode: "rollback", Status: "failed", Steps: []StepProgress{}}
	defer func() {
		if err != nil {
			receipt.ErrorCode = fixedExecutionError(err)
		}
	}()
	if err = e.stopped(ctx); err != nil {
		return receipt, err
	}
	binding, hash, err := e.profile.RuntimeBinding()
	if err != nil || hash != e.plan.RuntimeConfigSHA256 {
		return receipt, ErrTarget
	}
	conn, err := e.target.Conn(ctx)
	if err != nil {
		return receipt, ErrTarget
	}
	defer conn.Close()
	release, err := migrationlock.Acquire(ctx, conn, e.profile.InstanceID, e.profile.Database)
	if err != nil {
		return receipt, ErrWrite
	}
	defer release()
	if err = CheckTarget(ctx, conn, e.profile, binding); err != nil {
		return receipt, err
	}
	tx, err := conn.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return receipt, ErrWrite
	}
	defer tx.Rollback()
	var batchID int64
	var status, planHash, raw string
	if tx.QueryRowContext(ctx, "SELECT id,status,plan_sha256,scope_json FROM mig_batch WHERE BINARY batch_code=BINARY ? FOR UPDATE", e.profile.BatchCode).Scan(&batchID, &status, &planHash, &raw) != nil || planHash != e.plan.ReviewHash {
		return receipt, ErrStep
	}
	var openingReferences int
	if tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM altoc_billing_schedule s JOIN altoc_contract c ON c.id=s.contract_id JOIN mig_object_map m ON m.target_table='altoc_contract' AND BINARY m.target_key=BINARY c.code AND m.batch_id=? AND m.map_role='primary' WHERE s.plan_type='opening_balance'", batchID).Scan(&openingReferences) != nil {
		return receipt, ErrTarget
	}
	if openingReferences > 0 {
		return receipt, ErrUsed
	}
	if status == "rolled_back" {
		receipt.Status = "rolled_back"
		return receipt, nil
	}
	var scope batchScope
	if json.Unmarshal([]byte(raw), &scope) != nil || scope.Plan.ReviewHash != planHash {
		return receipt, ErrStep
	}
	if scope.VaultUpgrade != nil {
		return receipt, ErrUsed
	}
	rows, err := tx.QueryContext(ctx, "SELECT DISTINCT target_table,target_key FROM mig_object_map WHERE batch_id=? AND disposition='created' AND target_domain IN ('altoc','finance')", batchID)
	if err != nil {
		return receipt, ErrWrite
	}
	objects := map[string]*rollbackRow{}
	for rows.Next() {
		var table, key string
		if rows.Scan(&table, &key) != nil {
			rows.Close()
			return receipt, ErrWrite
		}
		seal, ok := scope.Seals[table+"/"+key]
		if !ok {
			rows.Close()
			return receipt, ErrStep
		}
		objects[table+"/"+key] = &rollbackRow{seal: seal}
	}
	if rows.Err() != nil {
		rows.Close()
		return receipt, ErrWrite
	}
	rows.Close()
	for _, o := range objects {
		current, x := readSeal(ctx, tx, o.seal.Table, o.seal.KeyColumn, o.seal.Key)
		if x != nil { // An already absent row is only accepted after a committed partial rollback.
			if status != "rollback_partial" || !scope.RolledBack[o.seal.Table+"/"+o.seal.Key] {
				return receipt, ErrStep
			}
			o.absent = true
			continue
		}
		o.safe = current.SHA256 == o.seal.SHA256
		var id sql.NullString
		var code sql.NullString
		cols := "`" + o.seal.KeyColumn + "`"
		hasCode := false
		hasID := false
		for _, table := range baselineTables() {
			if table.Physical == o.seal.Table {
				for _, col := range table.Columns {
					hasCode = hasCode || col == "code"
					hasID = hasID || col == "id"
				}
			}
		}
		if hasID {
			cols = "CAST(id AS CHAR)"
		}
		if hasCode {
			cols += ",code"
			if tx.QueryRowContext(ctx, "SELECT "+cols+" FROM `"+o.seal.Table+"` WHERE BINARY `"+o.seal.KeyColumn+"`=BINARY ? FOR UPDATE", o.seal.Key).Scan(&id, &code) != nil {
				return receipt, ErrWrite
			}
		} else {
			if tx.QueryRowContext(ctx, "SELECT "+cols+" FROM `"+o.seal.Table+"` WHERE BINARY `"+o.seal.KeyColumn+"`=BINARY ? FOR UPDATE", o.seal.Key).Scan(&id) != nil {
				return receipt, ErrWrite
			}
		}
		o.id, o.code = id.String, code.String
	}
	checker := newRollbackReferenceChecker(objects)
	// Propagate retention to every referenced parent. References are checked in
	// every installed Altoc/Finance table, not just the migration's write set.
	for changed := true; changed; {
		changed = false
		for _, o := range objects {
			if !o.safe {
				continue
			}
			used, x := checker.used(ctx, tx, o)
			if x != nil {
				return receipt, x
			}
			if used {
				o.safe = false
				changed = true
			}
		}
	}
	keys := []string{}
	for key := range objects {
		keys = append(keys, key)
	}
	customerParents := map[string]string{}
	for _, o := range objects {
		if o.seal.Table == "altoc_customer" && o.safe {
			var parent sql.NullString
			if tx.QueryRowContext(ctx, "SELECT CAST(parent_customer_id AS CHAR) FROM altoc_customer WHERE id=?", o.id).Scan(&parent) != nil {
				return receipt, ErrTarget
			}
			customerParents[o.id] = parent.String
		}
	}
	depth := func(id string) int {
		seen := map[string]bool{}
		n := 0
		for id != "" && !seen[id] {
			seen[id] = true
			id = customerParents[id]
			n++
		}
		return n
	}
	sort.Slice(keys, func(i, j int) bool {
		a, b := objects[keys[i]], objects[keys[j]]
		if a.seal.Table == "altoc_customer" && b.seal.Table == "altoc_customer" {
			return depth(a.id) > depth(b.id)
		}
		return rollbackOrder(a.seal.Table) < rollbackOrder(b.seal.Table)
	})
	// Clear only the same-batch, unchanged customer/contact cycle. Retained
	// customers never lose their current primary contact.
	for _, key := range keys {
		o := objects[key]
		if o.safe && o.seal.Table == "altoc_customer" {
			if _, err = tx.ExecContext(ctx, "UPDATE altoc_customer SET primary_contact_id=NULL WHERE BINARY code=BINARY ?", o.code); err != nil {
				return receipt, ErrWrite
			}
		}
	}
	if scope.RolledBack == nil {
		scope.RolledBack = map[string]bool{}
	}
	for _, key := range keys {
		o := objects[key]
		if o.absent {
			continue
		}
		if !o.safe {
			receipt.Retained++
			receipt.RetainedObjects = append(receipt.RetainedObjects, o.seal)
			continue
		}
		if err = e.stopped(ctx); err != nil {
			return receipt, err
		}
		result, x := tx.ExecContext(ctx, "DELETE FROM `"+o.seal.Table+"` WHERE BINARY `"+o.seal.KeyColumn+"`=BINARY ?", o.seal.Key)
		if x != nil {
			return receipt, ErrWrite
		}
		n, x := result.RowsAffected()
		if x != nil || n != 1 {
			return receipt, ErrStep
		}
		scope.RolledBack[key] = true
	}
	receipt.Status = "rolled_back"
	if receipt.Retained > 0 {
		receipt.Status = "rollback_partial"
	}
	if _, err = tx.ExecContext(ctx, "UPDATE mig_batch SET status=?,scope_json=?,finished_at=UTC_TIMESTAMP(3) WHERE id=? AND plan_sha256=?", receipt.Status, scopeJSON(scope), batchID, planHash); err != nil {
		return receipt, ErrWrite
	}
	if tx.Commit() != nil {
		return receipt, ErrWrite
	}
	return receipt, nil
}
func rollbackOrder(table string) int {
	switch table {
	case "altoc_customer_migration_snapshot", "altoc_contract_migration_snapshot":
		return 0
	case "altoc_contract_party":
		return 1
	case "altoc_contract":
		return 2
	case "finance_account_balance_snapshot":
		return 3
	case "finance_account_balance_entry":
		return 4
	case "altoc_contact":
		return 5
	case "altoc_customer":
		return 6
	case "finance_bank_account":
		return 7
	case "finance_legal_entity":
		return 8
	}
	return 100
}

type rollbackReferenceChecker struct {
	tables          []domaininstall.Table
	known           map[string]bool
	present         map[string]bool
	presenceChecked map[string]bool
	unknown         map[string][]string
	byID            map[string]*rollbackRow
}

func newRollbackReferenceChecker(objects map[string]*rollbackRow) *rollbackReferenceChecker {
	c := &rollbackReferenceChecker{tables: baselineTables(), known: map[string]bool{}, present: map[string]bool{}, presenceChecked: map[string]bool{}, unknown: map[string][]string{}, byID: map[string]*rollbackRow{}}
	for _, table := range c.tables {
		c.known[table.Physical] = true
	}
	for _, o := range objects {
		if o.id != "" {
			c.byID[o.seal.Table+"/"+o.id] = o
		}
	}
	return c
}

// Metadata is scoped to one Serializable transaction under the migration lock.
// Reference rows and mutable safe flags are always read again; no usage verdict is cached.
func rollbackUsed(ctx context.Context, q targetQuery, target *rollbackRow, objects map[string]*rollbackRow) (bool, error) {
	return newRollbackReferenceChecker(objects).used(ctx, q, target)
}
func (c *rollbackReferenceChecker) used(ctx context.Context, q targetQuery, target *rollbackRow) (bool, error) {
	idColumns := map[string][]string{"altoc_customer": {"customer_id", "parent_customer_id", "third_party_customer_id"}, "altoc_contact": {"contact_id", "primary_contact_id"}, "altoc_contract": {"contract_id", "source_contract_id"}, "finance_bank_account": {"bank_account_id", "receiving_bank_account_id", "paying_bank_account_id"}, "altoc_billing_schedule": {"billing_schedule_id"}}
	codeColumns := map[string][]string{"altoc_customer": {"customer_code"}, "altoc_contract": {"contract_code"}, "finance_bank_account": {"bank_account_code", "receiving_bank_account_code", "paying_bank_account_code"}, "finance_legal_entity": {"legal_entity_code", "party_ref_code"}, "altoc_billing_schedule": {"billing_schedule_code", "receivable_plan_code"}}
	for _, table := range c.tables {
		if strings.HasPrefix(table.Physical, "mig_") {
			continue
		}
		if !c.presenceChecked[table.Physical] {
			present, err := baselineTablePresent(ctx, q, table.Physical)
			if err != nil {
				return true, err
			}
			c.present[table.Physical] = present
			c.presenceChecked[table.Physical] = true
		}
		if !c.present[table.Physical] {
			continue
		}
		pk := table.Columns[0]
		for _, col := range table.Columns {
			value := ""
			for _, name := range idColumns[target.seal.Table] {
				if col == name {
					value = target.id
				}
			}
			for _, name := range codeColumns[target.seal.Table] {
				if col == name {
					value = target.code
				}
			}
			if value == "" {
				continue
			}
			query := "SELECT CAST(`" + pk + "` AS CHAR) FROM `" + table.Physical + "` WHERE BINARY `" + col + "`=BINARY ?"
			rows, err := q.QueryContext(ctx, query, value)
			if err != nil {
				return true, ErrTarget
			}
			for rows.Next() {
				var id string
				if rows.Scan(&id) != nil {
					rows.Close()
					return true, ErrTarget
				}
				o := c.byID[table.Physical+"/"+id]
				allowed := o != nil && o.safe
				if !allowed {
					rows.Close()
					return true, nil
				}
			}
			if rows.Err() != nil {
				rows.Close()
				return true, ErrTarget
			}
			rows.Close()
		}
	}
	// Closed relationship column names, with metadata-discovered installed
	// tables. Unknown tables cannot claim same-batch exemption.
	names := append([]string{}, idColumns[target.seal.Table]...)
	names = append(names, codeColumns[target.seal.Table]...)
	for _, column := range names {
		unknown, cached := c.unknown[column]
		if !cached {
			rows, err := q.QueryContext(ctx, "SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME=?", column)
			if err != nil {
				return true, ErrTarget
			}
			unknown = []string{}
			for rows.Next() {
				var table string
				if rows.Scan(&table) != nil || !identifier.MatchString(table) {
					rows.Close()
					return true, ErrTarget
				}
				if !c.known[table] && !strings.HasPrefix(table, "mig_") {
					unknown = append(unknown, table)
				}
			}
			if rows.Err() != nil {
				rows.Close()
				return true, ErrTarget
			}
			rows.Close()
			c.unknown[column] = unknown
		}
		value := target.code
		for _, col := range idColumns[target.seal.Table] {
			if col == column {
				value = target.id
			}
		}
		if value == "" {
			continue
		}
		for _, table := range unknown {
			var count int
			if q.QueryRowContext(ctx, "SELECT COUNT(*) FROM `"+table+"` WHERE BINARY `"+column+"`=BINARY ?", value).Scan(&count) != nil {
				return true, ErrTarget
			}
			if count > 0 {
				return true, nil
			}
		}
	}
	return false, nil
}

func scopeJSON(scope batchScope) string { raw, _ := json.Marshal(scope); return string(raw) }
