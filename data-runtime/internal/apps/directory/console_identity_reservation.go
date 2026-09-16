package directory

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// 目录身份预留。
//
// LDAP 账号在 Connector 回执成功之前不会写入 directory_users，因此并发的建号
// 请求之间只有同一个 uid 的 pending operation 能互相排斥，username 与邮箱没有
// 任何跨请求保护。受控入职在真正开户之前先原子预留 UID/登录名/邮箱：预留只
// 阻止冲突，不创建 active Directory 用户，也不投影 Platform。
const consoleReservationTTL = 24 * time.Hour

var consoleReservationUIDPattern = consoleLDAPUIDPattern

type ConsoleIdentityReservationInput struct {
	UID             string
	Username        string
	Email           string
	ProviderCode    string
	ProviderSubject string
	SourceApp       string
	SourceBizCode   string
	ActorUID        string
}

// ConsoleReserveDirectoryIdentity 在单事务内完成全部冲突检查并写入预留。
// 任何一项冲突都必须在开户之前暴露，而不是等 Connector 失败后再回溯。
func (a *Adapter) ConsoleReserveDirectoryIdentity(
	ctx context.Context,
	input ConsoleIdentityReservationInput,
	deployment string,
) (map[string]any, error) {
	uid := strings.TrimSpace(input.UID)
	if !consoleReservationUIDPattern.MatchString(uid) {
		return nil, httperror.New(http.StatusBadRequest, "directory_ldap_uid_invalid", "LDAP UID is invalid")
	}
	// dt-* 是本设计要消除的合成主体，预留阶段就必须拒绝。
	if strings.HasPrefix(strings.ToLower(uid), "dt-") {
		return nil, httperror.New(http.StatusBadRequest, "directory_reservation_uid_synthetic",
			"A synthetic dt-* identifier cannot be reserved as a canonical UID")
	}
	username := strings.TrimSpace(input.Username)
	if username == "" {
		username = uid
	}
	email := strings.ToLower(strings.TrimSpace(input.Email))
	if email != "" && (len(email) > 255 || !strings.Contains(email, "@")) {
		return nil, httperror.New(http.StatusBadRequest, "directory_reservation_email_invalid", "Corporate email is invalid")
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// 过期预留先回收，否则一次未完成的入职会永久占用 UID 和邮箱。
	if _, err = tx.ExecContext(ctx, `UPDATE directory_identity_reservations
		SET status='expired',released_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
		WHERE status='active' AND expires_at<=UTC_TIMESTAMP(3)`); err != nil {
		return nil, err
	}

	state, err := a.consoleLDAPState(ctx, tx, deployment, true)
	if err != nil {
		return nil, err
	}
	if err = requireManagedConsoleLDAP(state); err != nil {
		return nil, err
	}

	// 同一发起方业务键重复请求返回既有预留，网络重试不会产生第二条。
	if strings.TrimSpace(input.SourceBizCode) != "" {
		var existingID, existingUID string
		var existingExpires time.Time
		err = tx.QueryRowContext(ctx, `SELECT reservation_id,uid,expires_at
			FROM directory_identity_reservations
			WHERE source_app=? AND source_biz_code=? AND status='active' LIMIT 1 FOR UPDATE`,
			nullableConsoleText(input.SourceApp), input.SourceBizCode).
			Scan(&existingID, &existingUID, &existingExpires)
		if err == nil {
			if existingUID != uid {
				return nil, httperror.New(http.StatusConflict, "directory_reservation_source_conflict",
					"This onboarding case already reserved a different UID")
			}
			if err = tx.Commit(); err != nil {
				return nil, err
			}
			return map[string]any{
				"reservationId": existingID, "uid": existingUID,
				"expiresAt": existingExpires.UTC().Format(time.RFC3339), "idempotent": true,
			}, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}

	var conflicts int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_users
		WHERE uid=? AND status<>'deleted'`, uid).Scan(&conflicts); err != nil {
		return nil, err
	}
	if conflicts > 0 {
		return nil, httperror.New(http.StatusConflict, "directory_reservation_uid_taken", "UID already exists in Directory")
	}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_users
		WHERE LOWER(TRIM(username))=? AND status<>'deleted'`, strings.ToLower(username)).Scan(&conflicts); err != nil {
		return nil, err
	}
	if conflicts > 0 {
		return nil, httperror.New(http.StatusConflict, "directory_reservation_username_taken", "Login name already exists in Directory")
	}
	if email != "" {
		if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_users
			WHERE LOWER(TRIM(email))=? AND status<>'deleted'`, email).Scan(&conflicts); err != nil {
			return nil, err
		}
		if conflicts > 0 {
			return nil, httperror.New(http.StatusConflict, "directory_reservation_email_taken", "Corporate email already exists in Directory")
		}
	}
	// 同一外部主体不得指向另一个 UID：那正是 dt-* 分叉的形态。
	if strings.TrimSpace(input.ProviderSubject) != "" {
		var mappedUID string
		err = tx.QueryRowContext(ctx, `SELECT uid FROM directory_identities
			WHERE provider_code=? AND provider_subject=? AND status<>'deleted' LIMIT 1`,
			strings.ToLower(strings.TrimSpace(input.ProviderCode)), strings.TrimSpace(input.ProviderSubject)).Scan(&mappedUID)
		if err == nil && mappedUID != uid {
			return nil, httperror.New(http.StatusConflict, "directory_reservation_identity_mapped",
				"This external identity is already mapped to another Directory user")
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
	}

	reservationID, err := randomConsoleMutationUUID()
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().UTC().Add(consoleReservationTTL)
	// 与其他 active 预留的冲突由四个唯一索引兜底：并发请求里只有一个能落库。
	if _, err = tx.ExecContext(ctx, `INSERT INTO directory_identity_reservations
		(reservation_id,uid,username,email,provider_code,provider_subject,
		 source_app,source_biz_code,status,expires_at,created_by_uid,created_at,updated_at)
		VALUES (?,?,?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),
			'active',?,NULLIF(?,''),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
		reservationID, uid, username, email,
		strings.ToLower(strings.TrimSpace(input.ProviderCode)), strings.TrimSpace(input.ProviderSubject),
		strings.TrimSpace(input.SourceApp), strings.TrimSpace(input.SourceBizCode),
		expiresAt, strings.TrimSpace(input.ActorUID)); err != nil {
		if isConsoleDuplicateKeyError(err) {
			return nil, httperror.New(http.StatusConflict, "directory_reservation_conflict",
				"UID, login name, corporate email or external identity is already reserved")
		}
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"reservationId": reservationID, "uid": uid, "username": username,
		"email": email, "expiresAt": expiresAt.UTC().Format(time.RFC3339), "idempotent": false,
	}, nil
}

// ConsoleSuggestDirectoryIdentity 在给定基名上找出第一个可用的 UID 与邮箱。
//
// 唯一性事实归 Console，所以候选变体必须在这里判定：让发起方自己猜、失败再重试
// 会把冲突暴露成一连串 409，也无法保证 HR 看到的建议在提交时仍然可用。
// 这里只做只读探测，真正的排他仍由预留的唯一索引保证。
func (a *Adapter) ConsoleSuggestDirectoryIdentity(
	ctx context.Context,
	base string,
	emailDomain string,
) (map[string]any, error) {
	normalized := strings.ToLower(strings.TrimSpace(base))
	normalized = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			return r
		}
		return -1
	}, normalized)
	if normalized == "" {
		return nil, httperror.New(http.StatusBadRequest, "directory_suggestion_base_invalid",
			"A login name base is required to suggest a UID")
	}
	if len(normalized) > 48 {
		normalized = normalized[:48]
	}
	domain := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(emailDomain, "@")))

	for attempt := 1; attempt <= 50; attempt++ {
		candidate := normalized
		if attempt > 1 {
			candidate = normalized + strconv.Itoa(attempt)
		}
		if !consoleReservationUIDPattern.MatchString(candidate) {
			continue
		}
		email := ""
		if domain != "" {
			email = candidate + "@" + domain
		}
		available, err := a.consoleIdentityAvailable(ctx, candidate, email)
		if err != nil {
			return nil, err
		}
		if available {
			return map[string]any{"uid": candidate, "email": email, "attempts": attempt}, nil
		}
	}
	return nil, httperror.New(http.StatusConflict, "directory_suggestion_exhausted",
		"No available UID was found for this name; enter one manually")
}

// consoleIdentityAvailable 同时检查既有目录用户与仍然有效的预留。只看
// directory_users 会漏掉正在开户中的账号——它们要到 Connector 回执成功才落库。
func (a *Adapter) consoleIdentityAvailable(ctx context.Context, uid string, email string) (bool, error) {
	var taken int
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_users
		WHERE (uid=? OR LOWER(TRIM(username))=? OR (?<>'' AND LOWER(TRIM(email))=?))
		  AND status<>'deleted'`,
		uid, uid, email, email).Scan(&taken); err != nil {
		return false, err
	}
	if taken > 0 {
		return false, nil
	}
	if err := a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_identity_reservations
		WHERE status='active' AND expires_at>UTC_TIMESTAMP(3)
		  AND (uid=? OR LOWER(username)=? OR (?<>'' AND LOWER(email)=?))`,
		uid, uid, email, email).Scan(&taken); err != nil {
		return false, err
	}
	return taken == 0, nil
}

// ConsoleReleaseDirectoryIdentityReservation 主动释放预留。入职单取消或 HR 改用
// 另一个 UID 时必须调用，否则该 UID 与邮箱会被占用到过期为止。
func (a *Adapter) ConsoleReleaseDirectoryIdentityReservation(
	ctx context.Context,
	reservationID string,
) (map[string]any, error) {
	result, err := a.db.ExecContext(ctx, `UPDATE directory_identity_reservations
		SET status='released',released_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
		WHERE reservation_id=? AND status='active'`, strings.TrimSpace(reservationID))
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	// 重复释放不报错：调用方重试不应因为上一次已经成功而失败。
	return map[string]any{"reservationId": reservationID, "released": affected == 1}, nil
}

// ConsoleReleaseOnboardingIdentityReservation binds a service-command release
// to the exact People onboarding business key. Possessing another reservation
// UUID is not sufficient to release it.
func (a *Adapter) ConsoleReleaseOnboardingIdentityReservation(
	ctx context.Context,
	reservationID string,
	uid string,
	onboardingCode string,
) (map[string]any, error) {
	reservationID = strings.TrimSpace(reservationID)
	uid = strings.TrimSpace(uid)
	onboardingCode = strings.TrimSpace(onboardingCode)
	result, err := a.db.ExecContext(ctx, `UPDATE directory_identity_reservations
		SET status='released',released_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
		WHERE reservation_id=? AND uid=? AND source_app='people' AND source_biz_code=? AND status='active'`,
		reservationID, uid, onboardingCode)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		var matching int
		if err = a.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM directory_identity_reservations
			WHERE reservation_id=? AND uid=? AND source_app='people' AND source_biz_code=?`,
			reservationID, uid, onboardingCode).Scan(&matching); err != nil {
			return nil, err
		}
		if matching != 1 {
			return nil, httperror.New(http.StatusNotFound, "directory_reservation_not_found", "The onboarding reservation was not found")
		}
	}
	return map[string]any{"reservationId": reservationID, "released": affected == 1}, nil
}

// consumeConsoleReservationTx 在账号创建排队成功后消费预留。消费后该 UID 由
// directory_users 与 pending operation 接管，不再需要预留占位。
func requireActiveConsoleReservationTx(ctx context.Context, tx *sql.Tx, body map[string]any) (string, error) {
	if strings.ToLower(strings.TrimSpace(text(body["sourceApp"]))) != "people" {
		return "", nil
	}
	reservationID := strings.TrimSpace(text(body["reservationId"]))
	if reservationID == "" {
		return "", httperror.New(http.StatusConflict, "directory_reservation_required", "People onboarding must provide an active identity reservation")
	}
	var uid, username, email, providerCode, providerSubject, sourceApp, sourceBizCode, status string
	var expiresAt time.Time
	err := tx.QueryRowContext(ctx, `SELECT uid,username,COALESCE(email,''),COALESCE(provider_code,''),
		COALESCE(provider_subject,''),COALESCE(source_app,''),COALESCE(source_biz_code,''),status,expires_at
		FROM directory_identity_reservations WHERE reservation_id=? FOR UPDATE`, reservationID).
		Scan(&uid, &username, &email, &providerCode, &providerSubject, &sourceApp, &sourceBizCode, &status, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return "", httperror.New(http.StatusConflict, "directory_reservation_missing", "Identity reservation was not found")
	}
	if err != nil {
		return "", err
	}
	if status != "active" || !expiresAt.After(time.Now().UTC()) {
		return "", httperror.New(http.StatusConflict, "directory_reservation_expired", "Identity reservation is no longer active")
	}
	expectedUsername := strings.TrimSpace(text(body["username"]))
	if expectedUsername == "" {
		expectedUsername = strings.TrimSpace(text(body["uid"]))
	}
	if uid != strings.TrimSpace(text(body["uid"])) || !strings.EqualFold(username, expectedUsername) ||
		!strings.EqualFold(email, strings.TrimSpace(text(body["email"]))) || sourceApp != "people" ||
		sourceBizCode != strings.TrimSpace(text(body["sourceBizCode"])) ||
		providerCode != strings.ToLower(strings.TrimSpace(text(body["providerCode"]))) ||
		providerSubject != strings.TrimSpace(text(body["providerSubject"])) {
		return "", httperror.New(http.StatusConflict, "directory_reservation_payload_mismatch", "Provisioning command does not match the reserved identity")
	}
	return reservationID, nil
}

func consumeConsoleReservationTx(ctx context.Context, tx *sql.Tx, reservationID string, uid string) error {
	if strings.TrimSpace(reservationID) == "" {
		return nil
	}
	result, err := tx.ExecContext(ctx, `UPDATE directory_identity_reservations
		SET status='consumed',consumed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3)
		WHERE reservation_id=? AND uid=? AND status='active' AND expires_at>UTC_TIMESTAMP(3)`, reservationID, uid)
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return httperror.New(http.StatusConflict, "directory_reservation_expired", "Identity reservation is no longer active")
	}
	return nil
}

func isConsoleDuplicateKeyError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "duplicate entry") || strings.Contains(message, "error 1062")
}
