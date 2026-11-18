import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preview} from 'vite';
import {chromium,webkit,expect,devices} from '@playwright/test';
const server=await preview({build:{outDir:'dist'},preview:{host:'127.0.0.1',port:0}});
const origin='http://127.0.0.1:'+server.httpServer.address().port;
const photos=[101,102,103,104].map(n=>`https://ap.rdcpix.com/fixture-m${n}s.jpg`);
const large=n=>`https://ap.rdcpix.com/fixture-m${n}od-w1920_h1440.webp`;
const address='24 Fixture Lane, Example City, CA 90210';
const lead={id:'photo-quality-fixture',leadId:'photo-quality-fixture',seller:{name:'Fixture Seller'},property:{address:'24 Fixture Lane',city:'Example City',state:'CA',zip:'90210'},deal:{listingSnapshot:{source:'apify-for-sale',address,retrievedAt:'2026-11-18T08:00:00Z',askingPrice:450000,photoUrls:photos,sourceLinks:[],facts:{}}}};
async function verify(engine,config,label){const browser=await engine.launch();const page=await browser.newPage(config);const imageRequests=[],writes=[],errors=[];
 const fixture=structuredClone(lead);
 try{
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const config={endpoint:location.origin,apiKey:'local-fixture'};window.PBK={openclaw:{getConfig:()=>config}};localStorage.setItem('pbk:local:openclaw-config',JSON.stringify(config));localStorage.setItem('pbk:prefs:v1',JSON.stringify({theme:'dark',tourCompleted:true}));});
  await page.routeWebSocket('**/*',socket=>socket.close());
  await page.route('**/*',route=>{const req=route.request(),u=new URL(req.url());
   if(photos.includes(u.href)||[101,102,103,104].some(n=>large(n)===u.href)){
    imageRequests.push(u.href);
    if(u.href===large(102)||u.href===large(103)||u.href===photos[2]||u.href===photos[3])return route.abort();
    const width=[large(101),large(104)].includes(u.href)?1280:120;
    return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="720"><rect width="100%" height="100%" fill="#253848"/></svg>`});
   }
   if(u.origin!==origin)return route.abort();
   if(req.isNavigationRequest())return route.fulfill({contentType:'text/html',body:readFileSync('dist/index.shell.html','utf8')});
   if(!/^\/(api\/|state$|health$|events$|invoke$|\.netlify\/functions\/)/.test(u.pathname))return route.continue();
   const send=json=>route.fulfill({json});
   if(u.pathname==='/api/state/stream/session')return send({ok:false});
   if(req.method()!=='GET'){writes.push(u.pathname);return route.abort();}
   if(u.pathname==='/api/auth/team/status')return send({ok:true,configured:false,authRequired:false});
   if(u.pathname.startsWith('/api/leads/'+lead.id))return send({ok:true,lead:fixture});
   if(u.pathname==='/api/leads')return send({ok:true,leads:[lead]});
   if(u.pathname==='/state')return send({leadImports:[lead]});
   return send({ok:true,items:[]});
  });
  await page.goto(origin+'/leads/'+lead.id);
  const property=page.getByRole('region',{name:'Property',exact:true});await expect(property).toBeVisible({timeout:20000});
  const image=property.getByRole('img',{name:'Listing photo 1',exact:true});await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveAttribute('src',large(101));await expect.poll(()=>image.evaluate(x=>x.naturalWidth)).toBe(1280);
  await expect(property.getByRole('link',{name:'Open full-size photo',exact:true})).toHaveAttribute('href',large(101));
  if(process.argv.includes('--viewer')){
   const trigger=property.getByRole('button',{name:'Open photo viewer',exact:true});
   await trigger.click();
   const viewer=page.getByRole('dialog',{name:'Property photos',exact:true});
   await expect(viewer).toBeVisible();
   const box=await viewer.boundingBox(),viewport=page.viewportSize();
   assert.ok(Math.abs(box.x)<1&&Math.abs(box.y)<1&&Math.abs(box.width-viewport.width)<2&&Math.abs(box.height-viewport.height)<2,'Viewer must fill the viewport');
   await expect(viewer.getByRole('img',{name:'Property photo 1 of 4',exact:true})).toHaveAttribute('src',large(101));
   const fitArea=viewer.getByRole('region',{name:'Photo zoom area',exact:true});
   await expect.poll(()=>fitArea.evaluate(x=>x.scrollWidth<=x.clientWidth+1&&x.scrollHeight<=x.clientHeight+1)).toBe(true);
   const gesture=async(dx,dy,{cancel=false,multi=false}={})=>{
    await fitArea.evaluate((area,{dx,dy,cancel,multi})=>{
     const b=area.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
     const send=(type,id,px,py,primary=true)=>area.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:id,isPrimary:primary,clientX:px,clientY:py,button:0,buttons:type==='pointerup'?0:1}));
     send('pointerdown',11,x,y);
     if(multi)send('pointerdown',12,x+20,y,false);
     send('pointermove',11,x+dx/2,y+dy/2);send('pointermove',11,x+dx,y+dy);
     send(cancel?'pointercancel':'pointerup',11,x+dx,y+dy);
     if(multi)send('pointerup',12,x+20,y,false);
    },{dx,dy,cancel,multi});
   };
   let nativeSwipe,touchSession;
   if(process.argv.includes('--swipe')){
    // Browser-native touch input proves touch-action routing; synthetic events
    // below cover cancellation/multiple contacts consistently in both engines.
    if(label==='narrow'){
     const cdp=await page.context().newCDPSession(page);
     touchSession=cdp;
     await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
     nativeSwipe=async(dx,dy)=>{
      const b=await fitArea.boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
      for(let step=1;step<=4;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*step/4,y:y+dy*step/4,id:1}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
     };
    }
    const swipe=nativeSwipe??gesture;
    await swipe(-100,0);await expect(viewer.getByRole('img',{name:'Property photo 2 of 4',exact:true})).toBeVisible();
    await swipe(100,0);await expect(viewer.getByRole('img',{name:'Property photo 1 of 4',exact:true})).toBeVisible();
    await swipe(100,0);await expect(viewer.getByRole('img',{name:'Property photo 4 of 4',exact:true})).toBeVisible();
    await swipe(-100,0);await expect(viewer.getByRole('img',{name:'Property photo 1 of 4',exact:true})).toBeVisible();
    for(const [dx,dy,options] of [[-30,0],[-100,95],[5,-100],[-100,0,{cancel:true}],[-100,0,{multi:true}]]){
     await gesture(dx,dy,options);await expect(viewer.getByRole('img',{name:'Property photo 1 of 4',exact:true})).toBeVisible();
    }
    // Two contacts may now pinch, but must never navigate. Restore fit for swipes.
    await viewer.getByRole('button',{name:'Reset zoom',exact:true}).click();
    if(nativeSwipe){await nativeSwipe(0,-100);await expect(viewer.getByRole('img',{name:'Property photo 1 of 4',exact:true})).toBeVisible();}
   }
   if(process.argv.includes('--touch-zoom')){
    const {verifyPhotoTouchZoom}=await import('./photo-touch-zoom-browser-cases.mjs');
    await verifyPhotoTouchZoom({page,area:fitArea,viewer,session:touchSession});
   }
   if(process.argv.includes('--dismiss')){
    const {verifyPhotoDismiss}=await import('./photo-dismiss-browser-cases.mjs');
    await verifyPhotoDismiss({page,area:fitArea,viewer,trigger,gesture,nativeSwipe});
   }
   await viewer.getByRole('button',{name:'Zoom in',exact:true}).click();
   await viewer.getByRole('button',{name:'Zoom in',exact:true}).click();
   await expect(viewer.getByLabel('Zoom level',{exact:true})).toHaveText('150%');
   const pan=viewer.getByRole('region',{name:'Photo zoom area',exact:true});
   await expect.poll(()=>pan.evaluate(x=>x.scrollWidth>x.clientWidth)).toBe(true);
   await pan.evaluate(x=>{x.scrollLeft=30;x.scrollTop=30;});
   assert.ok(await pan.evaluate(x=>x.scrollLeft>0&&x.scrollTop>0));
   if(process.argv.includes('--swipe')){
    const before=await pan.evaluate(x=>x.scrollLeft);
    await (nativeSwipe??gesture)(-100,0);
    await expect(viewer.getByRole('img',{name:'Property photo 1 of 4',exact:true})).toBeVisible();
    if(nativeSwipe)await expect.poll(()=>pan.evaluate(x=>x.scrollLeft)).toBeGreaterThan(before);
   }
   if(label==='desktop'){
    const area=await pan.boundingBox(),before=await pan.evaluate(x=>x.scrollLeft);
    await page.mouse.move(area.x+area.width/2,area.y+area.height/2);await page.mouse.down();
    await page.mouse.move(area.x+area.width/2-60,area.y+area.height/2,{steps:4});await page.mouse.up();
    assert.ok(await pan.evaluate(x=>x.scrollLeft)>before,'Zoomed photo should support mouse drag panning');
   }
   await viewer.getByRole('button',{name:'Next photo',exact:true}).click();
   await expect(viewer.getByRole('img',{name:'Property photo 2 of 4',exact:true})).toHaveAttribute('src',photos[1]);
   await expect(viewer.getByLabel('Zoom level',{exact:true})).toHaveText('100%');
   await viewer.getByRole('button',{name:'Previous photo',exact:true}).click();
   await viewer.getByRole('button',{name:'Previous photo',exact:true}).click();
   await expect(viewer.getByRole('img',{name:'Property photo 4 of 4',exact:true})).toHaveAttribute('src',large(104));
   await viewer.getByRole('button',{name:'Next photo',exact:true}).click();
   await expect(viewer.getByRole('img',{name:'Property photo 1 of 4',exact:true})).toBeVisible();
   await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');
   await expect(viewer.getByRole('img',{name:'Property photo 1 of 4',exact:true})).toBeVisible();
   await viewer.getByRole('button',{name:'Zoom in',exact:true}).focus();
   for(let i=0;i<12;i++)await viewer.getByRole('button',{name:'Zoom in',exact:true}).click();
   await expect(viewer.getByLabel('Zoom level',{exact:true})).toHaveText('400%');
   await expect(viewer.getByRole('button',{name:'Zoom in',exact:true})).toBeDisabled();
   await expect(viewer.getByRole('button',{name:'Zoom in',exact:true})).toBeFocused();
   await page.keyboard.press('0');
   await expect.poll(()=>fitArea.evaluate(x=>({zoom:document.querySelector('[aria-label="Zoom level"]')?.textContent,fit:x.scrollWidth<=x.clientWidth+1&&x.scrollHeight<=x.clientHeight+1,active:document.activeElement?.getAttribute('aria-label')}))).toMatchObject({zoom:'100%',fit:true});
   await page.keyboard.press('+');
   await expect(viewer.getByLabel('Zoom level',{exact:true})).toHaveText('125%');
   await page.keyboard.press('-');
   await expect(viewer.getByRole('button',{name:'Zoom out',exact:true})).toBeDisabled();
   for(let i=0;i<10;i++)await page.keyboard.press('Tab');
   assert.ok(await viewer.evaluate(x=>x.contains(document.activeElement)),'Focus must stay inside the viewer');
   await page.keyboard.press('Escape');await expect(viewer).toHaveCount(0);await expect(trigger).toBeFocused();
   await page.keyboard.press('ArrowRight');await expect(image).toHaveAttribute('src',large(101));
   await trigger.click();await expect(viewer.getByLabel('Zoom level',{exact:true})).toHaveText('100%');
   await viewer.getByRole('button',{name:'Close photo viewer',exact:true}).click();
   fixture.deal.listingSnapshot.photoUrls=[photos[0]];
   await page.getByRole('button',{name:'Refresh',exact:true}).click();await trigger.click();
   await expect(viewer.getByRole('button',{name:'Previous photo',exact:true})).toBeDisabled();
   await expect(viewer.getByRole('button',{name:'Next photo',exact:true})).toBeDisabled();
   if(process.argv.includes('--swipe')){await gesture(-100,0);await expect(viewer.getByRole('img',{name:'Property photo 1 of 1',exact:true})).toBeVisible();}
   if(process.argv.includes('--dismiss')){await (nativeSwipe??gesture)(0,100);await expect(viewer).toHaveCount(0);await expect(trigger).toBeFocused();await trigger.click();}
   await page.keyboard.press('Escape');fixture.deal.listingSnapshot.photoUrls=[];
   await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(trigger).toHaveCount(0);
   fixture.deal.listingSnapshot.photoUrls=[...photos];await page.getByRole('button',{name:'Refresh',exact:true}).click();
  }
  await property.getByRole('button',{name:'View photo 2',exact:true}).click();
  await expect(property.getByRole('img',{name:'Listing photo 2',exact:true})).toHaveAttribute('src',photos[1]);
  await expect(property.getByText('Low-resolution source preview. Open the listing for more detail.',{exact:true})).toBeVisible();
  await expect(property.getByRole('link',{name:'Open source photo',exact:true})).toHaveAttribute('href',photos[1]);
  await property.getByRole('button',{name:'View photo 4',exact:true}).click();
  await expect.poll(()=>imageRequests.includes(photos[3])).toBe(true);
  const fourth=property.getByRole('img',{name:'Listing photo 4',exact:true});
  await expect(fourth).toHaveAttribute('src',large(104));await expect.poll(()=>fourth.evaluate(x=>x.naturalWidth)).toBe(1280);
  await expect(property.getByRole('link',{name:'Open full-size photo',exact:true})).toHaveAttribute('href',large(104));
  if(process.argv.includes('--viewer')){
   await property.getByRole('button',{name:'Open photo viewer',exact:true}).click();
   const viewer=page.getByRole('dialog',{name:'Property photos',exact:true});
   await viewer.getByRole('button',{name:'Previous photo',exact:true}).click();
   await expect(viewer.getByRole('img',{name:'Property photo 1 of 3',exact:true})).toHaveAttribute('src',large(101));
   await viewer.getByRole('button',{name:'Close photo viewer',exact:true}).click();
  }else await property.getByRole('button',{name:'View photo 3',exact:true}).click();
  await expect(property.getByRole('button',{name:'View photo 3',exact:true})).toHaveCount(0);
  await expect(property.getByRole('img',{name:'Listing photo 1',exact:true})).toHaveAttribute('src',large(101));
  await property.getByRole('button',{name:'View photo 2',exact:true}).click();await property.getByRole('button',{name:'View photo 1',exact:true}).click();
  await expect(property.getByRole('link',{name:'Open full-size photo',exact:true})).toHaveAttribute('href',large(101));
  assert.ok(imageRequests.includes(large(102)));assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  console.log(label+': larger source image, full-size link, fallback, broken thumbnail isolation, rapid switching and no writes passed');
 }finally{await browser.close();}}
try{
 const cases=[[chromium,{viewport:{width:1440,height:960}},'desktop'],[webkit,devices['iPhone 13'],'mobile-webkit'],[chromium,{viewport:{width:320,height:800},isMobile:true},'narrow']];
 const selected=process.argv.find(arg=>arg.startsWith('--engine='))?.slice('--engine='.length);
 if(selected&&!cases.some(([, ,label])=>label===selected))throw new Error('Unknown browser engine: '+selected);
 for(const [engine,config,label] of cases)if(!selected||selected===label)await verify(engine,config,label);
}finally{await new Promise(resolve=>server.httpServer.close(resolve));}
