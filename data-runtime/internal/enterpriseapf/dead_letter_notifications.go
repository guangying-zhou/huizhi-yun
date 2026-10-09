package enterpriseapf

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strings"
	"time"
)

func DeadLetterOperation(op string) bool {
	switch op {
	case "pending-dead-letter-actionables", "dead-letter-actionable-published", "pending-dead-letter-closures", "dead-letter-closure-acknowledged":
		return true
	}
	return false
}

type DeadLetterInput struct {
	OperationID      string   `json:"operationId"`
	Generation       uint64   `json:"generation"`
	OperationVersion uint64   `json:"operationVersion"`
	ActionableKey    string   `json:"actionableKey"`
	ObjectVersion    string   `json:"objectVersion"`
	NotificationID   string   `json:"notificationId"`
	RecipientUIDs    []string `json:"recipientUids"`
	ExpectedVersion  string   `json:"expectedVersion"`
	NextVersion      string   `json:"nextVersion"`
	State            string   `json:"state"`
}

func deadSource(domain string) string {
	if domain == "people" {
		return "enterprise"
	}
	return domain
}
func deadRepo(r enterprise.Resolved) (*integrationoperation.Repository, string, error) {
	tables := []string{}
	for _, name := range []string{"integration_operation", "integration_operation_attempt", "service_command_receipt", "integration_operation_dead_letter_actionable"} {
		t, e := r.Table(name)
		if e != nil {
			return nil, "", e
		}
		tables = append(tables, t)
	}
	mapping, e := integrationoperation.NewOutboxTables(tables[0], tables[1], tables[2], tables[3])
	if e != nil {
		return nil, "", e
	}
	repo, e := integrationoperation.NewRepository(r.DB, integrationoperation.WithOutboxTables(mapping))
	return repo, tables[0], e
}

// Legacy domain source facts are not service identities. Only Enterprise-owned
// commands in this Host deployment may be adopted. Foreign rows require 18C reconciliation.
func deadOwner(ctx context.Context, tx *sql.Tx, table, source string, who Identity, id string) error {
	var n int
	if id == "" {
		e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table+" WHERE tenant_code=? AND deployment_code=? AND source_app=? AND NOT(BINARY service_client_id<=>BINARY 'enterprise.runtime')", who.Tenant, who.Deployment, source).Scan(&n)
		if e != nil {
			return e
		}
		if n != 0 {
			return httperror.New(503, "apf_dead_letter_legacy_pending", "Legacy owner reconciliation required")
		}
		return nil
	}
	var client string
	e := tx.QueryRowContext(ctx, "SELECT service_client_id FROM "+table+" WHERE operation_id=? AND tenant_code=? AND deployment_code=? AND source_app=?", id, who.Tenant, who.Deployment, source).Scan(&client)
	if e == sql.ErrNoRows {
		return httperror.New(404, "apf_dead_letter_not_found", "Operation not found")
	}
	if e != nil {
		return e
	}
	if client != "enterprise.runtime" {
		return httperror.New(403, "apf_dead_letter_owner_invalid", "Owner mismatch")
	}
	return nil
}
func (s *Service) DeadLetter(ctx context.Context, domain, op string, i DeadLetterInput, who Identity, owner DueOwner) (any, error) {
	if !owner.Enabled || !owner.LegacyOwnerDisabled {
		return nil, httperror.New(503, "apf_dead_letter_disabled", "Owner disabled")
	}
	d, ok := s.binding.Domains[domain]
	if (domain != "altoc" && domain != "finance" && domain != "people") || !ok || who.Client != "enterprise.runtime" || who.Actor != "" || who.Tenant != s.binding.Key.Tenant || who.Deployment != d.OwnerDeployment {
		return nil, httperror.New(403, "apf_dead_letter_identity_invalid", "Exact system identity required")
	}
	if !DeadLetterOperation(op) {
		return nil, httperror.New(400, "apf_dead_letter_input_invalid", "Fixed operation required")
	}
	list := strings.HasPrefix(op, "pending-")
	if list && (i.OperationID != "" || i.Generation != 0 || i.OperationVersion != 0 || i.ActionableKey != "" || i.ObjectVersion != "" || i.NotificationID != "" || i.ExpectedVersion != "" || i.NextVersion != "" || i.State != "" || len(i.RecipientUIDs) != 0) {
		return nil, httperror.New(400, "apf_dead_letter_input_invalid", "Empty scan required")
	}
	request, e := s.request(domain, enterprise.Scheduler)
	if e != nil {
		return nil, e
	}
	tx, res, e := s.registry.BeginSchedulerTransaction(ctx, request)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	repo, table, e := deadRepo(res[0])
	if e != nil {
		return nil, e
	}
	source := deadSource(domain)
	if e = deadOwner(ctx, tx, table, source, who, i.OperationID); e != nil {
		return nil, e
	}
	now := time.Now().UTC()
	var out any
	switch op {
	case "pending-dead-letter-actionables":
		out, e = repo.ListPendingDeadLetterActionablesInTransaction(ctx, tx, who.Tenant, who.Deployment, source, 3, now)
	case "pending-dead-letter-closures":
		out, e = repo.ListPendingDeadLetterClosuresInTransaction(ctx, tx, who.Tenant, who.Deployment, source, 3)
	case "dead-letter-actionable-published":
		if i.ExpectedVersion != "" || i.NextVersion != "" || i.State != "" {
			return nil, httperror.New(400, "apf_dead_letter_input_invalid", "Publish receipt required")
		}
		out, e = repo.MarkDeadLetterActionablePublishedInTransaction(ctx, tx, integrationoperation.MarkDeadLetterActionablePublishedInput{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: source, OperationID: i.OperationID, Generation: i.Generation, OperationVersion: i.OperationVersion, ActionableKey: i.ActionableKey, ObjectVersion: i.ObjectVersion, NotificationID: i.NotificationID, RecipientUIDs: i.RecipientUIDs, Now: now})
	case "dead-letter-closure-acknowledged":
		if i.OperationVersion != 0 || i.ObjectVersion != "" || i.NotificationID != "" || len(i.RecipientUIDs) != 0 {
			return nil, httperror.New(400, "apf_dead_letter_input_invalid", "Closure receipt required")
		}
		out, e = repo.MarkDeadLetterClosureAcknowledgedInTransaction(ctx, tx, integrationoperation.MarkDeadLetterClosureAcknowledgedInput{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: source, OperationID: i.OperationID, Generation: i.Generation, ActionableKey: i.ActionableKey, ExpectedVersion: i.ExpectedVersion, NextVersion: i.NextVersion, State: i.State, Now: now})
	}
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return out, nil
}
func (s *Service) AuthorizeDeadLetter(ctx context.Context, domain, actor, id, notification string) (any, error) {
	request, e := s.request(domain, enterprise.Read)
	if e != nil {
		return nil, e
	}
	tx, res, e := s.registry.BeginReadTransaction(ctx, request)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	repo, table, e := deadRepo(res[0])
	if e != nil {
		return nil, e
	}
	who := Identity{Tenant: s.binding.Key.Tenant, Deployment: s.binding.Domains[domain].OwnerDeployment}
	if e = deadOwner(ctx, tx, table, deadSource(domain), who, id); e != nil {
		return nil, e
	}
	allowed, _, e := repo.AuthorizeDeadLetterNotificationInTransaction(ctx, tx, integrationoperation.AuthorizeDeadLetterNotificationInput{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: deadSource(domain), OperationID: id, NotificationID: notification, SubjectUID: actor})
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return map[string]any{"allowed": allowed}, nil
}
