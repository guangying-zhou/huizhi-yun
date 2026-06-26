// 检查数据库的简单脚本
import { config } from 'dotenv';

// 加载环境变量
config({ path: '.env.dev' });

console.log('Environment check:');
console.log('TURSO_DB_URL:', process.env.TURSO_DB_URL ? 'Set' : 'Not set');
console.log('TURSO_DB_TOKEN:', process.env.TURSO_DB_TOKEN ? 'Set' : 'Not set');

// 根据错误信息，问题是：
// 1. Nuxt Content正在尝试访问 /api/content/docs/query 
// 2. 但是找不到名为'docs'的租户

console.log('\n问题分析:');
console.log('1. Nuxt Content正在尝试访问文档内容');
console.log('2. 路径是 /api/content/docs/...');
console.log('3. 但是数据库中没有名为"docs"的公司/租户');

console.log('\n可能的解决方案:');
console.log('1. 创建一个名为"docs"的公司/租户');
console.log('2. 或者修改路由配置，让文档不走动态租户路径');
console.log('3. 或者配置默认的文档处理方式');