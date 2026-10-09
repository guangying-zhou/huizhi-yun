package productcenter

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
)

type VersionExecutionItem struct {
	ItemKey     string  `json:"item_key"`
	Title       string  `json:"title"`
	ParentID    *int64  `json:"parent_id"`
	VersionID   *int64  `json:"version_id"`
	FeatureID   *int64  `json:"feature_id"`
	ContentHash string  `json:"content_hash"`
	ID          int64   `json:"id"`
	ProjectID   int64   `json:"project_id"`
	Status      string  `json:"status"`
	Weight      uint64  `json:"weight"`
	Priority    string  `json:"priority"`
	Severity    *string `json:"severity"`
}
type VersionExecutionSnapshot struct {
	Targets         []VersionExecutionItem `json:"targets"`
	OpenDefects     []VersionExecutionItem `json:"open_defects"`
	TotalWeight     uint64                 `json:"total_weight"`
	CompletedWeight uint64                 `json:"completed_weight"`
	NoExecutionPlan bool                   `json:"no_execution_plan"`
	DefectCoverage  string                 `json:"defect_coverage"`
	ContentHash     string                 `json:"content_hash"`
}

// Requires the product and version root locks. Work item IDs are read once,
// even when both a version and feature point to the same target. The recursive
// relation stops at a target explicitly assigned to a different version.
func loadVersionExecution(ctx context.Context, tx *sql.Tx, versionID int64, scopes []VersionAcceptanceScope) (VersionExecutionSnapshot, error) {
	out := VersionExecutionSnapshot{Targets: []VersionExecutionItem{}, OpenDefects: []VersionExecutionItem{}, DefectCoverage: "linked-descendants-only"}
	validFeatures := map[int64]bool{}
	for _, scope := range scopes {
		validFeatures[scope.ID] = true
	}
	rows, err := tx.QueryContext(ctx, `WITH RECURSIVE version_tree AS (
 SELECT id,project_id FROM work_items WHERE tier='target' AND (version_id=? OR feature_id IN(SELECT id FROM product_version_features WHERE version_id=?))
 UNION DISTINCT
 SELECT child.id,child.project_id FROM work_items child JOIN version_tree parent ON child.parent_id=parent.id AND child.project_id=parent.project_id
 WHERE child.tier<>'target' OR child.version_id IS NULL OR child.version_id=?
 ) SELECT wi.id,wi.project_id,wi.tier,wi.type,wi.status,wi.weight,wi.priority,wi.severity,wi.version_id,wi.feature_id,wi.parent_id,wi.item_key,wi.title,SHA2(CONCAT(COALESCE(wi.title,''),CHAR(0),COALESCE(wi.description,'')),256)
 FROM work_items wi JOIN version_tree tree ON tree.id=wi.id AND tree.project_id=wi.project_id ORDER BY wi.id FOR UPDATE`, versionID, versionID, versionID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item VersionExecutionItem
		var tier, kind string
		var boundVersion, boundFeature sql.NullInt64
		if err = rows.Scan(&item.ID, &item.ProjectID, &tier, &kind, &item.Status, &item.Weight, &item.Priority, &item.Severity, &boundVersion, &boundFeature, &item.ParentID, &item.ItemKey, &item.Title, &item.ContentHash); err != nil {
			return out, err
		}
		if boundVersion.Valid {
			value := boundVersion.Int64
			item.VersionID = &value
		}
		if boundFeature.Valid {
			value := boundFeature.Int64
			item.FeatureID = &value
		}
		if tier == "target" && ((boundVersion.Valid && boundVersion.Int64 == versionID) || (boundFeature.Valid && validFeatures[boundFeature.Int64])) {
			if !boundVersion.Valid || boundVersion.Int64 != versionID || (boundFeature.Valid && !validFeatures[boundFeature.Int64]) {
				return out, invalid("product_version_execution_binding_invalid", "执行目标的版本与范围关联不一致，请先修复")
			}
			out.Targets = append(out.Targets, item)
			out.TotalWeight += item.Weight
			if item.Status == "completed" {
				out.CompletedWeight += item.Weight
			}
		}
		if kind == "bug" && item.Status != "completed" {
			out.OpenDefects = append(out.OpenDefects, item)
		}
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	out.NoExecutionPlan = out.TotalWeight == 0
	content, err := json.Marshal(out)
	if err != nil {
		return out, err
	}
	digest := sha256.Sum256(content)
	out.ContentHash = hex.EncodeToString(digest[:])
	return out, nil
}

func requireVersionExecutionExceptions(snapshot VersionExecutionSnapshot, exceptions []VersionAcceptanceException) error {
	required := map[string]bool{}
	for _, target := range snapshot.Targets {
		if target.Status != "completed" {
			required["incomplete-target:"+strconv.FormatInt(target.ID, 10)] = false
		}
	}
	for _, bug := range snapshot.OpenDefects {
		required["open-defect:"+strconv.FormatInt(bug.ID, 10)] = false
	}
	for _, exception := range exceptions {
		if _, ok := required[exception.Code]; ok {
			required[exception.Code] = true
		} else if strings.HasPrefix(exception.Code, "incomplete-target:") || strings.HasPrefix(exception.Code, "open-defect:") {
			return invalid("product_version_exception_stale", "执行项或缺陷例外已不匹配当前事实，请重新核验")
		}
	}
	for _, covered := range required {
		if !covered {
			return invalid("product_version_execution_unresolved", "每项未完成执行目标和已关联未关闭缺陷均须明确处理或记录例外")
		}
	}
	return nil
}
