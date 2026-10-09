package productcenter

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"
)

// The definition records the measurement contract, not observed results.
// Values are decimal strings so large baselines never pass through float64.
type PlanningCycleMetric struct {
	Name              string  `json:"name"`
	Unit              string  `json:"unit"`
	Direction         string  `json:"direction"`
	MeasurementMethod string  `json:"measurement_method"`
	BaselineValue     *string `json:"baseline_value"`
	TargetValue       *string `json:"target_value"`
}

var cycleMetricDecimal = regexp.MustCompile(`^-?[0-9]{1,14}(\.[0-9]{1,6})?$`)

func ValidatePlanningCycleMetric(metric PlanningCycleMetric) error {
	for _, field := range []struct {
		value string
		max   int
	}{{metric.Name, 255}, {metric.Unit, 64}, {metric.MeasurementMethod, 2000}} {
		if strings.TrimSpace(field.value) == "" || !utf8.ValidString(field.value) || strings.ContainsRune(field.value, '\x00') || utf8.RuneCountInString(field.value) > field.max {
			return invalid("planning_cycle_metric_invalid", "指标名称、单位与测量口径必须明确且长度有效")
		}
	}
	switch metric.Direction {
	case "increase", "decrease", "maintain":
	default:
		return invalid("planning_cycle_metric_invalid", "指标方向须明确为提高、降低或维持")
	}
	for _, value := range []*string{metric.BaselineValue, metric.TargetValue} {
		if value != nil && !cycleMetricDecimal.MatchString(*value) {
			return invalid("planning_cycle_metric_value_invalid", "指标值须为最多 14 位整数、6 位小数的十进制字符串，未知请留空")
		}
	}
	return nil
}

func planningCycleMetricColumns(metric *PlanningCycleMetric) (definition, baseline, target any, err error) {
	if metric == nil {
		return nil, nil, nil, nil
	}
	encoded, err := json.Marshal(map[string]string{"name": metric.Name, "unit": metric.Unit, "direction": metric.Direction, "measurement_method": metric.MeasurementMethod})
	if err != nil {
		return nil, nil, nil, err
	}
	if metric.BaselineValue != nil {
		baseline = canonicalCycleMetricValue(*metric.BaselineValue)
	}
	if metric.TargetValue != nil {
		target = canonicalCycleMetricValue(*metric.TargetValue)
	}
	return encoded, baseline, target, nil
}

func canonicalCycleMetricValue(value string) string {
	negative := strings.HasPrefix(value, "-")
	parts := strings.Split(strings.TrimPrefix(value, "-"), ".")
	whole := strings.TrimLeft(parts[0], "0")
	if whole == "" {
		whole = "0"
	}
	fraction := ""
	if len(parts) > 1 {
		fraction = parts[1]
	}
	fraction += strings.Repeat("0", 6-len(fraction))
	sign := ""
	if negative && (whole != "0" || fraction != "000000") {
		sign = "-"
	}
	return sign + whole + "." + fraction
}
