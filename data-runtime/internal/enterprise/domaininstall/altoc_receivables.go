package domaininstall

import (
	_ "embed"
	"encoding/json"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

//go:embed altoc_receivables.json
var receivablesManifest []byte

func ReceivablesTables() []Table {
	var t []Table
	if json.Unmarshal(receivablesManifest, &t) != nil || len(t) != 1 {
		panic("invalid receivables manifest")
	}
	return t
}
func withoutReceivables(domain string, d enterprise.DomainBinding) (enterprise.DomainBinding, bool) {
	physical, ok := d.Tables["altoc_collection_event"]
	if !ok {
		return d, true
	}
	if domain != "altoc" || physical != "altoc_collection_event" {
		return d, false
	}
	out := d
	out.Tables = map[string]string{}
	for k, v := range d.Tables {
		if k != "altoc_collection_event" {
			out.Tables[k] = v
		}
	}
	return out, true
}
func WithReceivables(b enterprise.Binding) (enterprise.Binding, error) {
	d, ok := b.Domains["altoc"]
	if !ok || !IsAPFDomain("altoc", d) || d.Tables["altoc_collection_event"] != "" {
		return b, ErrBoundary
	}
	out := b
	out.Domains = map[string]enterprise.DomainBinding{}
	for k, v := range b.Domains {
		out.Domains[k] = v
	}
	d.Tables = map[string]string{}
	for k, v := range b.Domains["altoc"].Tables {
		d.Tables[k] = v
	}
	d.Tables["altoc_collection_event"] = "altoc_collection_event"
	out.Domains["altoc"] = d
	return out, nil
}
func ForReceivables(e Expectation) Installer {
	return Installer{installer{domain: "altoc-receivables", manifest: receivablesManifest, expect: e, apf: true}}
}
func (x *installer) validateReceivables(b enterprise.Binding) error {
	d, ok := b.Domains["altoc"]
	if !ok || d.OwnerDeployment != x.expect.OwnerDeployment || d.Read != enterprise.PathUnified || d.Tables["altoc_collection_event"] != "altoc_collection_event" || !IsAPFDomain("altoc", d) {
		return ErrBoundary
	}
	for name, other := range b.Domains {
		if name != "altoc" {
			for _, p := range other.Tables {
				if p == "altoc_collection_event" {
					return ErrBoundary
				}
			}
		}
	}
	return nil
}
