package productcenter

import (
	"math"
	"reflect"
	"sort"
)

// ExecutionCoordination summarizes only the supplied execution facts. Callers
// must apply project visibility before exposing Projects; weight is not hours.
type ExecutionCoordination struct {
	Projects              []ProjectExecutionCoordination `json:"projects"`
	TargetCount           int                            `json:"target_count"`
	IncompleteTargetCount int                            `json:"incomplete_target_count"`
	OpenDefectCount       int                            `json:"open_defect_count"`
	TotalWeight           uint64                         `json:"total_weight"`
	CompletedWeight       uint64                         `json:"completed_weight"`
	NoExecutionPlan       bool                           `json:"no_execution_plan"`
	DefectCoverage        string                         `json:"defect_coverage"`
}
type ProjectExecutionCoordination struct {
	ProjectID             int64  `json:"project_id"`
	TargetCount           int    `json:"target_count"`
	IncompleteTargetCount int    `json:"incomplete_target_count"`
	OpenDefectCount       int    `json:"open_defect_count"`
	TotalWeight           uint64 `json:"total_weight"`
	CompletedWeight       uint64 `json:"completed_weight"`
	NoExecutionPlan       bool   `json:"no_execution_plan"`
}

// Repeated targets across version/scope joins count once by stable work-item ID.
// Conflicting duplicates fail instead of choosing an arbitrary status or weight.
func SummarizeExecutionCoordination(snapshot VersionExecutionSnapshot) (ExecutionCoordination, error) {
	out := ExecutionCoordination{Projects: []ProjectExecutionCoordination{}, DefectCoverage: snapshot.DefectCoverage}
	projects := map[int64]*ProjectExecutionCoordination{}
	seenTargets, seenDefects := map[int64]VersionExecutionItem{}, map[int64]VersionExecutionItem{}
	add := func(items []VersionExecutionItem, seen map[int64]VersionExecutionItem, target bool) error {
		for _, item := range items {
			if item.ID <= 0 || item.ProjectID <= 0 {
				return invalid("product_execution_coordination_invalid", "执行项身份无效")
			}
			if previous, exists := seen[item.ID]; exists {
				if !reflect.DeepEqual(previous, item) {
					return invalid("product_execution_coordination_invalid", "重复执行项事实不一致")
				}
				continue
			}
			seen[item.ID] = item
			project := projects[item.ProjectID]
			if project == nil {
				project = &ProjectExecutionCoordination{ProjectID: item.ProjectID}
				projects[item.ProjectID] = project
			}
			if target {
				if item.Weight > math.MaxUint64-out.TotalWeight {
					return invalid("product_execution_coordination_invalid", "执行权重超出范围")
				}
				out.TargetCount++
				project.TargetCount++
				out.TotalWeight += item.Weight
				project.TotalWeight += item.Weight
				if item.Status == "completed" {
					out.CompletedWeight += item.Weight
					project.CompletedWeight += item.Weight
				} else {
					out.IncompleteTargetCount++
					project.IncompleteTargetCount++
				}
			} else {
				if item.Status == "completed" {
					return invalid("product_execution_coordination_invalid", "未关闭缺陷列表包含已完成项")
				}
				out.OpenDefectCount++
				project.OpenDefectCount++
			}
		}
		return nil
	}
	if err := add(snapshot.Targets, seenTargets, true); err != nil {
		return out, err
	}
	if err := add(snapshot.OpenDefects, seenDefects, false); err != nil {
		return out, err
	}
	for _, project := range projects {
		project.NoExecutionPlan = project.TotalWeight == 0
		out.Projects = append(out.Projects, *project)
	}
	sort.Slice(out.Projects, func(i, j int) bool { return out.Projects[i].ProjectID < out.Projects[j].ProjectID })
	out.NoExecutionPlan = out.TotalWeight == 0
	return out, nil
}
