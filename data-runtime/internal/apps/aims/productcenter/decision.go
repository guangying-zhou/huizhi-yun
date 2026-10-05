package productcenter

import (
	"sort"
	"strings"
)

type InvestmentCategory string

const (
	Reliability InvestmentCategory = "reliability"
	Usability   InvestmentCategory = "usability"
	Growth      InvestmentCategory = "growth"
)

func ValidInvestmentCategory(value InvestmentCategory) bool {
	return value == Reliability || value == Usability || value == Growth
}

// Move is relative to a single anchor in the complete authorized queue.
// Exactly one anchor is required; an empty queue is seeded by the add command.
type Move struct {
	ItemID   string `json:"item_id"`
	BeforeID string `json:"before_id,omitempty"`
	AfterID  string `json:"after_id,omitempty"`
}

func MoveQueue(queue []string, actualRevision, expectedRevision int64, move Move) ([]string, error) {
	if actualRevision < 1 || actualRevision != expectedRevision {
		return nil, invalid("priority_queue_conflict", "排序已被更新，请刷新后重试")
	}
	if move.ItemID == "" || (move.BeforeID == "") == (move.AfterID == "") {
		return nil, invalid("priority_move_invalid", "移动需要一个明确的相邻位置")
	}
	anchor := move.BeforeID
	if anchor == "" {
		anchor = move.AfterID
	}
	if anchor == move.ItemID {
		return nil, invalid("priority_move_invalid", "不能以事项自身作为相邻位置")
	}
	seen := make(map[string]bool, len(queue))
	remaining := make([]string, 0, len(queue))
	for _, id := range queue {
		if id == "" || seen[id] {
			return nil, invalid("priority_queue_invalid", "排序集合存在空项或重复项")
		}
		seen[id] = true
		if id != move.ItemID {
			remaining = append(remaining, id)
		}
	}
	if !seen[move.ItemID] || !seen[anchor] {
		return nil, invalid("priority_item_not_found", "事项或相邻位置不在当前可操作队列中")
	}
	result := make([]string, 0, len(queue))
	for _, id := range remaining {
		if id == move.BeforeID {
			result = append(result, move.ItemID)
		}
		result = append(result, id)
		if id == move.AfterID {
			result = append(result, move.ItemID)
		}
	}
	return result, nil
}

// ValidateDependencies validates the complete same-product graph supplied by
// the repository while holding the product root lock. Unknown nodes fail closed.
func ValidateDependencies(graph map[string][]string) error {
	state := make(map[string]uint8, len(graph))
	var visit func(string) error
	visit = func(id string) error {
		if id == "" {
			return invalid("planning_dependency_invalid", "前置事项标识不能为空")
		}
		if state[id] == 1 {
			return invalid("planning_dependency_cycle", "前置关系不能形成循环")
		}
		if state[id] == 2 {
			return nil
		}
		dependencies, ok := graph[id]
		if !ok {
			return invalid("planning_dependency_not_found", "前置事项不在同一产品中")
		}
		state[id] = 1
		seen := make(map[string]bool, len(dependencies))
		for _, predecessor := range dependencies {
			if seen[predecessor] {
				return invalid("planning_dependency_duplicate", "前置事项不能重复")
			}
			seen[predecessor] = true
			if err := visit(predecessor); err != nil {
				return err
			}
		}
		state[id] = 2
		return nil
	}
	// Stable traversal produces repeatable validation errors and diagnostics.
	ids := make([]string, 0, len(graph))
	for id := range graph {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		if err := visit(id); err != nil {
			return err
		}
	}
	return nil
}

type Capacity struct {
	Total      Hundredths                        `json:"total_person_days"`
	Reserve    Hundredths                        `json:"reserve_person_days"`
	Categories map[InvestmentCategory]Hundredths `json:"categories"`
}

func (c Capacity) Validate() error {
	if c.Total < 0 || c.Total > 100_000_000 || c.Reserve < 0 || c.Reserve > c.Total {
		return invalid("planning_capacity_invalid", "总容量及预留须为有效的非负人日")
	}
	allocated := c.Reserve
	for category, value := range c.Categories {
		if !ValidInvestmentCategory(category) || value < 0 || value > c.Total {
			return invalid("planning_capacity_invalid", "投资类别或分类容量无效")
		}
		allocated += value
	}
	for _, category := range []InvestmentCategory{Reliability, Usability, Growth} {
		if _, ok := c.Categories[category]; !ok {
			return invalid("planning_capacity_missing", "请明确各投资类别的容量，可填零")
		}
	}
	if allocated > c.Total {
		return invalid("planning_capacity_overallocated", "分类容量加预留不能超过总容量")
	}
	return nil
}

// RetainedEffort is confirmed consumption of a withdrawn item in this cycle.
// Nil means no retained-consumption record; explicit zero is permitted only
// after the command layer has verified an authorized consumption confirmation.
type DecisionItem struct {
	ID                        string
	Category                  InvestmentCategory
	RetainedEffort            *Hundredths
	Selected                  bool
	Delivered                 bool
	Effort                    *Hundredths
	AssessmentCurrent         bool
	CrossDependencyUnresolved bool
	Dependencies              []string
}

type DecisionIssue struct {
	Code          string             `json:"code"`
	ItemID        string             `json:"item_id,omitempty"`
	PredecessorID string             `json:"predecessor_id,omitempty"`
	Category      InvestmentCategory `json:"category,omitempty"`
}

type CapacityReport struct {
	RetainedEffort   Hundredths                        `json:"retained_person_days"`
	OccupiedEffort   Hundredths                        `json:"occupied_person_days"`
	SelectedEffort   Hundredths                        `json:"selected_person_days"`
	Available        Hundredths                        `json:"available_person_days"`
	Remaining        Hundredths                        `json:"remaining_person_days"`
	ByCategory       map[InvestmentCategory]Hundredths `json:"by_category"`
	UnknownEstimates int                               `json:"unknown_estimates"`
	Issues           []DecisionIssue                   `json:"issues"`
}

// InspectDecision never silently drops missing estimates or unmet dependencies.
// It is used for a preview and then recomputed inside the committing transaction.
func InspectDecision(capacity Capacity, ordered []DecisionItem) (CapacityReport, error) {
	report := CapacityReport{ByCategory: map[InvestmentCategory]Hundredths{}, Issues: []DecisionIssue{}}
	if err := capacity.Validate(); err != nil {
		return report, err
	}
	graph := make(map[string][]string, len(ordered))
	items := make(map[string]DecisionItem, len(ordered))
	positions := make(map[string]int, len(ordered))
	for i, item := range ordered {
		if _, exists := items[item.ID]; exists || item.ID == "" {
			return report, invalid("planning_item_duplicate", "规划集合中的事项必须唯一且非空")
		}
		if !ValidInvestmentCategory(item.Category) {
			return report, invalid("planning_category_invalid", "投资类别无效")
		}
		if item.Effort != nil && (*item.Effort < 50 || *item.Effort > 100_000_000) {
			return report, invalid("assessment_effort_invalid", "投入须为 0.5～1000000 人日")
		}
		if item.RetainedEffort != nil && (item.Selected || *item.RetainedEffort < 0 || *item.RetainedEffort > 100_000_000) {
			return report, invalid("planning_retained_effort_invalid", "保留投入须为未选事项的有效已确认消耗，不能与已选投入重复计算")
		}
		items[item.ID], positions[item.ID], graph[item.ID] = item, i, item.Dependencies
	}
	if err := ValidateDependencies(graph); err != nil {
		return report, err
	}
	for i, item := range ordered {
		if item.RetainedEffort != nil {
			report.RetainedEffort += *item.RetainedEffort
			report.ByCategory[item.Category] += *item.RetainedEffort
		}
		if !item.Selected {
			continue
		}
		if !item.Delivered && !item.AssessmentCurrent {
			report.Issues = append(report.Issues, DecisionIssue{Code: "assessment_required", ItemID: item.ID})
		}
		if item.Effort == nil {
			report.UnknownEstimates++
			report.Issues = append(report.Issues, DecisionIssue{Code: "effort_required", ItemID: item.ID})
		} else {
			report.SelectedEffort += *item.Effort
			report.ByCategory[item.Category] += *item.Effort
		}
		// Delivered work selected in this cycle still consumed its planned budget.
		// Historical delivered prerequisites outside this selection are excluded above.
		if item.Delivered {
			continue
		}
		if item.CrossDependencyUnresolved {
			report.Issues = append(report.Issues, DecisionIssue{Code: "cross_dependency_unresolved", ItemID: item.ID})
		}
		for _, predecessorID := range item.Dependencies {
			predecessor := items[predecessorID]
			if !predecessor.Delivered && (!predecessor.Selected || positions[predecessorID] >= i) {
				report.Issues = append(report.Issues, DecisionIssue{Code: "dependency_unresolved", ItemID: item.ID, PredecessorID: predecessorID})
			}
		}
	}
	report.Available = capacity.Total - capacity.Reserve
	report.OccupiedEffort = report.SelectedEffort + report.RetainedEffort
	report.Remaining = report.Available - report.OccupiedEffort
	if report.Remaining < 0 {
		report.Issues = append(report.Issues, DecisionIssue{Code: "capacity_exceeded"})
	}
	for _, category := range []InvestmentCategory{Reliability, Usability, Growth} {
		if report.ByCategory[category] > capacity.Categories[category] {
			report.Issues = append(report.Issues, DecisionIssue{Code: "category_capacity_exceeded", Category: category})
		}
	}
	return report, nil
}

type DecisionException struct {
	Code           string             `json:"code"`
	ItemID         string             `json:"item_id,omitempty"`
	PredecessorID  string             `json:"predecessor_id,omitempty"`
	Category       InvestmentCategory `json:"category,omitempty"`
	Reason         string             `json:"reason"`
	ResponsibleUID string             `json:"responsible_uid"`
	Impact         string             `json:"impact"`
}

// ConfirmDecision requires a separately authorized prioritize actor at the
// adapter boundary. An exception is specific to an actual issue, never a boolean
// override or a P0 tag. The report remains unchanged for the saved snapshot.
func ConfirmDecision(report CapacityReport, exceptions []DecisionException) error {
	remaining := make(map[DecisionIssue]bool, len(report.Issues))
	for _, issue := range report.Issues {
		remaining[issue] = true
	}
	for _, exception := range exceptions {
		issue := DecisionIssue{exception.Code, exception.ItemID, exception.PredecessorID, exception.Category}
		if !remaining[issue] || strings.TrimSpace(exception.Reason) == "" ||
			strings.TrimSpace(exception.ResponsibleUID) == "" || strings.TrimSpace(exception.Impact) == "" {
			return invalid("decision_exception_invalid", "例外须对应当前问题，并填写原因、责任人和影响")
		}
		// A stale assessment is not waived by an ordinary capacity exception.
		// Emergency handoffs have a dedicated, audited command at the adapter.
		if issue.Code == "assessment_required" {
			return invalid("assessment_required", "范围或证据已变化，请重新确认评估")
		}
		delete(remaining, issue)
	}
	if len(remaining) != 0 {
		return invalid("decision_issues_unresolved", "请处理选择结果中的未解决问题")
	}
	return nil
}
