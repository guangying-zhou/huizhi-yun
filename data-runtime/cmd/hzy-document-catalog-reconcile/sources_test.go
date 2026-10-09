package main

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
)

func TestExpectedSourceNamesFailClosed(t *testing.T) {
	c := config.Config{}
	c.Apps.Aims.Enabled = true
	c.Apps.Codocs.Enabled = true
	c.Apps.Aims.DB.Database = "unified"
	c.Apps.Codocs.DB.Database = "codocs"
	if mode, err := validateSources(c, "unified", "codocs"); err != nil || mode != "legacy" {
		t.Fatal(mode, err)
	}
	for _, names := range [][2]string{{"", "codocs"}, {"old_aims", "codocs"}, {"unified", "wrong"}, {"unified\nsecret", "codocs"}} {
		if _, err := validateSources(c, names[0], names[1]); err == nil {
			t.Fatal("bad expectation accepted")
		}
	}
	c.Enterprise.Enabled = true
	c.Enterprise.Domains = map[string]config.EnterpriseDomainConfig{"aims": {Read: enterprise.PathUnified}}
	if _, err := validateSources(c, "unified", "codocs"); err == nil {
		t.Fatal("unbound unified connection accepted")
	}
	c.Enterprise.Domains["aims"] = config.EnterpriseDomainConfig{Read: enterprise.PathDisabled}
	if _, err := validateSources(c, "unified", "codocs"); err == nil {
		t.Fatal("disabled source accepted")
	}
}
func TestConnectedDatabaseNameCheckedBeforeReconcile(t *testing.T) {
	for _, actual := range []string{"expected", "other"} {
		t.Run(actual, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectQuery("SELECT DATABASE\\(\\)").WillReturnRows(sqlmock.NewRows([]string{"database"}).AddRow(actual))
			err = verifyDatabaseName(context.Background(), db, "expected")
			if (err == nil) != (actual == "expected") {
				t.Fatal(err)
			}
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestUnifiedSourceMustMatchRuntimeBinding(t *testing.T) {
	c := config.Config{Tenant: "C000001", Deployment: "c000001-prod-tenant-runtime", Enterprise: config.EnterpriseConfig{Enabled: true, Environment: "prod", SchemaVersion: "v1", Generation: 7, InstanceID: "fixture", DB: config.DBConfig{Host: "127.0.0.1", Port: 3306, Database: "hzy_enterprise"}, Domains: map[string]config.EnterpriseDomainConfig{"aims": {OwnerDeployment: "C000001-prod-enterprise", Read: enterprise.PathUnified, Write: enterprise.PathUnified, Scheduler: enterprise.PathDisabled, Tables: map[string]string{"aims_projects": "aims_projects"}}}}}
	c.DeploymentBindings = map[string]string{"enterprise": "C000001-prod-enterprise"}
	c.Enterprise.DB.User = "fixture"
	c.Enterprise.DB.ConnectionLimit = 1
	c.Apps.Aims.Enabled = true
	c.Apps.Codocs.Enabled = true
	c.Apps.Aims.DB = c.Enterprise.DB
	c.Apps.Codocs.DB.Database = "hzy_codocs"
	if mode, err := validateSources(c, "hzy_enterprise", "hzy_codocs"); err != nil || mode != "unified" {
		t.Fatal(mode, err)
	}
	c.Apps.Aims.DB.Host = "other"
	if _, err := validateSources(c, "hzy_enterprise", "hzy_codocs"); err == nil {
		t.Fatal("different server accepted")
	}
	c.Apps.Aims.DB = c.Enterprise.DB
	c.Apps.Aims.DB.Port++
	if _, err := validateSources(c, "hzy_enterprise", "hzy_codocs"); err == nil {
		t.Fatal("different port accepted")
	}
}

func TestBothConnectedSourcesCheckedBeforeBusinessReads(t *testing.T) {
	for _, targetName := range []string{"codocs", "wrong"} {
		t.Run(targetName, func(t *testing.T) {
			source, sm, _ := sqlmock.New()
			defer source.Close()
			target, tm, _ := sqlmock.New()
			defer target.Close()
			sm.ExpectQuery("SELECT DATABASE\\(\\)").WillReturnRows(sqlmock.NewRows([]string{"database"}).AddRow("aims"))
			tm.ExpectQuery("SELECT DATABASE\\(\\)").WillReturnRows(sqlmock.NewRows([]string{"database"}).AddRow(targetName))
			err := verifySources(context.Background(), config.Config{}, source, target, "aims", "codocs", "legacy")
			if (err == nil) != (targetName == "codocs") {
				t.Fatal(err)
			}
			if err := sm.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
			if err := tm.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
