package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) updateProjectWithLeaderSync(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
	projectID string,
) (any, error) {
	if err := a.requireProjectUpdateAccess(ctx, path, query, body, projectID); err != nil {
		return nil, err
	}

	if hasAnyBodyKey(body, "leaderUid", "leader_uid") && cleanBodyText(body, "leaderUid", "leader_uid") == "" {
		return nil, httperror.New(http.StatusBadRequest, "project_manager_required", "leader_uid cannot be cleared")
	}
	if hasAnyBodyKey(body, "oppId", "opp_id", "opportunityId", "opportunity_id") {
		return nil, httperror.New(http.StatusForbidden, "opportunity_link_service_owned", "opportunity link can only be maintained by Altoc")
	}
	if hasAnyBodyKey(body, "customerCode", "customer_code", "customerName", "customer_name", "category") {
		var linkedOpportunity sql.NullInt64
		if err := a.DB().QueryRowContext(ctx, "SELECT opp_id FROM aims_projects WHERE id = ?", projectID).Scan(&linkedOpportunity); err != nil {
			return nil, err
		}
		if linkedOpportunity.Valid {
			return nil, httperror.New(http.StatusForbidden, "opportunity_master_data_service_owned", "Altoc-linked opportunity category and customer data cannot be edited in Aims")
		}
	}
	leaderUID := cleanBodyText(body, "leaderUid", "leader_uid")
	lifecycleStatus := cleanBodyText(body, "lifecycleStatus", "lifecycle_status")
	if lifecycleStatus == "approval_pending" {
		category := cleanBodyText(body, "category")
		if category == "" {
			if err := a.DB().QueryRowContext(ctx, "SELECT category FROM aims_projects WHERE id = ?", projectID).Scan(&category); err != nil {
				return nil, err
			}
		}
		if err := validateProjectInitiationLifecycle(category, lifecycleStatus); err != nil {
			return nil, err
		}
	}
	actor := currentUserFrom(query, body)

	result, _, err := a.Adapter.HandleRuntimeUpdateWithTxHook(ctx, method, path, query, body, func(ctx context.Context, tx *sql.Tx, identifier string) (map[string]any, error) {
		if err := validateServiceYearProjectTx(ctx, tx, identifier); err != nil {
			return nil, err
		}
		if leaderUID != "" {
			if err := ensureProjectLeaderMemberTx(ctx, tx, identifier, leaderUID); err != nil {
				return nil, err
			}
		}
		if lifecycleStatus != "" {
			if err := appendProjectLifecycleEventTx(ctx, tx, identifier, lifecycleStatus, actor); err != nil {
				return nil, err
			}
		}
		return map[string]any{}, nil
	})
	if err != nil {
		return result, err
	}
	return result, nil
}

func (a *Adapter) requireProjectUpdateAccess(ctx context.Context, path string, query url.Values, body map[string]any, projectID string) error {
	if _, err := parseID(projectID, "project_id"); err != nil {
		return err
	}
	if isAdminProjectObjectPath(path) {
		return requireProjectAdminAccess(query, body, projectID)
	}
	if currentUserFrom(query, body) == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if hasProjectAdminFlag(query) {
		return nil
	}

	_, _, err := a.requireProjectManager(ctx, projectID, query, body)
	return err
}

func (a *Adapter) requireProjectManagerOrScopedAdmin(ctx context.Context, projectID int64, uid string, query url.Values) error {
	uid = strings.TrimSpace(uid)
	if uid == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	adminWhere, adminArgs := projectScopedAdminWhere(query, "p")
	args := append([]any{uid, projectID, uid}, adminArgs...)
	var count int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM aims_projects p
		LEFT JOIN aims_project_members pm
		  ON pm.project_id = p.id
		 AND pm.uid = ?
		 AND COALESCE(pm.status, 'active') = 'active'
		WHERE p.id = ?
		  AND (p.leader_uid = ? OR pm.role = 'manager' OR `+adminWhere+`)
	`, args...).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return httperror.New(http.StatusForbidden, "project_manager_required", "project manager access required")
	}
	return nil
}

func (a *Adapter) requireProjectMemberOrScopedAdmin(ctx context.Context, projectID int64, uid string, query url.Values) error {
	uid = strings.TrimSpace(uid)
	if uid == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if hasProjectAdminFlag(query) {
		return nil
	}

	adminWhere, adminArgs := projectScopedAdminWhere(query, "p")
	args := append([]any{uid, projectID, uid}, adminArgs...)
	var count int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM aims_projects p
		LEFT JOIN aims_project_members pm
		  ON pm.project_id = p.id
		 AND pm.uid = ?
		 AND COALESCE(pm.status, 'active') = 'active'
		WHERE p.id = ?
		  AND (p.leader_uid = ? OR pm.id IS NOT NULL OR `+adminWhere+`)
	`, args...).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return httperror.New(http.StatusForbidden, "project_member_required", "project member access required")
	}
	return nil
}

func (a *Adapter) requireWorkItemProjectMemberOrScopedAdmin(ctx context.Context, rawWorkItemID string, query url.Values) error {
	workItemID, err := parseID(rawWorkItemID, "work_item_id")
	if err != nil {
		return err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	var projectID int64
	err = a.DB().QueryRowContext(ctx, `
		SELECT project_id
		FROM work_items
		WHERE id = ?
	`, workItemID).Scan(&projectID)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "work_item_not_found", "work item not found")
	}
	if err != nil {
		return err
	}
	return a.requireProjectMemberOrScopedAdmin(ctx, projectID, uid, query)
}

type directProjectManagedObjectGuard struct {
	projectIDQuery  string
	notFoundCode    string
	notFoundMessage string
}

var directProjectManagedObjectGuards = map[string]directProjectManagedObjectGuard{
	"deliverables": {
		projectIDQuery:  "SELECT project_id FROM deliverables WHERE id = ?",
		notFoundCode:    "deliverable_not_found",
		notFoundMessage: "deliverable not found",
	},
	"milestones": {
		projectIDQuery:  "SELECT project_id FROM milestones WHERE id = ?",
		notFoundCode:    "milestone_not_found",
		notFoundMessage: "milestone not found",
	},
	"requirements": {
		projectIDQuery:  "SELECT project_id FROM requirement_items WHERE id = ?",
		notFoundCode:    "requirement_not_found",
		notFoundMessage: "requirement not found",
	},
	"requirement-contents": {
		projectIDQuery:  "SELECT project_id FROM requirement_contents WHERE id = ?",
		notFoundCode:    "content_not_found",
		notFoundMessage: "requirement content not found",
	},
	"requirement-reviews": {
		projectIDQuery:  "SELECT project_id FROM requirement_review_batches WHERE id = ?",
		notFoundCode:    "batch_not_found",
		notFoundMessage: "requirement review batch not found",
	},
}

var directProjectManagedObjectResources = []string{
	"deliverables",
	"milestones",
	"requirements",
	"requirement-contents",
	"requirement-reviews",
}

func directProjectManagedObjectPath(path string) (string, string, bool) {
	for _, resource := range directProjectManagedObjectResources {
		if objectID, ok := directPathParam(path, "/v1/aims/"+resource+"/"); ok {
			return resource, objectID, true
		}
	}
	return "", "", false
}

func (a *Adapter) requireDirectProjectManagedObjectManagerOrScopedAdmin(ctx context.Context, resource string, rawObjectID string, query url.Values) error {
	guard, ok := directProjectManagedObjectGuards[resource]
	if !ok {
		return httperror.New(http.StatusNotFound, "resource_not_found", "resource not found")
	}
	objectID, err := parseID(rawObjectID, "id")
	if err != nil {
		return err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	var projectID int64
	err = a.DB().QueryRowContext(ctx, guard.projectIDQuery, objectID).Scan(&projectID)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, guard.notFoundCode, guard.notFoundMessage)
	}
	if err != nil {
		return err
	}
	return a.requireProjectManagerOrScopedAdmin(ctx, projectID, uid, query)
}

func requireProjectAdminAccess(query url.Values, body map[string]any, projectID string) error {
	if _, err := parseID(projectID, "project_id"); err != nil {
		return err
	}
	if currentUserFrom(query, body) == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if !hasProjectAdminFlag(query) {
		return httperror.New(http.StatusForbidden, "project_admin_required", "仅系统管理员可以执行该操作")
	}
	return nil
}

func hasProjectAdminFlag(query url.Values) bool {
	return strings.TrimSpace(firstQueryText(query, "current_user_is_project_admin", "currentUserIsProjectAdmin")) == "1"
}

func isAdminProjectObjectPath(path string) bool {
	_, ok := directPathParam(path, "/v1/aims/admin/projects/")
	return ok
}

func (a *Adapter) ensureProjectLeaderMember(ctx context.Context, projectID string, leaderUID string) error {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := ensureProjectLeaderMemberTx(ctx, tx, projectID, leaderUID); err != nil {
		return err
	}

	return tx.Commit()
}

func ensureProjectLeaderMemberTx(ctx context.Context, tx *sql.Tx, projectID string, leaderUID string) error {
	if _, err := tx.ExecContext(ctx, `
		UPDATE aims_project_members
		SET role = 'member'
		WHERE project_id = ?
		  AND uid <> ?
		  AND role = 'manager'
	`, projectID, leaderUID); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO aims_project_members (project_id, uid, role, status)
		VALUES (?, ?, 'manager', 'active')
		ON DUPLICATE KEY UPDATE
			role = 'manager',
			status = 'active'
	`, projectID, leaderUID); err != nil {
		return err
	}

	return nil
}

func appendProjectLifecycleEventTx(ctx context.Context, tx *sql.Tx, projectID string, toStatus string, actor string) error {
	var currentStatus sql.NullString
	err := tx.QueryRowContext(ctx, `
		SELECT to_status
		FROM project_lifecycle_events
		WHERE project_id = ?
		ORDER BY effective_at DESC, id DESC
		LIMIT 1
		FOR UPDATE
	`, projectID).Scan(&currentStatus)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if currentStatus.Valid && currentStatus.String == toStatus {
		return nil
	}
	if actor == "" {
		actor = "system"
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO project_lifecycle_events (
		  project_id, from_status, to_status, effective_at, actor_uid, source
		) VALUES (?, ?, ?, UTC_TIMESTAMP(6), ?, 'aims.project.update')
	`, projectID, nullableText(currentStatus.String), toStatus, actor)
	return err
}

func cleanBodyText(body map[string]any, keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(fmt.Sprint(body[key]))
		if value != "" && value != "<nil>" {
			return value
		}
	}
	return ""
}

func directPathParam(path string, prefix string) (string, bool) {
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	value := strings.TrimPrefix(path, prefix)
	if value == "" || strings.Contains(value, "/") {
		return "", false
	}
	return value, true
}
