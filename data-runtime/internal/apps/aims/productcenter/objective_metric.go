package productcenter

import "math/big"

// ProductObjectiveMetric uses decimal strings throughout the API and snapshots.
// Formal improvement objectives require a known baseline and target.
type ProductObjectiveMetric struct {
	Name                  string `json:"name"`
	Unit                  string `json:"unit"`
	MeasurementDefinition string `json:"measurement_definition"`
	Direction             string `json:"direction"`
	BaselineValue         string `json:"baseline_value"`
	TargetValue           string `json:"target_value"`
}

func ValidateProductObjectiveMetric(metric ProductObjectiveMetric) error {
	if err := ValidatePlanningCycleMetric(PlanningCycleMetric{
		Name: metric.Name, Unit: metric.Unit, MeasurementMethod: metric.MeasurementDefinition,
		Direction: metric.Direction, BaselineValue: &metric.BaselineValue, TargetValue: &metric.TargetValue,
	}); err != nil {
		return err
	}
	baseline, _ := new(big.Rat).SetString(metric.BaselineValue)
	target, _ := new(big.Rat).SetString(metric.TargetValue)
	comparison := target.Cmp(baseline)
	if !((metric.Direction == "increase" && comparison > 0) || (metric.Direction == "decrease" && comparison < 0)) {
		return invalid("product_objective_target_invalid", "提高目标须高于基线，降低目标须低于基线")
	}
	return nil
}

// ProductObjectiveAttainment returns a percentage, not a task completion ratio.
// A missing observation stays unknown. Negative progress and overachievement
// remain visible rather than being clamped to 0..100.
func ProductObjectiveAttainment(metric ProductObjectiveMetric, observed *string) (*string, error) {
	if err := ValidateProductObjectiveMetric(metric); err != nil {
		return nil, err
	}
	if observed == nil {
		return nil, nil
	}
	if !cycleMetricDecimal.MatchString(*observed) {
		return nil, invalid("product_objective_observation_invalid", "观测值须为最多 14 位整数、6 位小数的十进制字符串")
	}
	baseline, _ := new(big.Rat).SetString(metric.BaselineValue)
	target, _ := new(big.Rat).SetString(metric.TargetValue)
	value, _ := new(big.Rat).SetString(*observed)
	numerator := new(big.Rat).Sub(value, baseline)
	denominator := new(big.Rat).Sub(target, baseline)
	percent := new(big.Rat).Mul(new(big.Rat).Quo(numerator, denominator), big.NewRat(100, 1)).FloatString(6)
	return &percent, nil
}
