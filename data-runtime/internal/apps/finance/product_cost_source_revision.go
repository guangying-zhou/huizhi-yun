package finance

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
)

// Content revision, not an authorization token or chronological sequence. It
// includes direct expenses and allocation evidence because the labor input hash
// alone does not change when those mutable Finance facts are corrected.
func productCostSourceRevision(snapshot productCostSnapshot) (string, error) {
	copySnapshot := snapshot
	copySnapshot.Allocations = append([]productCostAllocationFact{}, snapshot.Allocations...)
	copySnapshot.DirectExpenses = append([]productDirectExpenseFact{}, snapshot.DirectExpenses...)
	sort.Slice(copySnapshot.Allocations, func(i, j int) bool { return copySnapshot.Allocations[i].Code < copySnapshot.Allocations[j].Code })
	sort.Slice(copySnapshot.DirectExpenses, func(i, j int) bool { return copySnapshot.DirectExpenses[i].Code < copySnapshot.DirectExpenses[j].Code })
	if snapshot.Rules != nil {
		rules := *snapshot.Rules
		rules.Shares = append([]productCostShare{}, rules.Shares...)
		sort.Slice(rules.Shares, func(i, j int) bool { return rules.Shares[i].ProductCode < rules.Shares[j].ProductCode })
		copySnapshot.Rules = &rules
	}
	for i := range copySnapshot.Allocations {
		refs := copySnapshot.Allocations[i].SourceRefs
		if len(refs) == 0 {
			continue
		}
		var value any
		// Decode numbers without float conversion so revisions retain exact input.
		if !json.Valid(refs) {
			return "", fmt.Errorf("invalid cost source JSON")
		}
		decoder := json.NewDecoder(bytes.NewReader(refs))
		decoder.UseNumber()
		if err := decoder.Decode(&value); err != nil {
			return "", err
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return "", err
		}
		copySnapshot.Allocations[i].SourceRefs = encoded
	}
	encoded, err := json.Marshal(copySnapshot)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(append([]byte("finance.product-cost-snapshot.v1\n"), encoded...))
	return hex.EncodeToString(digest[:]), nil
}
