// PM2 alternative to the systemd unit. Keep exactly one instance in fork mode:
// the resident scheduler must not run twice for the same site.
module.exports = {
  apps: [{
    name: 'hzy-tenant-gateway',
    script: 'deploy/self-hosted/gateway/server.mjs',
    args: ['--config', '/etc/hzy-gateway/gateway.json'],
    cwd: '/opt/hzy/current',
    exec_mode: 'fork',
    instances: 1,
    watch: false,
    autorestart: true,
    // Exit code 78 = configuration rejected; restarting will not help.
    stop_exit_codes: [78],
    kill_timeout: 25000,
    env: { NODE_ENV: 'production' }
  }]
}
