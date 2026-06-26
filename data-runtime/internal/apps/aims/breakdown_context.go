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

var breakdownTerminalStatuses = []string{"in_review", "completed"}

type breakdownItem struct {
	ID                 int64    `json:"id"`
	ProjectID          int64    `json:"projectId"`
	ProjectCode        string   `json:"projectCode"`
	ProjectName        string   `json:"projectName"`
	MilestoneID        int64    `json:"milestoneId"`
	MilestoneName      string   `json:"milestoneName"`
	MilestoneStartDate *string  `json:"milestoneStartDate"`
	MilestoneEndDate   *string  `json:"milestoneEndDate"`
	PivrStage          *string  `json:"pivrStage"`
	ItemNumber         int64    `json:"itemNumber"`
	ItemKey            string   `json:"itemKey"`
	Tier               string   `json:"tier"`
	Type               string   `json:"type"`
	Title              string   `json:"title"`
	Description        *string  `json:"description"`
	StartDate          *string  `json:"startDate"`
	DueDate            *string  `json:"dueDate"`
	Status             string   `json:"status"`
	Priority           string   `json:"priority"`
	Severity           *string  `json:"severity"`
	AssigneeUID        *string  `json:"assigneeUid"`
	ReporterUID        *string  `json:"reporterUid"`
	EstimatedHours     *float64 `json:"estimatedHours"`
	ParentID           *int64   `json:"parentId"`
	ApprovalStatus     string   `json:"approvalStatus"`
	ReviewLevel        int64    `json:"reviewLevel"`
	Required           bool     `json:"required"`
	TemplateKey        *string  `json:"templateKey"`
	CreatedAt          string   `json:"createdAt"`
	UpdatedAt          string   `json:"updatedAt"`
}

type breakdownDeliverable struct {
	ID                  int64   `json:"id"`
	EntityType          string  `json:"entityType"`
	EntityID            *int64  `json:"entityId"`
	TargetID            *int64  `json:"targetId"`
	MatterID            *int64  `json:"matterId"`
	SourceDeliverableID *int64  `json:"sourceDeliverableId"`
	Name                string  `json:"name"`
	Description         *string `json:"description"`
	AcceptanceCriteria  *string `json:"acceptanceCriteria"`
	DeliverableType     string  `json:"deliverableType"`
	Required            bool    `json:"required"`
	SortOrder           int64   `json:"sortOrder"`
	Status              string  `json:"status"`
	DocumentUUID        *string `json:"documentUuid"`
	DocumentTitle       *string `json:"documentTitle"`
	DocumentSource      string  `json:"documentSource"`
	RepoProjectCode     *string `json:"repoProjectCode"`
	RepoFilePath        *string `json:"repoFilePath"`
	RepoCommitID        *string `json:"repoCommitId"`
	EvidenceURL         *string `json:"evidenceUrl"`
	EvidenceNote        *string `json:"evidenceNote"`
	SubmittedBy         *string `json:"submittedBy"`
	SubmittedAt         *string `json:"submittedAt"`
	ProjectID           int64   `json:"projectId"`
	ProjectCode         *string `json:"projectCode"`
	SourceStage         *string `json:"sourceStage"`
	SourceMilestoneName *string `json:"sourceMilestoneName"`
	SourceItemKey       *string `json:"sourceItemKey"`
	SourceItemTitle     *string `json:"sourceItemTitle"`
	CreatedAt           string  `json:"createdAt"`
	UpdatedAt           string  `json:"updatedAt"`
}

type breakdownDocument struct {
	ID                  int64   `json:"id"`
	UUID                string  `json:"uuid"`
	Title               string  `json:"title"`
	DocCategory         *string `json:"docCategory"`
	CodocsUUID          *string `json:"codocsUuid"`
	DocumentSource      string  `json:"documentSource"`
	RepoProjectCode     *string `json:"repoProjectCode"`
	RepoFilePath        *string `json:"repoFilePath"`
	RepoCommitID        *string `json:"repoCommitId"`
	ContentSize         int64   `json:"contentSize"`
	CreatedAt           string  `json:"createdAt"`
	UpdatedAt           string  `json:"updatedAt"`
	MilestoneID         *int64  `json:"milestoneId"`
	WorkItemID          *int64  `json:"workItemId"`
	SourceStage         *string `json:"sourceStage"`
	SourceMilestoneName *string `json:"sourceMilestoneName"`
	SourceItemKey       *string `json:"sourceItemKey"`
	SourceItemTitle     *string `json:"sourceItemTitle"`
}

type breakdownChild struct {
	ID             int64                  `json:"id"`
	ProjectID      int64                  `json:"projectId"`
	MilestoneID    int64                  `json:"milestoneId"`
	ItemNumber     int64                  `json:"itemNumber"`
	ItemKey        string                 `json:"itemKey"`
	Tier           string                 `json:"tier"`
	Type           string                 `json:"type"`
	Title          string                 `json:"title"`
	Description    *string                `json:"description"`
	StartDate      *string                `json:"startDate"`
	DueDate        *string                `json:"dueDate"`
	Status         string                 `json:"status"`
	Priority       string                 `json:"priority"`
	Severity       *string                `json:"severity"`
	AssigneeUID    *string                `json:"assigneeUid"`
	ReporterUID    *string                `json:"reporterUid"`
	EstimatedHours *float64               `json:"estimatedHours"`
	ParentID       *int64                 `json:"parentId"`
	SortOrder      int64                  `json:"sortOrder"`
	ApprovalStatus string                 `json:"approvalStatus"`
	Required       bool                   `json:"required"`
	TemplateKey    *string                `json:"templateKey"`
	CreatedAt      string                 `json:"createdAt"`
	UpdatedAt      string                 `json:"updatedAt"`
	Deliverables   []breakdownDeliverable `json:"deliverables"`
}

type breakdownApproval struct {
	ID             int64   `json:"id"`
	Transition     string  `json:"transition"`
	Title          *string `json:"title"`
	RequestedBy    string  `json:"requestedBy"`
	RequestedAt    string  `json:"requestedAt"`
	RequestComment *string `json:"requestComment"`
	ReviewerUID    *string `json:"reviewerUid"`
	Status         string  `json:"status"`
	ReviewedAt     *string `json:"reviewedAt"`
	ReviewComment  *string `json:"reviewComment"`
	CreatedAt      string  `json:"createdAt"`
}

type milestoneMeta struct {
	ID        int64
	Name      string
	PivrStage *string
	SortOrder int64
}

func (a *Adapter) workItemBreakdownContext(ctx context.Context, workItemID string, query url.Values) (map[string]any, error) {
	workItemID = strings.TrimSpace(workItemID)
	if workItemID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_work_item_id", "work item id is required")
	}
	if strings.TrimSpace(query.Get("current_user")) == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	item, err := a.breakdownItem(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	if item == nil {
		return nil, httperror.New(http.StatusNotFound, "work_item_not_found", "工作项不存在")
	}

	currentDeliverables, err := a.breakdownDeliverables(ctx, "d.project_id = ? AND d.target_id = ?", item.ProjectID, workItemID)
	if err != nil {
		return nil, err
	}
	currentDocuments, err := a.breakdownDocuments(ctx, `
		d.work_item_id = ?
		AND d.is_folder = 0
	`, workItemID)
	if err != nil {
		return nil, err
	}
	children, err := a.breakdownChildren(ctx, item.ID)
	if err != nil {
		return nil, err
	}

	childIDs := make([]any, 0, len(children))
	for _, child := range children {
		childIDs = append(childIDs, child.ID)
	}
	if len(childIDs) > 0 {
		childDeliverables, err := a.breakdownDeliverables(ctx, "d.project_id = ? AND d.matter_id IN ("+placeholders(len(childIDs))+")", append([]any{item.ProjectID}, childIDs...)...)
		if err != nil {
			return nil, err
		}
		byChild := make(map[int64][]breakdownDeliverable)
		for _, deliverable := range childDeliverables {
			if deliverable.MatterID == nil {
				continue
			}
			byChild[*deliverable.MatterID] = append(byChild[*deliverable.MatterID], deliverable)
		}
		for i := range children {
			children[i].Deliverables = byChild[children[i].ID]
			if children[i].Deliverables == nil {
				children[i].Deliverables = []breakdownDeliverable{}
			}
		}
	}

	latestApproval, err := a.breakdownApproval(ctx, item.ProjectID, item.ID, false)
	if err != nil {
		return nil, err
	}
	pendingApproval, err := a.breakdownApproval(ctx, item.ProjectID, item.ID, true)
	if err != nil {
		return nil, err
	}
	previousArtifacts, err := a.breakdownPreviousArtifacts(ctx, *item)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"item": item,
		"current": map[string]any{
			"documents":    currentDocuments,
			"deliverables": currentDeliverables,
		},
		"children":          children,
		"previousArtifacts": previousArtifacts,
		"latestApproval":    latestApproval,
		"pendingApproval":   pendingApproval,
	}, nil
}

func (a *Adapter) breakdownItem(ctx context.Context, workItemID string) (*breakdownItem, error) {
	row := a.DB().QueryRowContext(ctx, `
		SELECT
			wi.id,
			wi.project_id,
			p.project_code,
			p.name AS project_name,
			wi.milestone_id,
			m.name AS milestone_name,
			DATE_FORMAT(m.start_date, '%Y-%m-%d') AS milestone_start_date,
			DATE_FORMAT(m.end_date, '%Y-%m-%d') AS milestone_end_date,
			m.pivr_stage,
			wi.item_number,
			wi.item_key,
			wi.tier,
			wi.type,
			wi.title,
			wi.description,
			DATE_FORMAT(wi.start_date, '%Y-%m-%d') AS start_date,
			DATE_FORMAT(wi.due_date, '%Y-%m-%d') AS due_date,
			wi.status,
			wi.priority,
			wi.severity,
			wi.assignee_uid,
			wi.reporter_uid,
			wi.estimated_hours,
			wi.parent_id,
			wi.approval_status,
			wi.review_level,
			wi.required,
			wi.template_key,
			DATE_FORMAT(wi.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(wi.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		JOIN milestones m ON m.id = wi.milestone_id
		WHERE wi.id = ?
	`, workItemID)

	var item breakdownItem
	var milestoneStartDate, milestoneEndDate, pivrStage, description, startDate, dueDate sql.NullString
	var severity, assigneeUID, reporterUID, approvalStatus, templateKey, createdAt, updatedAt sql.NullString
	var estimatedHours sql.NullFloat64
	var parentID sql.NullInt64
	var reviewLevel sql.NullInt64
	var required int64
	if err := row.Scan(
		&item.ID,
		&item.ProjectID,
		&item.ProjectCode,
		&item.ProjectName,
		&item.MilestoneID,
		&item.MilestoneName,
		&milestoneStartDate,
		&milestoneEndDate,
		&pivrStage,
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
		&reviewLevel,
		&required,
		&templateKey,
		&createdAt,
		&updatedAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("query breakdown item: %w", err)
	}

	item.MilestoneStartDate = nullableString(milestoneStartDate)
	item.MilestoneEndDate = nullableString(milestoneEndDate)
	item.PivrStage = nullableString(pivrStage)
	item.Description = nullableString(description)
	item.StartDate = nullableString(startDate)
	item.DueDate = nullableString(dueDate)
	item.Severity = nullableString(severity)
	item.AssigneeUID = nullableString(assigneeUID)
	item.ReporterUID = nullableString(reporterUID)
	item.EstimatedHours = nullableFloat64(estimatedHours)
	item.ParentID = nullableInt64(parentID)
	item.ApprovalStatus = nullStringOr(approvalStatus, "not_required")
	item.ReviewLevel = nullInt64Or(reviewLevel, 1)
	item.Required = required != 0
	item.TemplateKey = nullableString(templateKey)
	item.CreatedAt = nullStringOr(createdAt, "")
	item.UpdatedAt = nullStringOr(updatedAt, "")
	return &item, nil
}

func (a *Adapter) breakdownDeliverables(ctx context.Context, where string, args ...any) ([]breakdownDeliverable, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			d.id,
			d.project_id,
			d.project_code,
			d.project_owner_id,
			d.milestone_owner_id,
			d.target_id,
			d.matter_id,
			d.name,
			d.description,
			d.acceptance_criteria,
			d.deliverable_type,
			d.required,
			d.sort_order,
			d.status,
			d.document_uuid,
			d.document_title,
			d.document_source,
			d.repo_project_code,
			d.repo_file_path,
			d.repo_commit_id,
			d.evidence_url,
			d.evidence_note,
			d.submitted_by,
			DATE_FORMAT(d.submitted_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
			DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(d.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
			m.pivr_stage AS source_stage,
			m.name AS source_milestone_name,
			wi.item_key AS source_item_key,
			wi.title AS source_item_title
		FROM deliverables d
		LEFT JOIN milestones m ON m.id = d.milestone_owner_id
		LEFT JOIN work_items wi ON wi.id = COALESCE(d.target_id, d.matter_id)
		WHERE `+where+`
		ORDER BY d.sort_order ASC, d.created_at ASC
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query breakdown deliverables: %w", err)
	}
	defer rows.Close()

	deliverables := make([]breakdownDeliverable, 0)
	for rows.Next() {
		deliverable, err := scanBreakdownDeliverable(rows)
		if err != nil {
			return nil, err
		}
		deliverables = append(deliverables, deliverable)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return deliverables, nil
}

func scanBreakdownDeliverable(rows *sql.Rows) (breakdownDeliverable, error) {
	var item breakdownDeliverable
	var projectCode, description, acceptanceCriteria, documentUUID, documentTitle, documentSource sql.NullString
	var repoProjectCode, repoFilePath, repoCommitID, evidenceURL, evidenceNote, submittedBy, submittedAt sql.NullString
	var createdAt, updatedAt, sourceStage, sourceMilestoneName, sourceItemKey, sourceItemTitle sql.NullString
	var projectOwnerID, milestoneOwnerID, targetID, matterID sql.NullInt64
	var required int64
	if err := rows.Scan(
		&item.ID,
		&item.ProjectID,
		&projectCode,
		&projectOwnerID,
		&milestoneOwnerID,
		&targetID,
		&matterID,
		&item.Name,
		&description,
		&acceptanceCriteria,
		&item.DeliverableType,
		&required,
		&item.SortOrder,
		&item.Status,
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
		&createdAt,
		&updatedAt,
		&sourceStage,
		&sourceMilestoneName,
		&sourceItemKey,
		&sourceItemTitle,
	); err != nil {
		return item, fmt.Errorf("scan breakdown deliverable: %w", err)
	}

	item.ProjectCode = nullableString(projectCode)
	item.TargetID = nullableInt64(targetID)
	item.MatterID = nullableInt64(matterID)
	item.Description = nullableString(description)
	item.AcceptanceCriteria = nullableString(acceptanceCriteria)
	item.Required = required != 0
	item.DocumentUUID = nullableString(documentUUID)
	item.DocumentTitle = nullableString(documentTitle)
	item.DocumentSource = nullStringOr(documentSource, "codocs")
	item.RepoProjectCode = nullableString(repoProjectCode)
	item.RepoFilePath = nullableString(repoFilePath)
	item.RepoCommitID = nullableString(repoCommitID)
	item.EvidenceURL = nullableString(evidenceURL)
	item.EvidenceNote = nullableString(evidenceNote)
	item.SubmittedBy = nullableString(submittedBy)
	item.SubmittedAt = nullableString(submittedAt)
	item.SourceStage = nullableString(sourceStage)
	item.SourceMilestoneName = nullableString(sourceMilestoneName)
	item.SourceItemKey = nullableString(sourceItemKey)
	item.SourceItemTitle = nullableString(sourceItemTitle)
	item.CreatedAt = nullStringOr(createdAt, "")
	item.UpdatedAt = nullStringOr(updatedAt, "")

	if projectOwnerID.Valid {
		item.EntityType = "project"
		item.EntityID = &projectOwnerID.Int64
	} else if milestoneOwnerID.Valid {
		item.EntityType = "milestone"
		item.EntityID = &milestoneOwnerID.Int64
	} else if targetID.Valid {
		item.EntityType = "target"
		item.EntityID = &targetID.Int64
	} else if matterID.Valid {
		item.EntityType = "matter"
		item.EntityID = &matterID.Int64
	} else {
		item.EntityType = "unknown"
	}
	if targetID.Valid && matterID.Valid {
		id := item.ID
		item.SourceDeliverableID = &id
	}
	return item, nil
}

func (a *Adapter) breakdownDocuments(ctx context.Context, where string, args ...any) ([]breakdownDocument, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			d.id,
			d.uuid,
			d.title,
			d.doc_category,
			d.codocs_uuid,
			d.document_source,
			d.repo_project_code,
			d.repo_file_path,
			d.repo_commit_id,
			d.content_size,
			DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(d.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
			COALESCE(d.milestone_id, wi.milestone_id) AS milestone_id,
			d.work_item_id,
			COALESCE(m.pivr_stage, mw.pivr_stage) AS source_stage,
			COALESCE(m.name, mw.name) AS source_milestone_name,
			wi.item_key AS source_item_key,
			wi.title AS source_item_title
		FROM project_documents d
		LEFT JOIN milestones m ON m.id = d.milestone_id
		LEFT JOIN work_items wi ON wi.id = d.work_item_id
		LEFT JOIN milestones mw ON mw.id = wi.milestone_id
		WHERE `+where+`
		ORDER BY d.updated_at DESC, d.created_at DESC
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query breakdown documents: %w", err)
	}
	defer rows.Close()

	documents := make([]breakdownDocument, 0)
	for rows.Next() {
		document, err := scanBreakdownDocument(rows)
		if err != nil {
			return nil, err
		}
		documents = append(documents, document)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return documents, nil
}

func scanBreakdownDocument(rows *sql.Rows) (breakdownDocument, error) {
	var item breakdownDocument
	var docCategory, codocsUUID, documentSource, repoProjectCode, repoFilePath, repoCommitID sql.NullString
	var createdAt, updatedAt, sourceStage, sourceMilestoneName, sourceItemKey, sourceItemTitle sql.NullString
	var milestoneID, workItemID sql.NullInt64
	if err := rows.Scan(
		&item.ID,
		&item.UUID,
		&item.Title,
		&docCategory,
		&codocsUUID,
		&documentSource,
		&repoProjectCode,
		&repoFilePath,
		&repoCommitID,
		&item.ContentSize,
		&createdAt,
		&updatedAt,
		&milestoneID,
		&workItemID,
		&sourceStage,
		&sourceMilestoneName,
		&sourceItemKey,
		&sourceItemTitle,
	); err != nil {
		return item, fmt.Errorf("scan breakdown document: %w", err)
	}
	item.DocCategory = nullableString(docCategory)
	item.CodocsUUID = nullableString(codocsUUID)
	item.DocumentSource = nullStringOr(documentSource, "codocs")
	if item.DocumentSource == "codocs" && !documentSource.Valid && repoProjectCode.Valid && repoFilePath.Valid {
		item.DocumentSource = "repo"
	}
	item.RepoProjectCode = nullableString(repoProjectCode)
	item.RepoFilePath = nullableString(repoFilePath)
	item.RepoCommitID = nullableString(repoCommitID)
	item.CreatedAt = nullStringOr(createdAt, "")
	item.UpdatedAt = nullStringOr(updatedAt, "")
	item.MilestoneID = nullableInt64(milestoneID)
	item.WorkItemID = nullableInt64(workItemID)
	item.SourceStage = nullableString(sourceStage)
	item.SourceMilestoneName = nullableString(sourceMilestoneName)
	item.SourceItemKey = nullableString(sourceItemKey)
	item.SourceItemTitle = nullableString(sourceItemTitle)
	return item, nil
}

func (a *Adapter) breakdownChildren(ctx context.Context, parentID int64) ([]breakdownChild, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			id,
			project_id,
			milestone_id,
			item_number,
			item_key,
			tier,
			type,
			title,
			description,
			DATE_FORMAT(start_date, '%Y-%m-%d') AS start_date,
			DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date,
			status,
			priority,
			severity,
			assignee_uid,
			reporter_uid,
			estimated_hours,
			parent_id,
			sort_order,
			approval_status,
			required,
			template_key,
			DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM work_items
		WHERE parent_id = ?
		ORDER BY sort_order ASC, created_at ASC
	`, parentID)
	if err != nil {
		return nil, fmt.Errorf("query breakdown children: %w", err)
	}
	defer rows.Close()

	children := make([]breakdownChild, 0)
	for rows.Next() {
		var item breakdownChild
		var description, startDate, dueDate, severity, assigneeUID, reporterUID, approvalStatus, templateKey, createdAt, updatedAt sql.NullString
		var estimatedHours sql.NullFloat64
		var parentID sql.NullInt64
		var required int64
		if err := rows.Scan(
			&item.ID,
			&item.ProjectID,
			&item.MilestoneID,
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
			&item.SortOrder,
			&approvalStatus,
			&required,
			&templateKey,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan breakdown child: %w", err)
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
		item.Required = required != 0
		item.TemplateKey = nullableString(templateKey)
		item.CreatedAt = nullStringOr(createdAt, "")
		item.UpdatedAt = nullStringOr(updatedAt, "")
		item.Deliverables = []breakdownDeliverable{}
		children = append(children, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return children, nil
}

func (a *Adapter) breakdownApproval(ctx context.Context, projectID int64, workItemID int64, pendingOnly bool) (*breakdownApproval, error) {
	statusFilter := ""
	if pendingOnly {
		statusFilter = "AND status = 'pending'"
	}
	row := a.DB().QueryRowContext(ctx, `
		SELECT
			id,
			transition,
			title,
			requested_by,
			DATE_FORMAT(requested_at, '%Y-%m-%d %H:%i:%s') AS requested_at,
			request_comment,
			reviewer_uid,
			status,
			DATE_FORMAT(reviewed_at, '%Y-%m-%d %H:%i:%s') AS reviewed_at,
			review_comment,
			DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM approval_records
		WHERE project_id = ?
		  AND work_item_owner_id = ?
		  `+statusFilter+`
		ORDER BY created_at DESC
		LIMIT 1
	`, projectID, workItemID)

	var item breakdownApproval
	var title, requestedAt, requestComment, reviewerUID, reviewedAt, reviewComment, createdAt sql.NullString
	if err := row.Scan(
		&item.ID,
		&item.Transition,
		&title,
		&item.RequestedBy,
		&requestedAt,
		&requestComment,
		&reviewerUID,
		&item.Status,
		&reviewedAt,
		&reviewComment,
		&createdAt,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("query breakdown approval: %w", err)
	}
	item.Title = nullableString(title)
	item.RequestedAt = nullStringOr(requestedAt, "")
	item.RequestComment = nullableString(requestComment)
	item.ReviewerUID = nullableString(reviewerUID)
	item.ReviewedAt = nullableString(reviewedAt)
	item.ReviewComment = nullableString(reviewComment)
	item.CreatedAt = nullStringOr(createdAt, "")
	return &item, nil
}

func (a *Adapter) breakdownPreviousArtifacts(ctx context.Context, item breakdownItem) (map[string]any, error) {
	projectDocs, err := a.breakdownDocuments(ctx, `
		d.project_id = ?
		AND d.milestone_id IS NULL
		AND d.work_item_id IS NULL
		AND d.is_folder = 0
	`, item.ProjectID)
	if err != nil {
		return nil, err
	}

	var currentSortOrder sql.NullInt64
	if err := a.DB().QueryRowContext(ctx, "SELECT sort_order FROM milestones WHERE id = ?", item.MilestoneID).Scan(&currentSortOrder); err != nil && err != sql.ErrNoRows {
		return nil, fmt.Errorf("query current milestone sort order: %w", err)
	}
	priorMilestones, err := a.priorBreakdownMilestones(ctx, item.ProjectID, item.MilestoneID, nullInt64Or(currentSortOrder, 0))
	if err != nil {
		return nil, err
	}

	priorMilestoneDocMap := make(map[int64]map[string]any)
	for _, milestone := range priorMilestones {
		priorMilestoneDocMap[milestone.ID] = map[string]any{
			"milestoneDocs": []breakdownDocument{},
			"workItemDocs":  map[int64]map[string]any{},
		}
	}

	priorIDs := make([]any, 0, len(priorMilestones))
	for _, milestone := range priorMilestones {
		priorIDs = append(priorIDs, milestone.ID)
	}
	if len(priorIDs) > 0 {
		docs, err := a.priorMilestoneDocuments(ctx, priorIDs)
		if err != nil {
			return nil, err
		}
		deliverableDocs, err := a.priorMilestoneDeliverableDocuments(ctx, priorIDs)
		if err != nil {
			return nil, err
		}
		a.addPriorMilestoneDocuments(priorMilestoneDocMap, docs)
		a.addPriorMilestoneDocuments(priorMilestoneDocMap, deliverableDocs)
	}

	completedItemDocs, err := a.completedItemDocuments(ctx, item.MilestoneID, item.ID)
	if err != nil {
		return nil, err
	}
	completedDeliverableDocs, err := a.completedDeliverableDocuments(ctx, item.MilestoneID, item.ID)
	if err != nil {
		return nil, err
	}
	completedDocMap := make(map[int64][]breakdownDocument)
	for _, document := range append(completedItemDocs, completedDeliverableDocs...) {
		if document.WorkItemID == nil {
			continue
		}
		completedDocMap[*document.WorkItemID] = appendBreakdownDocumentDedup(completedDocMap[*document.WorkItemID], document)
	}
	completedItems, err := a.completedBreakdownItems(ctx, item.MilestoneID, item.ID)
	if err != nil {
		return nil, err
	}

	milestones := make([]map[string]any, 0, len(priorMilestones))
	for _, milestone := range priorMilestones {
		entry := priorMilestoneDocMap[milestone.ID]
		workItemDocMap := entry["workItemDocs"].(map[int64]map[string]any)
		workItems := make([]map[string]any, 0, len(workItemDocMap))
		for wiID, value := range workItemDocMap {
			workItems = append(workItems, map[string]any{
				"id":        wiID,
				"itemKey":   value["itemKey"],
				"title":     value["itemTitle"],
				"documents": value["docs"],
			})
		}
		milestones = append(milestones, map[string]any{
			"id":        milestone.ID,
			"name":      milestone.Name,
			"pivrStage": milestone.PivrStage,
			"documents": entry["milestoneDocs"],
			"workItems": workItems,
		})
	}

	completedWorkItems := make([]map[string]any, 0, len(completedItems))
	for _, completed := range completedItems {
		docs := completedDocMap[completed.ID]
		if docs == nil {
			docs = []breakdownDocument{}
		}
		completedWorkItems = append(completedWorkItems, map[string]any{
			"id":        completed.ID,
			"itemKey":   completed.ItemKey,
			"title":     completed.Title,
			"documents": docs,
		})
	}

	return map[string]any{
		"project": map[string]any{
			"id":        item.ProjectID,
			"name":      item.ProjectName,
			"documents": projectDocs,
		},
		"milestones": milestones,
		"currentMilestoneCompleted": map[string]any{
			"milestoneId":   item.MilestoneID,
			"milestoneName": item.MilestoneName,
			"pivrStage":     item.PivrStage,
			"workItems":     completedWorkItems,
		},
	}, nil
}

func (a *Adapter) priorBreakdownMilestones(ctx context.Context, projectID int64, milestoneID int64, currentSortOrder int64) ([]milestoneMeta, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, name, pivr_stage, sort_order
		FROM milestones
		WHERE project_id = ?
		  AND id != ?
		  AND sort_order < ?
		ORDER BY sort_order ASC, start_date ASC, id ASC
	`, projectID, milestoneID, currentSortOrder)
	if err != nil {
		return nil, fmt.Errorf("query prior milestones: %w", err)
	}
	defer rows.Close()

	items := make([]milestoneMeta, 0)
	for rows.Next() {
		var item milestoneMeta
		var pivrStage sql.NullString
		if err := rows.Scan(&item.ID, &item.Name, &pivrStage, &item.SortOrder); err != nil {
			return nil, err
		}
		item.PivrStage = nullableString(pivrStage)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) priorMilestoneDocuments(ctx context.Context, milestoneIDs []any) ([]breakdownDocument, error) {
	ph := placeholders(len(milestoneIDs))
	args := append([]any{}, milestoneIDs...)
	args = append(args, milestoneIDs...)
	return a.breakdownDocuments(ctx, `
		d.is_folder = 0
		AND (
			d.milestone_id IN (`+ph+`)
			OR wi.milestone_id IN (`+ph+`)
		)
	`, args...)
}

func (a *Adapter) priorMilestoneDeliverableDocuments(ctx context.Context, milestoneIDs []any) ([]breakdownDocument, error) {
	ph := placeholders(len(milestoneIDs))
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			d.id AS deliverable_id,
			d.name AS deliverable_name,
			wi.id AS work_item_id,
			wi.milestone_id AS milestone_id,
			m.pivr_stage AS source_stage,
			m.name AS source_milestone_name,
			wi.item_key AS source_item_key,
			wi.title AS source_item_title,
			d.document_uuid,
			d.document_title,
			d.document_source,
			d.repo_project_code,
			d.repo_file_path,
			d.repo_commit_id,
			DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(d.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM deliverables d
		JOIN work_items wi ON wi.id = d.matter_id
		JOIN milestones m ON m.id = wi.milestone_id
		WHERE wi.milestone_id IN (`+ph+`)
		  AND (
			d.document_uuid IS NOT NULL
			OR (d.repo_project_code IS NOT NULL AND d.repo_file_path IS NOT NULL)
		  )
		ORDER BY m.sort_order ASC, wi.sort_order ASC, d.updated_at DESC
	`, milestoneIDs...)
	if err != nil {
		return nil, fmt.Errorf("query prior deliverable docs: %w", err)
	}
	defer rows.Close()
	return scanDeliverableDocuments(rows)
}

func (a *Adapter) completedItemDocuments(ctx context.Context, milestoneID int64, workItemID int64) ([]breakdownDocument, error) {
	args := []any{milestoneID}
	for _, status := range breakdownTerminalStatuses {
		args = append(args, status)
	}
	args = append(args, workItemID, workItemID)
	return a.breakdownDocuments(ctx, `
		d.is_folder = 0
		AND wi.milestone_id = ?
		AND wi.status IN (`+placeholders(len(breakdownTerminalStatuses))+`)
		AND wi.id != ?
		AND wi.id NOT IN (SELECT id FROM work_items WHERE parent_id = ?)
	`, args...)
}

func (a *Adapter) completedDeliverableDocuments(ctx context.Context, milestoneID int64, workItemID int64) ([]breakdownDocument, error) {
	args := []any{milestoneID}
	for _, status := range breakdownTerminalStatuses {
		args = append(args, status)
	}
	args = append(args, workItemID, workItemID)
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			d.id AS deliverable_id,
			d.name AS deliverable_name,
			wi.id AS work_item_id,
			wi.milestone_id AS milestone_id,
			m.pivr_stage AS source_stage,
			m.name AS source_milestone_name,
			wi.item_key AS source_item_key,
			wi.title AS source_item_title,
			d.document_uuid,
			d.document_title,
			d.document_source,
			d.repo_project_code,
			d.repo_file_path,
			d.repo_commit_id,
			DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
			DATE_FORMAT(d.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM deliverables d
		JOIN work_items wi ON wi.id = d.matter_id
		JOIN milestones m ON m.id = wi.milestone_id
		WHERE wi.milestone_id = ?
		  AND wi.status IN (`+placeholders(len(breakdownTerminalStatuses))+`)
		  AND wi.id != ?
		  AND wi.id NOT IN (SELECT id FROM work_items WHERE parent_id = ?)
		  AND (
			d.document_uuid IS NOT NULL
			OR (d.repo_project_code IS NOT NULL AND d.repo_file_path IS NOT NULL)
		  )
		ORDER BY wi.sort_order ASC, d.updated_at DESC
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query completed deliverable docs: %w", err)
	}
	defer rows.Close()
	return scanDeliverableDocuments(rows)
}

func scanDeliverableDocuments(rows *sql.Rows) ([]breakdownDocument, error) {
	documents := make([]breakdownDocument, 0)
	for rows.Next() {
		var deliverableID int64
		var deliverableName string
		var workItemID, milestoneID int64
		var sourceStage, sourceMilestoneName, sourceItemKey, sourceItemTitle sql.NullString
		var documentUUID, documentTitle, documentSource, repoProjectCode, repoFilePath, repoCommitID sql.NullString
		var createdAt, updatedAt sql.NullString
		if err := rows.Scan(
			&deliverableID,
			&deliverableName,
			&workItemID,
			&milestoneID,
			&sourceStage,
			&sourceMilestoneName,
			&sourceItemKey,
			&sourceItemTitle,
			&documentUUID,
			&documentTitle,
			&documentSource,
			&repoProjectCode,
			&repoFilePath,
			&repoCommitID,
			&createdAt,
			&updatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan deliverable document: %w", err)
		}
		docID := -deliverableID
		document := breakdownDocument{
			ID:                  docID,
			UUID:                nullStringOr(documentUUID, fmt.Sprintf("deliverable-%d", deliverableID)),
			Title:               nullStringOr(documentTitle, deliverableName),
			DocCategory:         stringPtr("deliverable"),
			CodocsUUID:          nullableString(documentUUID),
			DocumentSource:      nullStringOr(documentSource, "codocs"),
			RepoProjectCode:     nullableString(repoProjectCode),
			RepoFilePath:        nullableString(repoFilePath),
			RepoCommitID:        nullableString(repoCommitID),
			ContentSize:         0,
			CreatedAt:           nullStringOr(createdAt, ""),
			UpdatedAt:           nullStringOr(updatedAt, ""),
			MilestoneID:         &milestoneID,
			WorkItemID:          &workItemID,
			SourceStage:         nullableString(sourceStage),
			SourceMilestoneName: nullableString(sourceMilestoneName),
			SourceItemKey:       nullableString(sourceItemKey),
			SourceItemTitle:     nullableString(sourceItemTitle),
		}
		if document.DocumentSource == "repo" {
			document.CodocsUUID = nil
		}
		documents = append(documents, document)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return documents, nil
}

type completedBreakdownItem struct {
	ID      int64
	ItemKey string
	Title   string
}

func (a *Adapter) completedBreakdownItems(ctx context.Context, milestoneID int64, workItemID int64) ([]completedBreakdownItem, error) {
	args := []any{milestoneID}
	for _, status := range breakdownTerminalStatuses {
		args = append(args, status)
	}
	args = append(args, workItemID, workItemID)
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, item_key, title
		FROM work_items
		WHERE milestone_id = ?
		  AND status IN (`+placeholders(len(breakdownTerminalStatuses))+`)
		  AND id != ?
		  AND id NOT IN (SELECT id FROM work_items WHERE parent_id = ?)
		ORDER BY sort_order ASC, created_at ASC
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query completed items: %w", err)
	}
	defer rows.Close()

	items := make([]completedBreakdownItem, 0)
	for rows.Next() {
		var item completedBreakdownItem
		if err := rows.Scan(&item.ID, &item.ItemKey, &item.Title); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) addPriorMilestoneDocuments(target map[int64]map[string]any, documents []breakdownDocument) {
	for _, document := range documents {
		if document.MilestoneID == nil {
			continue
		}
		entry, ok := target[*document.MilestoneID]
		if !ok {
			continue
		}
		if document.WorkItemID == nil {
			entry["milestoneDocs"] = appendBreakdownDocumentDedup(entry["milestoneDocs"].([]breakdownDocument), document)
			continue
		}
		workItemDocs := entry["workItemDocs"].(map[int64]map[string]any)
		if _, ok := workItemDocs[*document.WorkItemID]; !ok {
			workItemDocs[*document.WorkItemID] = map[string]any{
				"itemKey":   stringValue(document.SourceItemKey),
				"itemTitle": stringValue(document.SourceItemTitle),
				"docs":      []breakdownDocument{},
			}
		}
		value := workItemDocs[*document.WorkItemID]
		value["docs"] = appendBreakdownDocumentDedup(value["docs"].([]breakdownDocument), document)
	}
}

func appendBreakdownDocumentDedup(documents []breakdownDocument, document breakdownDocument) []breakdownDocument {
	key := breakdownDocumentDedupKey(document)
	for _, existing := range documents {
		if breakdownDocumentDedupKey(existing) == key {
			return documents
		}
	}
	return append(documents, document)
}

func breakdownDocumentDedupKey(document breakdownDocument) string {
	if document.DocumentSource == "repo" {
		return "repo:" + stringValue(document.RepoProjectCode) + ":" + stringValue(document.RepoFilePath) + ":" + stringValue(document.RepoCommitID)
	}
	return "codocs:" + stringValue(firstStringPtr(document.CodocsUUID, &document.UUID))
}

func nullableFloat64(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	return &value.Float64
}

func nullStringOr(value sql.NullString, fallback string) string {
	if !value.Valid {
		return fallback
	}
	return value.String
}

func nullInt64Or(value sql.NullInt64, fallback int64) int64 {
	if !value.Valid {
		return fallback
	}
	return value.Int64
}

func stringPtr(value string) *string {
	return &value
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func firstStringPtr(values ...*string) *string {
	for _, value := range values {
		if value != nil && *value != "" {
			return value
		}
	}
	return nil
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}
