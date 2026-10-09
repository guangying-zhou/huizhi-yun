// Run only after approval, immediately before fencing hzy-platform-dev.
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
try{
 if(process.env.APF_RELEASE_APPROVAL!=='platform-930c5ede-C000001-test'||execFileSync('hostname',{encoding:'utf8'}).trim()!=='iZcqwiqyhp9u8rZ')throw Error('guard')
 const dir=process.env.ATTEMPT
 if(!dir||(fs.statSync(dir).mode&0o777)!==0o700)throw Error('guard')
 const all=JSON.parse(execFileSync('pm2',['jlist'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}))
 const live=all.find(p=>p.name==='hzy-platform-dev')
 if(!live?.pid||live.pm2_env.exec_mode!=='fork_mode'||live.pm2_env.watch!==false)throw Error('guard')
 const env=Object.fromEntries(fs.readFileSync(`/proc/${live.pid}/environ`,'utf8').split('\0').filter(Boolean).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]).filter(([k])=>/^[A-Z][A-Z0-9_]*$/.test(k)&&!/^(PM2_|PM_ID$|NODE_APP_INSTANCE$|NODE_UNIQUE_ID$|NODE_CHANNEL_FD$)/.test(k)))
 if(env.DB_NAME!=='hzy_platform_dev'||String(env.PORT)!=='3011')throw Error('guard')
 const settings=Object.fromEntries(['kill_timeout','listen_timeout','min_uptime','max_restarts','restart_delay','exp_backoff_restart_delay','max_memory_restart','cron_restart','merge_logs','time','log_date_format','node_args','args','shutdown_with_message','treekill','autorestart'].filter(k=>live.pm2_env[k]!==undefined).map(k=>[k,live.pm2_env[k]]))
 const app={...settings,name:live.name,cwd:live.pm2_env.pm_cwd,script:live.pm2_env.pm_exec_path,interpreter:live.pm2_env.exec_interpreter,out_file:live.pm2_env.pm_out_log_path,error_file:live.pm2_env.pm_err_log_path,exec_mode:'fork',instances:1,watch:false,env}
 for(const [name,data] of [['pm2-before.json',all],['rollback.config.json',{apps:[app]}]])fs.writeFileSync(path.join(dir,name),JSON.stringify(data),{mode:0o600,flag:'wx'})
 console.log('snapshot: PASS (contains secrets; private files only)')
}catch{console.error('snapshot stopped; no credentials logged');process.exitCode=1}
