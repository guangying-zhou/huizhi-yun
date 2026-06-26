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

type workItemChild struct {
	ID             int64    `json:"id"`
	ItemKey        string   `json:"itemKey"`
	Title          string   `json:"title"`
	Status         string   `json:"status"`
	AssigneeUID    *string  `json:"assigneeUid"`
	AssigneeName   *string  `json:"assigneeName"`
	EstimatedHours *float64 `json:"estimatedHours"`
	StartDate      *string  `json:"startDate"`
	DueDate        *string  `json:"dueDate"`
	Description    *string  `json:"description"`
	Priority       string   `json:"priority"`
	ApprovalStatus string   `json:"approvalStatus"`
	CreatedAt      string   `json:"createdAt"`
}

type workItemTransition struct {
	ToStatus      string `json:"toStatus"`
	TransitionKey string `json:"transitionKey"`
}

type workItemCommit struct {
	ID              int64   `json:"id"`
	RepoProjectCode string  `json:"repoProjectCode"`
	CommitSHA       string  `json:"commitSha"`
	Message         string  `json:"message"`
	AuthorName      *string `json:"authorName"`
	AuthorEmail     *string `json:"authorEmail"`
	CommittedAt     string  `json:"committedAt"`
}

func requireCurrentUser(query url.Values) error {
	if strings.TrimSpace(query.Get("current_user")) == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	return nil
}

func normalizeRequiredID(value, name string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", httperror.New(http.StatusBadRequest, "missing_"+name, name+" is required")
	}
	return value, nil
}

func (a *Adapter) workItemChildren(ctx context.Context, workItemID string, query url.Values) ([]workItemChild, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	workItemID, err := normalizeRequiredID(workItemID, "work_item_id")
	if err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			wi.id,
			wi.item_key,
			wi.title,
			wi.status,
			wi.assignee_uid,
			NULL AS assignee_name,
			wi.estimated_hours,
			wi.start_date,
			wi.due_date,
			wi.description,
			wi.priority,
			wi.approval_status,
			wi.created_at
		FROM work_items wi
		WHERE wi.parent_id = ?
		ORDER BY wi.sort_order ASC, wi.created_at ASC
	`, workItemID)
	if err != nil {
		return nil, fmt.Errorf("query work item children: %w", err)
	}
	defer rows.Close()

	children := make([]workItemChild, 0)
	for rows.Next() {
		var child workItemChild
		var assigneeUID, assigneeName, startDate, dueDate, description, approvalStatus sql.NullString
		var estimatedHours sql.NullFloat64
		if err := rows.Scan(
			&child.ID,
			&child.ItemKey,
			&child.Title,
			&child.Status,
			&assigneeUID,
			&assigneeName,
			&estimatedHours,
			&startDate,
			&dueDate,
			&description,
			&child.Priority,
			&approvalStatus,
			&child.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan work item child: %w", err)
		}
		child.AssigneeUID = nullableString(assigneeUID)
		child.AssigneeName = nullableString(assigneeName)
		child.EstimatedHours = nullableFloat64(estimatedHours)
		child.StartDate = nullableString(startDate)
		child.DueDate = nullableString(dueDate)
		child.Description = nullableString(description)
		child.ApprovalStatus = nullStringOr(approvalStatus, "not_required")
		children = append(children, child)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return children, nil
}

func (a *Adapter) workItemTransitions(ctx context.Context, workItemID string, query url.Values) ([]workItemTransition, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	workItemID, err := normalizeRequiredID(workItemID, "work_item_id")
	if err != nil {
		return nil, err
	}

	var projectID sql.NullInt64
	var entityType, status string
	row := a.DB().QueryRowContext(ctx, `
		SELECT project_id, tier, status
		FROM work_items
		WHERE id = ?
	`, workItemID)
	if err := row.Scan(&projectID, &entityType, &status); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "work_item_not_found", "工作项不存在")
		}
		return nil, fmt.Errorf("query work item transition context: %w", err)
	}

	if projectID.Valid {
		projectRules, err := a.queryWorkItemTransitions(ctx, "project_id = ? AND entity_type = ? AND from_status = ?", projectID.Int64, entityType, status)
		if err != nil {
			return nil, err
		}
		if len(projectRules) > 0 {
			return projectRules, nil
		}

		var ruleID int64
		hasProjectRules := a.DB().QueryRowContext(ctx, `
			SELECT id
			FROM workflow_transitions
			WHERE project_id = ? AND entity_type = ?
			LIMIT 1
		`, projectID.Int64, entityType)
		if err := hasProjectRules.Scan(&ruleID); err == nil {
			return []workItemTransition{}, nil
		} else if err != sql.ErrNoRows {
			return nil, fmt.Errorf("query project transition rules: %w", err)
		}
	}

	return a.queryWorkItemTransitions(ctx, "project_id IS NULL AND entity_type = ? AND from_status = ?", entityType, status)
}

func (a *Adapter) queryWorkItemTransitions(ctx context.Context, where string, args ...any) ([]workItemTransition, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT to_status, transition_key
		FROM workflow_transitions
		WHERE `+where+`
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query work item transitions: %w", err)
	}
	defer rows.Close()

	transitions := make([]workItemTransition, 0)
	for rows.Next() {
		var transition workItemTransition
		if err := rows.Scan(&transition.ToStatus, &transition.TransitionKey); err != nil {
			return nil, fmt.Errorf("scan work item transition: %w", err)
		}
		transitions = append(transitions, transition)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return transitions, nil
}

func (a *Adapter) workItemCommits(ctx context.Context, workItemID string, query url.Values) ([]workItemCommit, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	workItemID, err := normalizeRequiredID(workItemID, "work_item_id")
	if err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, repo_project_code, commit_sha, message, author_name, author_email, committed_at
		FROM gitlab_commits
		WHERE work_item_id = ?
		ORDER BY committed_at DESC
	`, workItemID)
	if err != nil {
		return nil, fmt.Errorf("query work item commits: %w", err)
	}
	defer rows.Close()

	commits := make([]workItemCommit, 0)
	for rows.Next() {
		var commit workItemCommit
		var authorName, authorEmail sql.NullString
		if err := rows.Scan(
			&commit.ID,
			&commit.RepoProjectCode,
			&commit.CommitSHA,
			&commit.Message,
			&authorName,
			&authorEmail,
			&commit.CommittedAt,
		); err != nil {
			return nil, fmt.Errorf("scan work item commit: %w", err)
		}
		commit.AuthorName = nullableString(authorName)
		commit.AuthorEmail = nullableString(authorEmail)
		commits = append(commits, commit)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return commits, nil
}

func (a *Adapter) projectDuplicateCheck(ctx context.Context, query url.Values) (map[string]bool, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}

	name := strings.TrimSpace(query.Get("name"))
	projectCode := strings.TrimSpace(query.Get("projectCode"))
	if projectCode == "" {
		projectCode = strings.TrimSpace(query.Get("project_code"))
	}

	nameExists := false
	codeExists := false
	if name != "" {
		exists, err := a.projectFieldExists(ctx, "name", name)
		if err != nil {
			return nil, err
		}
		nameExists = exists
	}
	if projectCode != "" {
		exists, err := a.projectFieldExists(ctx, "project_code", projectCode)
		if err != nil {
			return nil, err
		}
		codeExists = exists
	}

	return map[string]bool{
		"nameExists": nameExists,
		"codeExists": codeExists,
	}, nil
}

func (a *Adapter) projectFieldExists(ctx context.Context, field string, value string) (bool, error) {
	row := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*) AS cnt
		FROM aims_projects
		WHERE `+field+` = ? AND lifecycle_status != 'archived'
	`, value)
	var count int64
	if err := row.Scan(&count); err != nil {
		return false, fmt.Errorf("query project duplicate %s: %w", field, err)
	}
	return count > 0, nil
}
