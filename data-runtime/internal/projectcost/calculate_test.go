package projectcost

import (
	"math/big"
	"testing"
	"time"
)

func TestExactCostsAndReadiness(t *testing.T) {
	inputs := TimeInputs{Entries: []TimeEntry{{ID: 1, EmployeeUID: "u", Hours: "320.00", ReviewStatus: "approved"}}}
	people := []PersonInput{{EmployeeUID: "u", RateCode: "r", RankSalary: "1000", PerformanceMin: "100", PerformanceMax: "300", RateCurrency: "CNY"}}
	param := ParameterInput{Code: "p", Currency: "CNY", BaseSalary: "3000", WelfareRate: "0.1", ManagementRate: "0.2", ResourceCost: "100"}
	cal := CalendarInput{Code: "CN", Month: "2026-10", StandardHours: "160", SHA256: "facts"}
	p := Build(inputs, people, param, cal, false)
	if !p.Ready || p.Amount != "11288.00" || p.Items[0].Ratio != "2.0000" {
		t.Fatal(p)
	}
	cal.RetrievedAt = time.Now()
	if Build(inputs, people, param, cal, false).InputHash != p.InputHash {
		t.Fatal("retrieval time drift")
	}
	inputs.Entries[0].ReviewStatus = "returned"
	p = Build(inputs, people, param, cal, false)
	if p.Ready || p.Amount != "" {
		t.Fatal("partial cost", p)
	}
	p = Build(TimeInputs{}, nil, param, cal, false)
	if p.Ready {
		t.Fatal("implicit zero")
	}
	p = Build(TimeInputs{}, nil, param, cal, true)
	if !p.Ready || p.Amount != "0.00" {
		t.Fatal(p)
	}
	for _, s := range []string{"1.005", "-1.005"} {
		v, _ := new(big.Rat).SetString(s)
		expected := "1.01"
		if s[0] == '-' {
			expected = "-1.01"
		}
		if Round(v, 2) != expected {
			t.Fatal(s)
		}
	}
}

func TestCanonicalInputsAndStrictDecimals(t *testing.T) {
	for _, value := range []string{"1/2", "1e3", "-1", "NaN", "01.2", ""} {
		if _, e := decimal(value); e == nil {
			t.Fatal(value)
		}
	}
	times := TimeInputs{Entries: []TimeEntry{{ID: 2, EmployeeUID: "u2", Hours: "8", ReviewStatus: "approved"}, {ID: 1, EmployeeUID: "u1", Hours: "16", ReviewStatus: "approved"}}}
	persons := []PersonInput{{EmployeeUID: "u2", RankSalary: "0", PerformanceMin: "0", PerformanceMax: "0", RateCurrency: "CNY"}, {EmployeeUID: "u1", RankSalary: "0", PerformanceMin: "0", PerformanceMax: "0", RateCurrency: "CNY"}}
	param := ParameterInput{Code: "p", Currency: "CNY", BaseSalary: "1.01", WelfareRate: "0.2", ManagementRate: "0", ResourceCost: "0"}
	cal := CalendarInput{Code: "CN", Month: "2026-10", StandardHours: "8", SHA256: "calendar"}
	one := Build(times, persons, param, cal, false)
	times.Entries[0], times.Entries[1] = times.Entries[1], times.Entries[0]
	persons[0], persons[1] = persons[1], persons[0]
	two := Build(times, persons, param, cal, false)
	if one.InputHash != two.InputHash || one.Amount != two.Amount || one.Items[0].StandardCost != "1.21" || one.Amount != "3.63" {
		t.Fatal(one, two)
	}
}
