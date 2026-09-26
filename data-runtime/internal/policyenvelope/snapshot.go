package policyenvelope

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"reflect"
)

// Snapshot is an authenticated Runtime read result, NOT a bearer authorization
// proof. It must be persisted transactionally with CAS under a tenant/environment/
// security-domain binding. AcceptedAt is supplied by Runtime, never by the writer.
type Snapshot struct {
	Tenant         string   `json:"tenant"`
	Environment    string   `json:"environment"`
	Deployment     string   `json:"deployment"`
	Envelope       Envelope `json:"envelope"`
	ETag           string   `json:"etag"`
	AcceptedAt     int64    `json:"acceptedAt"`
	PolicyRevision int64    `json:"policyRevision"`
	IssuedAt       int64    `json:"issuedAt"`
	PayloadHash    string   `json:"payloadHash"`
}

// Prepare accepts only fully verified new envelopes. The previous trusted durable
// row is the watermark even after expiry; callers must hold its database CAS/lock.
// This function performs no persistence and is not exposed as an HTTP handler.
func Prepare(envelope Envelope, previous *Snapshot, kid, publicKey string, context Context) (Snapshot, error) {
	context.AllowInactive = true
	raw, err := json.Marshal(envelope)
	if err != nil {
		return Snapshot{}, ErrInvalid
	}
	body, err := Verify(raw, kid, publicKey, context)
	if err != nil {
		return Snapshot{}, err
	}
	// Hash signed content, not incidental outer JSON escaping or field ordering.
	digest := sha256.Sum256([]byte(envelope.KID + "\n" + envelope.Body + "\n" + envelope.Signature))
	etag := hex.EncodeToString(digest[:])
	if previous != nil {
		if previous.Tenant != context.Tenant || previous.Environment != context.Environment || previous.Deployment != context.Deployment || previous.AcceptedAt > context.Now || previous.PolicyRevision < 1 {
			return Snapshot{}, ErrInvalid
		}
		if previous.ETag == etag {
			return *previous, nil
		} // Lost response replay never refreshes freshness.
		if body.PolicyRevision < previous.PolicyRevision || body.IssuedAt <= previous.IssuedAt {
			return Snapshot{}, ErrInvalid
		}
		// Equal revision may be refreshed, but cannot silently replace policy facts.
		// Tenant lifecycle status is not a policy fact: Platform signs a suspension
		// or reactivation of the current revision, ordered by the newer IssuedAt.
		if body.PolicyRevision == previous.PolicyRevision {
			// Previous is trusted durable state, potentially expired. Do not erase
			// its scope watermark just because its validity window ended.
			var prior Body
			if json.Unmarshal([]byte(previous.Envelope.Body), &prior) != nil ||
				body.PayloadHash != previous.PayloadHash || body.BundleVersion != prior.BundleVersion ||
				!reflect.DeepEqual(body.Deployments, prior.Deployments) ||
				!reflect.DeepEqual(body.PolicyExpiresAt, prior.PolicyExpiresAt) {
				return Snapshot{}, ErrInvalid
			}
		}
	}
	return Snapshot{Tenant: context.Tenant, Environment: context.Environment, Deployment: context.Deployment, Envelope: envelope, ETag: etag, AcceptedAt: context.Now, PolicyRevision: body.PolicyRevision, IssuedAt: body.IssuedAt, PayloadHash: body.PayloadHash}, nil
}
