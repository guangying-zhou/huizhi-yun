package finance

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
)

var errProductCostRevisionConflict = errors.New("product cost attribution revision conflict")

// The caller must authorize the entire project/month and bind actorUID to the
// verified user before opening this transaction. Commit with the caller-owned
// command receipt, or roll back on any error. No independently committed write.
func replaceProductCostAttribution(ctx context.Context, tx *sql.Tx, rules productCostAttributionRules, expectedRevision int64, actorUID string) error {
	if expectedRevision < 0 || expectedRevision == math.MaxInt64 || rules.Revision != expectedRevision+1 {
		return errProductCostRevisionConflict
	}
	if !validProductAttributionKey(actorUID, 64) {
		return errors.New("invalid product cost attribution actor")
	}
	// Reuse exactly the calculation validation; zero is only a validation input,
	// never a stored financial fact or a claim about actual cost currency.
	validated, err := distributeProductCost("0.00", "CNY", rules)
	if err != nil {
		return err
	}
	shares := make([]productCostShare, 0, len(validated.Products))
	for _, product := range validated.Products {
		shares = append(shares, productCostShare{ProductCode: product.ProductCode, BasisPoints: product.BasisPoints})
	}
	encoded, err := json.Marshal(shares)
	if err != nil {
		return err
	}
	// Also serializes simultaneous first revisions (no pre-existing row to lock).
	if _, err := tx.ExecContext(ctx, `INSERT INTO product_cost_attribution_head(project_code, period_month, revision)
		VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE revision = revision`, rules.ProjectCode, rules.PeriodMonth); err != nil {
		return err
	}
	var current int64
	if err := tx.QueryRowContext(ctx, `SELECT revision FROM product_cost_attribution_head
		WHERE project_code = ? AND period_month = ? FOR UPDATE`, rules.ProjectCode, rules.PeriodMonth).Scan(&current); err != nil {
		return err
	}
	if current != expectedRevision {
		return errProductCostRevisionConflict
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO product_cost_attribution_revision
		(project_code, period_month, revision, evidence_ref, shares_json, total_basis_points, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, rules.ProjectCode, rules.PeriodMonth, rules.Revision,
		rules.EvidenceRef, string(encoded), 10000-validated.UnassignedBasisPoints, actorUID); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE product_cost_attribution_head SET revision = ?
		WHERE project_code = ? AND period_month = ?`, rules.Revision, rules.ProjectCode, rules.PeriodMonth)
	return err
}

// The supplied transaction establishes the caller's read snapshot. A single
// join binds current-head selection to immutable history without a torn read.
// sql.ErrNoRows means no configured rules, not a ready zero-cost result.
func readProductCostAttribution(ctx context.Context, tx *sql.Tx, projectCode, periodMonth string) (productCostAttributionRules, error) {
	rules := productCostAttributionRules{ProjectCode: projectCode, PeriodMonth: periodMonth, Revision: 1, EvidenceRef: "read-validation"}
	if _, err := distributeProductCost("0.00", "CNY", rules); err != nil {
		return productCostAttributionRules{}, err
	}
	var encoded []byte
	var storedTotal int
	err := tx.QueryRowContext(ctx, `SELECT r.revision, r.evidence_ref, r.shares_json, r.total_basis_points
		FROM product_cost_attribution_head h
		JOIN product_cost_attribution_revision r ON r.project_code = h.project_code
		AND r.period_month = h.period_month AND r.revision = h.revision
		WHERE h.project_code = ? AND h.period_month = ?`, projectCode, periodMonth).
		Scan(&rules.Revision, &rules.EvidenceRef, &encoded, &storedTotal)
	if err != nil {
		return productCostAttributionRules{}, err
	}
	if err := json.Unmarshal(encoded, &rules.Shares); err != nil {
		return productCostAttributionRules{}, err
	}
	validated, err := distributeProductCost("0.00", "CNY", rules)
	if err != nil {
		return productCostAttributionRules{}, err
	}
	if storedTotal != 10000-validated.UnassignedBasisPoints {
		return productCostAttributionRules{}, errors.New("product cost attribution stored total mismatch")
	}
	return rules, nil
}
