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

type milestoneDetail struct {
	ID           int64                       `json:"id"`
	ProjectID    int64                       `json:"projectId"`
	TemplateKey  *string                     `json:"templateKey"`
	Name         string                      `json:"name"`
	Description  *string                     `json:"description"`
	Mode         string                      `json:"mode"`
	PivrStage    *string                     `json:"pivrStage"`
	StartDate    *string                     `json:"startDate"`
	EndDate      *string                     `json:"endDate"`
	Status       string                      `json:"status"`
	SortOrder    int64                       `json:"sortOrder"`
	Progress     int64                       `json:"progress"`
	Deliverables []milestoneDeliverableState `json:"deliverables"`
}

type milestoneDetailRow struct {
	milestoneDetail
	totalWeight     float64
	completedWeight float64
}

type milestoneDeliverableState struct {
	Name      string `json:"name"`
	Required  bool   `json:"required"`
	Completed bool   `json:"completed"`
}

type milestoneDetailWorkItem struct {
	ID             int64                     `json:"id"`
	ItemKey        string                    `json:"itemKey"`
	Tier           string                    `json:"tier"`
	Type           string                    `json:"type"`
	Title          string                    `json:"title"`
	Description    *string                   `json:"description"`
	Status         string                    `json:"status"`
	Priority       string                    `json:"priority"`
	AssigneeUID    *string                   `json:"assigneeUid"`
	ReporterUID    *string                   `json:"reporterUid"`
	StartDate      *string                   `json:"startDate"`
	DueDate        *string                   `json:"dueDate"`
	EstimatedHours *float64                  `json:"estimatedHours"`
	ParentID       *int64                    `json:"parentId"`
	TemplateKey    *string                   `json:"templateKey"`
	SortOrder      int64                     `json:"sortOrder"`
	RequirementID  *int64                    `json:"requirementId"`
	Deliverables   []milestoneDeliverable    `json:"deliverables"`
	Matters        []milestoneDetailWorkItem `json:"matters"`
}

type milestoneWorkItemRow struct {
	milestoneDetailWorkItem
	ProjectID   int64
	MilestoneID int64
}

type milestoneDeliverable struct {
	ID                 int64   `json:"id"`
	TargetID           *int64  `json:"targetId"`
	MatterID           *int64  `json:"matterId"`
	Name               string  `json:"name"`
	Description        *string `json:"description"`
	AcceptanceCriteria *string `json:"acceptanceCriteria"`
	DeliverableType    string  `json:"deliverableType"`
	Required           bool    `json:"required"`
	Status             string  `json:"status"`
	SortOrder          int64   `json:"sortOrder"`
}

func (a *Adapter) milestoneDetail(ctx context.Context, milestoneID string, query url.Values) (map[string]any, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	milestoneID, err := normalizeRequiredID(milestoneID, "milestone_id")
	if err != nil {
		return nil, err
	}

	milestone, err := a.queryMilestoneDetail(ctx, milestoneID)
	if err != nil {
		return nil, err
	}
	if milestone == nil {
		return nil, httperror.New(http.StatusNotFound, "milestone_not_found", "里程碑不存在")
	}

	milestone.Deliverables, err = a.milestoneDeliverableStates(ctx, milestone.ProjectID, milestone.ID)
	if err != nil {
		return nil, err
	}
	items, err := a.milestoneWorkItems(ctx, milestoneID)
	if err != nil {
		return nil, err
	}
	deliverables, err := a.milestoneWorkItemDeliverables(ctx, items)
	if err != nil {
		return nil, err
	}

	deliverablesByMatter := make(map[int64][]milestoneDeliverable)
	deliverablesByTarget := make(map[int64][]milestoneDeliverable)
	for _, deliverable := range deliverables {
		if deliverable.MatterID != nil {
			deliverablesByMatter[*deliverable.MatterID] = append(deliverablesByMatter[*deliverable.MatterID], deliverable)
		} else if deliverable.TargetID != nil {
			deliverablesByTarget[*deliverable.TargetID] = append(deliverablesByTarget[*deliverable.TargetID], deliverable)
		}
	}

	targets := make([]milestoneDetailWorkItem, 0)
	targetIDs := make(map[int64]bool)
	for _, item := range items {
		if item.Tier != "target" {
			continue
		}
		target := item.milestoneDetailWorkItem
		target.Deliverables = deliverablesByTarget[item.ID]
		if target.Deliverables == nil {
			target.Deliverables = []milestoneDeliverable{}
		}
		target.Matters = make([]milestoneDetailWorkItem, 0)
		for _, matterRow := range items {
			if matterRow.Tier != "matter" || matterRow.ParentID == nil || *matterRow.ParentID != item.ID {
				continue
			}
			matter := matterRow.milestoneDetailWorkItem
			matter.Deliverables = deliverablesByMatter[matter.ID]
			if matter.Deliverables == nil {
				matter.Deliverables = []milestoneDeliverable{}
			}
			target.Matters = append(target.Matters, matter)
		}
		targetIDs[target.ID] = true
		targets = append(targets, target)
	}

	orphanMatters := make([]milestoneDetailWorkItem, 0)
	for _, item := range items {
		if item.Tier != "matter" {
			continue
		}
		if item.ParentID != nil && targetIDs[*item.ParentID] {
			continue
		}
		matter := item.milestoneDetailWorkItem
		matter.Deliverables = deliverablesByMatter[matter.ID]
		if matter.Deliverables == nil {
			matter.Deliverables = []milestoneDeliverable{}
		}
		orphanMatters = append(orphanMatters, matter)
	}

	return map[string]any{
		"milestone":     milestone,
		"targets":       targets,
		"orphanMatters": orphanMatters,
	}, nil
}

func (a *Adapter) queryMilestoneDetail(ctx context.Context, milestoneID string) (*milestoneDetail, error) {
	row := a.DB().QueryRowContext(ctx, `
		SELECT m.id, m.project_id, m.template_key, m.name, m.description, m.mode,
		       m.pivr_stage, m.start_date, m.end_date, m.status, m.sort_order,
		       IFNULL(SUM(wi.weight), 0) AS total_weight,
		       IFNULL(SUM(CASE WHEN wi.status = 'completed' THEN wi.weight ELSE 0 END), 0) AS completed_weight
		FROM milestones m
		LEFT JOIN work_items wi ON wi.project_id = m.project_id AND wi.milestone_id = m.id
		WHERE m.id = ?
		GROUP BY m.id
	`, milestoneID)

	var rowData milestoneDetailRow
	var templateKey, description, pivrStage, startDate, endDate sql.NullString
	if err := row.Scan(
		&rowData.ID,
		&rowData.ProjectID,
		&templateKey,
		&rowData.Name,
		&description,
		&rowData.Mode,
		&pivrStage,
		&startDate,
		&endDate,
		&rowData.Status,
		&rowData.SortOrder,
		&rowData.totalWeight,
		&rowData.completedWeight,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("query milestone detail: %w", err)
	}
	rowData.TemplateKey = nullableString(templateKey)
	rowData.Description = nullableString(description)
	rowData.PivrStage = nullableString(pivrStage)
	rowData.StartDate = nullableString(startDate)
	rowData.EndDate = nullableString(endDate)
	if rowData.totalWeight > 0 {
		rowData.Progress = int64((rowData.completedWeight/rowData.totalWeight)*100 + 0.5)
	}
	return &rowData.milestoneDetail, nil
}

func (a *Adapter) milestoneDeliverableStates(ctx context.Context, projectID int64, milestoneID int64) ([]milestoneDeliverableState, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT d.name, d.`+"`required`"+`, d.status
		FROM deliverables d
		LEFT JOIN work_items wi ON wi.id = d.target_id
		WHERE d.project_id = ?
		  AND (
		    d.milestone_owner_id = ?
		    OR wi.milestone_id = ?
		  )
		ORDER BY d.sort_order ASC, d.created_at ASC, d.id ASC
	`, projectID, milestoneID, milestoneID)
	if err != nil {
		return nil, fmt.Errorf("query milestone deliverables: %w", err)
	}
	defer rows.Close()

	states := make([]milestoneDeliverableState, 0)
	byName := make(map[string]int)
	for rows.Next() {
		var name string
		var required int64
		var status string
		if err := rows.Scan(&name, &required, &status); err != nil {
			return nil, fmt.Errorf("scan milestone deliverable: %w", err)
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if idx, ok := byName[name]; ok {
			states[idx].Required = states[idx].Required || required != 0
			states[idx].Completed = states[idx].Completed || status == "approved"
			continue
		}
		byName[name] = len(states)
		states = append(states, milestoneDeliverableState{
			Name:      name,
			Required:  required != 0,
			Completed: status == "approved",
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	reqRows, err := a.DB().QueryContext(ctx, `
		SELECT title, status, `+"`required`"+`
		FROM work_items
		WHERE project_id = ?
		  AND tier = 'target'
		  AND type = 'requirement'
		  AND milestone_id = ?
		ORDER BY sort_order ASC, created_at ASC
	`, projectID, milestoneID)
	if err != nil {
		return nil, fmt.Errorf("query milestone requirement deliverables: %w", err)
	}
	defer reqRows.Close()
	for reqRows.Next() {
		var title, status string
		var required int64
		if err := reqRows.Scan(&title, &status, &required); err != nil {
			return nil, fmt.Errorf("scan milestone requirement deliverable: %w", err)
		}
		title = strings.TrimSpace(title)
		if title == "" {
			continue
		}
		if _, ok := byName[title]; ok {
			continue
		}
		byName[title] = len(states)
		states = append(states, milestoneDeliverableState{
			Name:      title,
			Required:  required != 0,
			Completed: status == "completed",
		})
	}
	if err := reqRows.Err(); err != nil {
		return nil, err
	}
	return states, nil
}

func (a *Adapter) milestoneWorkItems(ctx context.Context, milestoneID string) ([]milestoneWorkItemRow, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, project_id, milestone_id, item_key, tier, type, title, description,
		       status, priority, assignee_uid, reporter_uid, start_date, due_date,
		       estimated_hours, parent_id, template_key, sort_order, created_at, requirement_id
		FROM work_items
		WHERE milestone_id = ?
		ORDER BY tier ASC, sort_order ASC, id ASC
	`, milestoneID)
	if err != nil {
		return nil, fmt.Errorf("query milestone work items: %w", err)
	}
	defer rows.Close()

	items := make([]milestoneWorkItemRow, 0)
	for rows.Next() {
		var item milestoneWorkItemRow
		var description, assigneeUID, reporterUID, startDate, dueDate, templateKey sql.NullString
		var estimatedHours sql.NullFloat64
		var parentID, requirementID sql.NullInt64
		var createdAt string
		if err := rows.Scan(
			&item.ID,
			&item.ProjectID,
			&item.MilestoneID,
			&item.ItemKey,
			&item.Tier,
			&item.Type,
			&item.Title,
			&description,
			&item.Status,
			&item.Priority,
			&assigneeUID,
			&reporterUID,
			&startDate,
			&dueDate,
			&estimatedHours,
			&parentID,
			&templateKey,
			&item.SortOrder,
			&createdAt,
			&requirementID,
		); err != nil {
			return nil, fmt.Errorf("scan milestone work item: %w", err)
		}
		item.Description = nullableString(description)
		item.AssigneeUID = nullableString(assigneeUID)
		item.ReporterUID = nullableString(reporterUID)
		item.StartDate = nullableString(startDate)
		item.DueDate = nullableString(dueDate)
		item.EstimatedHours = nullableFloat64(estimatedHours)
		item.ParentID = nullableInt64(parentID)
		item.TemplateKey = nullableString(templateKey)
		item.RequirementID = nullableInt64(requirementID)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) milestoneWorkItemDeliverables(ctx context.Context, items []milestoneWorkItemRow) ([]milestoneDeliverable, error) {
	ids := make([]any, 0)
	seen := make(map[int64]bool)
	for _, item := range items {
		if item.Tier != "target" && item.Tier != "matter" {
			continue
		}
		if seen[item.ID] {
			continue
		}
		seen[item.ID] = true
		ids = append(ids, item.ID)
	}
	if len(ids) == 0 {
		return []milestoneDeliverable{}, nil
	}
	ph := placeholders(len(ids))
	args := append([]any{}, ids...)
	args = append(args, ids...)
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, target_id, matter_id, name, description, acceptance_criteria, deliverable_type,
		       `+"`required`"+`, status, sort_order
		FROM deliverables
		WHERE target_id IN (`+ph+`)
		   OR matter_id IN (`+ph+`)
		ORDER BY sort_order ASC, id ASC
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query milestone work item deliverables: %w", err)
	}
	defer rows.Close()

	deliverables := make([]milestoneDeliverable, 0)
	for rows.Next() {
		var deliverable milestoneDeliverable
		var targetID, matterID sql.NullInt64
		var description, acceptanceCriteria sql.NullString
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
			&deliverable.SortOrder,
		); err != nil {
			return nil, fmt.Errorf("scan milestone work item deliverable: %w", err)
		}
		deliverable.TargetID = nullableInt64(targetID)
		deliverable.MatterID = nullableInt64(matterID)
		deliverable.Description = nullableString(description)
		deliverable.AcceptanceCriteria = nullableString(acceptanceCriteria)
		deliverable.Required = required != 0
		deliverables = append(deliverables, deliverable)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return deliverables, nil
}
