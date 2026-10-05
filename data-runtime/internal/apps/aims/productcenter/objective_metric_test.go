package productcenter

import "testing"

func TestProductObjectiveAttainment(t *testing.T) {
	for _, tc := range []struct{ direction, baseline, target, observed, want string }{
		{"increase", "10", "20", "15", "50.000000"},
		{"decrease", "5", "2", "4.5", "16.666667"},
		{"decrease", "5", "2", "6", "-33.333333"},
		{"increase", "10", "20", "25", "150.000000"},
		{"increase", "99999999999999.999997", "99999999999999.999999", "99999999999999.999998", "50.000000"},
		{"increase", "-10", "-2", "-6", "50.000000"},
	} {
		metric := ProductObjectiveMetric{"登录成功率", "%", "成功次数/总次数", tc.direction, tc.baseline, tc.target}
		got, err := ProductObjectiveAttainment(metric, &tc.observed)
		if err != nil || got == nil || *got != tc.want {
			t.Fatalf("%+v: %v %v", tc, got, err)
		}
		if missing, err := ProductObjectiveAttainment(metric, nil); err != nil || missing != nil {
			t.Fatal("missing observation became a result", missing, err)
		}
	}
}

func TestProductObjectiveMetricRejectsInvalidInputs(t *testing.T) {
	valid := ProductObjectiveMetric{"成功率", "%", "成功次数/总次数", "increase", "10", "20"}
	for _, mutate := range []func(*ProductObjectiveMetric){
		func(m *ProductObjectiveMetric) { m.TargetValue = "10" },
		func(m *ProductObjectiveMetric) { m.TargetValue = "9" },
		func(m *ProductObjectiveMetric) { m.Direction = "decrease" },
		func(m *ProductObjectiveMetric) { m.Direction = "maintain" },
		func(m *ProductObjectiveMetric) { m.MeasurementDefinition = " " },
		func(m *ProductObjectiveMetric) { m.BaselineValue = "" },
		func(m *ProductObjectiveMetric) { m.TargetValue = "100000000000000" },
	} {
		metric := valid
		mutate(&metric)
		if _, err := ProductObjectiveAttainment(metric, nil); err == nil {
			t.Fatalf("accepted %+v", metric)
		}
	}
	for _, value := range []string{"", "NaN", "1e2", "1.0000001", " 1", "+1", "1/2"} {
		if _, err := ProductObjectiveAttainment(valid, &value); err == nil {
			t.Fatalf("accepted observation %q", value)
		}
	}
}
