package config

import (
	"context"
	"database/sql"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
)

func TestEnterpriseOutboundWorkerExplicitLocalBinding(t *testing.T) {
	c := enterpriseConfigFixture()
	d := c.Enterprise.Domains["aims"]
	d.Write = enterprise.PathUnified
	d.Tables = map[string]string{"integration_operation": "a_op", "integration_operation_attempt": "a_attempt", "service_command_receipt": "a_receipt", "integration_operation_dead_letter_actionable": "a_dead"}
	c.Enterprise.Domains["aims"] = d
	b, err := c.EnterpriseBinding()
	if err != nil {
		t.Fatal(err)
	}
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	r := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if err = r.Register(context.Background(), b); err != nil {
		t.Fatal(err)
	}
	if s, err := c.EnterpriseAimsOutboundSource(r, b); err != nil || s != nil {
		t.Fatal("absence is not legacy identity", err)
	}
	c.Enterprise.AimsDeliveryWorker = &EnterpriseDeliveryWorker{Deployment: "aims-site", ServiceClientID: "aims.runtime"}
	s, err := c.EnterpriseAimsOutboundSource(r, b)
	if err != nil || s.WorkerDeployment() != "aims-site" {
		t.Fatal(err)
	}
	c.Enterprise.AimsDeliveryWorker.Deployment = "enterprise-site"
	if _, err = c.EnterpriseAimsOutboundSource(r, b); err == nil {
		t.Fatal("owner inferred as worker")
	}
	c.Enterprise.AimsDeliveryWorker.Deployment = "aims-site"
	c.Enterprise.AimsDeliveryWorker.ServiceClientID = "enterprise.runtime"
	if _, err = c.EnterpriseAimsOutboundSource(r, b); err == nil {
		t.Fatal("transport impersonation")
	}
	c.Enterprise.AimsDeliveryWorker.ServiceClientID = "aims.runtime"
	delete(c.DeploymentBindings, "aims")
	if _, err = c.EnterpriseAimsOutboundSource(r, b); err == nil {
		t.Fatal("missing actual worker binding")
	}
}
