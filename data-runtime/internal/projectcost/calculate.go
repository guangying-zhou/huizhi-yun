package projectcost

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"sort"
)

type Item struct {
	EmployeeUID, Hours, StandardHours, Ratio, StandardCost, Amount, Currency string
	Person                                                                   PersonInput
}
type Plan struct {
	Ready                       bool
	Reasons                     []string
	Items                       []Item
	Amount, Currency, InputHash string
}

func Hash(v any) string {
	raw, _ := json.Marshal(v)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func decimal(s string) (*big.Rat, error) {
	if !regexp.MustCompile(`^(0|[1-9][0-9]*)(\.[0-9]+)?$`).MatchString(s) {
		return nil, fmt.Errorf("invalid decimal")
	}
	v, ok := new(big.Rat).SetString(s)
	if !ok || v.Sign() < 0 {
		return nil, fmt.Errorf("invalid decimal")
	}
	return v, nil
}

// Round uses exact integer half-up arithmetic, never binary floats.
func Round(v *big.Rat, scale int) string {
	mul := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(scale)), nil)
	n := new(big.Int).Mul(v.Num(), mul)
	negative := n.Sign() < 0
	n.Abs(n)
	q, r := new(big.Int).QuoRem(n, v.Denom(), new(big.Int))
	if new(big.Int).Lsh(r, 1).Cmp(v.Denom()) >= 0 {
		q.Add(q, big.NewInt(1))
	}
	digits := q.String()
	for len(digits) <= scale {
		digits = "0" + digits
	}
	if scale > 0 {
		digits = digits[:len(digits)-scale] + "." + digits[len(digits)-scale:]
	}
	if negative && q.Sign() != 0 {
		digits = "-" + digits
	}
	return digits
}
func Build(time TimeInputs, people []PersonInput, param ParameterInput, calendar CalendarInput, zero bool) Plan {
	time.Entries = append([]TimeEntry{}, time.Entries...)
	sort.Slice(time.Entries, func(i, j int) bool { return time.Entries[i].ID < time.Entries[j].ID })
	people = append([]PersonInput{}, people...)
	sort.Slice(people, func(i, j int) bool { return people[i].EmployeeUID < people[j].EmployeeUID })
	p := Plan{Reasons: []string{}, Items: []Item{}}
	reasons := map[string]bool{}
	if calendar.Code != "CN" || calendar.SHA256 == "" {
		reasons["missing_work_calendar"] = true
	}
	standard, e := decimal(calendar.StandardHours)
	if e != nil || standard.Sign() <= 0 {
		reasons["missing_work_calendar"] = true
	}
	if param.Code == "" {
		reasons["missing_finance_cost_parameters"] = true
	}
	values := []string{param.BaseSalary, param.WelfareRate, param.ManagementRate, param.ResourceCost}
	nums := make([]*big.Rat, 4)
	for i, v := range values {
		n, e := decimal(v)
		if e != nil {
			reasons["invalid_finance_cost_parameters"] = true
			n = new(big.Rat)
		}
		nums[i] = n
	}
	hours := map[string]*big.Rat{}
	for _, entry := range time.Entries {
		if entry.ReviewStatus != "approved" {
			reasons["unreviewed_time_entries"] = true
			continue
		}
		n, e := decimal(entry.Hours)
		if e != nil || n.Sign() <= 0 || entry.EmployeeUID == "" {
			reasons["invalid_aims_time_entry"] = true
			continue
		}
		if hours[entry.EmployeeUID] == nil {
			hours[entry.EmployeeUID] = new(big.Rat)
		}
		hours[entry.EmployeeUID].Add(hours[entry.EmployeeUID], n)
	}
	if len(time.Entries) == 0 && !zero {
		reasons["missing_aims_time_entries"] = true
	}
	byUID := map[string]PersonInput{}
	for _, v := range people {
		byUID[v.EmployeeUID] = v
	}
	uids := []string{}
	for uid := range hours {
		uids = append(uids, uid)
	}
	sort.Strings(uids)
	sum := new(big.Rat)
	for _, uid := range uids {
		person, ok := byUID[uid]
		if !ok || person.MissingReason != "" {
			reason := person.MissingReason
			if reason == "" {
				reason = "missing_people_standard_cost"
			}
			reasons[reason] = true
			continue
		}
		rank, e := decimal(person.RankSalary)
		min, emin := decimal(person.PerformanceMin)
		max, emax := decimal(person.PerformanceMax)
		if e != nil || emin != nil || emax != nil || min.Cmp(max) > 0 {
			reasons["invalid_people_standard_cost"] = true
			continue
		}
		if len(param.Currency) != 3 || person.RateCurrency != param.Currency {
			reasons["currency_mismatch"] = true
			continue
		}
		mid := new(big.Rat).Quo(new(big.Rat).Add(min, max), big.NewRat(2, 1))
		base := new(big.Rat).Add(new(big.Rat).Add(nums[0], rank), mid)
		welfare := new(big.Rat).Mul(base, nums[1])
		withWelfare := new(big.Rat).Add(base, welfare)
		total := new(big.Rat).Add(new(big.Rat).Add(withWelfare, new(big.Rat).Mul(withWelfare, nums[2])), nums[3])
		if total.Sign() <= 0 {
			reasons["invalid_monthly_standard_cost"] = true
			continue
		}
		if standard == nil || standard.Sign() <= 0 {
			continue
		}
		ratio := Round(new(big.Rat).Quo(hours[uid], standard), 4)
		roundedRatio, _ := decimal(ratio)
		monthly := Round(total, 2)
		roundedMonthly, _ := decimal(monthly)
		amount := Round(new(big.Rat).Mul(roundedMonthly, roundedRatio), 2)
		amountRat, _ := decimal(amount)
		sum.Add(sum, amountRat)
		p.Items = append(p.Items, Item{uid, Round(hours[uid], 4), Round(standard, 4), ratio, monthly, amount, param.Currency, person})
	}
	for reason := range reasons {
		p.Reasons = append(p.Reasons, reason)
	}
	sort.Strings(p.Reasons)
	p.Ready = len(p.Reasons) == 0
	p.Currency = param.Currency
	if p.Ready {
		p.Amount = Round(sum, 2)
	}
	// Retrieval time is diagnostic only; it must not create a new revision.

	p.InputHash = Hash(struct {
		Time       TimeInputs
		People     []PersonInput
		Parameters ParameterInput
		Calendar   any
		Zero       bool
		Formula    string
	}{time, people, param, struct {
		Code, Month, Hours, PerDay, Hash, Version string
		Days                                      int
	}{calendar.Code, calendar.Month, calendar.StandardHours, calendar.HoursPerDay, calendar.SHA256, calendar.SourceVersion, calendar.WorkdayCount}, zero, FormulaVersion})
	return p
}
