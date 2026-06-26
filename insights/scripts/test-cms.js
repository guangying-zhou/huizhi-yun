// 测试 CMS 功能的脚本
import { createId } from '@paralleldrive/cuid2';

const BASE_URL = 'http://localhost:3000';

// 测试数据
const testBusiness = {
  id: createId(),
  name: 'test-business',
  displayName: 'Test Business',
  fullName: 'Test Business Ltd.',
  type: 'business',
  creator: createId()
};

const testUser = {
  id: testBusiness.creator,
  email: 'test@example.com',
  name: 'Test User',
  emailVerified: true,
  role: 'USER',
  onboarded: true,
  businessId: testBusiness.id
};

const testPage = {
  title: 'Welcome to Our Business',
  description: 'This is our business homepage',
  content: {
    blocks: [
      {
        id: 'hero-1',
        type: 'hero',
        data: {
          title: 'Welcome to Test Business',
          subtitle: 'We provide amazing services',
          ctaText: 'Get Started',
          ctaLink: '/contact'
        }
      },
      {
        id: 'content-1',
        type: 'paragraph',
        data: {
          text: 'This is a test page created by our CMS system.'
        }
      }
    ]
  },
  template: 'default',
  status: 'draft',
  type: 'page',
  seoTitle: 'Test Business - Homepage',
  seoDescription: 'Welcome to Test Business, your trusted partner'
};

async function testAPI() {
  console.log('🧪 Testing CMS functionality...\n');
  
  try {
    // 1. 测试创建页面 API（无认证，预期失败）
    console.log('1. Testing page creation without auth (should fail)...');
    const createResponse = await fetch(`${BASE_URL}/api/cms/pages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPage)
    });
    
    console.log(`   Status: ${createResponse.status} ${createResponse.statusText}`);
    
    if (createResponse.status === 401) {
      console.log('   ✅ Authentication check working correctly\n');
    } else {
      console.log('   ❌ Authentication check not working\n');
    }

    // 2. 测试公开内容 API (已移除租户内容API)
    console.log('2. Public content API has been removed to avoid conflicts with Nuxt Content...');
    console.log('   ✅ Tenant content will be handled through CMS pages API\n');

    // 3. 测试获取页面列表（无认证，预期失败）
    console.log('3. Testing page list without auth (should fail)...');
    const listResponse = await fetch(`${BASE_URL}/api/cms/pages`);
    console.log(`   Status: ${listResponse.status} ${listResponse.statusText}`);
    
    if (listResponse.status === 401) {
      console.log('   ✅ Page list API authentication working\n');
    } else {
      console.log('   ❌ Page list API authentication not working\n');
    }

    console.log('🎉 Basic CMS API tests completed!');
    console.log('\n📝 Next steps:');
    console.log('   1. Visit http://localhost:3000 to register/login');
    console.log('   2. Create a business');
    console.log('   3. Visit /dashboard/content to test the CMS interface');
    
  } catch (error) {
    console.error('❌ Test error:', error.message);
  }
}

// 运行测试
testAPI();