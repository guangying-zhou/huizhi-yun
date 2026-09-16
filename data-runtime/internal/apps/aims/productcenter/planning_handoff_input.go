package productcenter

import (
	"context"
	"database/sql"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

type PlanningHandoffInput struct {
	PlanningDeliveryCheck
	RequestBizID            string `json:"request_biz_id"`
	ExpectedRequestRevision uint64 `json:"expected_request_revision"`
	ProjectCode             string `json:"project_code"`
	SliceKey                string `json:"slice_key"`
	Operation               string `json:"operation"`
	RequirementID           int64  `json:"requirement_id"`
	Title                   string `json:"title"`
	ScopeSummary            string `json:"scope_summary"`
	Reason                  string `json:"reason"`
	PlannedVersionID        int64  `json:"planned_version_id"`
	PlannedVersionFeatureID int64  `json:"planned_version_feature_id"`
}

func ValidatePlanningHandoffInput(input PlanningHandoffInput) error {
	// A scope without cycle revisions can be a simple-mode handoff. A complete
	// cycle remains the legacy gate even if it also carries a version scope.
	hasCycle := input.CycleBizID != "" || input.ExpectedCycleRevision != 0 || input.ExpectedQueueRevision != 0
	if input.PlannedVersionFeatureID > 0 && !hasCycle {
		if input.PlannedVersionID <= 0 || input.ExpectedRevision == 0 || input.ExpectedItemRevision == 0 {
			return invalid("planning_handoff_version_invalid", "轻量版本转交需要版本、范围和当前修订")
		}
	} else if err := ValidatePlanningDeliveryCheck(input.PlanningDeliveryCheck); err != nil {
		return err
	}
	if input.RequestBizID != "" {
		id, err := uuid.Parse(input.RequestBizID)
		if err != nil || id.String() != input.RequestBizID || input.ExpectedRequestRevision == 0 {
			return invalid("planning_handoff_source_invalid", "来源需求标识或版本无效")
		}
	} else if input.ExpectedRequestRevision != 0 {
		return invalid("planning_handoff_source_invalid", "未指定来源需求不能提交需求版本")
	}
	for _, field := range []struct {
		value string
		max   int
	}{{input.ProjectCode, 64}, {input.SliceKey, 191}} {
		if field.value == "" || field.value != strings.TrimSpace(field.value) || !utf8.ValidString(field.value) || utf8.RuneCountInString(field.value) > field.max || strings.ContainsAny(field.value, "/\\") || strings.IndexFunc(field.value, unicode.IsControl) >= 0 {
			return invalid("planning_handoff_target_invalid", "目标项目和交付切片标识无效")
		}
	}
	if input.Operation != "create" && input.Operation != "link" {
		return invalid("planning_handoff_operation_invalid", "请选择创建草稿或关联已有项目需求")
	}
	if (input.Operation == "create" && input.RequirementID != 0) || (input.Operation == "link" && input.RequirementID <= 0) {
		return invalid("planning_handoff_requirement_invalid", "项目需求标识与操作不匹配")
	}
	if input.Operation == "link" && input.Title != "" {
		return invalid("planning_handoff_requirement_invalid", "关联已有需求不能覆盖其标题")
	}
	fields := []struct {
		value string
		max   int
	}{{input.ScopeSummary, 2000}, {input.Reason, 2000}}
	if input.Operation == "create" {
		fields = append(fields, struct {
			value string
			max   int
		}{input.Title, 500})
	}
	for _, field := range fields {
		if strings.TrimSpace(field.value) == "" || !utf8.ValidString(field.value) || utf8.RuneCountInString(field.value) > field.max || strings.ContainsRune(field.value, '\x00') {
			return invalid("planning_handoff_fields_invalid", "请填写有效标题、本次交付范围和原因，范围不能超过2000字")
		}
	}
	if input.PlannedVersionID < 0 || input.PlannedVersionFeatureID < 0 || (input.PlannedVersionFeatureID > 0 && input.PlannedVersionID == 0) {
		return invalid("planning_handoff_version_invalid", "版本特性必须同时指定所属版本")
	}
	return nil
}

type PlanningHandoffSource struct {
	ID       int64  `json:"id"`
	BizID    string `json:"biz_id"`
	Title    string `json:"title"`
	Revision uint64 `json:"revision"`
}

// ResolvePlanningHandoffSourceTx runs under the authorized product root lock.
// A request-backed item cannot use the engineering (no-source) path to bypass
// request handoff authorization. The caller must authorize a provided source.
func ResolvePlanningHandoffSourceTx(ctx context.Context, tx *sql.Tx, code string, input PlanningHandoffInput) (*PlanningHandoffSource, error) {
	if err := ValidatePlanningHandoffInput(input); err != nil {
		return nil, err
	}
	var itemID int64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM product_planning_items WHERE product_code=? AND biz_id=?`, code, input.ItemBizID).Scan(&itemID); err != nil {
		return nil, err
	}
	if input.RequestBizID == "" {
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_planning_item_requests WHERE product_code=? AND planning_item_id=?`, code, itemID).Scan(&count); err != nil {
			return nil, err
		}
		if count != 0 {
			return nil, invalid("planning_handoff_source_required", "该事项有关联需求，请明确本次转交来源")
		}
		return nil, nil
	}
	var source PlanningHandoffSource
	var status string
	err := tx.QueryRowContext(ctx, `SELECT r.id,r.biz_id,r.title,r.revision,r.decision_status FROM product_requests r JOIN product_planning_item_requests l ON l.request_id=r.id AND l.product_code=r.product_code WHERE r.product_code=? AND r.biz_id=? AND l.planning_item_id=?`, code, input.RequestBizID, itemID).Scan(&source.ID, &source.BizID, &source.Title, &source.Revision, &status)
	if err != nil {
		return nil, err
	}
	if source.Revision != input.ExpectedRequestRevision {
		return nil, invalid("product_request_revision_conflict", "来源需求已变化，请刷新")
	}
	if status == "merged" {
		return nil, invalid("product_request_merged_readonly", "已合并需求不能继续转交")
	}
	return &source, nil
}
