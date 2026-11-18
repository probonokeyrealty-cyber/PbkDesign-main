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
   if(u.pathname.startsWith('/api/leads/'+lead.id))return send({ok:true,lead});
   if(u.pathname==='/api/leads')return send({ok:true,leads:[lead]});
   if(u.pathname==='/state')return send({leadImports:[lead]});
   return send({ok:true,items:[]});
  });
  await page.goto(origin+'/leads/'+lead.id);
  const property=page.getByRole('region',{name:'Property',exact:true});await expect(property).toBeVisible({timeout:20000});
  const image=property.getByRole('img',{name:'Listing photo 1',exact:true});await image.scrollIntoViewIfNeeded();
  await expect(image).toHaveAttribute('src',large(101));await expect.poll(()=>image.evaluate(x=>x.naturalWidth)).toBe(1280);
  await expect(property.getByRole('link',{name:'Open full-size photo',exact:true})).toHaveAttribute('href',large(101));
  await property.getByRole('button',{name:'View photo 2',exact:true}).click();
  await expect(property.getByRole('img',{name:'Listing photo 2',exact:true})).toHaveAttribute('src',photos[1]);
  await expect(property.getByText('Low-resolution source preview. Open the listing for more detail.',{exact:true})).toBeVisible();
  await expect(property.getByRole('link',{name:'Open source photo',exact:true})).toHaveAttribute('href',photos[1]);
  await property.getByRole('button',{name:'View photo 4',exact:true}).click();
  await expect.poll(()=>imageRequests.includes(photos[3])).toBe(true);
  const fourth=property.getByRole('img',{name:'Listing photo 4',exact:true});
  await expect(fourth).toHaveAttribute('src',large(104));await expect.poll(()=>fourth.evaluate(x=>x.naturalWidth)).toBe(1280);
  await expect(property.getByRole('link',{name:'Open full-size photo',exact:true})).toHaveAttribute('href',large(104));
  await property.getByRole('button',{name:'View photo 3',exact:true}).click();
  await expect(property.getByRole('button',{name:'View photo 3',exact:true})).toHaveCount(0);
  await expect(property.getByRole('img',{name:'Listing photo 1',exact:true})).toHaveAttribute('src',large(101));
  await property.getByRole('button',{name:'View photo 2',exact:true}).click();await property.getByRole('button',{name:'View photo 1',exact:true}).click();
  await expect(property.getByRole('link',{name:'Open full-size photo',exact:true})).toHaveAttribute('href',large(101));
  assert.ok(imageRequests.includes(large(102)));assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  console.log(label+': larger source image, full-size link, fallback, broken thumbnail isolation, rapid switching and no writes passed');
 }finally{await browser.close();}}
try{await verify(chromium,{viewport:{width:1440,height:960}},'desktop');await verify(webkit,devices['iPhone 13'],'mobile-webkit');await verify(chromium,{viewport:{width:320,height:800},isMobile:true},'narrow');}finally{await new Promise(resolve=>server.httpServer.close(resolve));}
