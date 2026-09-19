package enterprise

import (
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// OutboundSource binds logical Aims facts to an explicitly configured real Aims
// delivery worker. It grants no transport identity or authorization. The worker
// must authenticate independently when delivering to Altoc.
type OutboundSource struct {
	key                                   BindingKey
	schema                                string
	generation                            uint64
	owner, workerDeployment, workerClient string
	tables                                integrationoperation.OutboxTables
}

func NewOutboundSource(writer ResolveRequest, resolved Resolved, workerDeployment, workerClient string) (OutboundSource, error) {
	if writer.Domain != "aims" || !nonempty(workerDeployment) || workerClient != "aims.runtime" {
		return OutboundSource{}, fmt.Errorf("%w: explicit Aims delivery worker required", ErrBindingMismatch)
	}
	operation, e := resolved.Table("integration_operation")
	if e != nil {
		return OutboundSource{}, e
	}
	attempt, e := resolved.Table("integration_operation_attempt")
	if e != nil {
		return OutboundSource{}, e
	}
	receipt, e := resolved.Table("service_command_receipt")
	if e != nil {
		return OutboundSource{}, e
	}
	deadLetter, e := resolved.Table("integration_operation_dead_letter_actionable")
	if e != nil {
		return OutboundSource{}, e
	}
	tables, e := integrationoperation.NewOutboxTables(operation, attempt, receipt, deadLetter)
	if e != nil {
		return OutboundSource{}, e
	}
	s := OutboundSource{writer.Key, writer.SchemaVersion, writer.Generation, writer.OwnerDeployment, workerDeployment, workerClient, tables}
	if e = s.Validate(writer, resolved); e != nil {
		return OutboundSource{}, e
	}
	return s, nil
}
func (s OutboundSource) Validate(writer ResolveRequest, resolved Resolved) error {
	if !validKey(s.key) || !nonempty(s.schema) || s.generation == 0 || !nonempty(s.owner) || writer.Domain != "aims" || resolved.Domain != "aims" || s.key != writer.Key || s.key != resolved.Key || s.schema != writer.SchemaVersion || s.schema != resolved.SchemaVersion || s.generation != writer.Generation || s.generation != resolved.Generation || s.owner != writer.OwnerDeployment || s.owner != resolved.OwnerDeployment || s.workerDeployment == "" || s.workerClient != "aims.runtime" {
		return ErrBindingMismatch
	}
	for logical, physical := range map[string]string{"integration_operation": s.tables.Operation(), "integration_operation_attempt": s.tables.Attempt(), "service_command_receipt": s.tables.Receipt(), "integration_operation_dead_letter_actionable": s.tables.DeadLetterActionable()} {
		actual, e := resolved.Table(logical)
		if e != nil || actual != physical {
			return ErrBindingMismatch
		}
	}
	return s.tables.Validate()
}

// Context returns no trusted producer context for an absent or stale source.
// Producers reject it when a command actually has external feedback bindings.
func (s *OutboundSource) Context(writer ResolveRequest, requestID string) integrationoperation.TrustedContext {
	if s == nil || writer.Domain != "aims" || s.key != writer.Key || s.schema != writer.SchemaVersion || s.generation != writer.Generation || s.owner != writer.OwnerDeployment {
		return integrationoperation.TrustedContext{}
	}
	tables := s.tables
	return integrationoperation.TrustedContext{TenantCode: s.key.Tenant, DeploymentCode: s.workerDeployment, SourceApp: "aims", RequestID: requestID, OutboxTables: &tables}
}

func (s OutboundSource) WorkerDeployment() string                  { return s.workerDeployment }
func (s OutboundSource) WorkerClient() string                      { return s.workerClient }
func (s OutboundSource) Tables() integrationoperation.OutboxTables { return s.tables }
