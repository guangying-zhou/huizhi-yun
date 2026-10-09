package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Balance register (W1 §4.2): every registration is one append-only entry; the
// day's shown value is the amount registered last. Registering again never
// overwrites history.

func balanceEntryUnavailable() error {
	return httperror.New(503, "finance_balance_entry_unavailable", "Balance register is not installed")
}

func validateBalanceEntryInput(op string, i FinanceInput) error {
	if !financeCode.MatchString(i.AccountCode) || i.Code != "" || i.Search != "" || i.Status != "" || i.EndDate != "" {
		return financeInvalid()
	}
	if op == "balance-entries-list" {
		if !dateValid(i.StartDate) || len(i.Payload) != 0 || i.Page < 1 || i.Page > 1000000 || i.PageSize < 1 || i.PageSize > 100 {
			return financeInvalid()
		}
		return nil
	}
	if i.StartDate != "" || i.Page != 0 || i.PageSize != 0 {
		return financeInvalid()
	}
	for k, v := range i.Payload {
		switch k {
		case "balanceDate":
			s, ok := v.(string)
			if !ok || !dateValid(s) {
				return financeInvalid()
			}
		case "balanceAmount":
			// Signed: a loan account's balance is negative.
			s, ok := v.(string)
			if !ok || !decimalValid(strings.TrimPrefix(s, "-"), 18, 2) || s == "-" {
				return financeInvalid()
			}
		case "note":
			if !stringValue(v, 500, true) {
				return financeInvalid()
			}
		default:
			return financeInvalid()
		}
	}
	if i.Payload["balanceDate"] == nil || i.Payload["balanceAmount"] == nil {
		return financeInvalid()
	}
	return nil
}

type balanceTables struct{ account, entry, snapshot, audit string }

func (s *Service) balanceTables(ctx context.Context, tx *sql.Tx, r enterprise.Resolved) (balanceTables, error) {
	var t balanceTables
	var e error
	if t.account, e = r.Table("finance_bank_account"); e != nil {
		return t, e
	}
	if t.snapshot, e = r.Table("finance_account_balance_snapshot"); e != nil {
		return t, e
	}
	if t.audit, e = r.Table("finance_audit_log"); e != nil {
		return t, e
	}
	if t.entry, e = r.Table("finance_account_balance_entry"); e != nil {
		return t, balanceEntryUnavailable()
	}
	if has, e := financeHasColumn(ctx, tx, t.snapshot, "entry_count"); e != nil {
		return t, e
	} else if !has {
		return t, balanceEntryUnavailable()
	}
	return t, nil
}

func balanceIdentity(s *Service, who Identity) error {
	if who.Actor == "" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["finance"].OwnerDeployment || who.Client != "enterprise.runtime" {
		return httperror.New(403, "finance_identity_invalid", "Invalid writer")
	}
	return nil
}

// FinanceBalanceEntries lists every registration of one account on one day.
func (s *Service) FinanceBalanceEntries(ctx context.Context, i FinanceInput, who Identity) (any, error) {
	if e := validateBalanceEntryInput("balance-entries-list", i); e != nil {
		return nil, e
	}
	if e := balanceIdentity(s, who); e != nil {
		return nil, e
	}
	req, e := s.request("finance", enterprise.Read)
	if e != nil {
		return nil, e
	}
	tx, resolved, e := s.registry.BeginSnapshotReadTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	t, e := s.balanceTables(ctx, tx, resolved[0])
	if e != nil {
		return nil, e
	}
	var account int64
	if e = tx.QueryRowContext(ctx, "SELECT id FROM "+t.account+" WHERE BINARY code=BINARY ? AND deleted_at IS NULL", i.AccountCode).Scan(&account); e == sql.ErrNoRows {
		return nil, httperror.New(404, "finance_object_not_found", "Object unavailable")
	} else if e != nil {
		return nil, e
	}
	var total int64
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+t.entry+" WHERE bank_account_id=? AND balance_date=?", account, i.StartDate).Scan(&total); e != nil {
		return nil, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT id,CAST(balance_date AS CHAR),CAST(balance_amount AS CHAR),currency_code,entry_source,CAST(recorded_at AS CHAR),recorded_by,recorded_by_name,note,is_day_latest FROM "+t.entry+" WHERE bank_account_id=? AND balance_date=? ORDER BY recorded_at DESC,id DESC LIMIT ? OFFSET ?", account, i.StartDate, i.PageSize, (i.Page-1)*i.PageSize)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var id int64
		var date, amount, currency, source, recordedAt string
		var by, name, note sql.NullString
		var latest bool
		if e = rows.Scan(&id, &date, &amount, &currency, &source, &recordedAt, &by, &name, &note, &latest); e != nil {
			return nil, e
		}
		items = append(items, map[string]any{"id": id, "account_code": i.AccountCode, "balance_date": date, "balance_amount": amount, "currency_code": currency, "entry_source": source, "recorded_at": recordedAt, "recorded_by": nullString(by), "recorded_by_name": nullString(name), "note": nullString(note), "is_day_latest": latest})
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

// FinanceBalanceEntryCreate registers one balance. hooks let the migration queue
// resolve its item in the same transaction.
func (s *Service) FinanceBalanceEntryCreate(ctx context.Context, i FinanceInput, who Identity) (any, error) {
	return s.balanceEntryCreate(ctx, i, who, customerHooks{})
}

func (s *Service) balanceEntryCreate(ctx context.Context, i FinanceInput, who Identity, hooks customerHooks) (any, error) {
	if e := validateBalanceEntryInput("balance-entries-create", i); e != nil {
		return nil, e
	}
	if e := balanceIdentity(s, who); e != nil {
		return nil, e
	}
	if who.Key == "" {
		return nil, financeInvalid()
	}
	date, amount := i.Payload["balanceDate"].(string), i.Payload["balanceAmount"].(string)
	note := i.Payload["note"]
	// A balance cannot be registered for a day that has not happened (UTC+14 is
	// the latest calendar day anywhere).
	if date > time.Now().UTC().Add(14*time.Hour).Format("2006-01-02") {
		return nil, httperror.New(409, "finance_balance_date_invalid", "Balance date is in the future")
	}
	req, e := s.request("finance", enterprise.Write)
	if e != nil {
		return nil, e
	}
	tx, resolved, e := s.registry.BeginWriteTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	if hooks.before != nil {
		if e = hooks.before(ctx, tx); e != nil {
			return nil, e
		}
	}
	t, e := s.balanceTables(ctx, tx, resolved[0])
	if e != nil {
		return nil, e
	}
	// The account row lock serializes registrations of one account.
	var account int64
	var currency, status string
	if e = tx.QueryRowContext(ctx, "SELECT id,currency_code,status FROM "+t.account+" WHERE BINARY code=BINARY ? AND deleted_at IS NULL FOR UPDATE", i.AccountCode).Scan(&account, &currency, &status); e == sql.ErrNoRows {
		return nil, httperror.New(404, "finance_object_not_found", "Object unavailable")
	} else if e != nil {
		return nil, e
	}
	if status == "closed" {
		return nil, httperror.New(409, "finance_account_closed", "A closed account takes no new balance")
	}
	// The entry reference is derived from the idempotency key, so a replay meets
	// the unique key instead of adding a second registration.
	digest := sha256.Sum256([]byte(who.Tenant + "|" + who.Actor + "|" + who.Key))
	ref := binary.BigEndian.Uint64(digest[:8]) >> 1
	var existingAmount string
	var existingNote sql.NullString
	var entryID int64
	e = tx.QueryRowContext(ctx, "SELECT id,CAST(balance_amount AS CHAR),note FROM "+t.entry+" WHERE bank_account_id=? AND balance_date=? AND entry_source='manual' AND entry_ref=?", account, date, ref).Scan(&entryID, &existingAmount, &existingNote)
	if e != nil && e != sql.ErrNoRows {
		return nil, e
	}
	replay := e == nil
	if replay {
		var normalized string
		if e = tx.QueryRowContext(ctx, "SELECT CAST(CAST(? AS DECIMAL(18,2)) AS CHAR)", amount).Scan(&normalized); e != nil {
			return nil, e
		}
		wantNote, _ := note.(string)
		if normalized != existingAmount || existingNote.String != wantNote {
			return nil, httperror.New(409, "finance_idempotency_conflict", "Intent changed")
		}
	} else {
		// Strictly later than anything already registered for the day, so a page
		// registration can never tie with another one.
		res, e := tx.ExecContext(ctx, "INSERT INTO "+t.entry+"(bank_account_id,balance_date,balance_amount,currency_code,entry_source,recorded_at,recorded_by,note,entry_ref) SELECT ?,?,?,?,'manual',GREATEST(CURRENT_TIMESTAMP(3),COALESCE((SELECT MAX(x.recorded_at) FROM "+t.entry+" x WHERE x.bank_account_id=? AND x.balance_date=? AND x.entry_source='manual'),'1000-01-01')+INTERVAL 1000 MICROSECOND),?,?,?", account, date, amount, currency, account, date, who.Actor, note, ref)
		if e != nil {
			return nil, e
		}
		if entryID, e = res.LastInsertId(); e != nil {
			return nil, e
		}
		if e = refreshBalanceDay(ctx, tx, t, account, date, "manual", currency, who.Actor); e != nil {
			return nil, e
		}
		entry, _ := json.Marshal(map[string]any{"balanceDate": date, "balanceAmount": amount, "entryId": entryID})
		if _, e = tx.ExecContext(ctx, "INSERT INTO "+t.audit+"(entity_type,entity_id,entity_code,action,new_value,operator_uid,channel,request_id) VALUES ('bank_account',?,?,'balance_entry',?,?,'user',?)", account, i.AccountCode, string(entry), who.Actor, who.RequestID); e != nil {
			return nil, e
		}
	}
	out := map[string]any{"id": entryID, "account_code": i.AccountCode, "balance_date": date}
	var shown string
	var count, ties, distinct int64
	if e = tx.QueryRowContext(ctx, "SELECT CAST(balance_amount AS CHAR),entry_count,latest_tie_count,distinct_amounts FROM "+t.snapshot+" WHERE bank_account_id=? AND snapshot_date=? AND source_type='manual'", account, date).Scan(&shown, &count, &ties, &distinct); e != nil {
		return nil, e
	}
	out["day_balance_amount"], out["entry_count"], out["latest_tie_count"], out["distinct_amounts"] = shown, count, ties, distinct
	if hooks.after != nil && !replay {
		if e = hooks.after(ctx, tx, i.AccountCode); e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"data": out}, nil
}

// refreshBalanceDay applies the shown-value rule to one (account, day, source):
// the entries registered at the latest moment are the source of the day's value.
// Several of them with different amounts cannot be decided here.
func refreshBalanceDay(ctx context.Context, tx *sql.Tx, t balanceTables, account int64, date, source, currency, actor string) error {
	var count, ties, distinct, latestDistinct int64
	var amount sql.NullString
	e := tx.QueryRowContext(ctx, "SELECT COUNT(*),COUNT(DISTINCT balance_amount),COALESCE(SUM(recorded_at=m.latest),0),COUNT(DISTINCT CASE WHEN recorded_at=m.latest THEN balance_amount END),CAST(MAX(CASE WHEN recorded_at=m.latest THEN balance_amount END) AS CHAR) FROM "+t.entry+" e JOIN (SELECT MAX(recorded_at) latest FROM "+t.entry+" WHERE bank_account_id=? AND balance_date=? AND entry_source=?) m WHERE e.bank_account_id=? AND e.balance_date=? AND e.entry_source=?", account, date, source, account, date, source).Scan(&count, &distinct, &ties, &latestDistinct, &amount)
	if e != nil {
		return e
	}
	if latestDistinct != 1 || !amount.Valid {
		return httperror.New(409, "finance_balance_latest_conflict", "The latest registrations of the day disagree")
	}
	if _, e = tx.ExecContext(ctx, "UPDATE "+t.entry+" e JOIN (SELECT MAX(recorded_at) latest FROM "+t.entry+" WHERE bank_account_id=? AND balance_date=? AND entry_source=?) m SET e.is_day_latest=(e.recorded_at=m.latest) WHERE e.bank_account_id=? AND e.balance_date=? AND e.entry_source=?", account, date, source, account, date, source); e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "INSERT INTO "+t.snapshot+"(bank_account_id,snapshot_date,balance_amount,currency_code,source_type,created_by,entry_count,latest_tie_count,distinct_amounts) VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE balance_amount=VALUES(balance_amount),entry_count=VALUES(entry_count),latest_tie_count=VALUES(latest_tie_count),distinct_amounts=VALUES(distinct_amounts)", account, date, amount.String, currency, source, actor, count, ties, distinct)
	return e
}
