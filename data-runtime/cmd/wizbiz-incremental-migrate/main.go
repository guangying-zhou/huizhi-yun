package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiz"
	"github.com/joho/godotenv"
)

func main() {
	var envPath string
	var targets string
	var batchCode string
	var since string
	var limit int
	var apply bool
	var jsonOutput bool

	flags := flag.NewFlagSet("wizbiz-incremental-migrate", flag.ExitOnError)
	flags.StringVar(&envPath, "env", ".env", "environment file path")
	flags.StringVar(&targets, "targets", "all", "comma-separated targets or all")
	flags.StringVar(&batchCode, "batch-code", "", "migration batch code")
	flags.StringVar(&since, "since", "", "optional lower-bound timestamp/date for incremental source filtering")
	flags.IntVar(&limit, "limit", 0, "optional source row limit per target")
	flags.BoolVar(&apply, "apply", false, "write target databases; default is dry-run")
	flags.BoolVar(&jsonOutput, "json", false, "print machine-readable JSON result")
	flags.Parse(os.Args[1:])

	if envPath != "" {
		_ = godotenv.Load(envPath)
	}

	cfg := wizbiz.LoadConfigFromEnv()
	opt := wizbiz.Options{
		Apply:     apply,
		BatchCode: strings.TrimSpace(batchCode),
		Since:     strings.TrimSpace(since),
		Limit:     limit,
		Targets:   parseTargets(targets),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	result, err := wizbiz.Run(ctx, cfg, opt)
	if err != nil {
		if jsonOutput {
			_ = json.NewEncoder(os.Stdout).Encode(map[string]string{"error": err.Error()})
		}
		log.Fatalf("[wizbiz-incremental-migrate] failed: %v", err)
	}
	if jsonOutput {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		_ = encoder.Encode(result)
	}
	if jsonOutput {
		return
	}

	mode := "dry-run"
	if result.Apply {
		mode = "apply"
	}
	fmt.Printf("WizBiz incremental migration finished (%s), batch=%s\n", mode, result.BatchCode)
	for _, target := range result.Targets {
		fmt.Printf("- %-22s scanned=%d insert=%d update=%d skip=%d\n", target.Name, target.Scanned, target.Inserted, target.Updated, target.Skipped)
		for _, warning := range target.Warnings {
			fmt.Printf("  warning: %s\n", warning)
		}
	}
}

func parseTargets(value string) []string {
	parts := strings.Split(value, ",")
	targets := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			targets = append(targets, part)
		}
	}
	if len(targets) == 0 {
		return []string{"all"}
	}
	return targets
}
