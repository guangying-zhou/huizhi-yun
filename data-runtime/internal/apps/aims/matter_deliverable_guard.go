package aims

import (
	"context"
	"database/sql"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The completion command locks project, then work item before freezing its
// snapshot. Deliverable writes take the same locks so evidence cannot change
// between the readiness check and the in_review transition.
func lockMatterDeliverableWriteTx(ctx context.Context, tx *sql.Tx, projectID, matterID int64) error {
	var actualProjectID int64
	var tier, status string
	err := tx.QueryRowContext(ctx, "SELECT project_id,tier,status FROM work_items WHERE id=? FOR UPDATE", matterID).
		Scan(&actualProjectID, &tier, &status)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "work_item_not_found", "work item not found")
	}
	if err != nil {
		return err
	}
	if actualProjectID != projectID || tier != "matter" {
		return httperror.New(http.StatusBadRequest, "matter_deliverable_owner_invalid", "Matter deliverable owner is invalid")
	}
	if status != "in_progress" {
		return httperror.New(http.StatusConflict, "matter_deliverable_frozen", "Matter deliverables are editable only while work is in progress")
	}
	return nil
}

func lockExistingMatterDeliverableWriteTx(ctx context.Context, tx *sql.Tx, projectID, deliverableID int64) error {
	var targetID, matterID sql.NullInt64
	err := tx.QueryRowContext(ctx, "SELECT target_id,matter_id FROM deliverables WHERE id=? AND project_id=?", deliverableID, projectID).Scan(&targetID, &matterID)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "deliverable_not_found", "deliverable not found")
	}
	if err != nil {
		return err
	}
	if matterID.Valid && !targetID.Valid {
		return lockMatterDeliverableWriteTx(ctx, tx, projectID, matterID.Int64)
	}
	return nil
}
