package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"github.com/huizhi-yun/data-runtime/internal/directoryconnector"
)

func runDirectoryConnector() error {
	cfg, err := directoryconnector.LoadConfig()
	if err != nil {
		return err
	}
	agent, err := directoryconnector.New(cfg)
	if err != nil {
		return err
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	return agent.Run(ctx)
}
