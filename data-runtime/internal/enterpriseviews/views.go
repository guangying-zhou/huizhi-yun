// Package enterpriseviews is the single source of truth for the compatibility
// view family that must exist in the unified Enterprise store before a
// generation is activated.
//
// The family is derived from the domain mapping itself: every logical table of
// the Aims and Assets domains whose physical table has another name gets a
// view, because the domain adapters keep the owning domain's logical SQL names
// and reach the unified store only through those views. The only exceptions
// are the names in SharedPhysicalNames, which several domains map to their own
// physical tables and which the code reaches through the resolved table name.
//
// The installer (hzy-enterprise-compatibility-rehearsal) and the verifier
// (hzy-enterprise-verify-views) both call Install, so what is installed and what
// is verified cannot drift apart. The adapter lists below (RequiredByAdapters)
// remain as a floor: every name an adapter checks at startup or in a command
// must be part of the derived family; the contract tests enforce it.
package enterpriseviews

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/apps/assets"
	"github.com/huizhi-yun/data-runtime/internal/apps/workflow"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseassets"
	"github.com/huizhi-yun/data-runtime/internal/enterprisecontracts"
	"github.com/huizhi-yun/data-runtime/internal/enterpriseplanning"
	"github.com/huizhi-yun/data-runtime/internal/enterprisescheduler"
)

func union(lists ...[]string) []string {
	seen := map[string]bool{}
	for _, names := range lists {
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

// Aims is every logical name the unified Aims domain resolves through a view.
func Aims() []string {
	return union(
		pc.FeedbackViewNames(),
		enterpriseplanning.PilotViewNames(),
		enterprisescheduler.CompletionViewNames(),
		aims.EnterpriseWriteViewNames(),
		aims.EnterpriseWorkItemDeleteViewNames(),
		aims.EnterpriseCompletionArtifactViewNames(),
		aims.EnterpriseCompletionTransactionViewNames(),
		aims.EnterpriseDueNotificationViewNames(),
		aims.EnterpriseMilestoneRolloverViewNames(),
		enterprisecontracts.ActivationAimsViews(),
		enterprisecontracts.MilestoneReceivableAimsViews(),
	)
}

// Assets is every logical name the unified Assets domain resolves through a view.
func Assets() []string {
	return union(
		enterpriseassets.ProductViewNames(),
		assets.EnterpriseAdapterViewNames(),
		assets.EnterpriseDueNotificationViewNames(),
		assets.EnterpriseProductAdoptionViewNames(),
	)
}

// InstalledDomains are the domains installed by the compatibility tool. Altoc
// has its own installer (hzy-enterprise-add-altoc) and is never installed here.
var InstalledDomains = []string{"aims", "assets"}

// SharedPhysicalNames are logical names that more than one domain maps to its
// own physical table (or that are resolved per domain). A schema-level view can
// point at only one table, so they never get a view, whatever domains a
// particular configuration enables. Code reaches them through Resolved.Table.
var SharedPhysicalNames = e.SharedPhysicalNames

func shared() map[string]bool {
	out := make(map[string]bool, len(SharedPhysicalNames))
	for _, name := range SharedPhysicalNames {
		out[name] = true
	}
	return out
}

// ExclusiveOwners are logical names that the frozen plan maps in several
// domains but that exactly one domain may expose in the Runtime binding, because
// only that domain's code addresses the name directly. The other domains keep
// the data (their physical copy stays in the unified store) but do not map it;
// otherwise the name could never be a view. system_parameters is the dictionary
// table of Assets (its adapter writes it by its logical name); Aims never reads it.
var ExclusiveOwners = map[string]string{"system_parameters": "assets"}

// PruneExclusive returns a copy of the binding without the non-owner mappings of
// ExclusiveOwners. The binding candidate of the installer and the Runtime
// configuration must both be built this way.
func PruneExclusive(b e.Binding) e.Binding {
	out := b
	out.Domains = make(map[string]e.DomainBinding, len(b.Domains))
	for domain, d := range b.Domains {
		tables := make(map[string]string, len(d.Tables))
		for logical, physical := range d.Tables {
			if owner, exclusive := ExclusiveOwners[logical]; exclusive && owner != domain {
				continue
			}
			tables[logical] = physical
		}
		d.Tables = tables
		out.Domains[domain] = d
	}
	return out
}

// CrossDomainNames returns every logical name mapped by more than one domain
// of the binding, regardless of which installer owns the domain.
func CrossDomainNames(b e.Binding) []string {
	count := map[string]int{}
	for _, d := range b.Domains {
		for logical := range d.Tables {
			count[logical]++
		}
	}
	var out []string
	for logical, n := range count {
		if n > 1 {
			out = append(out, logical)
		}
	}
	sort.Strings(out)
	return out
}

// Derive returns the views the domain needs: its renamed mapping entries minus
// SharedPhysicalNames. A cross-domain name that is neither shared nor pruned to
// its exclusive owner is an error, so an unreviewed collision can never silently
// change the family.
func Derive(b e.Binding, domain string) ([]string, error) {
	d, ok := b.Domains[domain]
	if !ok {
		return nil, fmt.Errorf("enterpriseviews: domain %q is not in the binding", domain)
	}
	exclude := shared()
	for _, name := range CrossDomainNames(b) {
		if exclude[name] {
			continue
		}
		if owner, exclusive := ExclusiveOwners[name]; exclusive {
			return nil, fmt.Errorf("enterpriseviews: logical name %q must be mapped only by %s; prune the other domains from the binding (PruneExclusive)", name, owner)
		}
		return nil, fmt.Errorf("enterpriseviews: logical name %q is mapped by several domains but is neither shared nor exclusive", name)
	}
	var out []string
	for logical, physical := range d.Tables {
		if physical != logical && !exclude[logical] {
			out = append(out, logical)
		}
	}
	sort.Strings(out)
	return out, nil
}

// Install returns the view family for every installed domain of the binding and
// checks the floor: each name an adapter requires must be in the family or be a
// table that needs no view (physical equals logical).
func Install(b e.Binding) (map[string][]string, error) {
	required := RequiredByAdapters()
	out := map[string][]string{}
	for _, domain := range installedDomains(b) {
		names, err := Derive(b, domain)
		if err != nil {
			return nil, err
		}
		have := map[string]bool{}
		for _, name := range names {
			have[name] = true
		}
		for _, name := range required[domain] {
			if have[name] {
				continue
			}
			if physical, mapped := b.Domains[domain].Tables[name]; mapped && physical == name && !shared()[name] {
				continue
			}
			return nil, fmt.Errorf("enterpriseviews: %s adapter requires %q, which the mapping does not provide as a view", domain, name)
		}
		out[domain] = names
	}
	return out, nil
}

// MappingHash fingerprints the Aims and Assets mapping (logical to physical) so
// that installation and verification can prove they used the same mapping.
func MappingHash(b e.Binding) string {
	var lines []string
	for _, domain := range installedDomains(b) {
		for logical, physical := range b.Domains[domain].Tables {
			lines = append(lines, domain+"\t"+logical+"\t"+physical)
		}
	}
	sort.Strings(lines)
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n") + "\n"))
	return hex.EncodeToString(sum[:])
}

// RequiredByAdapters is the floor: every name a Runtime adapter checks through
// enterprise.VerifyCompatibilityViews*.
func RequiredByAdapters() map[string][]string {
	return map[string][]string{"aims": Aims(), "assets": Assets(), "workflow": workflow.EnterpriseViewNames()}
}

// Workflow is opt-in. Existing Aims/Assets install hashes and view sets stay unchanged.
func installedDomains(b e.Binding) []string {
	out := append([]string(nil), InstalledDomains...)
	if _, ok := b.Domains["workflow"]; ok {
		out = append(out, "workflow")
	}
	return out
}

// SeparatelyInstalledDomains have their own reviewed installer (Altoc:
// hzy-enterprise-add-altoc). verify-views does not install them, but when the
// binding configures such a domain its renamed mapping entries are an accepted
// part of the live view family; each one still has to match its exact
// definition like every other view.
var SeparatelyInstalledDomains = []string{"altoc", "people", "finance"}

// SeparatelyInstalled returns the renamed mapping entries of the separately
// installed domains present in the binding.
func SeparatelyInstalled(b e.Binding) []string {
	var out []string
	for _, domain := range SeparatelyInstalledDomains {
		d, ok := b.Domains[domain]
		if !ok {
			continue
		}
		for logical, physical := range d.Tables {
			if physical != logical && !shared()[logical] {
				out = append(out, logical)
			}
		}
	}
	sort.Strings(out)
	return out
}
