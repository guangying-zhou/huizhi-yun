package aims

import (
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func projectInitialLifecycleStatus(category string) string {
	if strings.TrimSpace(category) == "routine" {
		return "active"
	}
	return "draft"
}

func validateProjectInitiationLifecycle(category string, targetStatus string) error {
	if strings.TrimSpace(category) == "routine" && strings.TrimSpace(targetStatus) == "approval_pending" {
		return httperror.New(http.StatusConflict, "routine_initiation_not_applicable", "日常事务容器不经过立项审批，创建后直接启用")
	}
	return nil
}
