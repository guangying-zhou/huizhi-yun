package productcenter

import "testing"

func TestCycleMetricPrecisionAndUnknownValues(t *testing.T) {
	zero, large := "-0.0", "99999999999999.123456"
	valid := PlanningCycleMetric{Name: "首次登录阻断率", Unit: "百分比", Direction: "decrease", MeasurementMethod: "本周期首次登录失败用户数 / 首次登录用户数，按用户去重", BaselineValue: &zero, TargetValue: &large}
	if err := ValidatePlanningCycleMetric(valid); err != nil {
		t.Fatal(err)
	}
	_, baseline, target, err := planningCycleMetricColumns(&valid)
	if err != nil || baseline != "0.000000" || target != large {
		t.Fatalf("decimal %v %v %v", baseline, target, err)
	}
	valid.BaselineValue = nil
	valid.TargetValue = nil
	_, baseline, target, err = planningCycleMetricColumns(&valid)
	if err != nil || baseline != nil || target != nil {
		t.Fatal("unknown values became zero")
	}
	for _, value := range []string{"1e2", "NaN", "1.1234567", "100000000000000", "", " 1", "+1"} {
		bad := valid
		bad.TargetValue = &value
		if ValidatePlanningCycleMetric(bad) == nil {
			t.Fatalf("invalid decimal %q", value)
		}
	}
	valid.Direction = "automatic"
	requireProductRule(t, ValidatePlanningCycleMetric(valid), "planning_cycle_metric_invalid")
}
