package main

import (
	"log"
	"os"

	"github.com/huizhi-yun/notification-runtime/internal/enrollment"
	"github.com/huizhi-yun/notification-runtime/internal/runtimeapp"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "enroll" {
		if err := enrollment.Run(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	if err := runtimeapp.Run(os.Args[1:], runtimeapp.ConnectorRuntime); err != nil {
		log.Print(err)
		if runtimeapp.IsConnectorDeviceIdentityRejected(err) {
			os.Exit(78)
		}
		os.Exit(1)
	}
}
