package server

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// integration operation 的乐观并发/租约哨兵必须映射成 409，绝不能漏成 500。
//
// 2026-08-23 生产事故：`ErrStaleFencing`（租约过期）没有被任何应用映射，
// 漏成 500；而 retryableHTTPStatus 把 >=500 判为可重试，调用方于是永不 checkpoint，
// 无限重领重试——单条 operation attempt_count 冲到 5261，而 max_attempts 只有 8。
func TestIntegrationOperationSentinelsMapToConflict(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
	}{
		{"stale fencing", integrationoperation.ErrStaleFencing},
		{"persistence race", integrationoperation.ErrPersistenceRace},
		{"operation not found", integrationoperation.ErrOperationNotFound},
		{"idempotency payload mismatch", integrationoperation.ErrIdempotencyPayloadMismatch},
		{"receipt in progress", integrationoperation.ErrReceiptInProgress},
		{"receipt rejected", integrationoperation.ErrReceiptRejected},
		{"replay rejected", integrationoperation.ErrReplayRejected},
		{"immutable identity", integrationoperation.ErrImmutableIdentity},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// 直接返回与被包装两种情形都必须命中。
			for _, err := range []error{tc.err, fmt.Errorf("wrapped: %w", tc.err)} {
				status, code, _, ok := integrationOperationSentinelStatus(err)
				if !ok {
					t.Fatalf("sentinel not mapped: %v", err)
				}
				if status != http.StatusConflict {
					t.Fatalf("expected 409, got %d", status)
				}
				if code == "" {
					t.Fatal("mapped code must not be empty")
				}
				if retryableHTTPStatus(status) {
					t.Fatal("409 必须是不可重试的，否则调用方会无限重试")
				}
			}
		})
	}
}

// 损坏数据仍应保持 500 暴露出来，不被误映射成 409。
func TestCorruptOperationIsNotMappedToConflict(t *testing.T) {
	if _, _, _, ok := integrationOperationSentinelStatus(integrationoperation.ErrCorruptOperation); ok {
		t.Fatal("ErrCorruptOperation 不应被映射为 409")
	}
}

// 普通错误不受影响。
func TestUnrelatedErrorIsNotMapped(t *testing.T) {
	if _, _, _, ok := integrationOperationSentinelStatus(errors.New("boom")); ok {
		t.Fatal("无关错误不应被映射")
	}
}

// 入参校验类哨兵必须是 400：调用方提交的内容非法，重试同样失败。
func TestValidationSentinelsMapToBadRequest(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
	}{
		{"invalid identity", integrationoperation.ErrInvalidIdentity},
		{"invalid operation id", integrationoperation.ErrInvalidOperationID},
		{"unsafe content", integrationoperation.ErrUnsafePersistenceContent},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, _, _, ok := integrationOperationSentinelStatus(fmt.Errorf("wrapped: %w", tc.err))
			if !ok {
				t.Fatalf("sentinel not mapped: %v", tc.err)
			}
			if status != http.StatusBadRequest {
				t.Fatalf("expected 400, got %d", status)
			}
			if retryableHTTPStatus(status) {
				t.Fatal("400 必须不可重试")
			}
		})
	}
}

// 未映射错误仍会落到可重试的 500——正因如此 writeError 必须留痕，否则无法发现。
func TestUnmappedErrorStillDefaultsToRetryableServerError(t *testing.T) {
	if _, _, _, ok := integrationOperationSentinelStatus(errors.New("unknown")); ok {
		t.Fatal("未知错误不应被映射")
	}
	if !retryableHTTPStatus(http.StatusInternalServerError) {
		t.Fatal("500 仍应是可重试的")
	}
}
