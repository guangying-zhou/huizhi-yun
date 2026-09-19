package config

import (
	"errors"
	"net"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// EnterpriseConfig is read only from the local Runtime configuration. There is
// deliberately no HTTP, environment DSN, or control-plane credential overlay.
type EnterpriseConfig struct {
	EnableContractActivation bool `json:"enableContractActivation"`
	// EnableMilestoneReceivable routes only verified Aims milestone-completion
	// callbacks through the opt-in AA-04 shared transaction service.
	EnableMilestoneReceivable bool                              `json:"enableMilestoneReceivable"`
	AimsDeliveryWorker        *EnterpriseDeliveryWorker         `json:"aimsDeliveryWorker,omitempty"`
	AssetsDeliveryWorker      *EnterpriseDeliveryWorker         `json:"assetsDeliveryWorker,omitempty"`
	Enabled                   bool                              `json:"enabled"`
	Environment               string                            `json:"environment"`
	SchemaVersion             string                            `json:"schemaVersion"`
	Generation                uint64                            `json:"generation"`
	InstanceID                string                            `json:"instanceId"`
	DB                        DBConfig                          `json:"db"`
	Domains                   map[string]EnterpriseDomainConfig `json:"domains"`
}
type EnterpriseDomainConfig struct {
	OwnerDeployment string              `json:"ownerDeployment"`
	Tables          map[string]string   `json:"tables"`
	Read            enterprise.PathMode `json:"read"`
	Write           enterprise.PathMode `json:"write"`
	Scheduler       enterprise.PathMode `json:"scheduler"`
}

var ErrEnterpriseConfig = errors.New("enterprise: local configuration invalid or incomplete")

func (c Config) EnterpriseBinding() (enterprise.Binding, error) {
	e := c.Enterprise
	if !e.Enabled {
		return enterprise.Binding{}, nil
	}
	if e.DB.Host == "" || e.DB.Port < 1 || e.DB.Port > 65535 || e.DB.User == "" || e.DB.ConnectionLimit < 1 {
		return enterprise.Binding{}, ErrEnterpriseConfig
	}
	b := enterprise.Binding{Key: enterprise.BindingKey{Tenant: c.Tenant, Environment: e.Environment, RuntimeDeployment: c.Deployment}, Storage: enterprise.Storage{InstanceID: e.InstanceID, Address: net.JoinHostPort(e.DB.Host, strconv.Itoa(e.DB.Port)), Database: e.DB.Database}, SchemaVersion: e.SchemaVersion, Generation: e.Generation, Domains: make(map[string]enterprise.DomainBinding)}
	for domain, d := range e.Domains {
		switch domain {
		case "aims", "assets", "altoc", "finance", "people", "align", "insights":
		default:
			return enterprise.Binding{}, ErrEnterpriseConfig
		}
		owner := strings.TrimSpace(d.OwnerDeployment)
		if owner == "" || owner != d.OwnerDeployment || !(owner == c.DeploymentBindings[domain] || owner == c.DeploymentBindings["enterprise"]) {
			return enterprise.Binding{}, ErrEnterpriseConfig
		}
		tables := make(map[string]string, len(d.Tables))
		for k, v := range d.Tables {
			tables[k] = v
		}
		b.Domains[domain] = enterprise.DomainBinding{OwnerDeployment: owner, Tables: tables, Read: d.Read, Write: d.Write, Scheduler: d.Scheduler}
	}
	if err := enterprise.ValidateBinding(b); err != nil {
		return enterprise.Binding{}, ErrEnterpriseConfig
	}
	return b, nil
}

// EnterpriseDeliveryWorker names the real retained worker, not the physical
// enterprise owner. This local binding never grants a service token.
type EnterpriseDeliveryWorker struct {
	Deployment      string `json:"deployment"`
	ServiceClientID string `json:"serviceClientId"`
}

func (c Config) EnterpriseAimsOutboundSource(registry *enterprise.Registry, binding enterprise.Binding) (*enterprise.OutboundSource, error) {
	worker := c.Enterprise.AimsDeliveryWorker
	if worker == nil {
		return nil, nil
	}
	if binding.Key != (enterprise.BindingKey{Tenant: c.Tenant, Environment: c.Enterprise.Environment, RuntimeDeployment: c.Deployment}) || binding.SchemaVersion != c.Enterprise.SchemaVersion || binding.Generation != c.Enterprise.Generation || !c.Enterprise.Enabled || registry == nil || worker.Deployment == "" || strings.TrimSpace(worker.Deployment) != worker.Deployment || worker.Deployment != c.DeploymentBindings["aims"] || worker.ServiceClientID != "aims.runtime" {
		return nil, ErrEnterpriseConfig
	}
	d, ok := binding.Domains["aims"]
	if !ok {
		return nil, ErrEnterpriseConfig
	}
	writer := enterprise.ResolveRequest{Key: binding.Key, Domain: "aims", OwnerDeployment: d.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: enterprise.Write}
	resolved, err := registry.Resolve(writer)
	if err != nil {
		return nil, err
	}
	source, err := enterprise.NewOutboundSource(writer, resolved, worker.Deployment, worker.ServiceClientID)
	if err != nil {
		return nil, err
	}
	return &source, nil
}

// EnterpriseAssetsSchedulerWorker returns the retained Assets worker allowed to
// run Assets scheduled work on the unified path, or nil when none is configured.
func (c Config) EnterpriseAssetsSchedulerWorker() (*EnterpriseDeliveryWorker, error) {
	worker := c.Enterprise.AssetsDeliveryWorker
	if worker == nil {
		return nil, nil
	}
	if !c.Enterprise.Enabled || worker.Deployment == "" || strings.TrimSpace(worker.Deployment) != worker.Deployment || worker.Deployment != c.DeploymentBindings["assets"] || worker.ServiceClientID != "assets.runtime" {
		return nil, ErrEnterpriseConfig
	}
	return worker, nil
}
