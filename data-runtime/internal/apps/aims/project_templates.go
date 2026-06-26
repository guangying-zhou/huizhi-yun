package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type projectTemplateDefinition struct {
	Milestones []projectTemplateMilestone `json:"milestones"`
}

type projectTemplateMilestone struct {
	Key         string                    `json:"key"`
	Name        string                    `json:"name"`
	Description *string                   `json:"description"`
	Mode        string                    `json:"mode"`
	PivrStage   string                    `json:"pivrStage"`
	SortOrder   int                       `json:"sortOrder"`
	WorkItems   []projectTemplateWorkItem `json:"workItems"`
}

type projectTemplateWorkItem struct {
	Key          string                       `json:"key"`
	Title        string                       `json:"title"`
	Type         string                       `json:"type"`
	Tier         string                       `json:"tier"`
	Description  *string                      `json:"description"`
	Required     bool                         `json:"required"`
	ReviewLevel  int                          `json:"reviewLevel"`
	Priority     string                       `json:"priority"`
	SortOrder    int                          `json:"sortOrder"`
	Deliverables []projectTemplateDeliverable `json:"deliverables"`
}

type projectTemplateDeliverable struct {
	Key                string  `json:"key"`
	Name               string  `json:"name"`
	Description        *string `json:"description"`
	AcceptanceCriteria string  `json:"acceptanceCriteria"`
	DeliverableType    string  `json:"deliverableType"`
	Required           bool    `json:"required"`
	SortOrder          int     `json:"sortOrder"`
}

type resolvedProjectTemplateVersion struct {
	TemplateSetID     int64
	TemplateVersionID int64
	Definition        projectTemplateDefinition
}

type defaultProjectMilestoneSeed struct {
	Key       string
	Name      string
	Mode      string
	PivrStage string
	SortOrder int
}

func resolveProjectTemplateVersionTx(ctx context.Context, tx *sql.Tx, category string, requestedVersionID int64) (resolvedProjectTemplateVersion, error) {
	if requestedVersionID > 0 {
		return projectTemplateVersionByIDTx(ctx, tx, requestedVersionID, category)
	}

	var id int64
	if err := tx.QueryRowContext(ctx, `
		SELECT v.id
		FROM project_template_versions v
		JOIN project_template_sets s ON s.id = v.template_set_id
		WHERE s.category = ? AND v.status = 'published'
		ORDER BY s.is_system DESC, v.version_no DESC, v.updated_at DESC
		LIMIT 1
	`, category).Scan(&id); err != nil {
		if err == sql.ErrNoRows {
			return createDefaultProjectTemplateVersionTx(ctx, tx, category)
		}
		return resolvedProjectTemplateVersion{}, err
	}

	return projectTemplateVersionByIDTx(ctx, tx, id, category)
}

func projectTemplateVersionByIDTx(ctx context.Context, tx *sql.Tx, id int64, category string) (resolvedProjectTemplateVersion, error) {
	var (
		templateSetID int64
		status        string
		rowCategory   string
		definitionRaw any
	)
	if err := tx.QueryRowContext(ctx, `
		SELECT v.template_set_id, v.status, s.category, v.definition_json
		FROM project_template_versions v
		JOIN project_template_sets s ON s.id = v.template_set_id
		WHERE v.id = ?
		LIMIT 1
	`, id).Scan(&templateSetID, &status, &rowCategory, &definitionRaw); err != nil {
		if err == sql.ErrNoRows {
			return resolvedProjectTemplateVersion{}, httperror.New(http.StatusBadRequest, "project_template_not_found", "project template version not found")
		}
		return resolvedProjectTemplateVersion{}, err
	}
	if rowCategory != category {
		return resolvedProjectTemplateVersion{}, httperror.New(http.StatusBadRequest, "project_template_category_mismatch", "project template version does not match project category")
	}
	if status != "published" {
		return resolvedProjectTemplateVersion{}, httperror.New(http.StatusBadRequest, "project_template_not_published", "project can only use a published template version")
	}

	definition, err := parseProjectTemplateDefinition(definitionRaw)
	if err != nil {
		return resolvedProjectTemplateVersion{}, err
	}
	return resolvedProjectTemplateVersion{
		TemplateSetID:     templateSetID,
		TemplateVersionID: id,
		Definition:        definition,
	}, nil
}

func createDefaultProjectTemplateVersionTx(ctx context.Context, tx *sql.Tx, category string) (resolvedProjectTemplateVersion, error) {
	definition := defaultProjectTemplateDefinition(category)
	definitionJSON, err := json.Marshal(definition)
	if err != nil {
		return resolvedProjectTemplateVersion{}, err
	}

	templateSetID := int64(0)
	if err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM project_template_sets
		WHERE category = ? AND is_system = 1
		ORDER BY id ASC
		LIMIT 1
	`, category).Scan(&templateSetID); err != nil {
		if err != sql.ErrNoRows {
			return resolvedProjectTemplateVersion{}, err
		}
		setResult, err := tx.ExecContext(ctx, `
			INSERT INTO project_template_sets
			  (code, name, category, description, is_system, created_by)
			VALUES (?, ?, ?, ?, 1, 'system')
		`, "system-"+category, category+" 默认模板", category, "系统初始化模板集")
		if err != nil {
			return resolvedProjectTemplateVersion{}, err
		}
		templateSetID, err = setResult.LastInsertId()
		if err != nil {
			return resolvedProjectTemplateVersion{}, err
		}
	}

	nextVersionNo := int64(1)
	var maxVersionNo sql.NullInt64
	if err := tx.QueryRowContext(ctx, "SELECT MAX(version_no) FROM project_template_versions WHERE template_set_id = ?", templateSetID).Scan(&maxVersionNo); err != nil {
		return resolvedProjectTemplateVersion{}, err
	}
	if maxVersionNo.Valid {
		nextVersionNo = maxVersionNo.Int64 + 1
	}

	versionResult, err := tx.ExecContext(ctx, `
		INSERT INTO project_template_versions
		  (template_set_id, version_no, version_label, status, notes, definition_json, published_at, published_by, created_by)
		VALUES (?, ?, ?, 'published', '系统初始化版本', ?, CURRENT_TIMESTAMP, 'system', 'system')
	`, templateSetID, nextVersionNo, fmt.Sprintf("v%d", nextVersionNo), string(definitionJSON))
	if err != nil {
		return resolvedProjectTemplateVersion{}, err
	}
	templateVersionID, err := versionResult.LastInsertId()
	if err != nil {
		return resolvedProjectTemplateVersion{}, err
	}

	return resolvedProjectTemplateVersion{
		TemplateSetID:     templateSetID,
		TemplateVersionID: templateVersionID,
		Definition:        definition,
	}, nil
}

func instantiateProjectFromTemplateTx(
	ctx context.Context,
	tx *sql.Tx,
	projectID int64,
	projectCode string,
	createdBy string,
	definition projectTemplateDefinition,
	excludedWorkItemKeys map[string]bool,
) error {
	counter := int64(0)
	var storedCounter sql.NullInt64
	if err := tx.QueryRowContext(ctx, "SELECT counter FROM project_counters WHERE project_id = ?", projectID).Scan(&storedCounter); err != nil && err != sql.ErrNoRows {
		return err
	}
	if storedCounter.Valid {
		counter = storedCounter.Int64
	}

	for _, milestone := range sortedTemplateMilestones(definition.Milestones) {
		milestoneResult, err := tx.ExecContext(ctx, `
			INSERT INTO milestones
			  (project_id, name, description, mode, pivr_stage, sort_order, created_by, template_key)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, projectID, milestoneName(milestone), nullableStringPointer(milestone.Description), milestoneMode(milestone.Mode), nullableTemplateStage(milestone.PivrStage), milestone.SortOrder, createdBy, nullableText(milestone.Key))
		if err != nil {
			return err
		}
		milestoneID, err := milestoneResult.LastInsertId()
		if err != nil {
			return err
		}

		for _, workItem := range sortedTemplateWorkItems(milestone.WorkItems) {
			if excludedWorkItemKeys[workItem.Key] && !workItem.Required {
				continue
			}
			counter++
			itemKey := fmt.Sprintf("%s-%d", projectCode, counter)
			tier := workItemTier(workItem.Tier)
			workItemResult, err := tx.ExecContext(ctx, `
				INSERT INTO work_items
				  (project_id, milestone_id, item_number, item_key, type, tier, title, description,
				   status, priority, severity, weight, assignee_uid, reporter_uid, due_date,
				   estimated_hours, parent_id, sort_order, approval_status, review_level, required, template_key)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`, projectID, milestoneID, counter, itemKey, workItemType(workItem.Type), tier, workItemTitle(workItem), nullableStringPointer(workItem.Description), workItemStatus(tier), workItemPriority(workItem.Priority), nil, 1, nil, createdBy, nil, nil, nil, workItem.SortOrder, "not_required", clampInt(workItem.ReviewLevel, 0, 4, 1), boolToInt(workItem.Required), nullableText(workItem.Key))
			if err != nil {
				return err
			}
			workItemID, err := workItemResult.LastInsertId()
			if err != nil {
				return err
			}

			for _, deliverable := range sortedTemplateDeliverables(workItem.Deliverables) {
				if _, err := tx.ExecContext(ctx, `
					INSERT INTO deliverables
					  (project_owner_id, milestone_owner_id, target_id, matter_id,
					   name, description, acceptance_criteria, deliverable_type, required, sort_order,
					   status, project_id, project_code, created_by, template_key)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
				`, nil, nil, workItemID, nil, deliverableName(deliverable), nullableStringPointer(deliverable.Description), nullableText(deliverable.AcceptanceCriteria), deliverableType(deliverable.DeliverableType), boolToInt(deliverable.Required), deliverable.SortOrder, projectID, projectCode, createdBy, nullableText(deliverable.Key)); err != nil {
					return err
				}
			}
		}
	}

	_, err := tx.ExecContext(ctx, "UPDATE project_counters SET counter = ? WHERE project_id = ?", counter, projectID)
	return err
}

func parseProjectTemplateDefinition(raw any) (projectTemplateDefinition, error) {
	var text string
	switch value := raw.(type) {
	case nil:
		return projectTemplateDefinition{}, nil
	case []byte:
		text = strings.TrimSpace(string(value))
	case string:
		text = strings.TrimSpace(value)
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return projectTemplateDefinition{}, err
		}
		text = strings.TrimSpace(string(encoded))
	}
	if text == "" {
		return projectTemplateDefinition{}, nil
	}

	var definition projectTemplateDefinition
	if err := json.Unmarshal([]byte(text), &definition); err != nil {
		return projectTemplateDefinition{}, httperror.New(http.StatusBadRequest, "invalid_project_template_definition", "project template definition is invalid")
	}
	return normalizeProjectTemplateDefinition(definition), nil
}

func normalizeProjectTemplateDefinition(definition projectTemplateDefinition) projectTemplateDefinition {
	for milestoneIndex := range definition.Milestones {
		milestone := &definition.Milestones[milestoneIndex]
		if strings.TrimSpace(milestone.Key) == "" {
			milestone.Key = fmt.Sprintf("milestone-%d", milestoneIndex+1)
		}
		if strings.TrimSpace(milestone.Name) == "" {
			milestone.Name = fmt.Sprintf("里程碑 %d", milestoneIndex+1)
		}
		if strings.TrimSpace(milestone.Mode) == "" {
			milestone.Mode = "rolling_plan"
		}
		if strings.TrimSpace(milestone.PivrStage) == "" {
			milestone.PivrStage = "P"
		}
		for workItemIndex := range milestone.WorkItems {
			workItem := &milestone.WorkItems[workItemIndex]
			if strings.TrimSpace(workItem.Key) == "" {
				workItem.Key = fmt.Sprintf("%s-work-item-%d", milestone.Key, workItemIndex+1)
			}
			if strings.TrimSpace(workItem.Title) == "" {
				workItem.Title = fmt.Sprintf("工作项 %d", workItemIndex+1)
			}
			if strings.TrimSpace(workItem.Type) == "" {
				workItem.Type = "task"
			}
			if strings.TrimSpace(workItem.Tier) == "" {
				workItem.Tier = "target"
			}
			if strings.TrimSpace(workItem.Priority) == "" {
				workItem.Priority = "P2"
			}
			if workItem.ReviewLevel < 0 {
				workItem.ReviewLevel = 1
			}
			for deliverableIndex := range workItem.Deliverables {
				deliverable := &workItem.Deliverables[deliverableIndex]
				if strings.TrimSpace(deliverable.Key) == "" {
					deliverable.Key = fmt.Sprintf("%s-deliverable-%d", workItem.Key, deliverableIndex+1)
				}
				if strings.TrimSpace(deliverable.Name) == "" {
					deliverable.Name = fmt.Sprintf("交付物 %d", deliverableIndex+1)
				}
				if strings.TrimSpace(deliverable.DeliverableType) == "" {
					deliverable.DeliverableType = "document"
				}
			}
		}
	}
	return definition
}

func defaultProjectTemplateDefinition(category string) projectTemplateDefinition {
	seeds := defaultProjectMilestoneSeeds(category)
	milestones := make([]projectTemplateMilestone, 0, len(seeds))
	for _, seed := range seeds {
		milestones = append(milestones, projectTemplateMilestone{
			Key:       seed.Key,
			Name:      seed.Name,
			Mode:      seed.Mode,
			PivrStage: seed.PivrStage,
			SortOrder: seed.SortOrder,
		})
	}
	return projectTemplateDefinition{Milestones: milestones}
}

func defaultProjectMilestoneSeeds(category string) []defaultProjectMilestoneSeed {
	switch category {
	case "product_dev":
		return []defaultProjectMilestoneSeed{
			{Key: "p-gui-hua-poc", Name: "规划POC", Mode: "strong_constraint", PivrStage: "P", SortOrder: 1},
			{Key: "i-he-xin-mvp", Name: "核心MVP", Mode: "strong_constraint", PivrStage: "I", SortOrder: 2},
			{Key: "v-shang-yong-mmp", Name: "商用MMP", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-shi-chang-pmf", Name: "市场PMF", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	case "custom_dev":
		return []defaultProjectMilestoneSeed{
			{Key: "p-xu-qiu-que-ren", Name: "需求确认", Mode: "strong_constraint", PivrStage: "P", SortOrder: 1},
			{Key: "i-xi-tong-gou-jian", Name: "系统构建", Mode: "strong_constraint", PivrStage: "I", SortOrder: 2},
			{Key: "v-yan-shou-uat", Name: "验收 UAT", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-wei-bao-yi-jiao", Name: "维保移交", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	case "delivery":
		return []defaultProjectMilestoneSeed{
			{Key: "p-jin-chang-jiao-di", Name: "进场交底", Mode: "strong_constraint", PivrStage: "P", SortOrder: 1},
			{Key: "i-bu-shu-pei-zhi", Name: "部署配置", Mode: "strong_constraint", PivrStage: "I", SortOrder: 2},
			{Key: "v-shi-yun-xing", Name: "试运行", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-xiang-mu-jie-xiang", Name: "项目结项", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	case "maintenance":
		return []defaultProjectMilestoneSeed{
			{Key: "p-zhou-qi-gui-hua", Name: "周期规划", Mode: "periodic", PivrStage: "P", SortOrder: 1},
			{Key: "i-ren-wu-chu-li", Name: "任务处理", Mode: "periodic", PivrStage: "I", SortOrder: 2},
			{Key: "v-zhi-liang-chou-jian", Name: "质量抽检", Mode: "periodic", PivrStage: "V", SortOrder: 3},
			{Key: "r-fu-pan-you-hua", Name: "复盘优化", Mode: "periodic", PivrStage: "R", SortOrder: 4},
		}
	case "sales":
		return []defaultProjectMilestoneSeed{
			{Key: "p-xian-suo-huo-qu", Name: "线索获取", Mode: "rolling_plan", PivrStage: "P", SortOrder: 1},
			{Key: "i-fang-an-gou-tong", Name: "方案沟通", Mode: "rolling_plan", PivrStage: "I", SortOrder: 2},
			{Key: "v-shang-wu-tan-pan", Name: "商务谈判", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-ke-hu-cheng-gong", Name: "客户成功", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	case "presales":
		return []defaultProjectMilestoneSeed{
			{Key: "p-shang-ji-fen-xi", Name: "商机分析", Mode: "rolling_plan", PivrStage: "P", SortOrder: 1},
			{Key: "i-biao-shu-zhi-zuo", Name: "标书制作", Mode: "strong_constraint", PivrStage: "I", SortOrder: 2},
			{Key: "v-tou-biao-yan-shi", Name: "投标演示", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-jing-yan-fu-pan", Name: "经验复盘", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	case "improvement":
		return []defaultProjectMilestoneSeed{
			{Key: "p-que-xian-fen-xi", Name: "缺陷分析", Mode: "rolling_plan", PivrStage: "P", SortOrder: 1},
			{Key: "i-fang-an-zhi-xing", Name: "方案执行", Mode: "rolling_plan", PivrStage: "I", SortOrder: 2},
			{Key: "v-xiao-guo-hui-gui", Name: "效果回归", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-biao-zhun-gu-hua", Name: "标准固化", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	case "compliance":
		return []defaultProjectMilestoneSeed{
			{Key: "p-gui-zhang-shu-li", Name: "规章梳理", Mode: "strong_constraint", PivrStage: "P", SortOrder: 1},
			{Key: "i-zi-cha-zheng-gai", Name: "自查整改", Mode: "strong_constraint", PivrStage: "I", SortOrder: 2},
			{Key: "v-mo-ni-shen-ji", Name: "模拟审计", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-he-gui-jia-gu", Name: "合规加固", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	default:
		return []defaultProjectMilestoneSeed{
			{Key: "p-prepare", Name: "准备", Mode: "rolling_plan", PivrStage: "P", SortOrder: 1},
			{Key: "i-implement", Name: "实施", Mode: "rolling_plan", PivrStage: "I", SortOrder: 2},
			{Key: "v-verify", Name: "验证", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-release", Name: "改进", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	}
}

func sortedTemplateMilestones(items []projectTemplateMilestone) []projectTemplateMilestone {
	sorted := append([]projectTemplateMilestone(nil), items...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].SortOrder < sorted[j].SortOrder
	})
	return sorted
}

func sortedTemplateWorkItems(items []projectTemplateWorkItem) []projectTemplateWorkItem {
	sorted := append([]projectTemplateWorkItem(nil), items...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].SortOrder < sorted[j].SortOrder
	})
	return sorted
}

func sortedTemplateDeliverables(items []projectTemplateDeliverable) []projectTemplateDeliverable {
	sorted := append([]projectTemplateDeliverable(nil), items...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].SortOrder < sorted[j].SortOrder
	})
	return sorted
}

func excludedTemplateWorkItemKeys(body map[string]any) map[string]bool {
	excluded := map[string]bool{}
	for _, key := range []string{"excludedWorkItemKeys", "excluded_work_item_keys"} {
		raw, ok := body[key]
		if !ok || raw == nil {
			continue
		}
		if items, ok := raw.([]any); ok {
			for _, item := range items {
				if text := strings.TrimSpace(fmt.Sprint(item)); text != "" && text != "<nil>" {
					excluded[text] = true
				}
			}
			return excluded
		}
		if items, ok := raw.([]string); ok {
			for _, item := range items {
				if text := strings.TrimSpace(item); text != "" {
					excluded[text] = true
				}
			}
			return excluded
		}
	}
	return excluded
}

func nullableStringPointer(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func nullableTemplateStage(value string) any {
	value = strings.TrimSpace(value)
	if value == "P" || value == "I" || value == "V" || value == "R" {
		return value
	}
	return nil
}

func milestoneName(item projectTemplateMilestone) string {
	if text := strings.TrimSpace(item.Name); text != "" {
		return text
	}
	return "里程碑"
}

func milestoneMode(value string) string {
	switch strings.TrimSpace(value) {
	case "strong_constraint", "periodic", "rolling_plan":
		return strings.TrimSpace(value)
	default:
		return "rolling_plan"
	}
}

func workItemTitle(item projectTemplateWorkItem) string {
	if text := strings.TrimSpace(item.Title); text != "" {
		return text
	}
	return "工作项"
}

func workItemType(value string) string {
	switch strings.TrimSpace(value) {
	case "requirement", "task", "bug", "change_request":
		return strings.TrimSpace(value)
	default:
		return "task"
	}
}

func workItemTier(value string) string {
	switch strings.TrimSpace(value) {
	case "target", "matter":
		return strings.TrimSpace(value)
	default:
		return "target"
	}
}

func workItemStatus(tier string) string {
	if strings.TrimSpace(tier) == "target" {
		return "planning"
	}
	return "todo"
}

func workItemPriority(value string) string {
	switch strings.TrimSpace(value) {
	case "P0", "P1", "P2", "P3":
		return strings.TrimSpace(value)
	default:
		return "P2"
	}
}

func deliverableName(item projectTemplateDeliverable) string {
	if text := strings.TrimSpace(item.Name); text != "" {
		return text
	}
	return "交付物"
}

func deliverableType(value string) string {
	switch strings.TrimSpace(value) {
	case "document", "code", "artifact", "task":
		return strings.TrimSpace(value)
	default:
		return "document"
	}
}

func clampInt(value int, min int, max int, fallback int) int {
	if value == 0 {
		return fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func int64BodyValueOrZero(body map[string]any, keys ...string) (int64, error) {
	id, ok, err := optionalBodyID(body, keys...)
	if err != nil {
		return 0, fmt.Errorf("invalid %s", strings.Join(keys, "/"))
	}
	if !ok {
		return 0, nil
	}
	return id, nil
}
