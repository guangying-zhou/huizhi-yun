package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

type requirementReviewBatch struct {
	ID                 int64                    `json:"id"`
	BatchType          string                   `json:"batchType"`
	Title              string                   `json:"title"`
	Description        *string                  `json:"description"`
	RequirementIDs     []int64                  `json:"requirementIds"`
	Requirements       []requirementReviewBrief `json:"requirements"`
	Status             string                   `json:"status"`
	WorkflowInstanceID *string                  `json:"workflowInstanceId"`
	SubmittedBy        string                   `json:"submittedBy"`
	SubmittedAt        string                   `json:"submittedAt"`
	ClosedAt           *string                  `json:"closedAt"`
}

type requirementReviewBrief struct {
	ID                  int64   `json:"id"`
	ItemKind            string  `json:"itemKind"`
	ParentRequirementID *int64  `json:"parentRequirementId"`
	MilestoneID         *int64  `json:"milestoneId"`
	MilestoneName       *string `json:"milestoneName"`
	ReqCode             string  `json:"reqCode"`
	Title               string  `json:"title"`
	Status              string  `json:"status"`
	Priority            string  `json:"priority"`
	ChangeReason        *string `json:"changeReason"`
	ScopeNote           *string `json:"scopeNote"`
}

func (a *Adapter) projectRequirementReviews(ctx context.Context, projectID string, query url.Values) (map[string]any, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	if err := a.requireProjectReadAccess(ctx, projectID, query); err != nil {
		return nil, err
	}
	projectID, err := normalizeRequiredID(projectID, "project_id")
	if err != nil {
		return nil, err
	}

	batches, allRequirementIDs, err := a.requirementReviewBatches(ctx, projectID)
	if err != nil {
		return nil, err
	}
	requirementMap, err := a.requirementReviewRequirementMap(ctx, projectID, allRequirementIDs)
	if err != nil {
		return nil, err
	}

	for index := range batches {
		requirements := make([]requirementReviewBrief, 0, len(batches[index].RequirementIDs))
		for _, requirementID := range batches[index].RequirementIDs {
			if requirement, ok := requirementMap[requirementID]; ok {
				requirements = append(requirements, requirement)
			}
		}
		batches[index].Requirements = requirements
	}

	return map[string]any{
		"batches": batches,
	}, nil
}

func (a *Adapter) requirementReviewBatches(ctx context.Context, projectID string) ([]requirementReviewBatch, []int64, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			id,
			batch_type,
			title,
			description,
			requirement_ids_json,
			status,
			workflow_instance_id,
			submitted_by,
			DATE_FORMAT(submitted_at, '%Y-%m-%d %H:%i:%s') AS submitted_at,
			DATE_FORMAT(closed_at, '%Y-%m-%d %H:%i:%s') AS closed_at
		FROM requirement_review_batches
		WHERE project_id = ?
		  AND status != 'withdrawn'
		ORDER BY submitted_at DESC, id DESC
	`, projectID)
	if err != nil {
		return nil, nil, fmt.Errorf("query requirement review batches: %w", err)
	}
	defer rows.Close()

	batches := make([]requirementReviewBatch, 0)
	seenIDs := make(map[int64]bool)
	allRequirementIDs := make([]int64, 0)
	for rows.Next() {
		var batch requirementReviewBatch
		var description, requirementIDsJSON, workflowInstanceID, submittedAt, closedAt sql.NullString
		if err := rows.Scan(
			&batch.ID,
			&batch.BatchType,
			&batch.Title,
			&description,
			&requirementIDsJSON,
			&batch.Status,
			&workflowInstanceID,
			&batch.SubmittedBy,
			&submittedAt,
			&closedAt,
		); err != nil {
			return nil, nil, fmt.Errorf("scan requirement review batch: %w", err)
		}
		batch.Description = nullableString(description)
		batch.RequirementIDs = parseRequirementReviewIDs(nullStringOr(requirementIDsJSON, ""))
		batch.WorkflowInstanceID = nullableString(workflowInstanceID)
		batch.SubmittedAt = nullStringOr(submittedAt, "")
		batch.ClosedAt = nullableString(closedAt)
		batch.Requirements = []requirementReviewBrief{}

		for _, requirementID := range batch.RequirementIDs {
			if !seenIDs[requirementID] {
				seenIDs[requirementID] = true
				allRequirementIDs = append(allRequirementIDs, requirementID)
			}
		}

		batches = append(batches, batch)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	return batches, allRequirementIDs, nil
}

func (a *Adapter) requirementReviewRequirementMap(ctx context.Context, projectID string, requirementIDs []int64) (map[int64]requirementReviewBrief, error) {
	result := make(map[int64]requirementReviewBrief)
	if len(requirementIDs) == 0 {
		return result, nil
	}

	args := make([]any, 0, len(requirementIDs)+1)
	args = append(args, projectID)
	for _, id := range requirementIDs {
		args = append(args, id)
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			r.id,
			r.item_kind,
			r.parent_requirement_id,
			r.milestone_id,
			m.name AS milestone_name,
			r.req_code,
			r.title,
			r.status,
			r.priority,
			r.change_reason,
			r.scope_note
		FROM requirement_items r
		LEFT JOIN milestones m ON m.id = r.milestone_id
		WHERE r.project_id = ?
		  AND r.id IN (`+placeholders(len(requirementIDs))+`)
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query requirement review requirements: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var requirement requirementReviewBrief
		var parentRequirementID, milestoneID sql.NullInt64
		var milestoneName, changeReason, scopeNote sql.NullString
		if err := rows.Scan(
			&requirement.ID,
			&requirement.ItemKind,
			&parentRequirementID,
			&milestoneID,
			&milestoneName,
			&requirement.ReqCode,
			&requirement.Title,
			&requirement.Status,
			&requirement.Priority,
			&changeReason,
			&scopeNote,
		); err != nil {
			return nil, fmt.Errorf("scan requirement review requirement: %w", err)
		}
		requirement.ParentRequirementID = nullableInt64(parentRequirementID)
		requirement.MilestoneID = nullableInt64(milestoneID)
		requirement.MilestoneName = nullableString(milestoneName)
		requirement.ChangeReason = nullableString(changeReason)
		requirement.ScopeNote = nullableString(scopeNote)
		result[requirement.ID] = requirement
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func parseRequirementReviewIDs(raw string) []int64 {
	if strings.TrimSpace(raw) == "" {
		return []int64{}
	}

	var ids []int64
	if err := json.Unmarshal([]byte(raw), &ids); err == nil {
		return ids
	}

	var mixed []any
	if err := json.Unmarshal([]byte(raw), &mixed); err != nil {
		return []int64{}
	}
	parsed := make([]int64, 0, len(mixed))
	for _, item := range mixed {
		switch value := item.(type) {
		case float64:
			parsed = append(parsed, int64(value))
		case int64:
			parsed = append(parsed, value)
		case string:
			if id, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64); err == nil && id > 0 {
				parsed = append(parsed, id)
			}
		}
	}
	return parsed
}
