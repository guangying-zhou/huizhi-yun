package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type approvalProjectContext struct {
	projectID   int64
	projectCode any
}

func (a *Adapter) createApprovalRecord(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	uid := approvalTrustedActor(query)
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	entityType := strings.TrimSpace(firstBodyText(body, "entity_type", "entityType"))
	if entityType == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_entity_type", "entity_type is required")
	}
	normalizedEntityType, err := normalizeApprovalEntityType(entityType)
	if err != nil {
		return nil, err
	}

	entityID, ok, err := optionalBodyID(body, "entity_id", "entityId")
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_entity_id", "entity_id must be a positive integer")
	}
	if !ok || entityID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_entity_id", "entity_id is required")
	}

	transition := strings.TrimSpace(firstBodyText(body, "transition"))
	if transition == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_transition", "transition is required")
	}
	reviewerUID := strings.TrimSpace(firstBodyText(body, "reviewer_uid", "reviewerUid"))
	if reviewerUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_reviewer_uid", "reviewer_uid is required")
	}

	owner := approvalOwnerColumns(normalizedEntityType, entityID)
	projectContext, err := a.resolveApprovalProjectContext(ctx, normalizedEntityType, entityID)
	if err != nil {
		return nil, err
	}

	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO approval_records
			(project_owner_id, milestone_owner_id, work_item_owner_id,
			 entity_code, transition, title,
			 requested_by, request_comment, reviewer_uid, status,
			 project_id, project_code)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
	`,
		owner.projectOwnerID,
		owner.milestoneOwnerID,
		owner.workItemOwnerID,
		nullableText(firstBodyText(body, "entity_code", "entityCode")),
		transition,
		nullableText(firstBodyText(body, "title")),
		uid,
		nullableText(firstBodyText(body, "request_comment", "requestComment")),
		reviewerUID,
		projectContext.projectID,
		projectContext.projectCode,
	)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": id}, nil
}

func approvalTrustedActor(query url.Values) string {
	if uid := strings.TrimSpace(query.Get("current_user")); uid != "" {
		return uid
	}
	return strings.TrimSpace(query.Get("operator_uid"))
}

type approvalOwner struct {
	projectOwnerID   any
	milestoneOwnerID any
	workItemOwnerID  any
}

func approvalOwnerColumns(entityType string, entityID int64) approvalOwner {
	switch entityType {
	case "project":
		return approvalOwner{projectOwnerID: entityID}
	case "milestone":
		return approvalOwner{milestoneOwnerID: entityID}
	default:
		return approvalOwner{workItemOwnerID: entityID}
	}
}

func (a *Adapter) resolveApprovalProjectContext(ctx context.Context, entityType string, entityID int64) (approvalProjectContext, error) {
	var projectID int64
	var projectCode sql.NullString

	var err error
	switch entityType {
	case "project":
		err = a.DB().QueryRowContext(ctx, `
			SELECT id, project_code
			FROM aims_projects
			WHERE id = ?
		`, entityID).Scan(&projectID, &projectCode)
	case "milestone":
		err = a.DB().QueryRowContext(ctx, `
			SELECT m.project_id, p.project_code
			FROM milestones m
			JOIN aims_projects p ON p.id = m.project_id
			WHERE m.id = ?
		`, entityID).Scan(&projectID, &projectCode)
	default:
		err = a.DB().QueryRowContext(ctx, `
			SELECT wi.project_id, p.project_code
			FROM work_items wi
			JOIN aims_projects p ON p.id = wi.project_id
			WHERE wi.id = ?
		`, entityID).Scan(&projectID, &projectCode)
	}
	if err == sql.ErrNoRows {
		return approvalProjectContext{}, httperror.New(http.StatusBadRequest, "approval_project_context_unresolved", "unable to resolve approval project context")
	}
	if err != nil {
		return approvalProjectContext{}, err
	}
	if projectID <= 0 {
		return approvalProjectContext{}, httperror.New(http.StatusBadRequest, "approval_project_context_unresolved", "unable to resolve approval project context")
	}

	var projectCodeValue any
	if projectCode.Valid && strings.TrimSpace(projectCode.String) != "" {
		projectCodeValue = strings.TrimSpace(projectCode.String)
	}
	return approvalProjectContext{
		projectID:   projectID,
		projectCode: projectCodeValue,
	}, nil
}
