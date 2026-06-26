package aims

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Port of aims/server/api/v1/{milestones/[id]/review-approve,projects/[id]/requirement-targets,
// work-items/[id]/clone-from-template,projects/[id]/requirements/import}.post.ts
// 里程碑评审通过、需求变更 target 创建、变更实例克隆、需求规格书导入。

// approveMilestoneReview 里程碑评审通过回调（幂等）：当前里程碑置 completed，
// 下一个未完成里程碑自动激活。
func (a *Adapter) approveMilestoneReview(ctx context.Context, rawMilestoneID string, query url.Values) (map[string]any, error) {
	if _, err := requireReviewActionUser(query); err != nil {
		return nil, err
	}
	milestoneID, err := strconv.ParseInt(strings.TrimSpace(rawMilestoneID), 10, 64)
	if err != nil || milestoneID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_milestone_id", "无效的里程碑ID")
	}

	var projectID, sortOrder int64
	var status string
	var paymentTermID sql.NullInt64
	var projectCode, contractCode sql.NullString
	err = a.DB().QueryRowContext(ctx, `
		SELECT m.project_id, m.status, m.sort_order, m.payment_term_id, p.project_code, p.contract_code
		FROM milestones m
		JOIN aims_projects p ON p.id = m.project_id
		WHERE m.id = ?
		LIMIT 1
	`, milestoneID).Scan(&projectID, &status, &sortOrder, &paymentTermID, &projectCode, &contractCode)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "milestone_not_found", "里程碑不存在")
	}
	if err != nil {
		return nil, err
	}

	// 幂等：已完成则直接返回
	if status == "completed" {
		return milestoneReviewPayload(milestoneID, nil, paymentTermID, projectCode, contractCode, map[string]any{"alreadyCompleted": true}), nil
	}
	if status != "active" {
		return nil, httperror.New(http.StatusConflict, "milestone_not_active", "仅当前活动里程碑可完成评审")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		"UPDATE milestones SET status = 'completed' WHERE id = ?", milestoneID); err != nil {
		return nil, err
	}

	var nextMilestoneID sql.NullInt64
	err = tx.QueryRowContext(ctx, `
		SELECT id
		FROM milestones
		WHERE project_id = ?
		  AND status != 'completed'
		  AND (sort_order > ? OR (sort_order = ? AND id > ?))
		ORDER BY sort_order ASC, id ASC
		LIMIT 1`, projectID, sortOrder, sortOrder, milestoneID).Scan(&nextMilestoneID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if nextMilestoneID.Valid {
		if _, err := tx.ExecContext(ctx,
			"UPDATE milestones SET status = 'active' WHERE id = ?", nextMilestoneID.Int64); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	var nextValue any
	if nextMilestoneID.Valid {
		nextValue = nextMilestoneID.Int64
	}
	return milestoneReviewPayload(milestoneID, nextValue, paymentTermID, projectCode, contractCode, map[string]any{"approved": true}), nil
}

func milestoneReviewPayload(
	milestoneID int64,
	nextMilestoneID any,
	paymentTermID sql.NullInt64,
	projectCode sql.NullString,
	contractCode sql.NullString,
	extra map[string]any,
) map[string]any {
	var paymentTermValue any
	if paymentTermID.Valid {
		paymentTermValue = paymentTermID.Int64
	}
	var projectCodeValue any
	if projectCode.Valid {
		projectCodeValue = projectCode.String
	}
	var contractCodeValue any
	if contractCode.Valid {
		contractCodeValue = contractCode.String
	}
	payload := map[string]any{
		"milestoneId":       milestoneID,
		"milestone_id":      milestoneID,
		"nextMilestoneId":   nextMilestoneID,
		"next_milestone_id": nextMilestoneID,
		"paymentTermId":     paymentTermValue,
		"payment_term_id":   paymentTermValue,
		"projectCode":       projectCodeValue,
		"project_code":      projectCodeValue,
		"contractCode":      contractCodeValue,
		"contract_code":     contractCodeValue,
	}
	for key, value := range extra {
		payload[key] = value
	}
	return payload
}

// createRequirementChangeTarget 创建"需求变更"工作项（type=requirement, tier=target）。
// 变更 target 只能挂在 I/V/R 阶段里程碑下。
func (a *Adapter) createRequirementChangeTarget(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	projectID, err := parseProjectDeletionID(rawProjectID)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+strings.TrimSpace(rawProjectID)+"/requirement-targets", query, body, rawProjectID); err != nil {
		return nil, err
	}

	milestoneID, _ := bodyInt64(body, "milestoneId", "milestone_id")
	if milestoneID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "milestone_required", "请指定里程碑")
	}

	var milestoneName string
	var pivrStage sql.NullString
	err = a.DB().QueryRowContext(ctx,
		"SELECT name, pivr_stage FROM milestones WHERE id = ? AND project_id = ?", milestoneID, projectID).
		Scan(&milestoneName, &pivrStage)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "milestone_not_found", "里程碑不存在")
	}
	if err != nil {
		return nil, err
	}
	if !containsString([]string{"I", "V", "R"}, pivrStage.String) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_pivr_stage", "需求变更工作项只能挂在实施/验收/交付阶段里程碑下")
	}

	var projectCode string
	var leaderUID, createdBy sql.NullString
	err = a.DB().QueryRowContext(ctx,
		"SELECT project_code, leader_uid, created_by FROM aims_projects WHERE id = ?", projectID).
		Scan(&projectCode, &leaderUID, &createdBy)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
	}
	if err != nil {
		return nil, err
	}

	title := "需求变更-" + time.Now().Format("20060102")
	if value := optionalBodyString(body, "title"); value != nil && strings.TrimSpace(*value) != "" {
		title = strings.TrimSpace(*value)
	}
	description := optionalBodyString(body, "description")

	reporterUID := uid
	if leaderUID.Valid && strings.TrimSpace(leaderUID.String) != "" {
		reporterUID = leaderUID.String
	} else if createdBy.Valid && strings.TrimSpace(createdBy.String) != "" {
		reporterUID = createdBy.String
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	itemNumber, err := nextDecomposeItemNumber(ctx, tx, projectID)
	if err != nil {
		return nil, err
	}
	itemKey := fmt.Sprintf("%s-%d", projectCode, itemNumber)

	result, err := tx.ExecContext(ctx, `
		INSERT INTO work_items
		  (project_id, milestone_id, item_number, item_key, tier, type, title, description,
		   status, priority, reporter_uid, review_level, required, template_key, sort_order)
		VALUES (?, ?, ?, ?, 'target', 'requirement', ?, ?, 'planning', 'P1', ?, 1, 0,
		        CONCAT('requirement_change_', ?), -1)`,
		projectID, milestoneID, itemNumber, itemKey, title,
		nullableStringValue(description), reporterUID, itemNumber)
	if err != nil {
		return nil, err
	}
	insertID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"id":                 insertID,
		"itemKey":            itemKey,
		"title":              title,
		"milestoneId":        milestoneID,
		"milestoneName":      milestoneName,
		"milestonePivrStage": pivrStage.String,
		"isBaseline":         false,
	}, nil
}

// cloneWorkItemFromTemplate 从"需求变更"容器工作项克隆一条新的变更实例。
func (a *Adapter) cloneWorkItemFromTemplate(ctx context.Context, rawSourceID string, query url.Values) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	sourceID, err := parseDistributionWorkItemID(rawSourceID)
	if err != nil {
		return nil, err
	}

	var source struct {
		projectID   int64
		projectCode string
		milestoneID int64
		templateKey sql.NullString
		title       string
		description sql.NullString
		priority    string
		reviewLevel int64
		required    int64
	}
	err = a.DB().QueryRowContext(ctx, `
		SELECT wi.project_id, p.project_code, wi.milestone_id, wi.template_key,
		       wi.title, wi.description, wi.priority, wi.review_level, wi.required
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		WHERE wi.id = ?`, sourceID).
		Scan(&source.projectID, &source.projectCode, &source.milestoneID, &source.templateKey,
			&source.title, &source.description, &source.priority, &source.reviewLevel, &source.required)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "work_item_not_found", "工作项不存在")
	}
	if err != nil {
		return nil, err
	}
	if source.templateKey.String != "requirement_change" {
		return nil, httperror.New(http.StatusBadRequest, "not_template", "仅需求变更容器工作项支持克隆新实例")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	itemNumber, err := nextDecomposeItemNumber(ctx, tx, source.projectID)
	if err != nil {
		return nil, err
	}
	newItemKey := fmt.Sprintf("%s-%d", source.projectCode, itemNumber)

	// 本轮变更序号：同一 template_key 在当前项目下的数量 + 1
	var count int64
	if err := tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM work_items WHERE project_id = ? AND template_key = 'requirement_change'",
		source.projectID).Scan(&count); err != nil {
		return nil, err
	}
	round := count + 1
	clonedTitle := fmt.Sprintf("%s（第 %d 轮）", source.title, round)

	var description any
	if source.description.Valid {
		description = source.description.String
	}
	result, err := tx.ExecContext(ctx, `
		INSERT INTO work_items
		  (project_id, milestone_id, item_number, item_key, tier, type, title, description,
		   status, priority, weight, reporter_uid, parent_id, sort_order,
		   template_key, review_level, required)
		VALUES (?, ?, ?, ?, 'target', 'task', ?, ?,
		        'todo', ?, 1, ?, NULL, 0,
		        'requirement_change', ?, ?)`,
		source.projectID, source.milestoneID, itemNumber, newItemKey, clonedTitle, description,
		source.priority, uid, source.reviewLevel, source.required)
	if err != nil {
		return nil, err
	}
	insertID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"id":      insertID,
		"itemKey": newItemKey,
		"title":   clonedTitle,
		"round":   round,
	}, nil
}

// ---------- 需求规格书导入 ----------

type importContentItem struct {
	title               string
	headingDepth        int64
	contentMD           *string
	children            []importContentItem
	asRequirement       bool
	mergeGroupID        string
	requirementType     string
	requirementCategory *string
}

func parseImportContentItems(raw any) []importContentItem {
	rawItems, _ := raw.([]any)
	items := make([]importContentItem, 0, len(rawItems))
	for _, rawItem := range rawItems {
		itemMap, _ := rawItem.(map[string]any)
		if itemMap == nil {
			continue
		}
		item := importContentItem{
			title:               strings.TrimSpace(fmt.Sprint(itemMap["title"])),
			contentMD:           normalizeDistributionText(itemMap["contentMd"]),
			asRequirement:       itemMap["asRequirement"] == true,
			children:            parseImportContentItems(itemMap["children"]),
			requirementCategory: normalizeDistributionText(itemMap["requirementCategory"]),
		}
		if depth, err := bodyInt64(itemMap, "headingDepth"); err == nil {
			item.headingDepth = depth
		}
		if value := normalizeDistributionText(itemMap["mergeGroupId"]); value != nil {
			item.mergeGroupID = *value
		}
		if value := normalizeDistributionText(itemMap["requirementType"]); value != nil {
			item.requirementType = *value
		}
		items = append(items, item)
	}
	return items
}

type importResults struct {
	contentsCreated     int64
	requirementsCreated int64
	requirementIDs      []int64
}

// nextRequirementCode 生成项目前缀全局唯一需求编号（非锁定读取，
// 并发冲突由 uk_project_req_number + 上层重试兜底）。
func nextRequirementCode(ctx context.Context, tx *sql.Tx, projectID int64) (int64, string, error) {
	var projectCode sql.NullString
	err := tx.QueryRowContext(ctx,
		"SELECT project_code FROM aims_projects WHERE id = ?", projectID).Scan(&projectCode)
	if err != nil || strings.TrimSpace(projectCode.String) == "" {
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return 0, "", err
		}
		return 0, "", httperror.New(http.StatusInternalServerError, "project_code_missing", "项目编码不存在，无法生成需求编号")
	}

	var maxNumber int64
	if err := tx.QueryRowContext(ctx,
		"SELECT COALESCE(MAX(req_number), 0) FROM requirement_items WHERE project_id = ?",
		projectID).Scan(&maxNumber); err != nil {
		return 0, "", err
	}
	reqNumber := maxNumber + 1
	return reqNumber, fmt.Sprintf("%s-REQ-%03d", strings.TrimSpace(projectCode.String), reqNumber), nil
}

func insertImportContents(
	ctx context.Context,
	tx *sql.Tx,
	projectID int64,
	items []importContentItem,
	parentID any,
	uid string,
	mergeGroups map[string]int64,
	results *importResults,
	workItemID any,
) error {
	for index, item := range items {
		contentResult, err := tx.ExecContext(ctx, `
			INSERT INTO requirement_contents
			  (project_id, parent_id, heading_depth, title, content_md, sort_order, status, created_by)
			VALUES (?, ?, ?, ?, ?, ?, 'imported', ?)`,
			projectID, parentID, item.headingDepth, strings.TrimSpace(item.title),
			nullableDistributionString(item.contentMD), index, uid)
		if err != nil {
			return err
		}
		contentID, err := contentResult.LastInsertId()
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE requirement_contents
			SET content_original_id = ?, version_no = 1, version_status = 'draft'
			WHERE id = ?`, contentID, contentID); err != nil {
			return err
		}
		results.contentsCreated++

		if item.asRequirement {
			var requirementID int64
			if existing, ok := mergeGroups[item.mergeGroupID]; ok && item.mergeGroupID != "" {
				requirementID = existing
			} else {
				reqNumber, reqCode, err := nextRequirementCode(ctx, tx, projectID)
				if err != nil {
					return err
				}
				reqType := "functional"
				if item.requirementType == "non_functional" {
					reqType = "non_functional"
				}
				reqResult, err := tx.ExecContext(ctx, `
					INSERT INTO requirement_items
					  (project_id, req_number, req_code, title, type, category, priority, source, work_item_id, status, created_by)
					VALUES (?, ?, ?, ?, ?, ?, 'P2', 'internal', ?, 'draft', ?)`,
					projectID, reqNumber, reqCode, strings.TrimSpace(item.title), reqType,
					nullableDistributionString(item.requirementCategory), workItemID, uid)
				if err != nil {
					return err
				}
				requirementID, err = reqResult.LastInsertId()
				if err != nil {
					return err
				}
				results.requirementsCreated++
				results.requirementIDs = append(results.requirementIDs, requirementID)
				if item.mergeGroupID != "" {
					mergeGroups[item.mergeGroupID] = requirementID
				}
			}

			if _, err := tx.ExecContext(ctx, `
				INSERT IGNORE INTO requirement_item_contents
				  (requirement_id, content_id, relation_type, sort_order, created_by)
				VALUES (?, ?, 'baseline', ?, ?)`,
				requirementID, contentID, index, uid); err != nil {
				return err
			}
		}

		if len(item.children) > 0 {
			if err := insertImportContents(ctx, tx, projectID, item.children, contentID, uid, mergeGroups, results, workItemID); err != nil {
				return err
			}
		}
	}
	return nil
}

func aimsRandomUUID() (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", bytes[0:4], bytes[4:6], bytes[6:8], bytes[8:10], bytes[10:]), nil
}

// assertProjectActiveByID 项目级 active 断言（对应 Nuxt assertProjectActive）。
func (a *Adapter) assertProjectActiveByID(ctx context.Context, projectID int64) error {
	var status string
	err := a.DB().QueryRowContext(ctx,
		"SELECT lifecycle_status FROM aims_projects WHERE id = ?", projectID).Scan(&status)
	if errors.Is(err, sql.ErrNoRows) {
		return httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
	}
	if err != nil {
		return err
	}
	if status != "active" {
		reason := projectReadonlyReason[status]
		if reason == "" {
			reason = "项目当前状态不允许此操作"
		}
		return httperror.New(http.StatusConflict, "project_not_active", reason)
	}
	return nil
}

// importProjectRequirements 导入需求规格书（codocs / repo 两种来源）。
func (a *Adapter) importProjectRequirements(ctx context.Context, rawProjectID string, query url.Values, body map[string]any) (map[string]any, error) {
	uid, err := requireReviewActionUser(query)
	if err != nil {
		return nil, err
	}
	projectID, err := parseProjectDeletionID(rawProjectID)
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+strings.TrimSpace(rawProjectID)+"/requirements/import", query, body, rawProjectID); err != nil {
		return nil, err
	}
	if err := a.assertProjectActiveByID(ctx, projectID); err != nil {
		return nil, err
	}

	source := "codocs"
	if value := normalizeDistributionText(body["source"]); value != nil && *value == "repo" {
		source = "repo"
	}
	docName := normalizeDistributionText(body["docName"])
	items := parseImportContentItems(body["items"])
	if docName == nil || len(items) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_params", "缺少必要参数")
	}
	codocsUUID := normalizeDistributionText(body["codocsUuid"])
	repoProjectCode := normalizeDistributionText(body["repoProjectCode"])
	repoFilePath := normalizeDistributionText(body["repoFilePath"])
	repoCommitID := normalizeDistributionText(body["repoCommitId"])
	if source == "codocs" && codocsUUID == nil {
		return nil, httperror.New(http.StatusBadRequest, "codocs_uuid_required", "codocs 来源需要 codocsUuid")
	}
	if source == "repo" && (repoProjectCode == nil || repoFilePath == nil) {
		return nil, httperror.New(http.StatusBadRequest, "repo_params_required", "repo 来源需要 repoProjectCode 和 repoFilePath")
	}

	mode := "category"
	if value := normalizeDistributionText(body["mode"]); value != nil && *value == "flat" {
		mode = "flat"
	}
	headingLevels := "2,3"
	if mode == "category" {
		headingLevels = "2,3,4"
	}
	if value := normalizeDistributionText(body["headingLevels"]); value != nil {
		headingLevels = *value
	}
	forceOverwrite := body["forceOverwrite"] == true

	var existingDocID sql.NullInt64
	var existingImportStatus sql.NullString
	err = a.DB().QueryRowContext(ctx, `
		SELECT id, import_status FROM project_documents
		WHERE project_id = ? AND doc_category = 'requirement_spec'
		LIMIT 1`, projectID).Scan(&existingDocID, &existingImportStatus)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	if existingDocID.Valid && existingImportStatus.String == "imported_locked" {
		return nil, httperror.New(http.StatusConflict, "import_locked", "已创建任务，禁止重新导入")
	}
	if existingDocID.Valid {
		var linkedCount int64
		if err := a.DB().QueryRowContext(ctx, `
			SELECT COUNT(*)
			FROM requirement_item_contents ric
			INNER JOIN requirement_contents c ON c.id = ric.content_id
			WHERE c.project_id = ?
			  AND ric.relation_type = 'baseline'`, projectID).Scan(&linkedCount); err != nil {
			return nil, err
		}
		if linkedCount > 0 {
			return nil, httperror.New(http.StatusConflict, "requirements_generated", "规格书已生成需求项，禁止重新导入")
		}
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	codocsValue := nullableDistributionString(codocsUUID)
	if source != "codocs" {
		codocsValue = nil
	}
	repoCodeValue := nullableDistributionString(repoProjectCode)
	repoPathValue := nullableDistributionString(repoFilePath)
	repoCommitValue := nullableDistributionString(repoCommitID)
	if source != "repo" {
		repoCodeValue, repoPathValue, repoCommitValue = nil, nil, nil
	}

	if existingDocID.Valid {
		if _, err := tx.ExecContext(ctx, `
			DELETE ric FROM requirement_item_contents ric
			INNER JOIN requirement_contents c ON c.id = ric.content_id
			WHERE c.project_id = ?`, projectID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx,
			"DELETE FROM requirement_contents WHERE project_id = ?", projectID); err != nil {
			return nil, err
		}

		// 非草稿态需求（已基线/评审中等）不能随意删，需要确认覆盖
		var nonDraftCount int64
		if err := tx.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM requirement_items WHERE project_id = ? AND status != 'draft'",
			projectID).Scan(&nonDraftCount); err != nil {
			return nil, err
		}
		if nonDraftCount > 0 && !forceOverwrite {
			return nil, httperror.New(http.StatusConflict, "require_confirm",
				fmt.Sprintf("存在 %d 条非草稿态需求项，确认覆盖将删除所有草稿态需求", nonDraftCount))
		}

		if _, err := tx.ExecContext(ctx,
			"DELETE FROM requirement_items WHERE project_id = ? AND status = 'draft'", projectID); err != nil {
			return nil, err
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE project_documents
			SET codocs_uuid = ?, title = ?, import_mode = ?, heading_levels = ?,
			    document_source = ?, repo_project_code = ?, repo_file_path = ?, repo_commit_id = ?,
			    import_status = 'imported_clean', updated_by = ?
			WHERE id = ?`,
			codocsValue, *docName, mode, headingLevels,
			source, repoCodeValue, repoPathValue, repoCommitValue,
			uid, existingDocID.Int64); err != nil {
			return nil, err
		}
	} else {
		docUUID, err := aimsRandomUUID()
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO project_documents
			  (uuid, project_id, title, doc_category, codocs_uuid,
			   document_source, repo_project_code, repo_file_path, repo_commit_id,
			   is_folder, import_mode, heading_levels, import_status, created_by)
			VALUES (?, ?, ?, 'requirement_spec', ?, ?, ?, ?, ?, 0, ?, ?, 'imported_clean', ?)`,
			docUUID, projectID, *docName, codocsValue,
			source, repoCodeValue, repoPathValue, repoCommitValue,
			mode, headingLevels, uid); err != nil {
			return nil, err
		}
	}

	// 导入时指定 workItemId（来自变更批次），否则绑定基线 target
	var workItemValue any
	if bodyWorkItemID, err := bodyInt64(body, "workItemId", "work_item_id"); err == nil && bodyWorkItemID > 0 {
		workItemValue = bodyWorkItemID
	} else {
		var baselineID sql.NullInt64
		err := tx.QueryRowContext(ctx, `
			SELECT id FROM work_items
			WHERE project_id = ?
			  AND tier = 'target'
			  AND type = 'requirement'
			ORDER BY (template_key = 'requirement_baseline') DESC,
			         created_at ASC,
			         id ASC
			LIMIT 1`, projectID).Scan(&baselineID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if baselineID.Valid {
			workItemValue = baselineID.Int64
		}
	}

	mergeGroups := map[string]int64{}
	results := importResults{requirementIDs: []int64{}}
	if err := insertImportContents(ctx, tx, projectID, items, nil, uid, mergeGroups, &results, workItemValue); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"contentsCreated":     results.contentsCreated,
		"requirementsCreated": results.requirementsCreated,
		"requirementIds":      results.requirementIDs,
		"importStatus":        "imported_clean",
	}, nil
}
