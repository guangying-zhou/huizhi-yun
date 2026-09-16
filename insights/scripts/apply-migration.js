import { spawn } from 'child_process';

// 启动 drizzle-kit push 并自动选择 "create table"
const child = spawn('pnpm', ['drizzle-kit', 'push'], {
  stdio: ['pipe', 'inherit', 'inherit']
});

// 发送 "1" 来选择 "create table" 选项
setTimeout(() => {
  child.stdin.write('1\n');
  setTimeout(() => {
    child.stdin.end();
  }, 1000);
}, 2000);

child.on('close', (code) => {
  console.log(`Migration process exited with code ${code}`);
  process.exit(code);
});