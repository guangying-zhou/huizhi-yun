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

type aimsConflictPrincipal struct {
	Kind string `json:"kind"`
	UID  string `json:"uid"`
}

func (a *Adapter) aimsInstanceConflictFacts(ctx context.Context, query url.Values) (map[string]any, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}

	uid := strings.TrimSpace(query.Get("current_user"))
	targetType := strings.TrimSpace(firstQueryText(query, "target_type", "targetType"))
	targetID, err := parseID(firstQueryText(query, "id", "target_id", "targetId"), "id")
	if err != nil {
		return nil, err
	}

	switch targetType {
	case "approval":
		return a.approvalInstanceConflictFacts(ctx, targetID, uid, query)
	case "requirement_review":
		return a.requirementReviewInstanceConflictFacts(ctx, targetID, uid, query)
	default:
		return nil, httperror.New(http.StatusBadRequest, "unsupported_target_type", "target_type must be approval or requirement_review")
	}
}

func (a *Adapter) approvalInstanceConflictFacts(ctx context.Context, approvalID int64, uid string, query url.Values) (map[string]any, error) {
	var (
		projectID        int64
		projectOwnerID   sql.NullInt64
		milestoneOwnerID sql.NullInt64
		workItemOwnerID  sql.NullInt64
		entityCode       sql.NullString
		transition       sql.NullString
		title            sql.NullString
		requestedBy      sql.NullString
		reviewerUID      sql.NullString
		status           sql.NullString
		approvalProject  sql.NullString
		projectCode      sql.NullString
		deptCode         sql.NullString
		leaderUID        sql.NullString
	)

	err := a.DB().QueryRowContext(ctx, `
		SELECT
			a.project_id,
			a.project_owner_id,
			a.milestone_owner_id,
			a.work_item_owner_id,
			a.entity_code,
			a.transition,
			a.title,
			a.requested_by,
			a.reviewer_uid,
			a.status,
			a.project_code,
			p.project_code,
			p.dept_code,
			p.leader_uid
		FROM approval_records a
		LEFT JOIN aims_projects p ON p.id = a.project_id
		WHERE a.id = ?
		LIMIT 1
	`, approvalID).Scan(
		&projectID,
		&projectOwnerID,
		&milestoneOwnerID,
		&workItemOwnerID,
		&entityCode,
		&transition,
		&title,
		&requestedBy,
		&reviewerUID,
		&status,
		&approvalProject,
		&projectCode,
		&deptCode,
		&leaderUID,
	)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "approval_not_found", "approval not found")
	}
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectMemberOrScopedAdmin(ctx, projectID, uid, query); err != nil {
		return nil, err
	}

	entityType, entityID := approvalConflictEntity(projectOwnerID, milestoneOwnerID, workItemOwnerID)
	if entityType == "" || entityID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "approval_entity_unresolved", "approval entity is unresolved")
	}

	resourceCode := "projects"
	action := "approve"
	if entityType == "work_item" {
		resourceCode = "work_items"
		action = "confirm"
	}

	code := firstNonEmptyText(nullText(entityCode), fmt.Sprintf("%s:%d", entityType, entityID))
	projectCodeText := firstNonEmptyText(nullText(projectCode), nullText(approvalProject))
	principals := make([]aimsConflictPrincipal, 0, 3)
	if requester := nullText(requestedBy); requester != "" {
		principals = append(principals,
			aimsConflictPrincipal{Kind: "requester", UID: requester},
			aimsConflictPrincipal{Kind: "applicant", UID: requester},
		)
	}
	if reviewer := nullText(reviewerUID); reviewer != "" {
		principals = append(principals, aimsConflictPrincipal{Kind: "reviewer", UID: reviewer})
	}

	return map[string]any{
		"targetType":   "approval",
		"id":           approvalID,
		"code":         code,
		"resourceCode": resourceCode,
		"action":       action,
		"principals":   principals,
		"object": map[string]any{
			"actorUid":         uid,
			"ownerUid":         nullableConflictText(nullText(requestedBy)),
			"reviewerUid":      nullableConflictText(nullText(reviewerUID)),
			"projectCode":      nullableConflictText(projectCodeText),
			"departmentCode":   nullableConflictText(nullText(deptCode)),
			"leaderUid":        nullableConflictText(nullText(leaderUID)),
			"entityType":       entityType,
			"entityId":         entityID,
			"transition":       nullableConflictText(nullText(transition)),
			"approvalStatus":   nullableConflictText(nullText(status)),
			"matchedRelations": aimsConflictRelations("approval", approvalID, entityType, entityID, projectCodeText),
		},
		"title": titlePtr(title),
	}, nil
}

func (a *Adapter) requirementReviewInstanceConflictFacts(ctx context.Context, batchID int64, uid string, query url.Values) (map[string]any, error) {
	var (
		projectID          int64
		title              string
		batchType          string
		status             string
		submittedBy        sql.NullString
		workflowInstanceID sql.NullString
		projectCode        sql.NullString
		deptCode           sql.NullString
		leaderUID          sql.NullString
	)

	err := a.DB().QueryRowContext(ctx, `
		SELECT
			b.project_id,
			b.title,
			b.batch_type,
			b.status,
			b.submitted_by,
			b.workflow_instance_id,
			p.project_code,
			p.dept_code,
			p.leader_uid
		FROM requirement_review_batches b
		INNER JOIN aims_projects p ON p.id = b.project_id
		WHERE b.id = ?
		LIMIT 1
	`, batchID).Scan(
		&projectID,
		&title,
		&batchType,
		&status,
		&submittedBy,
		&workflowInstanceID,
		&projectCode,
		&deptCode,
		&leaderUID,
	)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "requirement_review_not_found", "requirement review batch not found")
	}
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectMemberOrScopedAdmin(ctx, projectID, uid, query); err != nil {
		return nil, err
	}

	submitter := nullText(submittedBy)
	principals := make([]aimsConflictPrincipal, 0, 2)
	if submitter != "" {
		principals = append(principals,
			aimsConflictPrincipal{Kind: "requester", UID: submitter},
			aimsConflictPrincipal{Kind: "submitter", UID: submitter},
		)
	}
	projectCodeText := nullText(projectCode)

	return map[string]any{
		"targetType":   "requirement_review",
		"id":           batchID,
		"code":         fmt.Sprintf("requirement_review:%d", batchID),
		"resourceCode": "projects",
		"action":       "approve",
		"principals":   principals,
		"object": map[string]any{
			"actorUid":           uid,
			"ownerUid":           nullableConflictText(submitter),
			"submitterUid":       nullableConflictText(submitter),
			"projectCode":        nullableConflictText(projectCodeText),
			"departmentCode":     nullableConflictText(nullText(deptCode)),
			"leaderUid":          nullableConflictText(nullText(leaderUID)),
			"batchType":          strings.TrimSpace(batchType),
			"approvalStatus":     strings.TrimSpace(status),
			"workflowInstanceId": nullableConflictText(nullText(workflowInstanceID)),
			"matchedRelations":   aimsConflictRelations("requirement_review", batchID, "", 0, projectCodeText),
		},
		"title": title,
	}, nil
}

func approvalConflictEntity(projectOwnerID, milestoneOwnerID, workItemOwnerID sql.NullInt64) (string, int64) {
	if projectOwnerID.Valid && projectOwnerID.Int64 > 0 {
		return "project", projectOwnerID.Int64
	}
	if milestoneOwnerID.Valid && milestoneOwnerID.Int64 > 0 {
		return "milestone", milestoneOwnerID.Int64
	}
	if workItemOwnerID.Valid && workItemOwnerID.Int64 > 0 {
		return "work_item", workItemOwnerID.Int64
	}
	return "", 0
}

func aimsConflictRelations(targetType string, targetID int64, entityType string, entityID int64, projectCode string) []string {
	relations := []string{fmt.Sprintf("aims:%s:%d", targetType, targetID)}
	if entityType != "" && entityID > 0 {
		relations = append(relations, fmt.Sprintf("aims:%s:%d", entityType, entityID))
	}
	if strings.TrimSpace(projectCode) != "" {
		relations = append(relations, "aims:project:"+strings.TrimSpace(projectCode))
	}
	return relations
}

func nullText(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return strings.TrimSpace(value.String)
}

func titlePtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	text := strings.TrimSpace(value.String)
	if text == "" {
		return nil
	}
	return &text
}

func nullableConflictText(value string) any {
	text := strings.TrimSpace(value)
	if text == "" {
		return nil
	}
	return text
}
