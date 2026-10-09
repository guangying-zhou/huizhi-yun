package aims

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type enterpriseProjectCommandScopeKey struct{}

// Only the authenticated server installs this context; body/query cannot opt in.
func WithEnterpriseProjectCommandScope(ctx context.Context, identity EnterpriseProjectUpdateIdentity) context.Context {
	return context.WithValue(ctx, enterpriseProjectCommandScopeKey{}, identity)
}

func requireEnterpriseDeliverableProjectScopeTx(ctx context.Context, tx *sql.Tx, actor string, projectID int64, manager bool) error {
	id, enabled := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !enabled {
		return nil
	}
	if id.ActorUID != actor || id.CommandScope == nil {
		return httperror.New(403, "enterprise_project_command_scope_invalid", "Project write authorization is invalid")
	}
	pid := fmt.Sprint(projectID)
	if err := requireEnterpriseProjectCommandScopeTx(ctx, tx, id, pid, "", "deliverable"); err != nil {
		return err
	}
	var leader string
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(leader_uid,'') FROM aims_projects WHERE id=? FOR UPDATE", projectID).Scan(&leader); err != nil {
		return err
	}
	if !manager {
		var count int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_members WHERE project_id=? AND uid=? AND status='active' FOR UPDATE", projectID, actor).Scan(&count); err != nil {
			return err
		}
		if leader == actor || count > 0 {
			return nil
		}
	}
	return requireEnterpriseProjectManagerTx(ctx, tx, id, pid, leader)
}

func requireEnterpriseProjectProductScopeTx(ctx context.Context, tx *sql.Tx, identity EnterpriseProjectUpdateIdentity, projectID int64) error {
	trusted, enabled := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !enabled {
		return nil // Independent Aims callers keep the existing domain gate.
	}
	if trusted.ActorUID != identity.ActorUID || trusted.CommandScope == nil {
		return httperror.New(403, "enterprise_project_command_scope_invalid", "Project write authorization is invalid")
	}
	return requireEnterpriseProjectCommandScopeTx(ctx, tx, trusted, fmt.Sprint(projectID), "", "project-product")
}

func requireEnterpriseProjectWeeklyReportScopeTx(ctx context.Context, tx *sql.Tx, actor string, projectID int64) error {
	trusted, enabled := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity)
	if !enabled {
		return nil // Independent Aims keeps its existing weekly-report gate.
	}
	if trusted.ActorUID != actor || trusted.CommandScope == nil {
		return httperror.New(403, "enterprise_project_command_scope_invalid", "Project write authorization is invalid")
	}
	return requireEnterpriseProjectCommandScopeTx(ctx, tx, trusted, fmt.Sprint(projectID), "", "weekly-report")
}

func requireDeliverableBatchOwnerProjectTx(ctx context.Context, tx *sql.Tx, row deliverableBatchRow) error {
	if _, enabled := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity); !enabled {
		return nil
	}
	var project int64
	switch row.OwnerKind {
	case deliverableOwnerProject:
		project = row.OwnerID
	case deliverableOwnerMilestone:
		if err := tx.QueryRowContext(ctx, "SELECT project_id FROM milestones WHERE id=? FOR UPDATE", row.OwnerID).Scan(&project); err != nil {
			return err
		}
	case deliverableOwnerTarget, deliverableOwnerMatter:
		var tier string
		if err := tx.QueryRowContext(ctx, "SELECT project_id,tier FROM work_items WHERE id=? FOR UPDATE", row.OwnerID).Scan(&project, &tier); err != nil {
			return err
		}
		if tier != string(row.OwnerKind) {
			return httperror.New(403, "deliverable_owner_mismatch", "Deliverable owner changed")
		}
	default:
		return httperror.New(400, "unsupported_entity_type", "Unsupported deliverable owner")
	}
	if project != row.ProjectID {
		return httperror.New(403, "deliverable_project_mismatch", "Deliverable belongs to another project")
	}
	return nil
}

func requireEnterpriseDeliverableOwnerTx(ctx context.Context, tx *sql.Tx, projectID, deliverableID, workItemID int64) error {
	if _, enabled := ctx.Value(enterpriseProjectCommandScopeKey{}).(EnterpriseProjectUpdateIdentity); !enabled {
		return nil
	}
	var actual int64
	var target, matter sql.NullInt64
	if err := tx.QueryRowContext(ctx, "SELECT project_id,target_id,matter_id FROM deliverables WHERE id=? FOR UPDATE", deliverableID).Scan(&actual, &target, &matter); err != nil {
		return err
	}
	if actual != projectID || (workItemID > 0 && (!target.Valid || target.Int64 != workItemID) && (!matter.Valid || matter.Int64 != workItemID)) {
		return httperror.New(403, "deliverable_project_mismatch", "Deliverable owner changed")
	}
	return nil
}
