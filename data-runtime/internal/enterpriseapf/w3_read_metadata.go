package enterpriseapf

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// Reviewed W3 object metadata reader. All names come from the Registry and all
// evidence stays server-side except the fixed source descriptor/display name.
func (s *Service) beginW3Read(ctx context.Context, detail bool) (*sql.Tx, []enterprise.Resolved, map[string]string, error) {
	owning, err := s.request("altoc", enterprise.Read)
	if err != nil {
		return nil, nil, nil, err
	}
	requests := []enterprise.ResolveRequest{owning}
	if detail {
		for _, domain := range []string{"finance", "migration"} {
			b, exists := s.binding.Domains[domain]
			if !exists || b.Read != enterprise.PathUnified {
				continue
			}
			req, e := s.request(domain, enterprise.Read)
			if e != nil {
				return nil, nil, nil, e
			}
			requests = append(requests, req)
		}
	}
	tx, resolved, err := s.registry.BeginSnapshotReadTransaction(ctx, requests...)
	if err != nil {
		return nil, nil, nil, err
	}
	tables := map[string]string{}
	for _, r := range resolved {
		for _, logical := range []string{"mig_object_map", "mig_identity_map", "mig_exception", "mig_batch", "finance_legal_entity", "finance_bank_account", "altoc_customer_migration_snapshot", "altoc_contract_migration_snapshot"} {
			if table, e := r.Table(logical); e == nil {
				tables[logical] = table
			}
		}
	}
	return tx, resolved, tables, nil
}
func w3ObjectMetadata(ctx context.Context, tx *sql.Tx, t map[string]string, kind string, item map[string]any) error {
	snapshot := t["altoc_"+kind+"_migration_snapshot"]
	if snapshot != "" {
		foreign := "customer_id"
		if kind == "contract" {
			foreign = "contract_id"
		}
		fields := []string{"snapshot_at", "source_note", "batch_code"}
		if kind == "customer" {
			fields = append(fields, "contract_count_subtree", "contract_amount_subtree", "contract_count_direct", "contract_amount_direct", "contract_count_3y", "contract_amount_3y", "contract_count_1y", "contract_amount_1y", "contract_count_ytd", "contract_amount_ytd", "receivable_contract_count", "receivable_amount_subtree", "receivable_amount_direct")
		} else {
			fields = append(fields, "remaining_uninvoiced_amount", "remaining_settlement_amount", "settlement_direction")
		}
		// Probe only a declared projection; never return unreviewed snapshot columns.
		columns, err := w3ExistingColumns(ctx, tx, snapshot, nil, fields)
		if err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, "SELECT "+w3Select(columns)+" FROM "+snapshot+" WHERE "+foreign+"=?", item["id"])
		if err != nil {
			return err
		}
		values, err := readFinanceRows(rows, columns)
		if err != nil {
			return err
		}
		if len(values) == 1 {
			item["migration_snapshot"] = values[0]
		}
	}
	if err := w3SourceMetadata(ctx, tx, t, "altoc", "altoc_"+kind, item); err != nil {
		return err
	}
	info, ok := item["source_info"].(map[string]any)
	if !ok {
		return nil
	}
	system, sourceTable, pk := info["system"], info["table"], info["pk"]
	batches := t["mig_batch"]
	var err error
	// The queue records the source salesperson's bare id; the identity table
	// contains the namespaced employee key. Never expose the JSON or identity row.
	exceptions, identities := t["mig_exception"], t["mig_identity_map"]
	if exceptions != "" && identities != "" && item["owner_uid"] == unassignedOwnerReadFilter() {
		var name sql.NullString
		err = tx.QueryRowContext(ctx, "SELECT i.display_name FROM "+exceptions+" e JOIN "+batches+" b ON b.id=e.batch_id LEFT JOIN "+identities+" i ON i.source_system=b.source_system AND i.source_user_id=CONCAT('employee:',JSON_UNQUOTE(JSON_EXTRACT(e.detail_json,'$.sourceUserId'))) WHERE b.source_system=? AND e.owning_domain='altoc' AND e.source_table=? AND e.source_pk=? AND e.target_table=? AND BINARY e.target_key=BINARY ? AND e.kind='owner_unmatched' ORDER BY e.id LIMIT 1", system, sourceTable, pk, "altoc_"+kind, item["code"]).Scan(&name)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if name.Valid {
			item["source_owner_name"] = name.String
		}
	}
	return nil
}

// Fixed descriptor only, after owning-object scope checks. No source JSON or
// cross-object identity facts leave the migration read transaction.
func w3SourceMetadata(ctx context.Context, tx *sql.Tx, t map[string]string, domain, logical string, item map[string]any) error {
	maps, batches := t["mig_object_map"], t["mig_batch"]
	if maps == "" || batches == "" {
		return nil
	}
	var system, sourceTable, pk, batch, imported string
	err := tx.QueryRowContext(ctx, "SELECT m.source_system,m.source_table,m.source_pk,b.batch_code,CAST(m.created_at AS CHAR) FROM "+maps+" m JOIN "+batches+" b ON b.id=m.batch_id AND b.source_system=m.source_system WHERE m.target_domain=? AND m.target_table=? AND BINARY m.target_key=BINARY ? AND m.map_role='primary' AND m.disposition IN ('created','matched_existing') ORDER BY m.id LIMIT 1", domain, logical, item["code"]).Scan(&system, &sourceTable, &pk, &batch, &imported)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	item["source_info"] = map[string]any{"system": system, "table": sourceTable, "pk": pk, "batchCode": batch, "importedAt": imported}
	return nil
}

func w3FinanceSourceMetadata(ctx context.Context, tx *sql.Tx, ledger enterprise.Resolved, item map[string]any) error {
	refs := map[string]string{}
	for _, logical := range []string{"mig_object_map", "mig_batch"} {
		if table, err := ledger.Table(logical); err == nil {
			refs[logical] = table
		}
	}
	return w3SourceMetadata(ctx, tx, refs, "finance", "finance_bank_account", item)
}
