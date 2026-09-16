package finance

import (
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Rules are one complete project/month revision, not merely the products visible
// to a caller. Persistence must serialize revision replacement per project/month.
type productCostShare struct {
	ProductCode string
	BasisPoints int
}

type productCostAttributionRules struct {
	ProjectCode string
	PeriodMonth string
	Revision    int64
	EvidenceRef string
	Shares      []productCostShare
}

type attributedProductCost struct {
	ProductCode string
	BasisPoints int
	Amount      string
}

type productCostDistribution struct {
	CurrencyCode          string
	RuleRevision          int64
	Products              []attributedProductCost
	UnassignedAmount      string
	RoundingAmount        string
	UnassignedBasisPoints int
}

var productCostAmountPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,15})\.[0-9]{2}$`)
var productCostCurrencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

func validProductAttributionKey(value string, limit int) bool {
	return value != "" && utf8.ValidString(value) && utf8.RuneCountInString(value) <= limit &&
		strings.TrimSpace(value) == value && !strings.ContainsAny(value, "/\\") &&
		strings.IndexFunc(value, unicode.IsControl) < 0
}

// distributeProductCost only performs exact allocation of an already verified
// Finance cost fact. It does not establish currency provenance, readiness, user
// authorization, or revenue attribution. Callers must establish those first.
// Amounts use DECIMAL(18,2)'s range. No binary floating point or implicit FX.
func distributeProductCost(amount, currency string, rules productCostAttributionRules) (productCostDistribution, error) {
	var result productCostDistribution
	if !productCostAmountPattern.MatchString(amount) || !productCostCurrencyPattern.MatchString(currency) {
		return result, fmt.Errorf("product cost requires exact nonnegative decimal amount and explicit currency")
	}
	period, err := time.Parse("2006-01", rules.PeriodMonth)
	if err != nil || period.Year() < 1 || period.Format("2006-01") != rules.PeriodMonth ||
		!validProductAttributionKey(rules.ProjectCode, 50) || rules.Revision < 1 ||
		strings.TrimSpace(rules.EvidenceRef) == "" || len(rules.EvidenceRef) > 500 ||
		!utf8.ValidString(rules.EvidenceRef) || strings.IndexFunc(rules.EvidenceRef, unicode.IsControl) >= 0 {
		return result, fmt.Errorf("invalid product cost attribution revision")
	}
	shares := append([]productCostShare(nil), rules.Shares...)
	sort.Slice(shares, func(i, j int) bool { return shares[i].ProductCode < shares[j].ProductCode })
	total := 0
	for i, share := range shares {
		if !validProductAttributionKey(share.ProductCode, 64) || share.BasisPoints < 1 || share.BasisPoints > 10000 ||
			(i > 0 && shares[i-1].ProductCode == share.ProductCode) {
			return result, fmt.Errorf("invalid or duplicate product cost share")
		}
		total += share.BasisPoints
		if total > 10000 {
			return result, fmt.Errorf("project period product shares exceed 100 percent")
		}
	}
	minor, _ := new(big.Int).SetString(strings.ReplaceAll(amount, ".", ""), 10)
	portion := func(basisPoints int) *big.Int {
		n := new(big.Int).Mul(minor, big.NewInt(int64(basisPoints)))
		return n.Quo(n, big.NewInt(10000))
	}
	result = productCostDistribution{
		CurrencyCode: currency, RuleRevision: rules.Revision,
		Products:              make([]attributedProductCost, 0, len(shares)),
		UnassignedBasisPoints: 10000 - total,
	}
	remaining := new(big.Int).Set(minor)
	for _, share := range shares {
		part := portion(share.BasisPoints)
		remaining.Sub(remaining, part)
		result.Products = append(result.Products, attributedProductCost{share.ProductCode, share.BasisPoints, productCostDecimal(part)})
	}
	unassigned := portion(10000 - total)
	result.UnassignedAmount = productCostDecimal(unassigned)
	result.RoundingAmount = productCostDecimal(remaining.Sub(remaining, unassigned))
	return result, nil
}

func productCostDecimal(minor *big.Int) string {
	digits := minor.String()
	if len(digits) < 3 {
		digits = strings.Repeat("0", 3-len(digits)) + digits
	}
	return digits[:len(digits)-2] + "." + digits[len(digits)-2:]
}
