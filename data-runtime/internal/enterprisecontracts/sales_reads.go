package enterprisecontracts

import (
	"context"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
)

// SalesReadService has only Altoc Read authority. Registry owns the pool and
// persistent generation fence; no Write or Scheduler operation is resolved.
type SalesReadService struct {
	registry *e.Registry
	request  e.ResolveRequest
	reader   *altoc.SalesReader
}

func NewSalesReadService(registry *e.Registry, binding e.Binding) (*SalesReadService, error) {
	if registry == nil {
		return nil, e.ErrBindingNotFound
	}
	domain, ok := binding.Domains["altoc"]
	if !ok {
		return nil, e.ErrBindingNotFound
	}
	request := e.ResolveRequest{Key: binding.Key, Domain: "altoc", OwnerDeployment: domain.OwnerDeployment, SchemaVersion: binding.SchemaVersion, Generation: binding.Generation, Operation: e.Read}
	resolved, err := registry.Resolve(request)
	if err != nil {
		return nil, err
	}
	tables := map[string]string{}
	apf := domaininstall.IsAltocSalesDomain(domain)
	for _, logical := range altoc.SalesReadTables {
		key := logical
		if apf {
			key = "altoc_" + logical
		}
		if _, err = resolved.Table(key); err != nil {
			return nil, err
		}
		tables[logical] = domain.Tables[key]
	}
	reader, err := altoc.NewSalesReader(tables)
	if apf {
		reader, err = altoc.NewEnterpriseSalesReader(tables)
	}
	if err != nil {
		return nil, err
	}
	return &SalesReadService{registry, request, reader}, nil
}
func (s *SalesReadService) Read(ctx context.Context, resource, id, actor string, scope altoc.BasicReadScope, query altoc.SalesReadQuery) (map[string]any, error) {
	if s == nil || s.registry == nil {
		return nil, e.ErrBindingNotFound
	}
	tx, _, err := s.registry.BeginSnapshotReadTransaction(ctx, s.request)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	data, err := s.reader.ReadInTransaction(ctx, tx, resource, id, actor, scope, query)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return data, nil
}
