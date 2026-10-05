package productcenter

import "testing"

func TestRICEReachObservationBindsComparisonFacts(t *testing.T) {
	model := riceModel()
	const item = "00000000-0000-4000-8000-000000000001"
	observation := RICEReachObservation{BizID: "00000000-0000-4000-8000-000000000002", ProductCode: "P-RICE", ItemBizID: item, ModelVersion: model.Version, ScopeRevision: 2, EvidenceRevision: 3, Reach: 450, ReachUnit: model.ReachUnit, ReachStartsOn: model.ReachStartsOn, ReachEndsOn: model.ReachEndsOn, ReachDefinition: model.ReachDefinition, SourceDefinition: model.SourceDefinition, SourceReference: "报表 export-2026-q4-001", Methodology: "按产品和期间筛选后对 UID 去重，排除测试账号", RecordedBy: "pm", RecordedAt: "2027-01-02T12:00:00Z"}
	check := func(value RICEReachObservation) error {
		return ValidateRICEReachObservation(model, value, "P-RICE", item, 2, 3)
	}
	if err := check(observation); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*RICEReachObservation){
		func(o *RICEReachObservation) { o.ProductCode = "OTHER" },
		func(o *RICEReachObservation) { o.ItemBizID = o.BizID },
		func(o *RICEReachObservation) { o.ModelVersion = "rice-v2" },
		func(o *RICEReachObservation) { o.ScopeRevision++ },
		func(o *RICEReachObservation) { o.EvidenceRevision++ },
		func(o *RICEReachObservation) { o.ReachUnit = "unique_customer_organizations" },
		func(o *RICEReachObservation) { o.ReachStartsOn = "2026-01-01" },
		func(o *RICEReachObservation) { o.ReachEndsOn = "2027-12-31" },
		func(o *RICEReachObservation) { o.ReachDefinition = "仅付费用户" },
		func(o *RICEReachObservation) { o.SourceDefinition = "其他报表" },
		func(o *RICEReachObservation) { o.SourceReference = "" },
		func(o *RICEReachObservation) { o.Methodology = "" },
		func(o *RICEReachObservation) { o.RecordedBy = "" },
		func(o *RICEReachObservation) { o.RecordedAt = "2027-02-30" },
		func(o *RICEReachObservation) { o.Reach = -1 },
	} {
		changed := observation
		change(&changed)
		if check(changed) == nil {
			t.Fatalf("accepted %+v", changed)
		}
	}
	observation.Reach = 0
	if err := check(observation); err != nil {
		t.Fatal("verified zero must remain usable", err)
	}
}
