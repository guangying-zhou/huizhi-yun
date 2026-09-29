package enterprise

import (
	"context"
	"database/sql"
)

// SchedulerIdentity is populated by a verified service-token boundary. It is not
// an HTTP request payload and does not itself verify signatures or revocation.
type SchedulerIdentity struct {
	Tenant, Deployment, SourceApp, ClientID, Subject string
}

// SchedulerBinding ties a real delivery service to one registered domain's
// scheduler path. It neither aliases the interactive Host identity nor creates
// credentials for a logical module.
type SchedulerBinding struct {
	registry *Registry
	request  ResolveRequest
	source   OutboundSource
}

func NewSchedulerBinding(registry *Registry, request ResolveRequest, source OutboundSource) (*SchedulerBinding, error) {
	if registry == nil || request.Operation != Scheduler {
		return nil, ErrBindingMismatch
	}
	resolved, err := registry.Resolve(request)
	if err != nil {
		return nil, err
	}
	if err = source.Validate(request, resolved); err != nil {
		return nil, err
	}
	return &SchedulerBinding{registry: registry, request: request, source: source}, nil
}

// Begin rejects mismatched service identities before any transaction starts.
// The caller commits claim/ack work before performing external delivery.
func (s *SchedulerBinding) Begin(ctx context.Context, identity SchedulerIdentity) (*sql.Tx, Resolved, error) {
	if s == nil || s.registry == nil || identity.Tenant != s.request.Key.Tenant || identity.Deployment != s.source.WorkerDeployment() || identity.SourceApp != "aims" || identity.ClientID != s.source.WorkerClient() || identity.Subject != s.source.WorkerClient() {
		return nil, Resolved{}, ErrBindingMismatch
	}
	tx, resolved, err := s.registry.BeginSchedulerTransaction(ctx, s.request)
	if err != nil {
		return nil, Resolved{}, err
	}
	if err = s.source.Validate(s.request, resolved[0]); err != nil {
		_ = tx.Rollback()
		return nil, Resolved{}, err
	}
	return tx, resolved[0], nil
}

// WorkerSchedulerBinding ties one app's retained worker to that app's own
// domain scheduler path when no outbox tables are involved. Aims outbox work
// keeps SchedulerBinding, which also validates its outbound source.
type WorkerSchedulerBinding struct {
	registry                            *Registry
	request                             ResolveRequest
	app, workerDeployment, workerClient string
}

func NewWorkerSchedulerBinding(registry *Registry, request ResolveRequest, app, workerDeployment, workerClient string) (*WorkerSchedulerBinding, error) {
	if registry == nil || request.Operation != Scheduler || request.Domain != app || !nonempty(workerDeployment) || workerClient != app+".runtime" {
		return nil, ErrBindingMismatch
	}
	if _, err := registry.Resolve(request); err != nil {
		return nil, err
	}
	return &WorkerSchedulerBinding{registry: registry, request: request, app: app, workerDeployment: workerDeployment, workerClient: workerClient}, nil
}

// Begin rejects any identity other than the registered worker before a
// transaction starts; the transaction then holds the registry SHARE lock.
func (s *WorkerSchedulerBinding) Begin(ctx context.Context, identity SchedulerIdentity) (*sql.Tx, error) {
	if s == nil || s.registry == nil || identity.Tenant != s.request.Key.Tenant || identity.Deployment != s.workerDeployment || identity.SourceApp != s.app || identity.ClientID != s.workerClient || identity.Subject != s.workerClient {
		return nil, ErrBindingMismatch
	}
	tx, _, err := s.registry.BeginSchedulerTransaction(ctx, s.request)
	return tx, err
}
