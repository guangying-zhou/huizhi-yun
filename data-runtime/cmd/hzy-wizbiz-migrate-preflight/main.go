package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/migrations/wizbiztool"
	"os"
)

func run() int {
	profile := flag.String("profile", "", "protected full migration profile")
	manifest := flag.String("snapshot-manifest", "", "protected snapshot manifest")
	phase := flag.String("phase", "migration", "w1 preparation or migration")
	flag.Parse()
	if flag.NArg() != 0 || *profile == "" || *manifest == "" || (*phase != "w1" && *phase != "migration") {
		fmt.Fprintln(os.Stderr, "preflight_input_invalid")
		return 1
	}
	var p wizbiztool.Profile
	var m wizbiztool.SnapshotManifest
	if _, e := wizbiztool.ReadJSON(*profile, &p, 64<<10); e != nil {
		fmt.Fprintln(os.Stderr, "preflight_profile_invalid")
		return 1
	}
	hash, e := wizbiztool.ReadJSON(*manifest, &m, 8<<20)
	if e != nil {
		fmt.Fprintln(os.Stderr, "preflight_manifest_invalid")
		return 1
	}
	r := wizbiztool.PreflightPhase(context.Background(), p, m, hash, *phase)
	if json.NewEncoder(os.Stdout).Encode(r) != nil {
		return 1
	}
	if !r.Ready {
		return 1
	}
	return 0
}
func main() { os.Exit(run()) }
