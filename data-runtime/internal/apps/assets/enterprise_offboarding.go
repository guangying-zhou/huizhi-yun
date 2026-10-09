package assets

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"time"
)

type EnterpriseOffboardingArrangement struct {
	EventCode, EmployeeUID, ResponsibleUID, Actor string
	EffectiveDate, DueAt                          time.Time
}

// The Enterprise coordinator derives the event/employee from locked People
// facts. Responsibility and deadline have already passed People authorization.
func ArrangeEnterpriseOffboardingTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), i EnterpriseOffboardingArrangement) error {
	if i.EventCode == "" || i.Actor == "" || !validOffboardingUID(i.EmployeeUID) || !validOffboardingUID(i.ResponsibleUID) || i.ResponsibleUID == i.EmployeeUID || i.DueAt.IsZero() || i.EffectiveDate.IsZero() {
		return httperror.New(400, "assets_offboarding_arrangement_invalid", "Explicit responsibility and deadline required")
	}
	root, err := table("asset_offboarding_recovery_cases")
	if err != nil {
		return err
	}
	h := sha256.Sum256([]byte("people-apf17b|" + i.EventCode + "|" + i.EmployeeUID + "|" + i.EffectiveDate.Format("2006-01-02")))
	code := "AOR-" + hex.EncodeToString(h[:20])
	digest := hex.EncodeToString(h[:])
	_, err = tx.ExecContext(ctx, "INSERT INTO "+root+"(case_code,source_app,source_event_key,source_payload_sha256,departed_employee_uid,offboarded_at,recovery_due_at,recovery_responsible_uid,created_by,updated_by) VALUES(?,'people',?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id", code, i.EventCode, digest, i.EmployeeUID, i.EffectiveDate, i.DueAt.UTC().Format("2006-01-02"), i.ResponsibleUID, i.Actor, i.Actor)
	if err != nil {
		return err
	}
	var storedUID, storedSHA, status string
	err = tx.QueryRowContext(ctx, "SELECT departed_employee_uid,source_payload_sha256,status FROM "+root+" WHERE source_app='people' AND BINARY source_event_key=BINARY ? FOR UPDATE", i.EventCode).Scan(&storedUID, &storedSHA, &status)
	if err != nil {
		return err
	}
	if storedUID != i.EmployeeUID || storedSHA != digest || status != "active" {
		return httperror.New(409, "assets_offboarding_arrangement_conflict", "Recovery event changed")
	}
	_, err = tx.ExecContext(ctx, "UPDATE "+root+" SET recovery_due_at=?,recovery_responsible_uid=?,updated_by=? WHERE source_app='people' AND BINARY source_event_key=BINARY ?", i.DueAt.UTC().Format("2006-01-02"), i.ResponsibleUID, i.Actor, i.EventCode)
	return err
}

func ResolveEnterpriseOffboardingTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), event, uid, actor string) error {
	root, err := table("asset_offboarding_recovery_cases")
	if err != nil {
		return err
	}
	var id int64
	if err = tx.QueryRowContext(ctx, "SELECT id FROM "+root+" WHERE source_app='people' AND BINARY source_event_key=BINARY ? AND BINARY departed_employee_uid=BINARY ? AND status='active' FOR UPDATE", event, uid).Scan(&id); err != nil {
		return err
	}
	n, err := OutstandingOffboardingAssetsTx(ctx, tx, table, uid)
	if err != nil {
		return err
	}
	if n != 0 {
		return httperror.New(409, "people_offboarding_assets_outstanding", "Assets have not been returned")
	}
	_, err = tx.ExecContext(ctx, "UPDATE "+root+" SET status='resolved',updated_by=? WHERE id=?", actor, id)
	return err
}

// Read-only owning query inside the caller's generation-fenced transaction.
// Never clears user_uid, returns assets, writes a recovery receipt or invents a
// deadline. People completion must inspect the current authoritative collection.
func OutstandingOffboardingAssetsTx(ctx context.Context, tx *sql.Tx, table func(string) (string, error), uid string) (int64, error) {
	if !validOffboardingUID(uid) {
		return 0, httperror.New(400, "assets_offboarding_recovery_identity_invalid", "Employee identity required")
	}
	items, err := table("asset_items")
	if err != nil {
		return 0, err
	}
	rows, err := tx.QueryContext(ctx, "SELECT id FROM "+items+" WHERE BINARY user_uid=BINARY ? AND archived_at IS NULL AND status NOT IN ('in_stock','scrapped','inactive','disposed','retired') ORDER BY id FOR UPDATE", uid)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var n int64
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			return 0, err
		}
		n++
	}
	return n, rows.Err()
}
