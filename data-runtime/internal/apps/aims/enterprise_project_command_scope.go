package aims

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"strings"
	"time"
)

// Only the signed Enterprise server installs this action-specific projection.
// Legacy direct callers retain their original domain gates without a projection.
type EnterpriseProjectCommandScope struct {
	Projection  projectscope.Projection
	Descendants map[string][]string
	ExpiresAt   int64
}

func requireEnterpriseProjectCommandScopeTx(ctx context.Context, tx *sql.Tx, identity EnterpriseProjectUpdateIdentity, projectID, itemID, action string) error {
	scope := identity.CommandScope
	if scope == nil {
		return nil
	}
	if scope.ExpiresAt <= time.Now().UnixMilli() {
		return httperror.New(403, "enterprise_project_command_scope_expired", "Project authorization expired")
	}
	var code, department, leader, creator string
	if err := tx.QueryRowContext(ctx, `SELECT project_code,COALESCE(dept_code,''),COALESCE(leader_uid,''),COALESCE(NULLIF(TRIM(created_by),''),leader_uid,'') FROM aims_projects WHERE id=? FOR UPDATE`, projectID).Scan(&code, &department, &leader, &creator); err != nil {
		if err == sql.ErrNoRows {
			return httperror.New(404, "project_not_found", "Project not found")
		}
		return err
	}
	var role string
	err := tx.QueryRowContext(ctx, `SELECT role FROM aims_project_members WHERE project_id=? AND uid=? AND status='active' FOR UPDATE`, projectID, identity.ActorUID).Scan(&role)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	member := err == nil
	owner := strings.TrimSpace(leader) == identity.ActorUID
	facts := projectscope.Facts{ProjectCode: code, DepartmentCode: department, Member: member, Owner: owner, Creator: strings.TrimSpace(creator) == identity.ActorUID}
	facts.Participant = facts.Member || facts.Owner || facts.Creator
	for _, root := range scope.Projection.DepartmentTreeRoots {
		children, ok := scope.Descendants[root]
		if !ok || len(children) == 0 {
			return httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
		}
		for _, child := range children {
			if strings.TrimSpace(child) == strings.TrimSpace(department) {
				facts.DepartmentTree = append(facts.DepartmentTree, root)
				break
			}
		}
	}
	allowed, err := scope.Projection.Allows(facts)
	if err != nil {
		return httperror.New(503, "enterprise_project_scope_unavailable", "Project scope facts unavailable")
	}
	// Existing create/edit/associate require membership in addition to the grant.
	// State/completion retain their own domain gates; this layer adds scope only.
	requireMember := action == "create" || action == "edit" || action == "associate"
	if !allowed || (requireMember && !owner && (!member || (action == "create" && role != "manager"))) {
		return httperror.New(403, "enterprise_project_command_scope_denied", "Project write authorization denied")
	}
	// Recheck the existing relationship gate before receipt lookup as well.
	if _, state := EnterpriseWorkItemStateCapabilities[action]; state {
		if action == "plan-ready" || (!owner && !member) {
			if err := requireEnterpriseProjectManagerTx(ctx, tx, identity, projectID, leader); err != nil {
				return err
			}
		}
	}
	if action == "completion-replay" && !owner && (!member || role != "manager") {
		return httperror.New(403, "completion_replay_project_denied", "Project management access is required")
	}
	if itemID != "" {
		var actualProject, tier, assignee string
		if err := tx.QueryRowContext(ctx, `SELECT project_id,COALESCE(tier,''),COALESCE(assignee_uid,'') FROM work_items WHERE id=? FOR UPDATE`, itemID).Scan(&actualProject, &tier, &assignee); err != nil {
			if err == sql.ErrNoRows {
				return httperror.New(404, "work_item_not_found", "Work item not found")
			}
			return err
		}
		if actualProject != projectID {
			return httperror.New(403, "work_item_project_mismatch", "Work item does not belong to the project")
		}
		if action == "complete" && ((tier == "target" && !owner) || (tier == "matter" && assignee != identity.ActorUID)) {
			return httperror.New(403, "work_item_completion_actor_denied", "Completion actor no longer has the required relationship")
		}
		if action == "start" && tier == "target" && !owner {
			return httperror.New(403, "work_item_start_leader_required", "Only the project leader starts target execution")
		}
	}
	if scope.ExpiresAt <= time.Now().UnixMilli() {
		return httperror.New(403, "enterprise_project_command_scope_expired", "Project authorization expired")
	}
	return nil
}
