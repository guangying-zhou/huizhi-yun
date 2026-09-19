package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/enterprisecandidate"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
	"os"
	"path/filepath"
	"regexp"
)

func run() error {
	input := flag.String("plan", "", "frozen read-only migration plan")
	dir := flag.String("out-dir", "", "candidate output directory")
	flag.Parse()
	if *input == "" || *dir == "" {
		return fmt.Errorf("--plan and --out-dir required")
	}
	raw, err := os.ReadFile(*input)
	if err != nil {
		return err
	}
	var plan unified.Plan
	if err = json.Unmarshal(raw, &plan); err != nil {
		return err
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(plan.Config.Tenant) {
		return fmt.Errorf("invalid tenant filename")
	}
	candidate, sql, err := enterprisecandidate.Build(plan, raw)
	if err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(candidate, "", "  ")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(*dir, 0700); err != nil {
		return err
	}
	prefix := filepath.Join(*dir, plan.Config.Tenant+".enterprise-")
	if err = os.WriteFile(prefix+"composition.candidate.json", append(encoded, '\n'), 0600); err != nil {
		return err
	}
	if err = os.WriteFile(prefix+"compatibility-views.candidate.sql", []byte(sql), 0600); err != nil {
		return err
	}
	fmt.Printf("candidate-only views=%d blockers=%d sourceReviewHash=%s installed=false targetVerified=false\n", len(candidate.Views), len(candidate.Blockers), candidate.SourceReviewHash)
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
