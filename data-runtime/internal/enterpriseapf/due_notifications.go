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
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The six families are separate fixed commands, not a caller-selected table/action.
type DueFamily struct{ Domain, LegacyFlag, EnableFlag, Purpose, Resource string }

var DueFamilies = map[string]DueFamily{
	"sales-due":          {"altoc", "HZY_ALTOC_SALES_DUE_NOTIFICATIONS_ENABLED", "HZY_ENTERPRISE_ALTOC_SALES_DUE_ENABLED", "apf_sales_due", "opportunity"},
	"billing-due":        {"altoc", "HZY_ALTOC_RECEIVABLE_DUE_NOTIFICATIONS_ENABLED", "HZY_ENTERPRISE_ALTOC_BILLING_DUE_ENABLED", "apf_billing_due", "receivable"},
	"issuance-due":       {"finance", "HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED", "HZY_ENTERPRISE_FINANCE_ISSUANCE_DUE_ENABLED", "apf_issuance_due", "invoices"},
	"reconciliation-due": {"finance", "HZY_FINANCE_DUE_NOTIFICATIONS_ENABLED", "HZY_ENTERPRISE_FINANCE_RECONCILIATION_DUE_ENABLED", "apf_reconciliation_due", "receipts"},
	"handover-due":       {"people", "HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED", "HZY_ENTERPRISE_PEOPLE_HANDOVER_DUE_ENABLED", "apf_handover_due", "offboarding_tasks"},
	"asset-recovery-due": {"people", "HZY_PEOPLE_OFFBOARDING_NOTIFICATIONS_ENABLED", "HZY_ENTERPRISE_PEOPLE_ASSET_RECOVERY_DUE_ENABLED", "apf_asset_recovery_due", "offboarding_tasks"},
}

type DueOwner struct {
	Enabled             bool `json:"enabled"`
	LegacyOwnerDisabled bool `json:"legacyOwnerDisabled"`
}

func DueOperation(op string) (string, string, bool) {
	for f := range DueFamilies {
		for _, a := range []string{"scan-due", "published", "closure-ack"} {
			if op == f+":"+a {
				return f, a, true
			}
		}
	}
	return "", "", false
}

type DueInput struct {
	EventKey       string `json:"eventKey"`
	NotificationID string `json:"notificationId"`
	RecipientUID   string `json:"recipientUid"`
	State          string `json:"state"`
}
type dueFact struct {
	Kind, Code, UID, Status string
	ID                      uint64
	Due                     sql.NullTime
	Active                  bool
	Resolved                bool
}
type DueCandidate struct {
	ID             uint64 `json:"id"`
	Family         string `json:"family"`
	SourceKind     string `json:"sourceKind"`
	SourceID       uint64 `json:"sourceId"`
	SourceCode     string `json:"sourceCode"`
	RecipientUID   string `json:"recipientUid"`
	DueAt          string `json:"dueAt"`
	EventKey       string `json:"eventKey"`
	ObjectVersion  string `json:"objectVersion"`
	NotificationID string `json:"notificationId"`
	ClosureState   string `json:"closureState"`
	RecoveryOnly   bool   `json:"recoveryOnly"`
}

func dueError(status int, code string) error {
	return httperror.New(status, code, "到期通知处理未完成")
}
func dueUID(uid string) bool {
	return uid != "" && len(uid) <= 64 && uid == strings.TrimSpace(uid) && !strings.EqualFold(uid, "@all") && !strings.ContainsAny(uid, "\x00\r\n")
}
func dueHash(f dueFact) string {
	sum := sha256.Sum256([]byte(f.Kind + "\x00" + f.Code + "\x00" + f.UID + "\x00" + f.Due.Time.UTC().Format(time.RFC3339Nano)))
	return hex.EncodeToString(sum[:])
}
func dueTable(r enterprise.Resolved, name string) (string, error) { return r.Table(name) }
func dueSources(family string) []string {
	switch family {
	case "sales-due":
		return []string{"lead", "opportunity", "sales_task"}
	case "billing-due":
		return []string{"billing_schedule"}
	case "issuance-due":
		return []string{"invoice_request"}
	case "reconciliation-due":
		return []string{"finance_receipt"}
	default:
		return []string{"offboarding_task"}
	}
}

// Each query is fixed here. No free form table, projection, predicate or owner fallback.
func dueQuery(r enterprise.Resolved, family, kind string) (string, error) {
	table, cols, filter := "", "", ""
	switch kind {
	case "lead", "opportunity":
		table = "altoc_" + kind
		cols = "id,code,COALESCE(owner_uid,''),status,next_action_due_at"
		filter = "deleted_at IS NULL"
	case "sales_task":
		table = "altoc_sales_task"
		cols = "id,code,assignee_uid,status,due_at"
		filter = "deleted_at IS NULL"
	case "billing_schedule":
		table = "altoc_billing_schedule"
		cols = "id,code,COALESCE(collection_responsible_uid,''),status,collection_due_at"
		filter = "deleted_at IS NULL AND direction='receivable' AND (unreceived_amount>0 OR status='received')"
	case "invoice_request":
		table = "finance_invoice_request"
		cols = "id,code,COALESCE(issuance_responsible_uid,''),status,issuance_due_at"
		filter = "deleted_at IS NULL"
	case "finance_receipt":
		table = "finance_receipt"
		cols = "id,code,COALESCE(reconciliation_responsible_uid,''),status,reconciliation_due_at"
		filter = "deleted_at IS NULL"
	case "offboarding_task":
		table = "people_offboarding_tasks"
		cols = "id,CAST(id AS CHAR),responsible_uid,status,due_at"
		typ := "handover"
		if family == "asset-recovery-due" {
			typ = "asset_recovery_coordination"
		}
		filter = "task_type='" + typ + "'"
	default:
		return "", dueError(400, "apf_due_source_invalid")
	}
	t, e := dueTable(r, table)
	if e != nil {
		return "", e
	}
	if kind == "lead" || kind == "opportunity" {
		tasks, e := dueTable(r, "altoc_sales_task")
		if e != nil {
			return "", e
		}
		filter += " AND NOT EXISTS(SELECT 1 FROM " + tasks + " st WHERE st.related_type='" + kind + "' AND st.related_id=" + t + ".id AND st.deleted_at IS NULL AND st.status IN ('todo','doing','overdue'))"
	}
	return "SELECT " + cols + " FROM " + t + " WHERE " + filter, nil
}
func classifyDue(f *dueFact) {
	switch f.Kind {
	case "sales_task":
		f.Active = f.Status == "todo" || f.Status == "doing" || f.Status == "overdue"
		f.Resolved = f.Status == "done"
	case "lead":
		f.Active = f.Status == "new" || f.Status == "pending_assign" || f.Status == "following"
		f.Resolved = f.Status == "converted"
	case "opportunity":
		f.Active = f.Status == "active"
		f.Resolved = f.Status == "won" || f.Status == "closed_won"
	case "billing_schedule":
		f.Active = f.Status == "billable" || f.Status == "invoicing" || f.Status == "invoiced" || f.Status == "partially_received"
		f.Resolved = f.Status == "received"
	case "invoice_request":
		f.Active = f.Status == "approved"
		f.Resolved = f.Status == "issued"
	case "finance_receipt":
		f.Active = f.Status == "confirmed" || f.Status == "partially_reconciled"
		f.Resolved = f.Status == "reconciled"
	case "offboarding_task":
		f.Active = f.Status == "pending"
		f.Resolved = f.Status == "completed"
	}
	f.Active = f.Active && f.Due.Valid && dueUID(f.UID)
}
func readDueFact(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, family, kind string, id uint64) (dueFact, error) {
	f := dueFact{Kind: kind, ID: id}
	q, e := dueQuery(r, family, kind)
	if e != nil {
		return f, e
	}
	e = tx.QueryRowContext(ctx, q+" AND id=? FOR UPDATE", id).Scan(&f.ID, &f.Code, &f.UID, &f.Status, &f.Due)
	if errors.Is(e, sql.ErrNoRows) {
		return f, nil
	}
	if e == nil {
		classifyDue(&f)
	}
	return f, e
}
func readDueCheckpoint(ctx context.Context, tx *sql.Tx, table, key string) (DueCandidate, string, error) {
	var c DueCandidate
	var hash string
	var due time.Time
	err := tx.QueryRowContext(ctx, "SELECT id,family,source_kind,source_id,source_code,recipient_uid,due_at,fact_hash,event_key,COALESCE(notification_id,''),COALESCE(closure_state,'') FROM "+table+" WHERE event_key=? FOR UPDATE", key).Scan(&c.ID, &c.Family, &c.SourceKind, &c.SourceID, &c.SourceCode, &c.RecipientUID, &due, &hash, &c.EventKey, &c.NotificationID, &c.ClosureState)
	c.DueAt = due.UTC().Format(time.RFC3339Nano)
	c.ObjectVersion = c.EventKey
	return c, hash, err
}
func (s *Service) Due(ctx context.Context, domain, op string, input DueInput, who Identity, owner DueOwner) (any, error) {
	family, action, ok := DueOperation(op)
	f, registered := DueFamilies[family]
	if !ok || !registered || f.Domain != domain {
		return nil, dueError(400, "apf_due_operation_invalid")
	}
	if who.Client != "enterprise.runtime" || who.Actor != "" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains[domain].OwnerDeployment {
		return nil, dueError(403, "apf_due_identity_invalid")
	}
	if !owner.Enabled || !owner.LegacyOwnerDisabled {
		return nil, dueError(503, "apf_due_owner_disabled")
	}
	req, e := s.request(domain, enterprise.Write)
	if e != nil {
		return nil, e
	}
	tx, rs, e := s.registry.BeginWriteTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	checkpoint, e := r.Table(domain + "_due_checkpoint")
	if e != nil {
		return nil, e
	}
	root, e := r.Table(domain + "_due_cursor")
	if e != nil {
		return nil, e
	}
	if action == "scan-due" {
		if input != (DueInput{}) {
			return nil, dueError(400, "apf_due_input_invalid")
		}
		out, e := scanDue(ctx, tx, r, checkpoint, root, family)
		if e != nil {
			return nil, e
		}
		if e = dueAudit(ctx, tx, r, domain, op, who.RequestID, map[string]any{"candidateCount": len(out.(map[string]any)["items"].([]DueCandidate)), "closureCount": len(out.(map[string]any)["closures"].([]DueCandidate))}); e != nil {
			return nil, e
		}
		if e = tx.Commit(); e != nil {
			return nil, e
		}
		return out, nil
	}
	if len(input.EventKey) > 191 || !regexp.MustCompile(`^apf-due:[a-z-]+:[a-z_]+:[0-9]+:[0-9]+$`).MatchString(input.EventKey) {
		return nil, dueError(400, "apf_due_input_invalid")
	}
	// Resolve immutable identity without a lock, then source before checkpoint. ACK uses the same lock order as scan.
	var kind string
	var id uint64
	e = tx.QueryRowContext(ctx, "SELECT source_kind,source_id FROM "+checkpoint+" WHERE family=? AND event_key=?", family, input.EventKey).Scan(&kind, &id)
	if e != nil {
		return nil, e
	}
	if _, e = readDueFact(ctx, tx, r, family, kind, id); e != nil {
		return nil, e
	}
	c, _, e := readDueCheckpoint(ctx, tx, checkpoint, input.EventKey)
	if e != nil {
		return nil, e
	}
	if action == "published" {
		if input.State != "" || input.RecipientUID != c.RecipientUID || input.NotificationID == "" || len(input.NotificationID) > 64 {
			return nil, dueError(400, "apf_due_ack_invalid")
		}
		if c.NotificationID != "" && c.NotificationID != input.NotificationID {
			return nil, dueError(409, "apf_due_receipt_conflict")
		}
		_, e = tx.ExecContext(ctx, "UPDATE "+checkpoint+" SET notification_id=?,published_at=COALESCE(published_at,UTC_TIMESTAMP(3)) WHERE id=?", input.NotificationID, c.ID)
	} else {
		if input.NotificationID != "" || input.RecipientUID != "" || c.NotificationID == "" || c.ClosureState == "" || c.ClosureState != input.State {
			return nil, dueError(409, "apf_due_closure_invalid")
		}
		_, e = tx.ExecContext(ctx, "UPDATE "+checkpoint+" SET closure_acked_at=COALESCE(closure_acked_at,UTC_TIMESTAMP(3)) WHERE id=?", c.ID)
	}
	if e != nil {
		return nil, e
	}
	if e = dueAudit(ctx, tx, r, domain, op, who.RequestID, map[string]any{"acknowledged": true}); e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"acknowledged": true}, nil
}
func scanDue(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, cp, root, family string) (any, error) {
	// Duplicate INSERT IGNORE takes a shared key lock. Concurrent scans then
	// deadlock upgrading it at FOR UPDATE; a no-op upsert takes the root X lock
	// immediately, for both the first scan and an already-created family.
	_, e := tx.ExecContext(ctx, "INSERT INTO "+root+" (family) VALUES(?) ON DUPLICATE KEY UPDATE family=family", family)
	if e != nil {
		return nil, e
	}
	var cursor string
	var reconcile uint64
	e = tx.QueryRowContext(ctx, "SELECT source_cursor,reconcile_cursor FROM "+root+" WHERE family=? FOR UPDATE", family).Scan(&cursor, &reconcile)
	if e != nil {
		return nil, e
	}
	items := []DueCandidate{}
	closures := []DueCandidate{}
	now := time.Now().UTC()
	// Rotate reconciliation independently of due scans. Published long-lived rows cannot starve changed later rows.
	keys, e := dueKeys(ctx, tx, cp, family, reconcile)
	if e != nil {
		return nil, e
	}
	if len(keys) == 0 {
		reconcile = 0
		keys, e = dueKeys(ctx, tx, cp, family, 0)
		if e != nil {
			return nil, e
		}
	}

	// Only reconciliation/source IDs are read here; source is locked before its checkpoint below.
	for _, key := range keys {
		var kind string
		var id uint64
		if e = tx.QueryRowContext(ctx, "SELECT source_kind,source_id FROM "+cp+" WHERE event_key=?", key).Scan(&kind, &id); e != nil {
			return nil, e
		}
		fact, e := readDueFact(ctx, tx, r, family, kind, id)
		if e != nil {
			return nil, e
		}
		c, hash, e := readDueCheckpoint(ctx, tx, cp, key)
		if e != nil {
			return nil, e
		}
		reconcile = c.ID
		if c.ClosureState == "" && (!fact.Active || dueHash(fact) != hash || fact.Due.Time.After(now)) {
			c.ClosureState = "cancelled"
			if fact.Resolved {
				c.ClosureState = "resolved"
			}
			if _, e = tx.ExecContext(ctx, "UPDATE "+cp+" SET closure_state=? WHERE id=?", c.ClosureState, c.ID); e != nil {
				return nil, e
			}
		}
		if c.NotificationID == "" {
			c.RecoveryOnly = c.ClosureState != ""
			items = append(items, c)
		} else if c.ClosureState != "" {
			closures = append(closures, c)
		}
	}
	// Scan uses rotating (kind,id) keyset, bounded even when earlier rows have already been published.
	parts := strings.Split(cursor, ":")
	startKind := ""
	var startID uint64
	if len(parts) == 2 {
		startKind = parts[0]
		startID, _ = strconv.ParseUint(parts[1], 10, 64)
	}
	count := 0
	last := ""
	for _, kind := range dueSources(family) {
		if kind < startKind {
			continue
		}
		q, e := dueQuery(r, family, kind)
		if e != nil {
			return nil, e
		}
		after := uint64(0)
		if kind == startKind {
			after = startID
		}
		rows, e := tx.QueryContext(ctx, q+" AND id>? ORDER BY id LIMIT ?", after, 20-count)
		if e != nil {
			return nil, e
		}
		facts := []dueFact{}
		for rows.Next() {
			f := dueFact{Kind: kind}
			if e = rows.Scan(&f.ID, &f.Code, &f.UID, &f.Status, &f.Due); e != nil {
				rows.Close()
				return nil, e
			}
			facts = append(facts, f)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
		for _, candidate := range facts {
			count++
			last = kind + ":" + strconv.FormatUint(candidate.ID, 10)
			fact, e := readDueFact(ctx, tx, r, family, kind, candidate.ID)
			if e != nil {
				return nil, e
			}
			if !fact.Active || fact.Due.Time.After(now) {
				continue
			}
			var generation uint64
			var previousKey, previousHash string
			var closed sql.NullTime
			e = tx.QueryRowContext(ctx, "SELECT generation_no,event_key,fact_hash,closure_acked_at FROM "+cp+" WHERE family=? AND source_kind=? AND source_id=? ORDER BY generation_no DESC LIMIT 1 FOR UPDATE", family, kind, fact.ID).Scan(&generation, &previousKey, &previousHash, &closed)
			if e != nil && !errors.Is(e, sql.ErrNoRows) {
				return nil, e
			}
			if e == nil && !closed.Valid {
				continue
			}

			generation++
			key := fmt.Sprintf("apf-due:%s:%s:%d:%d", family, kind, fact.ID, generation)
			_, e = tx.ExecContext(ctx, "INSERT INTO "+cp+" (family,source_kind,source_id,source_code,recipient_uid,due_at,fact_hash,event_key,generation_no) VALUES(?,?,?,?,?,?,?,?,?)", family, kind, fact.ID, fact.Code, fact.UID, fact.Due.Time.UTC(), dueHash(fact), key, generation)
			if e != nil {
				return nil, e
			}
			c, _, e := readDueCheckpoint(ctx, tx, cp, key)
			if e != nil {
				return nil, e
			}
			items = append(items, c)
		}
		if count >= 20 {
			break
		}
	}
	if count < 20 {
		last = ""
	}
	_, e = tx.ExecContext(ctx, "UPDATE "+root+" SET source_cursor=?,reconcile_cursor=? WHERE family=?", last, reconcile, family)
	if e != nil {
		return nil, e
	}
	return map[string]any{"items": items, "closures": closures}, nil
}

// Purpose is bound by the verified caller, not a browser permit or descriptor-selected policy.
func (s *Service) AuthorizeDue(ctx context.Context, domain, viewer, key string) (any, error) {
	if !dueUID(viewer) || len(key) > 191 {
		return nil, dueError(400, "apf_due_descriptor_invalid")
	}
	req, e := s.request(domain, enterprise.Write)
	if e != nil {
		return nil, e
	}
	tx, rs, e := s.registry.BeginWriteTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := rs[0]
	cp, e := r.Table(domain + "_due_checkpoint")
	if e != nil {
		return nil, e
	}
	var family, kind string
	var id uint64
	e = tx.QueryRowContext(ctx, "SELECT family,source_kind,source_id FROM "+cp+" WHERE event_key=?", key).Scan(&family, &kind, &id)
	if errors.Is(e, sql.ErrNoRows) {
		return map[string]any{"allowed": false}, nil
	}
	if e != nil {
		return nil, e
	}
	f, ok := DueFamilies[family]
	if !ok || f.Domain != domain {
		return nil, dueError(403, "apf_due_descriptor_invalid")
	}
	fact, e := readDueFact(ctx, tx, r, family, kind, id)
	if e != nil {
		return nil, e
	}
	c, hash, e := readDueCheckpoint(ctx, tx, cp, key)
	if e != nil {
		return nil, e
	}
	allowed := c.NotificationID != "" && c.ClosureState == "" && c.RecipientUID == viewer && fact.UID == viewer && fact.Active && hash == dueHash(fact)
	return map[string]any{"allowed": allowed}, nil
}

func dueAudit(ctx context.Context, tx *sql.Tx, r enterprise.Resolved, domain, op, request string, counts map[string]any) error {
	table, e := r.Table(domain + "_due_audit")
	if e != nil {
		return e
	}
	raw, e := json.Marshal(counts)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO "+table+"(action,counts,client_code,request_id) VALUES(?,CAST(? AS JSON),'enterprise.runtime',?)", op, string(raw), request)
	return e
}

func dueKeys(ctx context.Context, tx *sql.Tx, cp, family string, after uint64) ([]string, error) {
	rows, e := tx.QueryContext(ctx, "SELECT event_key FROM "+cp+" WHERE family=? AND id>? AND closure_acked_at IS NULL ORDER BY id LIMIT 20", family, after)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	keys := []string{}
	for rows.Next() {
		var k string
		if e = rows.Scan(&k); e != nil {
			return nil, e
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}
