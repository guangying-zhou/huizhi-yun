package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Port of aims/server/utils/requirementTask.ts
// createRequirementTaskFromRequirement：为已基线需求生成任务（含交付物与需求内容描述渲染）。

type requirementTaskDeliverable struct {
	Name               string
	DeliverableType    string
	Description        string
	AcceptanceCriteria string
	Required           bool
}

type requirementTaskOptions struct {
	requirementID    int64
	uid              string
	title            *string
	description      *string
	milestoneID      *int64
	assigneeUID      *string
	priority         *string
	estimatedHours   *float64
	startDate        *string
	dueDate          *string
	reviewLevel      *int64
	deliverables     []requirementTaskDeliverable
	status           string // "planning" 或 "todo"
	skipIfTaskExists bool
}

type requirementTaskResult struct {
	Created       bool
	RequirementID int64
	TaskID        int64
	ItemKey       string
	Title         string
	MilestoneID   int64
	Status        string
	SkipReason    string
	SkipMessage   string
}

type requirementTaskRequirementRow struct {
	id          int64
	itemKind    string
	projectID   int64
	reqCode     string
	title       string
	reqType     string
	status      string
	scopeNote   *string
	milestoneID *int64
	workItemID  *int64
}

type requirementTaskContentRow struct {
	id                int64
	contentOriginalID *int64
	sourceParentID    *int64
	title             string
	headingDepth      int64
	sortOrder         int64
	contentMD         *string
}

var requirementHeadingPattern = regexp.MustCompile(`^(\d+(?:\.\d+)+)\b`)

func nextRequirementTaskItemNumber(ctx context.Context, tx *sql.Tx, projectID int64) (int64, error) {
	result, err := tx.ExecContext(ctx,
		"UPDATE project_counters SET counter = LAST_INSERT_ID(counter + 1) WHERE project_id = ?",
		projectID,
	)
	if err != nil {
		return 0, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	if affected == 0 {
		return 0, httperror.New(http.StatusInternalServerError, "item_number_failed", "生成编号失败")
	}

	var itemNumber int64
	if err := tx.QueryRowContext(ctx, "SELECT LAST_INSERT_ID()").Scan(&itemNumber); err != nil {
		return 0, err
	}
	if itemNumber <= 0 {
		return 0, httperror.New(http.StatusInternalServerError, "item_number_failed", "生成编号失败")
	}
	return itemNumber, nil
}

func inferRequirementHeadingLevel(title string) (int, bool) {
	match := requirementHeadingPattern.FindStringSubmatch(strings.TrimSpace(title))
	if len(match) < 2 {
		return 0, false
	}
	segments := len(strings.Split(match[1], "."))
	level := segments + 1
	if level < 3 {
		level = 3
	}
	if level > 6 {
		level = 6
	}
	return level, true
}

func headingDepthOr(depth int64, fallback int64) int64 {
	if depth > 0 {
		return depth
	}
	return fallback
}

func renderRequirementContentItem(item requirementTaskContentRow, fallbackMinDepth int64) string {
	level, ok := inferRequirementHeadingLevel(item.title)
	if !ok {
		relative := 3 + headingDepthOr(item.headingDepth, fallbackMinDepth) - fallbackMinDepth
		if relative < 3 {
			relative = 3
		}
		if relative > 6 {
			relative = 6
		}
		level = int(relative)
	}
	hashes := strings.Repeat("#", level)
	md := ""
	if item.contentMD != nil {
		md = strings.TrimSpace(*item.contentMD)
	}
	if md != "" {
		return fmt.Sprintf("%s %s\n\n%s", hashes, item.title, md)
	}
	return fmt.Sprintf("%s %s", hashes, item.title)
}

func buildRequirementTaskDescription(
	reqCode string,
	title string,
	items []requirementTaskContentRow,
	scopeNote *string,
	contextModules []requirementTaskContentRow,
) string {
	headerLines := []string{
		"## 需求来源",
		"",
		fmt.Sprintf("- 编号：%s", reqCode),
		fmt.Sprintf("- 标题：%s", title),
	}
	if scopeNote != nil && strings.TrimSpace(*scopeNote) != "" {
		headerLines = append(headerLines, fmt.Sprintf("- 范围说明：%s", strings.TrimSpace(*scopeNote)))
	}
	header := strings.Join(headerLines, "\n") + "\n"
	if len(items) == 0 {
		return header
	}

	sortedModules := append([]requirementTaskContentRow(nil), contextModules...)
	sort.SliceStable(sortedModules, func(i, j int) bool {
		if sortedModules[i].sortOrder != sortedModules[j].sortOrder {
			return sortedModules[i].sortOrder < sortedModules[j].sortOrder
		}
		return sortedModules[i].id < sortedModules[j].id
	})
	sortedItems := append([]requirementTaskContentRow(nil), items...)
	sort.SliceStable(sortedItems, func(i, j int) bool {
		if sortedItems[i].sortOrder != sortedItems[j].sortOrder {
			return sortedItems[i].sortOrder < sortedItems[j].sortOrder
		}
		return sortedItems[i].id < sortedItems[j].id
	})

	moduleByID := map[int64]requirementTaskContentRow{}
	for _, module := range sortedModules {
		moduleByID[module.id] = module
	}

	moduleSections := map[int64][]requirementTaskContentRow{}
	var standaloneItems []requirementTaskContentRow
	for _, item := range sortedItems {
		if item.sourceParentID != nil {
			if _, ok := moduleByID[*item.sourceParentID]; ok {
				moduleSections[*item.sourceParentID] = append(moduleSections[*item.sourceParentID], item)
				continue
			}
		}
		standaloneItems = append(standaloneItems, item)
	}

	var bodyParts []string
	for _, module := range sortedModules {
		itemsUnderModule := moduleSections[module.id]
		if len(itemsUnderModule) == 0 {
			continue
		}

		moduleLevel := headingDepthOr(module.headingDepth, 2)
		if moduleLevel < 2 {
			moduleLevel = 2
		}
		if moduleLevel > 6 {
			moduleLevel = 6
		}
		moduleHeading := fmt.Sprintf("%s %s", strings.Repeat("#", int(moduleLevel)), module.title)
		moduleIntro := ""
		if module.contentMD != nil {
			moduleIntro = strings.TrimSpace(*module.contentMD)
		}

		moduleMinDepth := headingDepthOr(itemsUnderModule[0].headingDepth, 1)
		for _, item := range itemsUnderModule {
			depth := headingDepthOr(item.headingDepth, 1)
			if depth < moduleMinDepth {
				moduleMinDepth = depth
			}
		}

		renderedItems := make([]string, 0, len(itemsUnderModule))
		for _, item := range itemsUnderModule {
			renderedItems = append(renderedItems, renderRequirementContentItem(item, moduleMinDepth))
		}

		sectionParts := []string{moduleHeading}
		if moduleIntro != "" {
			sectionParts = append(sectionParts, moduleIntro)
		}
		sectionParts = append(sectionParts, strings.Join(renderedItems, "\n\n"))
		bodyParts = append(bodyParts, strings.Join(sectionParts, "\n\n"))
	}

	if len(standaloneItems) > 0 {
		standaloneMinDepth := headingDepthOr(standaloneItems[0].headingDepth, 1)
		for _, item := range standaloneItems {
			depth := headingDepthOr(item.headingDepth, 1)
			if depth < standaloneMinDepth {
				standaloneMinDepth = depth
			}
		}
		for _, item := range standaloneItems {
			bodyParts = append(bodyParts, renderRequirementContentItem(item, standaloneMinDepth))
		}
	}

	return fmt.Sprintf("%s\n## 需求内容\n\n%s\n", header, strings.Join(bodyParts, "\n\n"))
}

func buildRequirementDescription(ctx context.Context, tx *sql.Tx, req requirementTaskRequirementRow) (string, error) {
	relationType := "baseline"
	visibleVersionStatuses := "'draft', 'baselined'"
	if req.itemKind == "change" {
		relationType = "change"
		visibleVersionStatuses = "'baselined', 'change_draft', 'in_review'"
	}

	rows, err := tx.QueryContext(ctx, fmt.Sprintf(`
		WITH RECURSIVE content_scope AS (
		  SELECT c.id, c.content_original_id, c.parent_id AS source_parent_id,
		         c.title, c.heading_depth, c.sort_order, c.content_md,
		         CAST(CONCAT(LPAD(COALESCE(ric.sort_order, c.sort_order), 10, '0'), '.', LPAD(c.id, 10, '0')) AS CHAR(2000)) AS sort_path,
		         CAST(CONCAT(',', c.id, ',') AS CHAR(2000)) AS path_ids
		  FROM requirement_contents c
		  LEFT JOIN requirement_item_contents ric
		    ON ric.content_id = c.id
		   AND ric.requirement_id = ?
		   AND ric.relation_type = ?
		  WHERE ric.id IS NOT NULL
		    AND c.version_status IN (%s)

		  UNION ALL

		  SELECT child.id, child.content_original_id, child.parent_id AS source_parent_id,
		         child.title, child.heading_depth, child.sort_order, child.content_md,
		         CONCAT(scope.sort_path, '.', LPAD(child.sort_order, 10, '0'), '.', LPAD(child.id, 10, '0')) AS sort_path,
		         CONCAT(scope.path_ids, child.id, ',') AS path_ids
		  FROM requirement_contents child
		  INNER JOIN requirement_contents parent_version ON parent_version.id = child.parent_id
		  INNER JOIN content_scope scope
		    ON COALESCE(parent_version.content_original_id, parent_version.id) = COALESCE(scope.content_original_id, scope.id)
		  WHERE child.project_id = ?
		    AND child.version_status IN (%s)
		    AND LOCATE(CONCAT(',', child.id, ','), scope.path_ids) = 0
		)
		SELECT id, content_original_id, source_parent_id, title, heading_depth, sort_order, content_md
		FROM (
		  SELECT content_scope.*,
		         ROW_NUMBER() OVER (PARTITION BY id ORDER BY sort_path) AS rn
		  FROM content_scope
		) ranked
		WHERE rn = 1
		ORDER BY sort_path`, visibleVersionStatuses, visibleVersionStatuses),
		req.id, relationType, req.projectID)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	var contents []requirementTaskContentRow
	for rows.Next() {
		var row requirementTaskContentRow
		if err := rows.Scan(&row.id, &row.contentOriginalID, &row.sourceParentID, &row.title, &row.headingDepth, &row.sortOrder, &row.contentMD); err != nil {
			return "", err
		}
		contents = append(contents, row)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}

	contentIDSet := map[int64]bool{}
	for _, content := range contents {
		contentIDSet[content.id] = true
	}
	moduleIDSet := map[int64]bool{}
	var contextModuleIDs []int64
	for _, content := range contents {
		if content.sourceParentID == nil {
			continue
		}
		moduleID := *content.sourceParentID
		if contentIDSet[moduleID] || moduleIDSet[moduleID] {
			continue
		}
		moduleIDSet[moduleID] = true
		contextModuleIDs = append(contextModuleIDs, moduleID)
	}

	var contextModules []requirementTaskContentRow
	if len(contextModuleIDs) > 0 {
		args := make([]any, 0, len(contextModuleIDs))
		for _, id := range contextModuleIDs {
			args = append(args, id)
		}
		moduleRows, err := tx.QueryContext(ctx, `
			SELECT id, NULL, NULL, title, heading_depth, sort_order, content_md
			FROM requirement_contents
			WHERE id IN (`+placeholders(len(contextModuleIDs))+`)
			ORDER BY sort_order, id`, args...)
		if err != nil {
			return "", err
		}
		defer moduleRows.Close()
		for moduleRows.Next() {
			var row requirementTaskContentRow
			if err := moduleRows.Scan(&row.id, &row.contentOriginalID, &row.sourceParentID, &row.title, &row.headingDepth, &row.sortOrder, &row.contentMD); err != nil {
				return "", err
			}
			contextModules = append(contextModules, row)
		}
		if err := moduleRows.Err(); err != nil {
			return "", err
		}
	}

	return buildRequirementTaskDescription(req.reqCode, req.title, contents, req.scopeNote, contextModules), nil
}

func normalizeRequirementTaskPriority(priority *string) string {
	if priority != nil && containsString([]string{"P0", "P1", "P2", "P3"}, *priority) {
		return *priority
	}
	return "P2"
}

func normalizeRequirementTaskReviewLevel(reviewLevel *int64) int64 {
	if reviewLevel != nil && *reviewLevel >= 0 && *reviewLevel <= 4 {
		return *reviewLevel
	}
	return 1
}

func defaultRequirementTaskDeliverables(reqType string) []requirementTaskDeliverable {
	if reqType == "functional" {
		return []requirementTaskDeliverable{{
			Name:               "代码",
			DeliverableType:    "code",
			Description:        "实现该需求并提交代码",
			AcceptanceCriteria: "代码满足需求要求，并通过单元测试",
			Required:           true,
		}}
	}
	return nil
}

func createRequirementTaskFromRequirement(ctx context.Context, tx *sql.Tx, options requirementTaskOptions) (requirementTaskResult, error) {
	var req requirementTaskRequirementRow
	err := tx.QueryRowContext(ctx, `
		SELECT id, item_kind, project_id, req_code, title, type, status, scope_note, milestone_id, work_item_id
		FROM requirement_items
		WHERE id = ?`, options.requirementID).
		Scan(&req.id, &req.itemKind, &req.projectID, &req.reqCode, &req.title, &req.reqType, &req.status, &req.scopeNote, &req.milestoneID, &req.workItemID)
	if errors.Is(err, sql.ErrNoRows) {
		return requirementTaskResult{}, httperror.New(http.StatusNotFound, "requirement_not_found", "需求不存在")
	}
	if err != nil {
		return requirementTaskResult{}, err
	}
	if req.status != "baselined" {
		return requirementTaskResult{}, httperror.New(http.StatusConflict, "requirement_not_baselined", "只能为已基线的需求创建任务")
	}

	var existingTaskID int64
	err = tx.QueryRowContext(ctx,
		"SELECT id FROM work_items WHERE requirement_id = ? AND type = 'task' LIMIT 1",
		options.requirementID).Scan(&existingTaskID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return requirementTaskResult{}, err
	}
	if existingTaskID > 0 {
		if options.skipIfTaskExists {
			return requirementTaskResult{
				Created:       false,
				RequirementID: options.requirementID,
				SkipReason:    "existing_task",
				SkipMessage:   "该需求已关联任务",
			}, nil
		}
		return requirementTaskResult{}, httperror.New(http.StatusConflict, "existing_task", "该需求已关联任务")
	}

	var targetID, targetMilestoneID sql.NullInt64
	var targetItemKey sql.NullString
	if req.workItemID != nil {
		err = tx.QueryRowContext(ctx, `
			SELECT id, milestone_id, item_key
			FROM work_items
			WHERE id = ? AND tier = 'target' AND type = 'requirement'
			LIMIT 1
			FOR UPDATE`, *req.workItemID).Scan(&targetID, &targetMilestoneID, &targetItemKey)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return requirementTaskResult{}, err
		}
	}

	var finalMilestoneID int64
	switch {
	case options.milestoneID != nil && *options.milestoneID > 0:
		finalMilestoneID = *options.milestoneID
	case req.milestoneID != nil && *req.milestoneID > 0:
		finalMilestoneID = *req.milestoneID
	case targetMilestoneID.Valid && targetMilestoneID.Int64 > 0:
		finalMilestoneID = targetMilestoneID.Int64
	default:
		return requirementTaskResult{}, httperror.New(http.StatusBadRequest, "milestone_required", "请指定里程碑")
	}

	var projectCode sql.NullString
	err = tx.QueryRowContext(ctx, "SELECT project_code FROM aims_projects WHERE id = ?", req.projectID).Scan(&projectCode)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return requirementTaskResult{}, err
	}

	itemNumber, err := nextRequirementTaskItemNumber(ctx, tx, req.projectID)
	if err != nil {
		return requirementTaskResult{}, err
	}

	// 任务编号规则：
	//   - 挂接到需求 target（如 AIMS-3） → 顺序编号 AIMS-3-1, AIMS-3-2 ...
	//   - 无 target 兜底 → 沿用项目级自增编号 AIMS-{itemNumber}
	var itemKey string
	if targetID.Valid {
		var nextSeq int64
		if err := tx.QueryRowContext(ctx, `
			SELECT COALESCE(MAX(CAST(SUBSTRING_INDEX(item_key, '-', -1) AS UNSIGNED)), 0) + 1
			FROM work_items
			WHERE parent_id = ?
			  AND type = 'task'
			  AND item_key LIKE CONCAT(?, '-%')`, targetID.Int64, targetItemKey.String).Scan(&nextSeq); err != nil {
			return requirementTaskResult{}, err
		}
		if nextSeq < 1 {
			nextSeq = 1
		}
		itemKey = fmt.Sprintf("%s-%d", targetItemKey.String, nextSeq)
	} else {
		prefix := "AIMS"
		if projectCode.Valid && strings.TrimSpace(projectCode.String) != "" {
			prefix = projectCode.String
		}
		itemKey = fmt.Sprintf("%s-%d", prefix, itemNumber)
	}

	finalTitle := req.title
	if options.title != nil && strings.TrimSpace(*options.title) != "" {
		finalTitle = strings.TrimSpace(*options.title)
	}

	finalDescription := ""
	if options.description != nil && strings.TrimSpace(*options.description) != "" {
		finalDescription = strings.TrimSpace(*options.description)
	} else {
		finalDescription, err = buildRequirementDescription(ctx, tx, req)
		if err != nil {
			return requirementTaskResult{}, err
		}
	}

	finalPriority := normalizeRequirementTaskPriority(options.priority)
	finalReviewLevel := normalizeRequirementTaskReviewLevel(options.reviewLevel)
	finalStatus := "todo"
	if options.status == "planning" {
		finalStatus = "planning"
	}

	var parentID any
	if targetID.Valid {
		parentID = targetID.Int64
	}

	insertResult, err := tx.ExecContext(ctx, `
		INSERT INTO work_items
		  (project_id, milestone_id, item_number, item_key, tier, type, title, description,
		   status, priority, assignee_uid, estimated_hours, start_date, due_date,
		   review_level, requirement_id, reporter_uid, parent_id, sort_order)
		VALUES (?, ?, ?, ?, 'matter', 'task', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
		req.projectID,
		finalMilestoneID,
		itemNumber,
		itemKey,
		finalTitle,
		nullIfEmptyString(finalDescription),
		finalStatus,
		finalPriority,
		nullableStringValue(options.assigneeUID),
		nullableFloatValue(options.estimatedHours),
		nullableStringValue(options.startDate),
		nullableStringValue(options.dueDate),
		finalReviewLevel,
		options.requirementID,
		options.uid,
		parentID,
	)
	if err != nil {
		return requirementTaskResult{}, err
	}
	taskID, err := insertResult.LastInsertId()
	if err != nil {
		return requirementTaskResult{}, err
	}

	finalDeliverables := options.deliverables
	if len(finalDeliverables) == 0 {
		finalDeliverables = defaultRequirementTaskDeliverables(req.reqType)
	}

	for index, deliverable := range finalDeliverables {
		name := strings.TrimSpace(deliverable.Name)
		if name == "" {
			continue
		}
		deliverableType := deliverable.DeliverableType
		if !containsString([]string{"document", "code", "artifact", "task"}, deliverableType) {
			deliverableType = "code"
		}
		required := 1
		if !deliverable.Required {
			required = 0
		}

		var deliverableProjectCode any
		if projectCode.Valid {
			deliverableProjectCode = projectCode.String
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO deliverables
			  (project_id, project_code, matter_id, name, description, acceptance_criteria,
			   deliverable_type, required, status, sort_order, created_by)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
			req.projectID,
			deliverableProjectCode,
			taskID,
			name,
			nullIfEmptyString(strings.TrimSpace(deliverable.Description)),
			nullIfEmptyString(strings.TrimSpace(deliverable.AcceptanceCriteria)),
			deliverableType,
			required,
			index,
			options.uid,
		); err != nil {
			return requirementTaskResult{}, err
		}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE project_documents SET import_status = 'imported_locked'
		WHERE project_id = ? AND doc_category = 'requirement_spec' AND import_status != 'imported_locked'`,
		req.projectID); err != nil {
		return requirementTaskResult{}, err
	}

	return requirementTaskResult{
		Created:       true,
		RequirementID: options.requirementID,
		TaskID:        taskID,
		ItemKey:       itemKey,
		Title:         finalTitle,
		MilestoneID:   finalMilestoneID,
		Status:        finalStatus,
	}, nil
}

func nullIfEmptyString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func parseRequirementIDListJSON(raw []byte) []int64 {
	if len(raw) == 0 {
		return nil
	}
	var ids []int64
	if err := json.Unmarshal(raw, &ids); err != nil {
		return nil
	}
	result := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id > 0 {
			result = append(result, id)
		}
	}
	return result
}
