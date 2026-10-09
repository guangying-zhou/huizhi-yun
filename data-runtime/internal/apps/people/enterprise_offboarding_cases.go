package people

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"time"
)

// Caller holds Registry generation, employee and assignment locks. No delivery,
// responsibility defaults, asset mutation, or account projection occurs here.
func EnsureEnterpriseOffboardingCaseTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), uid, date, actor string) (map[string]any, error) {
	cases, err := table("people_offboarding_cases")
	if err != nil {
		return nil, err
	}
	if !factsUID.MatchString(uid) || actor == "" {
		return nil, factsError("people_uid_invalid")
	}
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil || parsed.Year() < 2000 {
		return nil, factsError("people_offboarding_date_invalid")
	}
	code := OffboardingCode(uid, date)
	_, err = tx.ExecContext(ctx, "INSERT INTO "+cases+"(case_code,employee_uid,effective_date,created_by,updated_by) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id", code, uid, date, actor, actor)
	if err != nil {
		return nil, err
	}
	row, err := FactsRowTx(ctx, tx, cases, "BINARY employee_uid=BINARY ? AND effective_date=?", uid, date)
	if err != nil {
		return nil, err
	}
	if row["case_code"] != code {
		return nil, httperror.New(409, "people_offboarding_identity_conflict", "Offboarding event already has another identity")
	}
	return row, nil
}

// Optional subset: legacy bindings retain exactly their old behaviour. Once
// mapped, a missing/broken table fails the enclosing transaction closed.
func EnsureEffectiveOffboardingCaseTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), uid string, who FactsContext) error {
	if _, err := table("people_offboarding_cases"); err != nil {
		return nil
	}
	employees, err := table("people_employees")
	if err != nil {
		return err
	}
	var status, date string
	err = tx.QueryRowContext(ctx, "SELECT employment_status,COALESCE(CAST(leave_date AS CHAR),'') FROM "+employees+" WHERE BINARY employee_uid=BINARY ? AND archived_at IS NULL FOR UPDATE", uid).Scan(&status, &date)
	if err != nil {
		return err
	}
	asOf := who.AsOf
	if asOf.IsZero() {
		asOf = time.Now().UTC()
	}
	if status != "left" || date == "" || date > asOf.Format("2006-01-02") {
		return nil
	}
	_, err = EnsureEnterpriseOffboardingCaseTx(ctx, tx, table, uid, date, who.Actor)
	return err
}

// Pre-lock all employee participants in canonical order before assignments or
// case/tasks. Active responsibility is a current fact, not a browser assertion.
func LockOffboardingEmployeesTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), i EnterpriseFactsInput) (map[string]any, error) {
	employees, err := table("people_employees")
	if err != nil {
		return nil, err
	}
	uids := []string{i.EmployeeUID}
	for _, k := range []string{"handoverResponsibleUid", "assetRecoveryResponsibleUid"} {
		if uid := FactsString(i.Payload, k); uid != "" {
			uids = append(uids, uid)
		}
	}
	sortStrings(uids)
	var departed map[string]any
	last := ""
	for _, uid := range uids {
		if uid == last {
			continue
		}
		last = uid
		row, err := FactsRowTx(ctx, tx, employees, "BINARY employee_uid=BINARY ? AND archived_at IS NULL", uid)
		if err != nil {
			return nil, err
		}
		if uid == i.EmployeeUID {
			departed = row
		} else if row["employment_status"] != "active" {
			return nil, httperror.New(409, "people_offboarding_responsible_inactive", "Responsible employee is not active")
		}
	}
	if departed == nil {
		return nil, fmt.Errorf("departed employee not locked")
	}
	return departed, nil
}
