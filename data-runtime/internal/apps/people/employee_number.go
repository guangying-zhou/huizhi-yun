package people

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
)

const employeeNumberSequenceCode = "employee_no"

func formatEmployeeNumber(value int64) string {
	raw := strconv.FormatInt(value, 10)
	if len(raw) >= 3 {
		return raw
	}
	return strings.Repeat("0", 3-len(raw)) + raw
}

// allocateEmployeeNumberTx serializes allocation through one sequence row. The
// collision check lets the allocator safely skip numeric values that an
// administrator may have assigned manually before this policy was introduced.
func allocateEmployeeNumberTx(ctx context.Context, tx *sql.Tx) (string, error) {
	var next int64
	if err := tx.QueryRowContext(ctx, `
		SELECT next_value FROM people_employee_number_sequences
		WHERE sequence_code=? FOR UPDATE
	`, employeeNumberSequenceCode).Scan(&next); err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("People employee number sequence is not initialized")
		}
		return "", err
	}
	if next < 0 {
		return "", fmt.Errorf("People employee number sequence is invalid")
	}

	for {
		candidate := formatEmployeeNumber(next)
		var employeeExists, onboardingExists bool
		if err := tx.QueryRowContext(ctx, `SELECT
			EXISTS(SELECT 1 FROM people_employees WHERE employee_no=?),
			EXISTS(SELECT 1 FROM people_onboarding_cases WHERE status<>'cancelled' AND employee_no=?)
		`, candidate, candidate).Scan(&employeeExists, &onboardingExists); err != nil {
			return "", err
		}
		next++
		if employeeExists || onboardingExists {
			continue
		}
		result, err := tx.ExecContext(ctx, `
			UPDATE people_employee_number_sequences SET next_value=?,updated_at=NOW()
			WHERE sequence_code=?
		`, next, employeeNumberSequenceCode)
		if err != nil {
			return "", err
		}
		if affected, _ := result.RowsAffected(); affected != 1 {
			return "", fmt.Errorf("People employee number sequence was not updated")
		}
		return candidate, nil
	}
}

func employeeNumberForDingTalkSyncTx(ctx context.Context, tx *sql.Tx, employeeUID string) (string, error) {
	var employeeNumber string
	err := tx.QueryRowContext(ctx, `
		SELECT employee_no FROM people_employees WHERE employee_uid=? FOR UPDATE
	`, employeeUID).Scan(&employeeNumber)
	if err == nil && strings.TrimSpace(employeeNumber) != "" {
		return strings.TrimSpace(employeeNumber), nil
	}
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}
	return allocateEmployeeNumberTx(ctx, tx)
}
