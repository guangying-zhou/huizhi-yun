// Command hzy-document-catalog-reconcile compares the documents Aims wants
// registered with the Codocs document catalog (document asset design DOC-07).
//
// It is dry-run by default and prints the differences as JSON. With --apply it
// makes the catalog match: missing entries are created, changed ones updated
// and entries whose source no longer exists are marked inactive. It never
// deletes rows and never copies document content. Applying is idempotent.
//
// With --portfolio-policy-owners it runs a different, separate reconcile
// instead (document asset design DOC-05, 5b-1): existing Codocs access policy
// rows of documents that Aims owns at portfolio level are marked as owned by
// that portfolio. It only updates the owner type and owner code of rows that
// already exist, is dry-run by default and idempotent with --apply.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/codocs"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/documentcatalog"
)

func main() {
	apply := flag.Bool("apply", false, "write the differences; the default is a read-only dry run")
	policyOwners := flag.Bool("portfolio-policy-owners", false, "reconcile the owner of portfolio document access policies instead of the catalog")
	expectedAims := flag.String("expect-aims-db", "", "required exact Aims database name")
	expectedCodocs := flag.String("expect-codocs-db", "", "required exact Codocs database name")
	flag.Parse()
	if flag.NArg() != 0 {
		fail("unexpected arguments")
	}
	cfg, err := config.Load()
	if err != nil {
		fail(err.Error())
	}
	mode, err := validateSources(cfg, *expectedAims, *expectedCodocs)
	if err != nil {
		fail(err.Error())
	}
	source, err := aims.New(cfg.Apps.Aims)
	if err != nil {
		fail(err.Error())
	}
	target, err := codocs.New(cfg.Apps.Codocs)
	if err != nil {
		fail(err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	defer source.DB().Close()
	defer target.DB().Close()
	if err := verifySources(ctx, cfg, source.DB(), target.DB(), *expectedAims, *expectedCodocs, mode); err != nil {
		fail(err.Error())
	}
	summary, _ := json.Marshal(map[string]string{"aimsDatabase": *expectedAims, "aimsMode": mode, "codocsDatabase": *expectedCodocs, "codocsMode": "independent"})
	fmt.Fprintln(os.Stderr, string(summary))
	if *policyOwners {
		rows, err := source.PortfolioPolicyOwners(ctx)
		if err != nil {
			fail(err.Error())
		}
		owners := make([]codocs.PortfolioPolicyOwner, 0, len(rows))
		for _, row := range rows {
			owners = append(owners, codocs.PortfolioPolicyOwner{DocumentUUID: row[0], PortfolioCode: row[1]})
		}
		report, err := target.ReconcilePortfolioPolicyOwners(ctx, owners, "system:document-reconcile", *apply)
		out, _ := json.MarshalIndent(map[string]any{"tenant": cfg.Tenant, "apply": *apply, "portfolioPolicyOwners": report}, "", "  ")
		fmt.Println(string(out))
		if err != nil {
			fmt.Fprintln(os.Stderr, "hzy-document-catalog-reconcile:", err)
			os.Exit(1)
		}
		return
	}
	result := map[string]any{"tenant": cfg.Tenant, "apply": *apply, "kinds": map[string]documentcatalog.Report{}}
	failed := false
	for _, kind := range aims.DocumentCatalogKinds() {
		report, syncErr := documentcatalog.Sync(ctx, target.DocumentCatalogStore(), cfg.Tenant, "aims", source, kind, documentcatalog.Filter{}, *apply)
		if syncErr != nil {
			failed = true
			result["error"] = fmt.Sprintf("%s: %v", kind, syncErr)
			break
		}
		result["kinds"].(map[string]documentcatalog.Report)[kind] = report
	}
	out, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(out))
	if failed {
		os.Exit(1)
	}
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, "hzy-document-catalog-reconcile:", message)
	os.Exit(2)
}
