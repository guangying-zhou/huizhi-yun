package enterpriseapf

import (
	"math/big"
	"regexp"
	"time"
)

var continuationMoney = regexp.MustCompile(`^-?(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$`)

// Historical facts are deliberately not an input. A net opening cannot be
// reduced again by its pre-cutover collections, even during a replay/import.
type ContinuationAllocation struct {
	Amount, ReceivedAt string
	Active             bool
}
type ContinuationAdjustment struct {
	Amount    string
	Confirmed bool
}

func netOpeningOutstanding(opening, cutoff string, allocations []ContinuationAllocation, adjustments []ContinuationAdjustment) (string, error) {
	if !continuationMoney.MatchString(opening) || moneyCents(opening).Sign() <= 0 {
		return "", financeInvalid()
	}
	day, e := time.Parse("2006-01-02", cutoff)
	if e != nil {
		return "", financeInvalid()
	}
	balance := moneyCents(opening)
	for _, a := range allocations {
		if !a.Active {
			continue
		}
		if !continuationMoney.MatchString(a.Amount) || moneyCents(a.Amount).Sign() <= 0 {
			return "", financeInvalid()
		}
		if len(a.ReceivedAt) < 10 {
			return "", financeInvalid()
		}
		at, e := time.Parse("2006-01-02", a.ReceivedAt[:10])
		if e != nil {
			return "", financeInvalid()
		}
		if !at.After(day) {
			return "", ledgerError(409, "before_opening_cutoff")
		}
		balance.Sub(balance, moneyCents(a.Amount))
	}
	for _, a := range adjustments {
		if !a.Confirmed {
			continue
		}
		if !continuationMoney.MatchString(a.Amount) || moneyCents(a.Amount).Sign() == 0 {
			return "", financeInvalid()
		}
		balance.Sub(balance, moneyCents(a.Amount))
	}
	if balance.Sign() < 0 {
		return "", ledgerError(409, "amount_exceeded")
	}
	return signedCentsText(balance), nil
}
func signedCentsText(n *big.Int) string {
	if n.Sign() < 0 {
		return "-" + centsText(new(big.Int).Abs(n))
	}
	return centsText(n)
}
func requireAdjustmentSeparation(entered, actor string) error {
	if entered == "" || actor == "" || entered == actor {
		return ledgerError(403, "adjustment_self_confirmation_denied")
	}
	return nil
}
