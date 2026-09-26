// hzy-enterprise-migrate produces a reviewed shadow copy; it never switches routes.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/migrations/unified"
)

type localConfig struct {
	Migration  unified.Config
	Recovery   *unified.RecoveryPlan
	Connection struct {
		Host                   string
		Port                   int
		User, Password, Socket string
	}
}

func run() error {
	configPath := flag.String("config", "", "protected local configuration file")
	planPath := flag.String("plan", "", "reviewable plan output/input file")
	recovery := flag.Bool("recovery", false, "plan/copy current fenced unified authority into two new recovery schemas")
	verifyRecovery := flag.Bool("verify-recovery", false, "read-only verify a reviewed completed recovery")
	apply := flag.Bool("apply", false, "write only the reviewed independent target shadow database")
	approved := flag.String("review-hash", "", "explicit approved plan SHA-256; required with --apply")
	flag.Parse()
	if *configPath == "" || *planPath == "" {
		return fmt.Errorf("--config and --plan required; default operation is dry-run")
	}
	raw, err := os.ReadFile(*configPath)
	if err != nil {
		return fmt.Errorf("cannot read local configuration")
	}
	var c localConfig
	if err := json.Unmarshal(raw, &c); err != nil {
		return fmt.Errorf("invalid local configuration")
	}
	mc := mysql.NewConfig()
	mc.User = c.Connection.User
	mc.Passwd = c.Connection.Password
	mc.Net = "tcp"
	mc.Addr = fmt.Sprintf("%s:%d", c.Connection.Host, c.Connection.Port)
	mc.Params = map[string]string{"time_zone": "'+00:00'"}
	mc.Timeout = 5 * time.Second
	mc.ReadTimeout = 30 * time.Second
	mc.WriteTimeout = 30 * time.Second
	if c.Connection.Socket != "" {
		if !strings.HasPrefix(filepath.Clean(c.Connection.Socket), "/tmp/hzy-product-center.") {
			return fmt.Errorf("socket mode accepts only dedicated isolated MySQL instances")
		}
		mc.Net = "unix"
		mc.Addr = c.Connection.Socket
	}
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		return fmt.Errorf("cannot initialize migration connection")
	}
	defer db.Close()
	db.SetMaxOpenConns(3)
	ctx, cancel := unified.BoundContext(context.Background())
	defer cancel()
	if *recovery || *verifyRecovery {
		if c.Recovery == nil || c.Recovery.Final.Config != c.Migration {
			return fmt.Errorf("explicit matching recovery contract required")
		}
		if *apply && *verifyRecovery {
			return fmt.Errorf("verify cannot apply")
		}
		p := *c.Recovery
		if *apply || *verifyRecovery {
			raw, err := os.ReadFile(*planPath)
			if err != nil {
				return fmt.Errorf("cannot read recovery plan")
			}
			if err = json.Unmarshal(raw, &p); err != nil {
				return fmt.Errorf("invalid recovery plan")
			}
			original := *c.Recovery
			original.Tables = nil
			original.ReviewHash = ""
			check := p
			check.Tables = nil
			check.ReviewHash = ""
			if unified.RecoveryReviewHash(original) != unified.RecoveryReviewHash(check) {
				return fmt.Errorf("recovery plan differs from protected contract")
			}
		}
		if *apply {
			return unified.ApplyRecovery(ctx, db, p, *approved)
		}
		if *verifyRecovery {
			return unified.VerifyRecovery(ctx, db, p)
		}
		planned, err := unified.PrepareRecovery(ctx, db, p)
		if err != nil {
			return err
		}
		raw, err := json.MarshalIndent(planned, "", "  ")
		if err != nil {
			return err
		}
		if err = os.WriteFile(*planPath, append(raw, '\n'), 0600); err != nil {
			return fmt.Errorf("cannot write recovery plan")
		}
		fmt.Printf("Recovery plan prepared: %s; no write/cutover performed\n", planned.ReviewHash)
		return nil
	}
	var plan unified.Plan
	if *apply {
		raw, err := os.ReadFile(*planPath)
		if err != nil {
			return fmt.Errorf("cannot read review plan")
		}
		if err := json.Unmarshal(raw, &plan); err != nil {
			return fmt.Errorf("invalid review plan")
		}
		if plan.Config != c.Migration {
			return fmt.Errorf("local migration identity differs from reviewed plan")
		}
		if err := unified.Apply(ctx, db, plan, *approved); err != nil {
			return fmt.Errorf("apply rejected or interrupted; inspect target ledger and re-plan if source changed: %w", err)
		}
	} else {
		plan, err = unified.Prepare(ctx, db, c.Migration)
		if err != nil {
			return fmt.Errorf("dry-run failed: %w", err)
		}
		data, err := json.MarshalIndent(plan, "", "  ")
		if err != nil {
			return err
		}
		if err := os.WriteFile(*planPath, append(data, '\n'), 0600); err != nil {
			return fmt.Errorf("cannot write review plan")
		}
	}
	var rows uint64
	for _, t := range plan.Tables {
		rows += t.Count
	}
	fmt.Printf("mode=%s tables=%d rows=%d review_hash=%s target=%s\n", map[bool]string{false: "dry-run", true: "verified-shadow"}[*apply], len(plan.Tables), rows, plan.ReviewHash, plan.Config.Target)
	fmt.Println("Source remains the sole writer. Target generation is 0; no runtime route or credential changed.")
	return nil
}
func main() {
	if err := run(); err != nil {
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) {
			fmt.Fprintf(os.Stderr, "MySQL rejected migration operation (code %d); SQL values withheld\n", mysqlErr.Number)
		} else {
			fmt.Fprintln(os.Stderr, err)
		}
		os.Exit(1)
	}
}
