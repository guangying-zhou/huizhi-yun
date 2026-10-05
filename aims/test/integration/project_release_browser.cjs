// Actual project releases page with mocked API and project store.
const {chromium}=require(process.env.HZY_PLAYWRIGHT_MODULE || 'playwright');
const baseURL = new URL(process.env.HZY_PRODUCT_UI_PREVIEW_URL || 'http://127.0.0.1:3317');
if (!['127.0.0.1','localhost','[::1]'].includes(baseURL.hostname)) throw Error('Use an isolated preview');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{for(const width of [1440,390]){
const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];let fail=true,writes=0;
page.on('pageerror',e=>errors.push(e.message));
const release=(id)=>({id,version_code:id===7?'v1.0':'v2.0',product_code:'P1',product_name:'试点产品',name:'测试版本',status:id===7?'released':'developing',features:[],items:[]});
await page.route('**/api/**',r=>r.abort());
await page.route('**/api/v1/projects/42/**',async r=>{let path=new URL(r.request().url()).pathname,data;
if(path.endsWith('/products'))data={items:[{id:1,product_code:'P1',product_name:'试点产品',is_primary:1}]};
else if(path.endsWith('/releases'))data={items:[release(7),release(8)]};
else if(path.endsWith('/work-items'))data={items:[{id:9,item_key:'PRJ-9',title:'登录功能'}]};
else if(path.endsWith('/items')){writes++;if(fail)return r.fulfill({status:503,json:{message:'服务暂不可用'}});data={attached:1,version_id:8};}
else data=release(Number(path.split('/').at(-1)));
await r.fulfill({json:{code:0,data}});
});
await page.goto(new URL('/projects/42/releases',baseURL).href);
await page.getByRole('button').filter({hasText:'v1.0'}).click();await page.getByRole('heading',{name:'v1.0'}).waitFor();
if(await page.getByRole('button',{name:'挂接目标',exact:true}).count())throw Error('Published attachment shown');
await page.getByRole('button').filter({hasText:'v2.0'}).click();await page.getByRole('button',{name:'挂接目标',exact:true}).click();
const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.locator('button[aria-haspopup="listbox"]').first().click();await page.getByRole('option').filter({hasText:'PRJ-9'}).click();await page.keyboard.press('Escape');await dialog.getByRole('button',{name:'挂接',exact:true}).click();await dialog.getByText('服务暂不可用',{exact:true}).waitFor();

fail=false;await dialog.getByRole('button',{name:'挂接',exact:true}).click();await dialog.waitFor({state:'hidden'});if(writes<2||errors.length)throw Error(JSON.stringify({writes,errors}));console.log('PASS',width);await page.close();
}}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
