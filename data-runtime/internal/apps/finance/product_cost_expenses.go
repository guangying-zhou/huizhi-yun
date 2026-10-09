package finance

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

type productDirectExpenseFact struct {
	Code, ProjectCode, PeriodMonth, Amount, Currency, Status string
}

// Match Finance's current project summary: expense_amount only (not fee_amount),
// all non-canceled, non-deleted entries by expense month, including drafts.
// The consumer must disclose this ledger basis rather than label it cash paid.
func readProductDirectExpenses(ctx context.Context, tx *sql.Tx, projectCode, periodMonth string) ([]productDirectExpenseFact, error) {
	month, err := time.Parse("2006-01", periodMonth)
	if err != nil || month.Year() < 1 || month.Format("2006-01") != periodMonth || !validProductAttributionKey(projectCode, 50) {
		return nil, fmt.Errorf("invalid product expense period or project")
	}
	rows, err := tx.QueryContext(ctx, `SELECT code, project_code, expense_amount, COALESCE(currency_code, ''), status
		FROM finance_expense WHERE BINARY project_code = BINARY ?
		AND expense_date >= ? AND expense_date < ? AND deleted_at IS NULL AND status <> 'canceled'
		ORDER BY BINARY code`, projectCode, month.Format("2006-01-02"), month.AddDate(0, 1, 0).Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []productDirectExpenseFact{}
	for rows.Next() {
		fact := productDirectExpenseFact{PeriodMonth: periodMonth}
		if err := rows.Scan(&fact.Code, &fact.ProjectCode, &fact.Amount, &fact.Currency, &fact.Status); err != nil {
			return nil, err
		}
		result = append(result, fact)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, rows.Close()
}
