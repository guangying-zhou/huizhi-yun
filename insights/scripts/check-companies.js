import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { businesses } from '../server/database/schema.ts';
import { config } from 'dotenv';

// 加载环境变量
config({ path: '.env.dev' });

const client = createClient({
  url: process.env.TURSO_DB_URL,
  authToken: process.env.TURSO_DB_TOKEN,
});

const db = drizzle(client);

async function checkCompanies() {
  try {
    console.log('正在检查数据库中的公司...');
    
    const companiesResult = await db.select().from(businesses);
    
    console.log(`找到 ${companiesResult.length} 家公司:`);
    companiesResult.forEach(business => {
      console.log(`ID: ${business.id}, Name: ${business.name}, Domain: ${business.domain}`);
    });

    // 检查是否有 docs 公司
    const docsBusiness = companiesResult.find(c => c.name === 'docs');
    if (!docsBusiness) {
      console.log('\n未找到名为 "docs" 的公司。');
      console.log('Nuxt Content 正在尝试访问 /api/content/docs/... 路径');
      console.log('这说明系统期望有一个名为 "docs" 的租户。');
    }

  } catch (error) {
    console.error('检查公司时出错:', error);
  } finally {
    client.close();
  }
}

checkCompanies();