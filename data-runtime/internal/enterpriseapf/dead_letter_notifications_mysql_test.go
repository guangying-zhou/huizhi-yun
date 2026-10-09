package enterpriseapf

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"sync"
	"testing"
	"time"
)

func TestAPFDeadLetterNotificationsMySQL(t *testing.T) {
	for _, domain := range []string{"altoc", "finance", "people"} {
		t.Run(domain, func(t *testing.T) {
			s, db := dueFixture(t, domain)
			ctx := context.Background()
			b := s.binding
			d := b.Domains[domain]
			d.Scheduler = enterprise.PathUnified
			b.Domains[domain] = d
			s.registry = enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
			if e := s.registry.Register(ctx, b); e != nil {
				t.Fatal(e)
			}
			s.binding = b
			table := domain + "_integration_operation"
			id := uuid.NewString()
			source := deadSource(domain)
			_, e := db.Exec("INSERT INTO "+table+" (operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_json,command_sha256,status,attempt_count,max_attempts,next_attempt_at,dead_lettered_at,original_actor_uid,service_client_id,version_no) VALUES(?,?,?,'C000001','host-test',?,'workflow','test.approval.v1','workflow:instance:create','fixture','F1',?,'{}',REPEAT('a',64),'dead_letter',8,8,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),'Owner','enterprise.runtime',4)", id, id, id, source, id)
			if e != nil {
				t.Fatal(e)
			}
			t.Cleanup(func() {
				db.Exec("DELETE FROM "+domain+"_integration_operation_dead_letter_actionable WHERE operation_id=?", id)
				db.Exec("DELETE FROM "+table+" WHERE operation_id=?", id)
			})
			who := Identity{Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime"}
			owner := DueOwner{Enabled: true, LegacyOwnerDisabled: true}
			call := func(op string, i DeadLetterInput) any {
				t.Helper()
				v, e := s.DeadLetter(ctx, domain, op, i, who, owner)
				if e != nil {
					t.Fatal(op, e)
				}
				return v
			}
			for _, bad := range []DueOwner{{}, {Enabled: true}} {
				if _, e := s.DeadLetter(ctx, domain, "pending-dead-letter-actionables", DeadLetterInput{}, who, bad); e == nil {
					t.Fatal("disabled owner accepted")
				}
			}
			for _, bad := range []Identity{{Tenant: "wrong", Deployment: "host-test", Client: "enterprise.runtime"}, {Tenant: "C000001", Deployment: "wrong", Client: "enterprise.runtime"}, {Tenant: "C000001", Deployment: "host-test", Client: domain + ".runtime"}, {Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Actor: "Owner"}} {
				if _, e := s.DeadLetter(ctx, domain, "pending-dead-letter-actionables", DeadLetterInput{}, bad, owner); e == nil {
					t.Fatal("foreign identity accepted")
				}
			}
			items := call("pending-dead-letter-actionables", DeadLetterInput{}).([]integrationoperation.DeadLetterActionableCandidate)
			if len(items) != 1 {
				t.Fatal(items)
			}
			c := items[0]
			if c.Generation != 4 || c.OperationVersion != 4 || c.ActionableKey != fmt.Sprintf("integration-operation:%s:%s:dead-letter:g4", source, id) {
				t.Fatal("frozen identity", c)
			}
			var frozen int
			db.QueryRow("SELECT COUNT(*) FROM " + domain + "_integration_operation_dead_letter_actionable").Scan(&frozen)
			call("pending-dead-letter-actionables", DeadLetterInput{})
			var same int
			db.QueryRow("SELECT COUNT(*) FROM " + domain + "_integration_operation_dead_letter_actionable").Scan(&same)
			if same != frozen {
				t.Fatal("duplicate generation")
			}
			ack := DeadLetterInput{OperationID: id, Generation: c.Generation, OperationVersion: c.OperationVersion, ActionableKey: c.ActionableKey, ObjectVersion: c.ObjectVersion, NotificationID: "N1", RecipientUIDs: []string{"Owner"}}
			bad := ack
			bad.Generation++
			if _, e := s.DeadLetter(ctx, domain, "dead-letter-actionable-published", bad, who, owner); e == nil {
				t.Fatal("changed generation accepted")
			}
			// Recovery before publish acknowledgement retains creation-before-close.
			req, _ := s.request(domain, enterprise.Read)
			resolved, e := s.registry.Resolve(req)
			if e != nil {
				t.Fatal(e)
			}
			repo, _, e := deadRepo(resolved)
			if e != nil {
				t.Fatal(e)
			}
			_, e = repo.Replay(ctx, integrationoperation.ReplayInput{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: source, OperationID: id, ExpectedVersion: 4, ActorUID: "Owner", Reason: "isolated recovery", Now: time.Now().UTC()})
			if e != nil {
				t.Fatal(e)
			}
			if len(call("pending-dead-letter-closures", DeadLetterInput{}).([]integrationoperation.DeadLetterClosureCandidate)) != 0 {
				t.Fatal("close precedes creation")
			}
			var wg sync.WaitGroup
			failures := make(chan error, 2)
			for range 2 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					_, e := s.DeadLetter(ctx, domain, "dead-letter-actionable-published", ack, who, owner)
					failures <- e
				}()
			}
			wg.Wait()
			close(failures)
			for e := range failures {
				if e != nil {
					t.Fatal("same ACK replay", e)
				}
			}
			authorized, e := s.AuthorizeDeadLetter(ctx, domain, "Owner", id, "N1")
			if e != nil || authorized.(map[string]any)["allowed"] != false {
				t.Fatal("recovered generation still viewable", authorized, e)
			}
			closures := call("pending-dead-letter-closures", DeadLetterInput{}).([]integrationoperation.DeadLetterClosureCandidate)
			if len(closures) != 1 {
				t.Fatal(closures)
			}
			cl := closures[0]
			if cl.State != "cancelled" || len(cl.RecipientUIDs) != 1 || cl.RecipientUIDs[0] != "Owner" {
				t.Fatal("changed frozen recipients", cl)
			}
			ci := DeadLetterInput{OperationID: id, Generation: cl.Generation, ActionableKey: cl.ActionableKey, ExpectedVersion: cl.ExpectedVersion, NextVersion: cl.NextVersion, State: cl.State}
			call("dead-letter-closure-acknowledged", ci)
			call("dead-letter-closure-acknowledged", ci)
			if len(call("pending-dead-letter-closures", DeadLetterInput{}).([]integrationoperation.DeadLetterClosureCandidate)) != 0 {
				t.Fatal("closure not converged")
			}
			// A new failed generation may now notify, but prior closure must already be ACKed.
			if _, e = db.Exec("UPDATE "+table+" SET status='dead_letter',version_no=6,dead_lettered_at=UTC_TIMESTAMP(3) WHERE operation_id=?", id); e != nil {
				t.Fatal(e)
			}
			items = call("pending-dead-letter-actionables", DeadLetterInput{}).([]integrationoperation.DeadLetterActionableCandidate)
			if len(items) != 1 || items[0].Generation != 6 {
				t.Fatal("new generation", items)
			}
			c = items[0]
			ack.Generation = 6
			ack.OperationVersion = 6
			ack.ActionableKey = c.ActionableKey
			ack.ObjectVersion = c.ObjectVersion
			ack.NotificationID = "N2"
			call("dead-letter-actionable-published", ack)
			for _, subject := range []string{"Owner", "owner", "Other"} {
				v, e := s.AuthorizeDeadLetter(ctx, domain, subject, id, "N2")
				if e != nil || v.(map[string]any)["allowed"] != (subject == "Owner") {
					t.Fatal("exact recipient", subject, v, e)
				}
			}
			if _, e := s.DeadLetter(ctx, domain, "pending-dead-letter-actionables", DeadLetterInput{OperationID: id}, who, owner); e == nil {
				t.Fatal("scan injection")
			}
			if _, e = db.Exec("UPDATE "+table+" SET service_client_id='legacy.runtime' WHERE operation_id=?", id); e != nil {
				t.Fatal(e)
			}
			if _, e := s.DeadLetter(ctx, domain, "pending-dead-letter-actionables", DeadLetterInput{}, who, owner); e == nil {
				t.Fatal("unreconciled legacy owner adopted")
			}
		})
	}
}
