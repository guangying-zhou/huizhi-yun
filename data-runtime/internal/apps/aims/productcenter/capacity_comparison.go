package productcenter

// EffortChange compares estimates for an already selected scope. Nil is unknown,
// including when only one side of the comparison has an estimate.
type LatestCapacityEstimate struct {
	Category InvestmentCategory
	Effort   *Hundredths
}

type EffortChange struct {
	ConfirmedCategory InvestmentCategory `json:"confirmed_category"`
	LatestCategory    InvestmentCategory `json:"latest_category"`
	ItemID            string             `json:"item_id"`
	Confirmed         *Hundredths        `json:"confirmed_person_days"`
	Latest            *Hundredths        `json:"latest_person_days"`
	Delta             *Hundredths        `json:"delta_person_days"`
}

type CapacityComparison struct {
	Confirmed CapacityReport `json:"confirmed"`
	Latest    CapacityReport `json:"latest"`
	Changes   []EffortChange `json:"changes"`
}

// CompareDecisionCapacity preserves the frozen decision inputs. The caller must
// load the complete authorized selection and its latest estimates in one locked
// transaction. Missing map keys fail closed; explicit nil means an unknown
// estimate. Completed selected work keeps its frozen consumption on both sides.
func CompareDecisionCapacity(capacity Capacity, frozen []DecisionItem, latest map[string]LatestCapacityEstimate) (CapacityComparison, error) {
	result := CapacityComparison{Changes: []EffortChange{}}
	confirmed, err := InspectDecision(capacity, frozen)
	if err != nil {
		return result, err
	}
	result.Confirmed = confirmed
	projected := append([]DecisionItem(nil), frozen...)
	needed := make(map[string]bool)
	for i, item := range frozen {
		if !item.Selected || item.Delivered {
			continue
		}
		needed[item.ID] = true
		estimate, ok := latest[item.ID]
		if !ok {
			return result, invalid("planning_latest_effort_missing", "最新投入集合不完整，请重新读取整个周期")
		}
		value := estimate.Effort
		projected[i].Effort = value
		projected[i].Category = estimate.Category
		if item.Category == estimate.Category && ((item.Effort == nil && value == nil) || (item.Effort != nil && value != nil && *item.Effort == *value)) {
			continue
		}
		change := EffortChange{ConfirmedCategory: item.Category, LatestCategory: estimate.Category, ItemID: item.ID, Confirmed: cloneEffort(item.Effort), Latest: cloneEffort(value)}
		if item.Effort != nil && value != nil {
			delta := *value - *item.Effort
			change.Delta = &delta
		}
		result.Changes = append(result.Changes, change)
	}
	for id := range latest {
		if !needed[id] {
			return result, invalid("planning_latest_effort_invalid", "最新投入只能对应本周期未交付的已选事项")
		}
	}
	result.Latest, err = InspectDecision(capacity, projected)
	return result, err
}

func cloneEffort(value *Hundredths) *Hundredths {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}
