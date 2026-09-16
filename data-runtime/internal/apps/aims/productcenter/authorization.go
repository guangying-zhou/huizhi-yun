package productcenter

import (
	"context"
	"database/sql"
	"strings"
	"unicode/utf8"
)

// AuthorizationQuery is implemented by *sql.DB and *sql.Tx. Mutation callers
// lock the product root before reading these facts in their command transaction.
type AuthorizationQuery interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

// AuthorizationFacts contains only facts for the verified actor, never the full
// member directory. This is input to Foundation/Console, not an action grant.
type AuthorizationFacts struct {
	ProductCode string `json:"product_code"`
	ActorUID    string `json:"actor_uid"`
	Status      string `json:"status"`
	Revision    uint64 `json:"revision"`
	IsMember    bool   `json:"is_member"`
	IsManager   bool   `json:"is_manager"`
}

func LoadAuthorizationFacts(ctx context.Context, query AuthorizationQuery, productCode, actorUID string) (AuthorizationFacts, error) {
	var facts AuthorizationFacts
	if productCode == "" || productCode != strings.TrimSpace(productCode) || utf8.RuneCountInString(productCode) > 64 {
		return facts, &RuleError{Code: "invalid_product_code", Message: "product code is required and must not exceed 64 characters"}
	}
	if actorUID == "" || actorUID != strings.TrimSpace(actorUID) || utf8.RuneCountInString(actorUID) > 64 {
		return facts, &RuleError{Code: "invalid_actor", Message: "verified actor is required"}
	}
	// UTC_TIMESTAMP is constant within the statement. The inclusive start and
	// exclusive expiry apply equally to managers, contributors and viewers.
	err := query.QueryRowContext(ctx, `
		SELECT w.product_code, w.status, w.revision,
		  EXISTS (SELECT 1 FROM product_members m WHERE m.product_code = w.product_code
		    AND m.uid = ? AND m.status = 'active'
		    AND m.valid_from <= UTC_TIMESTAMP(3)
		    AND (m.valid_until IS NULL OR m.valid_until > UTC_TIMESTAMP(3))),
		  EXISTS (SELECT 1 FROM product_members m WHERE m.product_code = w.product_code
		    AND m.uid = ? AND m.relation_type = 'manager' AND m.status = 'active'
		    AND m.valid_from <= UTC_TIMESTAMP(3)
		    AND (m.valid_until IS NULL OR m.valid_until > UTC_TIMESTAMP(3)))
		FROM product_workspaces w WHERE w.product_code = ?`, actorUID, actorUID, productCode).
		Scan(&facts.ProductCode, &facts.Status, &facts.Revision, &facts.IsMember, &facts.IsManager)
	if err != nil {
		return AuthorizationFacts{}, err
	}
	facts.ActorUID = actorUID
	return facts, nil
}
