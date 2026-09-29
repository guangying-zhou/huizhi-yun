package aims

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// The project lock serializes member mutations with this check. Check before
// receipt lookup too: a revoked manager must not replay an old authorized result.
func requireEnterpriseProjectWriteAccessTx(ctx context.Context, tx *sql.Tx, identity EnterpriseProjectUpdateIdentity, projectID int64) (string, error) {
	var leader sql.NullString
	if err := tx.QueryRowContext(ctx, `SELECT leader_uid FROM aims_projects WHERE id=? FOR UPDATE`, projectID).Scan(&leader); err == sql.ErrNoRows {
		return "", httperror.New(404, "project_not_found", "Project not found")
	} else if err != nil {
		return "", err
	}
	if identity.AdminProject {
		return leader.String, nil
	}
	var managers int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM aims_project_members WHERE project_id=? AND uid=? AND role='manager' AND status='active'`, projectID, identity.ActorUID).Scan(&managers); err != nil {
		return "", err
	}
	if !identity.StaticProjectEdit && identity.ActorUID != leader.String && managers == 0 {
		return "", httperror.New(403, "project_manager_required", "Project manager access required")
	}
	return leader.String, nil
}
