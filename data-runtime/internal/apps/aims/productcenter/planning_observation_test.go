package productcenter

import "testing"

func TestPlanningObservationInput(t *testing.T) {
	value := "99999999999999.123456"
	valid := PlanningObservationCreate{PlanningCycleTransition: PlanningCycleTransition{BizID: "00000000-0000-4000-8000-000000000001", ExpectedRevision: 1, ExpectedCycleRevision: 1, Reason: "测量完成"}, ValueMode: "known", ObservedValue: &value, ObservedAt: "2026-01-01T08:00:00.123+08:00", EvidenceSummary: "样本统计", EvidenceSource: "人工报表", Conclusion: "继续观察"}
	if err := ValidatePlanningObservationCreate(valid); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(*PlanningObservationCreate){
		"missing mode":        func(i *PlanningObservationCreate) { i.ValueMode = "" },
		"missing known value": func(i *PlanningObservationCreate) { i.ObservedValue = nil },
		"unknown with number": func(i *PlanningObservationCreate) { i.ValueMode = "unknown" },
		"exponent":            func(i *PlanningObservationCreate) { v := "1e3"; i.ObservedValue = &v },
		"overflow":            func(i *PlanningObservationCreate) { v := "100000000000000"; i.ObservedValue = &v },
		"missing timezone":    func(i *PlanningObservationCreate) { i.ObservedAt = "2026-01-01T00:00:00" },
		"precision loss":      func(i *PlanningObservationCreate) { i.ObservedAt = "2026-01-01T00:00:00.1234Z" },
		"missing evidence":    func(i *PlanningObservationCreate) { i.EvidenceSource = " " },
		"invalid correction":  func(i *PlanningObservationCreate) { v := int64(0); i.CorrectionOfID = &v },
		"nul conclusion":      func(i *PlanningObservationCreate) { i.Conclusion = "x\x00" },
	} {
		t.Run(name, func(t *testing.T) {
			input := valid
			change(&input)
			if ValidatePlanningObservationCreate(input) == nil {
				t.Fatal("invalid input accepted")
			}
		})
	}
	valid.ValueMode = "unknown"
	valid.ObservedValue = nil
	if err := ValidatePlanningObservationCreate(valid); err != nil {
		t.Fatal(err)
	}
}

func TestPlanningObservationQuery(t *testing.T) {
	valid := PlanningObservationQuery{CycleBizID: "00000000-0000-4000-8000-000000000001", Page: 1, PageSize: 20}
	if err := ValidatePlanningObservationQuery(valid); err != nil {
		t.Fatal(err)
	}
	for _, q := range []PlanningObservationQuery{
		{CycleBizID: valid.CycleBizID, Page: 0, PageSize: 20},
		{CycleBizID: valid.CycleBizID, Page: 1, PageSize: 101},
		{CycleBizID: "foreign", Page: 1, PageSize: 20},
	} {
		if ValidatePlanningObservationQuery(q) == nil {
			t.Fatalf("invalid query accepted %+v", q)
		}
	}
}
