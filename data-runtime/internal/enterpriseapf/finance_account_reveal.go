package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	accountNoRevealOperation = "accounts-reveal-account-no"
	accountNoSecretType      = "bank_account_number"
	accountNoOwnerType       = "finance_bank_account"
	// One person may look at this many full account numbers per hour. Attempts
	// count, including ones the vault then fails; refused-by-limit ones do not.
	accountNoRevealHourlyLimit = 20
)

// AccountNoAccess carries the request facts the vault records with each reveal.
// They arrive inside the signed command payload: the Host derives them from its
// own trusted request context, and the browser body can never supply them.
type AccountNoAccess struct{ RequestIP, UserAgent string }

// AccountNoVault is the Console vault's owner-bound custody reveal. It is an
// in-process typed dependency (ADR-018a D11); Finance never reads vault tables.
type AccountNoVault func(ctx context.Context, secretCode, secretType, ownerType, ownerKey, actor, reason string, access AccountNoAccess) (string, error)

func (s *Service) ConfigureAccountNoVault(vault AccountNoVault) { s.accountNoVault = vault }

// AccountNoSecretCode is the only vault code an account may point at. The
// reveal derives it from the account code instead of trusting the stored
// reference, so an edited reference can never select another secret.
func AccountNoSecretCode(accountCode string) string {
	return "finance.bank-account." + accountCode + ".account-no"
}

func validateAccountNoReveal(i FinanceInput) error {
	if !financeCode.MatchString(i.Code) || i.Page != 0 || i.PageSize != 0 || i.Search != "" || i.Status != "" || i.AccountCode != "" || i.StartDate != "" || i.EndDate != "" || len(i.Payload) != 3 {
		return financeInvalid()
	}
	reason, ok := i.Payload["reason"].(string)
	if !ok || !stringValue(reason, 200, false) || len([]rune(reason)) < 4 {
		return financeInvalid()
	}
	ip, ok := i.Payload["clientIp"].(string)
	if !ok || net.ParseIP(ip) == nil {
		return financeInvalid()
	}
	if agent, ok := i.Payload["userAgent"].(string); !ok || !stringValue(agent, 255, false) && agent != "" {
		return financeInvalid()
	}
	return nil
}

// FinanceRevealAccountNo shows one account's full number to a person holding
// bank_accounts:reveal-account-no. It is deliberately not an idempotent
// command: every call is a new audited access and nothing is stored for replay.
func (s *Service) FinanceRevealAccountNo(ctx context.Context, i FinanceInput, who Identity) (any, error) {
	if e := validateAccountNoReveal(i); e != nil {
		return nil, e
	}
	access := AccountNoAccess{RequestIP: i.Payload["clientIp"].(string), UserAgent: i.Payload["userAgent"].(string)}
	if who.Actor == "" || who.Tenant != s.binding.Key.Tenant || who.Deployment != s.binding.Domains["finance"].OwnerDeployment || who.Client != "enterprise.runtime" {
		return nil, httperror.New(403, "finance_identity_invalid", "Invalid writer")
	}
	if s.accountNoVault == nil {
		return nil, httperror.New(503, "finance_account_vault_unavailable", "Account number vault is unavailable")
	}
	reason := i.Payload["reason"].(string)
	req, e := s.request("finance", enterprise.Write)
	if e != nil {
		return nil, e
	}
	tx, resolved, e := s.registry.BeginWriteTransaction(ctx, req)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	table, e := resolved[0].Table("finance_bank_account")
	if e != nil {
		return nil, e
	}
	audit, e := resolved[0].Table("finance_audit_log")
	if e != nil {
		return nil, e
	}
	var id int64
	var ref sql.NullString
	if e = tx.QueryRowContext(ctx, "SELECT id,account_no_secret_ref FROM "+table+" WHERE BINARY code=BINARY ? AND deleted_at IS NULL FOR SHARE", i.Code).Scan(&id, &ref); e == sql.ErrNoRows {
		return nil, httperror.New(404, "finance_object_not_found", "Object unavailable")
	} else if e != nil {
		return nil, e
	}
	if !ref.Valid || strings.TrimSpace(ref.String) == "" {
		return nil, httperror.New(404, "finance_account_no_absent", "No full account number is stored for this account")
	}
	secretCode := AccountNoSecretCode(i.Code)
	if ref.String != "hzybase://vault/"+secretCode {
		return nil, httperror.New(409, "finance_account_no_ref_invalid", "Account number reference does not belong to this account")
	}
	// Serialize one person's reveals so the hourly count cannot be raced past.
	digest := sha256.Sum256([]byte(who.Tenant + "|" + who.Actor))
	lock := "hzy-fin-reveal-" + hex.EncodeToString(digest[:16])
	var locked sql.NullInt64
	if e = tx.QueryRowContext(ctx, "SELECT GET_LOCK(?,5)", lock).Scan(&locked); e != nil || locked.Int64 != 1 {
		return nil, httperror.New(503, "finance_account_vault_unavailable", "Account number vault is unavailable")
	}
	// Named locks belong to the pooled connection, not the transaction: release
	// while the transaction still owns the connection, on every path.
	released := false
	release := func() {
		if !released {
			released = true
			_, _ = tx.ExecContext(context.WithoutCancel(ctx), "DO RELEASE_LOCK(?)", lock)
		}
	}
	defer release()
	var recent int
	if e = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+audit+" WHERE entity_type='bank_account' AND action='reveal_account_no' AND BINARY operator_uid=BINARY ? AND created_at>=DATE_SUB(CURRENT_TIMESTAMP(3),INTERVAL 1 HOUR)", who.Actor).Scan(&recent); e != nil {
		return nil, e
	}
	// The business audit is committed before the vault is asked, so plaintext is
	// never returned without it; the vault writes its own access log with the result.
	entry, _ := json.Marshal(map[string]any{"reason": reason})
	action := "reveal_account_no"
	if recent >= accountNoRevealHourlyLimit {
		action = "reveal_account_no_rate_limited"
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO "+audit+"(entity_type,entity_id,entity_code,action,new_value,operator_uid,operator_ip,channel,request_id) VALUES ('bank_account',?,?,?,?,?,?,'user',?)", id, i.Code, action, string(entry), who.Actor, access.RequestIP, who.RequestID); e != nil {
		return nil, e
	}
	release()
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	if recent >= accountNoRevealHourlyLimit {
		return nil, httperror.New(429, "finance_account_no_reveal_rate_limited", "Too many account numbers viewed; try again later")
	}
	value, e := s.accountNoVault(ctx, secretCode, accountNoSecretType, accountNoOwnerType, i.Code, who.Actor, reason, access)
	if e != nil {
		var known httperror.Error
		if errors.As(e, &known) && known.Status == 404 {
			return nil, httperror.New(404, "finance_account_no_absent", "No full account number is stored for this account")
		}
		// A vault failure is a dependency failure, never a missing permission.
		return nil, httperror.New(503, "finance_account_vault_unavailable", "Account number vault is unavailable")
	}
	return map[string]any{"data": map[string]any{"code": i.Code, "accountNo": value, "revealedAt": time.Now().UTC().Format(time.RFC3339)}}, nil
}
