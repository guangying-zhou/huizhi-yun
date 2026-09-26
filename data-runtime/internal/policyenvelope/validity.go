package policyenvelope

// Outage renewal policy (docs/Policy-Sync-Cadence-Assessment-20260922.md),
// mirrored from authz-core evaluatePolicyEnvelopeValidity and pinned by
// testdata/validity-vectors.json.
const LongMaxAgeMS int64 = 3600000
const OutageGraceMS int64 = 86400000
const RenewalLivenessMS int64 = 1800000

const (
	RenewalOK                  = "ok"
	RenewalPlatformUnavailable = "platform_unavailable"
	RenewalRefused             = "refused"
	// RenewalInvalid: Platform answered with a malformed or unverifiable
	// response. Like refused it grants no grace and is sticky.
	RenewalInvalid = "invalid"
)

// StickyRenewal reports states that only a newer signed envelope may clear:
// a later outage or ok probe must never restore grace eligibility.
func StickyRenewal(state string) bool {
	return state == RenewalRefused || state == RenewalInvalid
}

type Renewal struct {
	State       string `json:"state"`
	AttemptedAt int64  `json:"attemptedAt"`
}

type Validity struct {
	Verdict    string `json:"verdict"`
	ValidUntil *int64 `json:"validUntil"`
}

// EvaluateValidity is the timing verdict for an envelope whose signature and
// binding were already verified. After ExpiresAt the last authentic envelope
// stays usable only while the syncer keeps recording that Platform is
// unreachable: at most IssuedAt+OutageGraceMS, never past PolicyExpiresAt, and
// never once renewal was refused or the syncer stopped trying.
func EvaluateValidity(body Body, renewal *Renewal, now int64) Validity {
	expired := Validity{Verdict: "expired"}
	if now < 0 || now > maxSafeInteger || body.IssuedAt < 0 || body.ExpiresAt > maxSafeInteger ||
		(body.PolicyExpiresAt != nil && (*body.PolicyExpiresAt < 0 || *body.PolicyExpiresAt > maxSafeInteger)) ||
		body.IssuedAt > now || body.ExpiresAt <= body.IssuedAt {
		return expired
	}
	if body.Status != "active" {
		return Validity{Verdict: "inactive"}
	}
	hardLimit := maxSafeInteger
	if body.PolicyExpiresAt != nil {
		hardLimit = *body.PolicyExpiresAt
	}
	if now < body.ExpiresAt && now < hardLimit {
		until := min(body.ExpiresAt, hardLimit)
		return Validity{Verdict: "valid", ValidUntil: &until}
	}
	graceUntil := min(body.IssuedAt+OutageGraceMS, hardLimit)
	if renewal == nil || renewal.State != RenewalPlatformUnavailable || renewal.AttemptedAt < body.IssuedAt || renewal.AttemptedAt > now {
		return expired
	}
	liveUntil := renewal.AttemptedAt + RenewalLivenessMS
	if now >= graceUntil || now >= liveUntil {
		return expired
	}
	until := min(graceUntil, liveUntil)
	return Validity{Verdict: "grace", ValidUntil: &until}
}

// VerifyAuthenticity checks signature, binding and payload as of the envelope's
// own issuance, accepting any signed status. It is NOT a lifecycle verdict:
// callers must apply EvaluateValidity with the current time and renewal state.
func VerifyAuthenticity(raw []byte, kid, publicKeyPEM string, context Context) (Body, error) {
	var envelope Envelope
	var body Body
	if strict(raw, &envelope) != nil || strict([]byte(envelope.Body), &body) != nil {
		return Body{}, ErrInvalid
	}
	context.Now = body.IssuedAt
	context.AllowInactive = true
	return Verify(raw, kid, publicKeyPEM, context)
}
