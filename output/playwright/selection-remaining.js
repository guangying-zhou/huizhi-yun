async (page) => {
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  for (const width of [1440,390]) {
    await page.setViewportSize({width,height:900});
    await page.goto('http://localhost:3187/codocs/s/AbCdEfGhIjKlMn12');
    const editor=page.locator('.crepe-editor.crepe-readonly .ProseMirror');
    await editor.locator('h1').waitFor();
    const paragraph=editor.locator(':scope > p').first();
    await paragraph.scrollIntoViewIfNeeded();
    const box=await paragraph.boundingBox();
    await page.mouse.move(box.x+5,box.y+10);await page.mouse.down();await page.mouse.move(box.x+Math.min(box.width-5,200),box.y+20,{steps:10});await page.mouse.up();
    if(await page.evaluate(()=>window.getSelection()?.toString()))throw new Error(width+' drag selected text');
    for(const node of [paragraph,editor.locator('th').first()]){
      await node.dblclick();
      if(await page.evaluate(()=>window.getSelection()?.toString()))throw new Error(width+' double click selected text');
      await page.evaluate(()=>window.getSelection()?.removeAllRanges());
    }
    if(await page.locator('.readonly-code-copy-btn').count())throw new Error('code copy button visible');
    const css=await editor.locator('.cm-line').first().evaluate(el=>getComputedStyle(el).userSelect);
    if(css!=='none')throw new Error('code still selectable '+css);
    await page.mouse.move(width/2,600);await page.mouse.wheel(0,650);
    await page.waitForFunction(()=>document.querySelector('main').scrollTop>0);
    const table=editor.locator('.tableWrapper');await table.scrollIntoViewIfNeeded();
    if(width===390){await table.hover();await page.mouse.wheel(400,0);await page.waitForFunction(()=>document.querySelector('.tableWrapper').scrollLeft>0);}
    await page.locator('main').evaluate(el=>el.scrollTop=0);
    await page.screenshot({path:'selection-'+width+'.png',animations:'disabled'});
    await page.getByRole('button',{name:'复制链接',exact:true}).click();
    await page.getByText('短链接已复制，可粘贴到通知中',{exact:true}).waitFor();
    if(await page.evaluate(()=>navigator.clipboard.readText())!=='http://localhost:3187/codocs/s/AbCdEfGhIjKlMn12')throw new Error('page short link copy blocked');
    await editor.getByRole('link',{name:'验收链接',exact:true}).click();
    await page.getByText('正文链接成功打开',{exact:true}).waitFor();
  }
  await page.goto('http://localhost:3187/codocs/edit-fixture');
  const editable=page.locator('.crepe-editor .ProseMirror');await editable.locator('h1').waitFor();
  if(await page.locator('.crepe-selection-disabled').count())throw new Error('normal editor selection disabled');
  await editable.locator('p').first().dblclick();
  if(!(await page.evaluate(()=>window.getSelection()?.toString())))throw new Error('normal editor selection empty');
  await editable.click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('正常编辑未受影响');
  await editable.getByText('正常编辑未受影响',{exact:true}).waitFor();
}