// Offline candidate + SHOW GRANTS snapshot preflight. Never connects to MySQL.
package main

import (
	"flag"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiztool"
	"os"
)

func run() error {
	profile := flag.String("profile", "", "protected migration profile")
	out := flag.String("out", "", "new 0600 candidate plan")
	snapshot := flag.String("show-grants", "", "optional protected native SHOW GRANTS JSON array")
	flag.Parse()
	if flag.NArg() != 0 || *profile == "" || *out == "" {
		return wizbiztool.ErrInput
	}
	var p wizbiztool.Profile
	if _, err := wizbiztool.ReadJSON(*profile, &p, 64<<10); err != nil {
		return err
	}
	plan, err := wizbiztool.BuildTargetGrantPlan(p)
	if err != nil {
		return err
	}
	if *snapshot != "" {
		var grants []string
		if _, err := wizbiztool.ReadJSON(*snapshot, &grants, 1<<20); err != nil {
			return err
		}
		if err := wizbiztool.CheckTargetGrantSnapshot(plan, grants); err != nil {
			return err
		}
	}
	if err := wizbiztool.WriteJSON(*out, plan); err != nil {
		return err
	}
	fmt.Printf("candidate only: DML=%d SELECT=%d snapshotChecked=%t\n", len(plan.DMLTables), len(plan.ReadOnlyTables), *snapshot != "")
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
