package enterpriseplanning

import "sort"

// PilotViewNames is the union of actual enabled product service requirements.
// Columns and physical names are not defined here; migration plans own those facts.
func PilotViewNames() []string {
	seen := map[string]bool{}
	for _, names := range [][]string{RequestViewNames(), FeatureViewNames(), HandoffViewNames(), ComponentViewNames(), CatalogViewNames(), VersionViewNames(), OnboardingViewNames(), PlanningViewNames()} {
		for _, name := range names {
			seen[name] = true
		}
	}
	out := make([]string, 0, len(seen))
	for name := range seen {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}
