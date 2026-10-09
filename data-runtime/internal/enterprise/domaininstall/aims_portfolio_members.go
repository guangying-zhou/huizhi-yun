package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed aims_portfolio_members.json
var aimsPortfolioMembersManifest []byte

func AimsPortfolioMembersTables() []Table {
	var tables []Table
	if json.Unmarshal(aimsPortfolioMembersManifest, &tables) != nil {
		panic("invalid aims portfolio manifest")
	}
	return tables
}

// Preserve the activated Aims mapping rather than inventing an APF base set.
// The reviewed source/proposal hashes freeze existing mappings; the shared
// installer baseline freezes existing tables, views and Registry rows.
func WithAimsPortfolioMembers(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["aims"]
	if !ok || d.Read != enterprise.PathUnified || d.Write != enterprise.PathUnified || len(d.Tables) == 0 {
		return b, ErrBoundary
	}
	for _, other := range b.Domains {
		for logical, physical := range other.Tables {
			for _, table := range AimsPortfolioMembersTables() {
				if logical == table.Logical || physical == table.Physical {
					return b, ErrBoundary
				}
			}
		}
	}
	out := b
	out.Domains = map[string]enterprise.DomainBinding{}
	for name, domain := range b.Domains {
		out.Domains[name] = domain
	}
	d.Tables = map[string]string{}
	for logical, physical := range b.Domains["aims"].Tables {
		d.Tables[logical] = physical
	}
	for _, table := range AimsPortfolioMembersTables() {
		d.Tables[table.Logical] = table.Physical
	}
	out.Domains["aims"] = d
	return out, nil
}

func ForAimsPortfolioMembers(e Expectation) Installer {
	// Table-only mode shares empty-table rollback and never creates views.
	return Installer{installer{domain: "aims-portfolio-members", manifest: aimsPortfolioMembersManifest, expect: e, apf: true}}
}
func (x *installer) validateAimsPortfolioMembers(b enterprise.Binding) error {
	d, ok := b.Domains["aims"]
	if !ok || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified || d.Write != enterprise.PathUnified {
		return ErrBoundary
	}
	prior := b
	prior.Domains = map[string]enterprise.DomainBinding{}
	for name, domain := range b.Domains {
		prior.Domains[name] = domain
	}
	d.Tables = map[string]string{}
	for logical, physical := range b.Domains["aims"].Tables {
		d.Tables[logical] = physical
	}
	for _, table := range AimsPortfolioMembersTables() {
		if d.Tables[table.Logical] != table.Physical {
			return ErrBoundary
		}
		delete(d.Tables, table.Logical)
	}
	prior.Domains["aims"] = d
	_, err := WithAimsPortfolioMembers(prior)
	return err
}
