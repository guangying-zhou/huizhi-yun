package unified

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type externalBindingItem struct{ App, Schema, Deployment string }
type externalApproval struct {
	Type, Tenant, Environment, CutoverKey, Generation, SealPayloadSha256, ActorUID, ApprovalReference string
	SealRevision                                                                                      uint64
	Actors                                                                                            []struct{ App, Deployment, ArtifactSha256 string }
	Report                                                                                            struct {
		Binding struct {
			Tenant, Environment, RuntimeDeployment, InstanceID string
			Sources, Providers                                 []externalBindingItem
			UnconfiguredProviders                              []string
		}
		Probes  []externalProbe
		Entries []json.RawMessage
	}
	Decisions []struct{ EntryID, EntrySha256, EvidenceSha256, Reference, Explanation, Outcome, EvidenceKind string }
}

func evidenceHex(v string) bool {
	b, e := hex.DecodeString(v)
	return e == nil && len(b) == 32 && len(v) == 64
}
func validateExternalApproval(payload []byte, deployments map[string]string, s FenceSpec, key string) (externalApproval, error) {
	var w externalApproval
	fail := func(reason string) (externalApproval, error) { return w, errors.New("external evidence " + reason) }
	if err := json.Unmarshal(payload, &w); err != nil {
		return w, err
	}
	b := w.Report.Binding
	if w.Type != "enterprise-external-drain-approval.v1" || w.Tenant != s.Config.Tenant || w.Environment != s.Config.Environment || w.CutoverKey != key || w.Generation != fmt.Sprint(s.Config.Generation) || w.SealRevision == 0 || w.ActorUID == "" || w.ApprovalReference == "" || !evidenceHex(w.SealPayloadSha256) || b.Tenant != w.Tenant || b.Environment != w.Environment || b.InstanceID != s.Config.InstanceID || b.RuntimeDeployment != s.Config.RuntimeDeployment {
		return fail("binding mismatch")
	}
	if len(deployments) != 2 || deployments["aims"] == "" || deployments["assets"] == "" {
		return fail("trusted source deployments required")
	}
	source := map[string]string{"aims": s.Config.SourceAims, "assets": s.Config.SourceAssets}
	expectedProbes := map[string]externalBindingItem{}
	if len(b.Sources) != 2 {
		return fail("source closure incomplete")
	}
	for _, item := range b.Sources {
		if source[item.App] != item.Schema || deployments[item.App] != item.Deployment {
			return fail("source schema/deployment mismatch")
		}
		delete(source, item.App)
		expectedProbes["source:"+item.App] = item
	}
	if len(source) != 0 || len(w.Actors) != 2 {
		return fail("source/actor closure mismatch")
	}
	actors := map[string]bool{}
	for _, actor := range w.Actors {
		if actors[actor.App] || deployments[actor.App] != actor.Deployment || !evidenceHex(actor.ArtifactSha256) {
			return fail("actor mismatch")
		}
		actors[actor.App] = true
	}
	providers := map[string]bool{"aims": false, "assets": false, "finance": false, "altoc": false, "codocs": false, "people": false, "console": false}
	expectedEntries := map[string]bool{}
	for _, provider := range b.Providers {
		seen, ok := providers[provider.App]
		if !ok || seen || !ident.MatchString(provider.Schema) || provider.Deployment == "" {
			return fail("provider closure mismatch")
		}
		if provider.App == "aims" && (provider.Schema != s.Config.SourceAims || provider.Deployment != deployments["aims"]) || provider.App == "assets" && (provider.Schema != s.Config.SourceAssets || provider.Deployment != deployments["assets"]) {
			return fail("source provider binding mismatch")
		}
		providers[provider.App] = true
		kind := "receipt"
		if provider.App == "console" {
			kind = "notification"
		}
		expectedProbes[kind+":"+provider.App] = provider
	}
	for _, app := range b.UnconfiguredProviders {
		seen, ok := providers[app]
		if !ok || seen {
			return fail("unconfigured provider overlap")
		}
		providers[app] = true
		expectedEntries["coverage:unconfigured-provider:"+app] = true
	}
	for _, seen := range providers {
		if !seen {
			return fail("provider omitted")
		}
	}
	if len(w.Report.Probes) != len(expectedProbes) {
		return fail("probe closure incomplete")
	}
	for _, probe := range w.Report.Probes {
		id := probe.Kind + ":" + probe.App
		expected, ok := expectedProbes[id]
		if !ok || expected.Schema != probe.Schema || expected.Deployment != probe.Deployment {
			return fail("probe binding mismatch")
		}
		delete(expectedProbes, id)
		if probe.Unavailable != "" {
			if probe.Unavailable != "ER_NO_SUCH_TABLE" && probe.Unavailable != "ER_BAD_FIELD_ERROR" {
				return fail("unavailable provider requires configuration repair")
			}
			expectedEntries["coverage:"+id] = true
			continue
		}
		if probe.Count != uint64(len(probe.Rows)) || !evidenceHex(probe.Hash) {
			return fail("probe count/hash invalid")
		}
		h := sha256.New()
		for _, row := range probe.Rows {
			if len(row) != len(externalColumns[probe.Kind]) {
				return fail("probe columns mismatch")
			}
			raw := make([]sql.RawBytes, len(row))
			for i, value := range row {
				if value != nil {
					raw[i] = []byte(*value)
				}
			}
			hashRow(h, raw)
			if probe.Kind == "source" {
				if row[0] == nil {
					return fail("source operation missing")
				}
				expectedEntries["operation:"+probe.App+":"+*row[0]] = true
			}
			if probe.Kind == "notification" {
				if row[0] == nil {
					return fail("notification identity missing")
				}
				expectedEntries["notification:"+*row[0]] = true
			}
		}
		if hex.EncodeToString(h.Sum(nil)) != probe.Hash {
			return fail("probe rows do not match digest")
		}
	}
	for _, scope := range []string{"deployed-worker-versions-and-direct-bindings", "pre-wrapper-inflight-history", "runtime-direct-callers", "external-notification-providers", "scheduled-consumers-and-other-app-outboxes"} {
		expectedEntries["coverage:"+scope] = true
	}
	if len(w.Report.Entries) != len(expectedEntries) {
		return fail("entry closure incomplete")
	}
	manual := map[string]string{}
	for _, raw := range w.Report.Entries {
		var entry struct{ ID, Classification string }
		if json.Unmarshal(raw, &entry) != nil || !expectedEntries[entry.ID] {
			return fail("entry missing or duplicate")
		}
		delete(expectedEntries, entry.ID)
		switch entry.Classification {
		case "automatic", "not-applicable":
		case "manual-required":
			var compact bytes.Buffer
			if json.Compact(&compact, raw) != nil {
				return fail("invalid entry JSON")
			}
			sum := sha256.Sum256(compact.Bytes())
			manual[entry.ID] = hex.EncodeToString(sum[:])
		default:
			return fail("unknown or blocked classification")
		}
	}
	if len(w.Decisions) != len(manual) {
		return fail("decision closure mismatch")
	}
	for _, d := range w.Decisions {
		if manual[d.EntryID] == "" || manual[d.EntryID] != d.EntrySha256 || !evidenceHex(d.EvidenceSha256) || len(d.Reference) < 8 || len(d.Explanation) < 16 {
			return fail("manual evidence hash/reference mismatch")
		}
		delete(manual, d.EntryID)
		if (strings.HasPrefix(d.EntryID, "operation:") || strings.HasPrefix(d.EntryID, "notification:") || d.EntryID == "coverage:pre-wrapper-inflight-history" || d.EntryID == "coverage:external-notification-providers") && d.Outcome == "verified-consumer-coverage" {
			return fail("specific send outcome unresolved")
		}
		if d.Outcome != "verified-terminal" && d.Outcome != "verified-not-sent" && d.Outcome != "verified-consumer-coverage" {
			return fail("manual outcome invalid")
		}
		if d.EvidenceKind != "provider-query" && d.EvidenceKind != "provider-export" && d.EvidenceKind != "activity-ledger" && d.EvidenceKind != "deployment-inventory" {
			return fail("manual evidence kind invalid")
		}
	}
	return w, nil
}
