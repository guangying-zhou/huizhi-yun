package unified

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	mysql "github.com/go-sql-driver/mysql"
	"strings"
)

// SQLApprovedExternalDrains verifies exact Platform-approved automatic/manual
// evidence and rechecks source/provider rows under the activation transaction.
// It never makes a network request or equates elapsed time with completion.
type SQLApprovedExternalDrains struct {
	Payload, Signature []byte
	PlatformPublicKey  ed25519.PublicKey
	SourceDeployments  map[string]string
}
type externalProbe struct {
	Kind, App, Schema, Deployment, Hash, Unavailable string
	Count                                            uint64
	Rows                                             [][]*string
}

var externalColumns = map[string][]string{
	"source":       {"operation_id", "operation_key", "tenant_code", "deployment_code", "source_app", "target_app", "operation_code", "required_capability", "idempotency_key", "command_schema_version", "command_sha256", "status", "attempt_count", "locked_by", "locked_until", "target_receipt_id", "target_biz_type", "target_biz_code", "response_summary_sha256"},
	"receipt":      {"receipt_id", "operation_id", "tenant_code", "source_deployment_code", "deployment_code", "source_app", "target_app", "operation_code", "required_capability", "idempotency_key", "command_schema_version", "command_sha256", "status", "locked_by", "locked_until", "target_biz_type", "target_biz_code", "response_summary_sha256"},
	"notification": {"id", "notification_id", "channel", "provider", "status", "attempt_count"},
}

func externalProbeQuery(p externalProbe) (string, error) {
	cols, ok := externalColumns[p.Kind]
	if !ok || !ident.MatchString(p.Schema) {
		return "", errors.New("invalid external probe")
	}
	prefix := ""
	table := "integration_operation"
	suffix := " ORDER BY operation_id"
	if p.Kind == "receipt" {
		table = "service_command_receipt"
		suffix = " WHERE tenant_code=? AND source_app IN ('aims','assets') ORDER BY receipt_id"
	}
	if p.Kind == "notification" {
		prefix = "d."
		table = "portal_notification_deliveries"
		suffix = " d JOIN " + qualified(p.Schema, "portal_notifications") + " n ON n.notification_id=d.notification_id WHERE n.source_app_code IN ('aims','assets') ORDER BY d.id"
	}
	projection := make([]string, len(cols))
	for i, col := range cols {
		projection[i] = "CAST(" + prefix + quoted(col) + " AS CHAR)"
	}
	return "SELECT " + strings.Join(projection, ",") + " FROM " + qualified(p.Schema, table) + suffix + " FOR SHARE", nil
}
func (v SQLApprovedExternalDrains) VerifyExternalDrain(ctx context.Context, tx *sql.Tx, s FenceSpec, key string) (string, error) {
	if len(v.PlatformPublicKey) != ed25519.PublicKeySize || !ed25519.Verify(v.PlatformPublicKey, v.Payload, v.Signature) {
		return "", errors.New("external evidence approval signature invalid")
	}
	wire, err := validateExternalApproval(v.Payload, v.SourceDeployments, s, key)
	if err != nil {
		return "", err
	}
	if err := verifyInstance(ctx, tx, s.Config.InstanceID); err != nil {
		return "", err
	}
	for _, probe := range wire.Report.Probes {
		query, err := externalProbeQuery(probe)
		if err != nil {
			return "", err
		}
		args := []any{}
		if probe.Kind == "receipt" {
			args = append(args, s.Config.Tenant)
		}
		rows, err := tx.QueryContext(ctx, query, args...)
		if probe.Unavailable != "" {
			if err == nil {
				rows.Close()
				return "", errors.New("external probe availability changed")
			}
			var serverError *mysql.MySQLError
			if !errors.As(err, &serverError) || !((probe.Unavailable == "ER_NO_SUCH_TABLE" && serverError.Number == 1146) || (probe.Unavailable == "ER_BAD_FIELD_ERROR" && serverError.Number == 1054)) {
				return "", errors.New("external probe unavailable without exact reviewed cause")
			}
			continue
		}
		if err != nil {
			return "", err
		}
		h := sha256.New()
		var count uint64
		for rows.Next() {
			values := make([]sql.RawBytes, len(externalColumns[probe.Kind]))
			dest := make([]any, len(values))
			for i := range values {
				dest[i] = &values[i]
			}
			if err := rows.Scan(dest...); err != nil {
				rows.Close()
				return "", err
			}
			hashRow(h, values)
			count++
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return "", err
		}
		if count != probe.Count || hex.EncodeToString(h.Sum(nil)) != probe.Hash {
			return "", errors.New("external source/provider evidence changed")
		}
	}
	return wire.SealPayloadSha256, nil
}
