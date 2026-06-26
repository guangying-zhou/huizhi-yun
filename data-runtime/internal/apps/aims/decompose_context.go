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

var allowedDecomposeTemplateKeys = map[string]bool{
	"requirement_baseline":  true,
	"requirement_breakdown": true,
	"requirement_change":    true,
}

type decomposeWorkItem struct {
	ID             int64   `json:"id"`
	ItemKey        string  `json:"itemKey"`
	Title          string  `json:"title"`
	Tier           string  `json:"tier"`
	Type           string  `json:"type"`
	TemplateKey    *string `json:"templateKey"`
	Status         string  `json:"status"`
	ApprovalStatus string  `json:"approvalStatus"`
	ReviewLevel    int64   `json:"reviewLevel"`
	ProjectID      int64   `json:"projectId"`
	ProjectCode    string  `json:"projectCode"`
	ProjectName    string  `json:"projectName"`
	MilestoneID    int64   `json:"milestoneId"`
	MilestoneName  string  `json:"milestoneName"`
}

type decomposeAnchor struct {
	Anchor                      string  `json:"anchor"`
	SourceDocumentUUID          string  `json:"sourceDocumentUuid"`
	SourceDocumentTitle         string  `json:"sourceDocumentTitle"`
	HeadingDepth                int64   `json:"headingDepth"`
	WorkItemID                  int64   `json:"workItemId"`
	WorkItemKey                 string  `json:"workItemKey"`
	WorkItemTier                string  `json:"workItemTier"`
	WorkItemParentID            *int64  `json:"workItemParentId"`
	WorkItemRequirementCategory *string `json:"workItemRequirementCategory"`
}

type decomposeItemRow struct {
	workItem    decomposeWorkItem
	portfolioID *int64
	gitGroup    *string
}

func (a *Adapter) workItemDecomposeContextData(ctx context.Context, workItemID string, query url.Values) (map[string]any, error) {
	workItemID = strings.TrimSpace(workItemID)
	if workItemID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_work_item_id", "work item id is required")
	}
	if strings.TrimSpace(query.Get("current_user")) == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	itemRow, err := a.decomposeWorkItem(ctx, workItemID)
	if err != nil {
		return nil, err
	}
	if itemRow == nil {
		return nil, httperror.New(http.StatusNotFound, "work_item_not_found", "工作项不存在")
	}
	templateKey := stringValue(itemRow.workItem.TemplateKey)
	if !allowedDecomposeTemplateKeys[templateKey] {
		return nil, httperror.New(http.StatusBadRequest, "unsupported_decompose_item", "当前工作项不支持需求分解，请在模板工作项（需求分解 / 需求变更）中操作")
	}

	sourceProjectCodes, err := a.decomposeSourceProjectCodes(ctx, itemRow.workItem.ProjectID, itemRow.gitGroup)
	if err != nil {
		return nil, err
	}
	anchors, err := a.decomposeExistingAnchors(ctx, itemRow.workItem.ProjectID)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"workItem":           itemRow.workItem,
		"sourceProjectCodes": sourceProjectCodes,
		"existingAnchors":    anchors,
	}, nil
}

func (a *Adapter) decomposeWorkItem(ctx context.Context, workItemID string) (*decomposeItemRow, error) {
	row := a.DB().QueryRowContext(ctx, `
		SELECT
			wi.id,
			wi.project_id,
			p.project_code,
			p.name AS project_name,
			wi.milestone_id,
			m.name AS milestone_name,
			wi.item_key,
			wi.title,
			wi.tier,
			wi.type,
			wi.template_key,
			wi.status,
			wi.approval_status,
			wi.review_level,
			p.portfolio_id,
			pf.git_group
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		JOIN milestones m ON m.id = wi.milestone_id
		LEFT JOIN project_portfolios pf ON pf.id = p.portfolio_id
		WHERE wi.id = ?
	`, workItemID)

	var item decomposeItemRow
	var templateKey, approvalStatus, gitGroup sql.NullString
	var reviewLevel, portfolioID sql.NullInt64
	if err := row.Scan(
		&item.workItem.ID,
		&item.workItem.ProjectID,
		&item.workItem.ProjectCode,
		&item.workItem.ProjectName,
		&item.workItem.MilestoneID,
		&item.workItem.MilestoneName,
		&item.workItem.ItemKey,
		&item.workItem.Title,
		&item.workItem.Tier,
		&item.workItem.Type,
		&templateKey,
		&item.workItem.Status,
		&approvalStatus,
		&reviewLevel,
		&portfolioID,
		&gitGroup,
	); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("query decompose work item: %w", err)
	}
	item.workItem.TemplateKey = nullableString(templateKey)
	item.workItem.ApprovalStatus = nullStringOr(approvalStatus, "not_required")
	item.workItem.ReviewLevel = nullInt64Or(reviewLevel, 1)
	item.portfolioID = nullableInt64(portfolioID)
	item.gitGroup = nullableString(gitGroup)
	return &item, nil
}

func (a *Adapter) decomposeSourceProjectCodes(ctx context.Context, projectID int64, gitGroup *string) ([]string, error) {
	seen := make(map[string]bool)
	codes := make([]string, 0)
	addCode := func(value string) {
		code := strings.TrimSpace(value)
		if code == "" || seen[code] {
			return
		}
		seen[code] = true
		codes = append(codes, code)
	}
	if gitGroup != nil {
		addCode(*gitGroup)
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT repo_project_code
		FROM aims_project_repos
		WHERE project_id = ?
		ORDER BY id ASC
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("query decompose project repos: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var repoProjectCode sql.NullString
		if err := rows.Scan(&repoProjectCode); err != nil {
			return nil, err
		}
		if repoProjectCode.Valid {
			addCode(repoProjectCode.String)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return codes, nil
}

func (a *Adapter) decomposeExistingAnchors(ctx context.Context, projectID int64) ([]decomposeAnchor, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
			a.heading_anchor,
			a.source_document_uuid,
			a.source_document_title,
			a.heading_depth,
			a.work_item_id,
			wi.item_key AS work_item_key,
			wi.tier AS work_item_tier,
			wi.parent_id AS work_item_parent_id,
			wi.requirement_category AS work_item_req_category
		FROM work_item_source_anchors a
		JOIN work_items wi ON wi.id = a.work_item_id
		WHERE wi.project_id = ?
		ORDER BY a.source_document_uuid, a.sort_order
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("query decompose anchors: %w", err)
	}
	defer rows.Close()

	anchors := make([]decomposeAnchor, 0)
	for rows.Next() {
		var anchor decomposeAnchor
		var parentID sql.NullInt64
		var requirementCategory sql.NullString
		if err := rows.Scan(
			&anchor.Anchor,
			&anchor.SourceDocumentUUID,
			&anchor.SourceDocumentTitle,
			&anchor.HeadingDepth,
			&anchor.WorkItemID,
			&anchor.WorkItemKey,
			&anchor.WorkItemTier,
			&parentID,
			&requirementCategory,
		); err != nil {
			return nil, fmt.Errorf("scan decompose anchor: %w", err)
		}
		anchor.WorkItemParentID = nullableInt64(parentID)
		anchor.WorkItemRequirementCategory = nullableString(requirementCategory)
		anchors = append(anchors, anchor)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return anchors, nil
}
