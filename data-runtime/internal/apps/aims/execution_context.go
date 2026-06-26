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

type executionItem struct {
	ID                     int64    `json:"id"`
	ProjectID              int64    `json:"projectId"`
	ProjectCode            string   `json:"projectCode"`
	MilestoneID            int64    `json:"milestoneId"`
	MilestoneName          string   `json:"milestoneName"`
	ItemNumber             int64    `json:"itemNumber"`
	ItemKey                string   `json:"itemKey"`
	Tier                   string   `json:"tier"`
	Type                   string   `json:"type"`
	Title                  string   `json:"title"`
	Description            *string  `json:"description"`
	StartDate              *string  `json:"startDate"`
	DueDate                *string  `json:"dueDate"`
	Status                 string   `json:"status"`
	Priority               string   `json:"priority"`
	Severity               *string  `json:"severity"`
	AssigneeUID            *string  `json:"assigneeUid"`
	ReporterUID            *string  `json:"reporterUid"`
	EstimatedHours         *float64 `json:"estimatedHours"`
	ParentID               *int64   `json:"parentId"`
	ApprovalStatus         string   `json:"approvalStatus"`
	CreatedAt              string   `json:"createdAt"`
	UpdatedAt              string   `json:"updatedAt"`
	ParentItemKey          *string  `json:"parentItemKey"`
	ParentTitle            *string  `json:"parentTitle"`
	TemplateKey            *string  `json:"templateKey"`
	RequirementCategory    *string  `json:"requirementCategory"`
	DecompositionSourceID  *int64   `json:"decompositionSourceId"`
	DecompositionSourceKey *string  `json:"decompositionSourceKey"`
}

type executionDeliverable struct {
	ID                 int64   `json:"id"`
	TargetID           *int64  `json:"targetId"`
	MatterID           *int64  `json:"matterId"`
	Name               string  `json:"name"`
	Description        *string `json:"description"`
	AcceptanceCriteria *string `json:"acceptanceCriteria"`
	DeliverableType    string  `json:"deliverableType"`
	Required           bool    `json:"required"`
	Status             string  `json:"status"`
	DocumentUUID       *string `json:"documentUuid"`
	DocumentTitle      *string `json:"documentTitle"`
	DocumentSource     string  `json:"documentSource"`
	RepoProjectCode    *string `json:"repoProjectCode"`
	RepoFilePath       *string `json:"repoFilePath"`
	RepoCommitID       *string `json:"repoCommitId"`
	EvidenceURL        *string `json:"evidenceUrl"`
	EvidenceNote       *string `json:"evidenceNote"`
	SubmittedBy        *string `json:"submittedBy"`
	SubmittedAt        *string `json:"submittedAt"`
	CreatedAt          string  `json:"createdAt"`
	UpdatedAt          string  `json:"updatedAt"`
}

type executionCommit struct {
	ID              int64   `json:"id"`
	RepoProjectCode string  `json:"repoProjectCode"`
	CommitSHA       string  `json:"commitSha"`
	Message         string  `json:"message"`
	AuthorName      *string `json:"authorName"`
	AuthorEmail     *string `json:"authorEmail"`
	CommittedAt     string  `json:"committedAt"`
	Additions       *int64  `json:"additions"`
	Deletions       *int64  `json:"deletions"`
	FilesChanged    *int64  `json:"filesChanged"`
}

type executionTimeEntry struct {
	ID          int64   `json:"id"`
	UID         string  `json:"uid"`
	EntryDate   string  `json:"entryDate"`
	Hours       float64 `json:"hours"`
	Description *string `json:"description"`
	CreatedAt   string  `json:"createdAt"`
}

func (a *Adapter) workItemExecutionContext(ctx context.Context, workItemID string, query url.Values) (map[string]any, error) {
	workItemID = strings.TrimSpace(workItemID)
	if workItemID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_work_item_id", "work item id is required")
	}
	if strings.TrimSpace(query.Get("current_user")) == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	item, err := a.executionItem(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, httperror.New(http.StatusNotFound, "work_item_not_found", "工作项不存在")
	}

	deliverables, err := a.executionDeliverables(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	commits, err := a.executionCommits(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	timeEntries, err := a.executionTimeEntries(ctx, workItemID)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"item":         item,
		"deliverables": deliverables,
		"commits":      commits,
		"timeEntries":  timeEntries,
	}, nil
}

func (a *Adapter) executionItem(ctx context.Context, workItemID string) (*executionItem, error) {
	row := a.DB().QueryRowContext(ctx, `
		SELECT
			wi.id, wi.project_id, p.project_code, wi.milestone_id, m.name AS milestone_name,
			wi.item_number, wi.item_key, wi.tier, wi.type, wi.title, wi.description,
			wi.start_date, wi.due_date, wi.status, wi.priority, wi.severity,
			wi.assignee_uid, wi.reporter_uid, wi.estimated_hours,
			wi.parent_id, wi.approval_status, wi.created_at, wi.updated_at,
			pw.item_key AS parent_item_key, pw.title AS parent_title,
			wi.template_key, wi.requirement_category, wi.decomposition_source_id,
			ds.item_key AS decomposition_source_key
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		JOIN milestones m ON m.id = wi.milestone_id
		LEFT JOIN work_items pw ON pw.id = wi.parent_id
		LEFT JOIN work_items ds ON ds.id = wi.decomposition_source_id
		WHERE wi.id = ?
	`, workItemID)

	var item executionItem
	var description, startDate, dueDate, severity, assigneeUID, reporterUID sql.NullString
	var estimatedHours sql.NullFloat64
	var parentID, decompositionSourceID sql.NullInt64
	var approvalStatus, parentItemKey, parentTitle, templateKey, requirementCategory, decompositionSourceKey sql.NullString
	if err := row.Scan(
		&item.ID,
		&item.ProjectID,
		&item.ProjectCode,
		&item.MilestoneID,
		&item.MilestoneName,
		&item.ItemNumber,
		&item.ItemKey,
		&item.Tier,
		&item.Type,
		&item.Title,
		&description,
		&startDate,
		&dueDate,
		&item.Status,
		&item.Priority,
		&severity,
		&assigneeUID,
		&reporterUID,
		&estimatedHours,
		&parentID,
		&approvalStatus,
		&item.CreatedAt,
		&item.UpdatedAt,
		&parentItemKey,
		&parentTitle,
		&templateKey,
		&requirementCategory,
		&decompositionSourceID,
		&decompositionSourceKey,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("query execution work item: %w", err)
	}

	item.Description = nullableString(description)
	item.StartDate = nullableString(startDate)
	item.DueDate = nullableString(dueDate)
	item.Severity = nullableString(severity)
	item.AssigneeUID = nullableString(assigneeUID)
	item.ReporterUID = nullableString(reporterUID)
	item.EstimatedHours = nullableFloat64(estimatedHours)
	item.ParentID = nullableInt64(parentID)
	item.ApprovalStatus = nullStringOr(approvalStatus, "not_required")
	item.ParentItemKey = nullableString(parentItemKey)
	item.ParentTitle = nullableString(parentTitle)
	item.TemplateKey = nullableString(templateKey)
	item.RequirementCategory = nullableString(requirementCategory)
	item.DecompositionSourceID = nullableInt64(decompositionSourceID)
	item.DecompositionSourceKey = nullableString(decompositionSourceKey)
	return &item, nil
}

func (a *Adapter) executionDeliverables(ctx context.Context, workItemID string) ([]executionDeliverable, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, target_id, matter_id, name, description, acceptance_criteria, deliverable_type,
		       `+"`required`"+`, status, document_uuid, document_title,
		       document_source, repo_project_code, repo_file_path, repo_commit_id,
		       evidence_url, evidence_note,
		       submitted_by, submitted_at, created_at, updated_at
		FROM deliverables
		WHERE target_id = ? OR matter_id = ?
		ORDER BY sort_order ASC, created_at ASC
	`, workItemID, workItemID)
	if err != nil {
		return nil, fmt.Errorf("query execution deliverables: %w", err)
	}
	defer rows.Close()

	deliverables := make([]executionDeliverable, 0)
	for rows.Next() {
		var deliverable executionDeliverable
		var targetID, matterID sql.NullInt64
		var description, acceptanceCriteria, documentUUID, documentTitle, documentSource sql.NullString
		var repoProjectCode, repoFilePath, repoCommitID, evidenceURL, evidenceNote, submittedBy, submittedAt sql.NullString
		var required int64
		if err := rows.Scan(
			&deliverable.ID,
			&targetID,
			&matterID,
			&deliverable.Name,
			&description,
			&acceptanceCriteria,
			&deliverable.DeliverableType,
			&required,
			&deliverable.Status,
			&documentUUID,
			&documentTitle,
			&documentSource,
			&repoProjectCode,
			&repoFilePath,
			&repoCommitID,
			&evidenceURL,
			&evidenceNote,
			&submittedBy,
			&submittedAt,
			&deliverable.CreatedAt,
			&deliverable.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan execution deliverable: %w", err)
		}
		deliverable.TargetID = nullableInt64(targetID)
		deliverable.MatterID = nullableInt64(matterID)
		deliverable.Description = nullableString(description)
		deliverable.AcceptanceCriteria = nullableString(acceptanceCriteria)
		deliverable.Required = required != 0
		deliverable.DocumentUUID = nullableString(documentUUID)
		deliverable.DocumentTitle = nullableString(documentTitle)
		deliverable.DocumentSource = nullStringOr(documentSource, "codocs")
		deliverable.RepoProjectCode = nullableString(repoProjectCode)
		deliverable.RepoFilePath = nullableString(repoFilePath)
		deliverable.RepoCommitID = nullableString(repoCommitID)
		deliverable.EvidenceURL = nullableString(evidenceURL)
		deliverable.EvidenceNote = nullableString(evidenceNote)
		deliverable.SubmittedBy = nullableString(submittedBy)
		deliverable.SubmittedAt = nullableString(submittedAt)
		deliverables = append(deliverables, deliverable)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return deliverables, nil
}

func (a *Adapter) executionCommits(ctx context.Context, workItemID string) ([]executionCommit, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, repo_project_code, commit_sha, message, author_name, author_email, committed_at,
		       additions, deletions, files_changed
		FROM gitlab_commits
		WHERE work_item_id = ?
		ORDER BY committed_at DESC
	`, workItemID)
	if err != nil {
		return nil, fmt.Errorf("query execution commits: %w", err)
	}
	defer rows.Close()

	commits := make([]executionCommit, 0)
	for rows.Next() {
		var commit executionCommit
		var authorName, authorEmail sql.NullString
		var additions, deletions, filesChanged sql.NullInt64
		if err := rows.Scan(
			&commit.ID,
			&commit.RepoProjectCode,
			&commit.CommitSHA,
			&commit.Message,
			&authorName,
			&authorEmail,
			&commit.CommittedAt,
			&additions,
			&deletions,
			&filesChanged,
		); err != nil {
			return nil, fmt.Errorf("scan execution commit: %w", err)
		}
		commit.AuthorName = nullableString(authorName)
		commit.AuthorEmail = nullableString(authorEmail)
		commit.Additions = nullableInt64(additions)
		commit.Deletions = nullableInt64(deletions)
		commit.FilesChanged = nullableInt64(filesChanged)
		commits = append(commits, commit)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return commits, nil
}

func (a *Adapter) executionTimeEntries(ctx context.Context, workItemID string) ([]executionTimeEntry, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, uid, entry_date, hours, description, created_at
		FROM time_entries
		WHERE work_item_id = ?
		ORDER BY entry_date ASC, created_at ASC
	`, workItemID)
	if err != nil {
		return nil, fmt.Errorf("query execution time entries: %w", err)
	}
	defer rows.Close()

	entries := make([]executionTimeEntry, 0)
	for rows.Next() {
		var entry executionTimeEntry
		var description sql.NullString
		if err := rows.Scan(
			&entry.ID,
			&entry.UID,
			&entry.EntryDate,
			&entry.Hours,
			&description,
			&entry.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan execution time entry: %w", err)
		}
		entry.Description = nullableString(description)
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return entries, nil
}
