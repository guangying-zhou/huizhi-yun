// Actual list component with mocked API responses; not real tenant acceptance.
const { chromium } = require(process.env.HZY_PLAYWRIGHT_MODULE || 'playwright');
const preview = new URL(process.env.HZY_PRODUCT_UI_PREVIEW_URL || 'http://127.0.0.1:3317');
if (!['127.0.0.1','localhost','[::1]'].includes(preview.hostname)) throw Error('Use an isolated local preview');
(async()=>{
const browser = await chromium.launch({channel:'chrome',headless:true});
try {
for(const width of [1440,390]){
const page = await browser.newPage({viewport:{width,height:1000}});const errors=[],calls=[];let fail=false;
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',async route=>{
const url=new URL(route.request().url());
if(url.pathname==='/api/v1/products'){
 calls.push(Object.fromEntries(url.searchParams));
 if(fail)return route.fulfill({status:503,json:{message:'Unavailable'}});
 const n=Number(url.searchParams.get('page')||1), search=url.searchParams.get('search');
 const total=search?1:43;
 const items=Array.from({length:search?1:Math.max(0,Math.min(20,total-(n-1)*20))},(_,i)=>({id:(n-1)*20+i+1,product_code:'P'+String((n-1)*20+i+1).padStart(3,'0'),product_name:'产品 '+((n-1)*20+i+1),product_line:'FC',customer_domain:'G',status:'mvp',asset_level:'core',product_level:'growth'}));
 return route.fulfill({json:{code:0,data:{items,total}}});
}
if(url.pathname==='/api/v1/technology-bases')return route.fulfill({json:{code:0,data:{items:[],total:0}}});
return route.abort();
});
await page.goto(new URL('/asset-list',preview).href);
await page.getByText('P001',{exact:true}).waitFor();

await page.locator('button').filter({hasText:/^2$/}).click();
await page.getByText('P021',{exact:true}).waitFor();
await page.locator('#product-asset-search').fill('Product');await page.locator('#product-asset-search').press('Enter');
await page.getByText('P001',{exact:true}).waitFor();
if(!calls.some(c=>c.page==='2')||calls.at(-1).page!=='1'||calls.at(-1).search!=='Product')throw Error(JSON.stringify(calls));
fail=true;
await page.locator('#product-asset-search').fill('Retry search');await page.locator('#product-asset-search').press('Enter');
await page.getByText('列表加载失败',{exact:true}).waitFor();
if(await page.getByText('暂无匹配记录',{exact:true}).count())throw Error('Failure displayed as empty list');
fail=false;await page.getByRole('button',{name:'重试',exact:true}).click();
await page.getByText('P001',{exact:true}).waitFor();
if(calls.at(-1).search!=='Retry search')throw Error('Retry lost search');

if(errors.length)throw Error(errors.join('\n'));
console.log('PASS',width);await page.close();
}
} finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
