package enterprisecontracts

import (
	"context"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
)

// BasicReadService has only Altoc Read authority. Registry owns the pool and
// persistent generation fence; no Write or Scheduler operation is resolved.
type BasicReadService struct {
	registry *e.Registry
	request  e.ResolveRequest
	reader   *altoc.BasicReader
}

func NewBasicReadService(registry *e.Registry, binding e.Binding) (*BasicReadService, error) {
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
	for _, logical := range altoc.BasicReadTables {
		if _, err = resolved.Table(logical); err != nil {
			return nil, err
		}
		tables[logical] = domain.Tables[logical]
	}
	reader, err := altoc.NewBasicReader(tables)
	if err != nil {
		return nil, err
	}
	return &BasicReadService{registry, request, reader}, nil
}
func (s *BasicReadService) Read(ctx context.Context, resource, id, actor string, scope altoc.BasicReadScope, query altoc.BasicReadQuery) (map[string]any, error) {
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
