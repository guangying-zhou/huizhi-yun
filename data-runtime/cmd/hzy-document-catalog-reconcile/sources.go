package main

import (
	"context"
	"database/sql"
	"errors"
	"regexp"

	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

var invalidSources = errors.New("document catalog source database expectation failed")

// Runtime constructs the Aims adapter from Apps.Aims, too. Unified mode
// additionally verifies its Registry-bound compatibility views on that pool.
func validateSources(c config.Config, expectedAims, expectedCodocs string) (string, error) {
	name := regexp.MustCompile(`^[A-Za-z0-9_]+$`)
	if !c.Apps.Aims.Enabled || !c.Apps.Codocs.Enabled || !name.MatchString(expectedAims) || !name.MatchString(expectedCodocs) || c.Apps.Aims.DB.Database != expectedAims || c.Apps.Codocs.DB.Database != expectedCodocs {
		return "", invalidSources
	}
	mode := "legacy"
	if c.Enterprise.Enabled {
		if d, ok := c.Enterprise.Domains["aims"]; ok {
			if d.Read == enterprise.PathUnified {
				mode = "unified"
				a, b := c.Apps.Aims.DB, c.Enterprise.DB
				if a.Host != b.Host || a.Port != b.Port || a.Database != b.Database {
					return "", invalidSources
				}
				if _, err := c.EnterpriseBinding(); err != nil {
					return "", invalidSources
				}
			} else if d.Read != enterprise.PathLegacy {
				return "", invalidSources
			}
		}
		if d, ok := c.Enterprise.Domains["codocs"]; ok && d.Read == enterprise.PathUnified {
			return "", invalidSources
		}
	}
	return mode, nil
}
func verifyDatabaseName(ctx context.Context, db *sql.DB, expected string) error {
	var actual string
	if err := db.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&actual); err != nil || actual != expected {
		return invalidSources
	}
	return nil
}
func verifySources(ctx context.Context, c config.Config, source, target *sql.DB, expectedAims, expectedCodocs, mode string) error {
	if err := verifyDatabaseName(ctx, source, expectedAims); err != nil {
		return err
	}
	if err := verifyDatabaseName(ctx, target, expectedCodocs); err != nil {
		return err
	}
	if mode == "unified" {
		b, err := c.EnterpriseBinding()
		if err != nil {
			return invalidSources
		}
		if err = enterprise.VerifyCompatibilityViews(ctx, source, b, "aims", []string{"aims_projects", "project_documents", "project_portfolios", "requirement_contents", "project_weekly_reports", "project_weekly_report_versions"}); err != nil {
			return errors.New("Aims unified Registry or compatibility view verification failed")
		}
	}
	return nil
}
