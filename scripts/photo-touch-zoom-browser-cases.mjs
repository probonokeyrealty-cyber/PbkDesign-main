import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function verifyPhotoTouchZoom({page,area,viewer,session}){
 const b=await area.boundingBox(),x=b.x+b.width*.6,y=b.y+b.height*.35;
 let contacts=new Map();
 const send=async(type,points=[])=>{
  if(type==='touchStart'){
   const added=points.filter(([id])=>!contacts.has(id));
   assert.ok(await page.evaluate(points=>points.every(([,x,y])=>!!document.elementFromPoint(x,y)?.closest('.pbk-photo-viewer-viewport')),added),'Test contacts must start on the photo viewport, not its overlaid controls');
  }
  if(session){
   await session.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,px,py])=>({id,x:px,y:py}))});
  }else{
   const next=new Map(points.map(([id,px,py])=>[id,{x:px,y:py}]));
   const events=type==='touchEnd'||type==='touchCancel'?[...contacts].filter(([id])=>!next.has(id)):[...next].filter(([id,p])=>type==='touchStart'?!contacts.has(id):contacts.get(id)?.x!==p.x||contacts.get(id)?.y!==p.y);
   for(const [id,p] of events)await area.dispatchEvent(({touchStart:'pointerdown',touchMove:'pointermove',touchEnd:'pointerup',touchCancel:'pointercancel'})[type],{pointerType:'touch',pointerId:id,isPrimary:id===1,clientX:p.x,clientY:p.y,button:0,buttons:type==='touchEnd'?0:1});
  }
  contacts=new Map(points.map(([id,px,py])=>[id,{x:px,y:py}]));
 };
 const tap=async(px=x,py=y)=>{await send('touchStart',[[1,px,py]]);await send('touchEnd');};
 const doubleTap=async()=>{
  if(session)await session.send('Input.synthesizeTapGesture',{x,y,tapCount:2,duration:40,gestureSourceType:'touch'});
  else await area.evaluate((a,{x,y})=>{
   // Model physical input timestamps independently of test-driver scheduling.
   const start=performance.now()-200;
   for(const [type,offset] of [['pointerdown',0],['pointerup',40],['pointerdown',80],['pointerup',120]]){
    const e=new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:1,isPrimary:true,clientX:x,clientY:y,button:0,buttons:type==='pointerup'?0:1});
    Object.defineProperty(e,'timeStamp',{value:start+offset});a.dispatchEvent(e);
   }
  },{x,y});
 };
 const level=viewer.getByLabel('Zoom level',{exact:true});
 const reset=async()=>{await viewer.getByRole('button',{name:'Reset zoom',exact:true}).click();await expect(level).toHaveText('100%');};
 const count=()=>viewer.locator('.pbk-photo-viewer-count');
 await expect(level).toHaveText('100%');
 await doubleTap();await expect(level).toHaveText('200%');
 await doubleTap();await expect(level).toHaveText('100%');
 if(!session){
  // Queued input must retain its physical duration, not handler execution time.
  await area.evaluate((a,{x,y})=>{
   const start=performance.now()-600;
   for(const [type,time] of [['pointerdown',0],['pointerup',450],['pointerdown',500],['pointerup',520]]){
    const e=new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:1,isPrimary:true,clientX:x,clientY:y});
    Object.defineProperty(e,'timeStamp',{value:start+time});a.dispatchEvent(e);
   }
  },{x,y});
  await expect(level).toHaveText('100%');
 }
 await expect.poll(()=>area.evaluate(a=>a.scrollWidth<=a.clientWidth+1&&a.scrollHeight<=a.clientHeight+1)).toBe(true);
 // A pinch uses the two-contact distance and retains the original focal point.
 const anchor=await area.evaluate((a,{x,y})=>{const r=a.getBoundingClientRect();return {x:x-r.x,y:y-r.y,cx:a.scrollLeft+x-r.x,cy:a.scrollTop+y-r.y};},{x,y});
 await send('touchStart',[[1,x-25,y],[2,x+25,y]]);
 await send('touchMove',[[1,x-50,y],[2,x+50,y]]);
 await expect(level).toHaveText('200%');
 const position=await area.evaluate(a=>({left:a.scrollLeft,top:a.scrollTop,maxLeft:a.scrollWidth-a.clientWidth,maxTop:a.scrollHeight-a.clientHeight}));
 assert.ok(Math.abs(position.left-Math.max(0,Math.min(position.maxLeft,anchor.cx*2-anchor.x)))<=3,'Pinch should retain horizontal focal point');
 assert.ok(Math.abs(position.top-Math.max(0,Math.min(position.maxTop,anchor.cy*2-anchor.y)))<=3,'Pinch should retain vertical focal point');
 // Remaining finger must not pan/swipe/tap after a pinch.
 await send('touchEnd',[[1,x-50,y]]);
 await send('touchStart',[[1,x-50,y],[3,x+50,y]]);
 await send('touchMove',[[1,x-100,y],[3,x+100,y]]);
 await expect(level).toHaveText('200%');
 await send('touchEnd',[[1,x-100,y]]);await send('touchMove',[[1,x-120,y]]);await send('touchEnd');
 await expect(count()).toHaveText('1 / 4');await expect(level).toHaveText('200%');
 await reset();
 await send('touchStart',[[1,x-20,y],[2,x+20,y]]);await send('touchMove',[[1,x-110,y],[2,x+110,y]]);
 await expect(level).toHaveText('400%');
 const capped=await area.evaluate(a=>({left:a.scrollLeft,max:a.scrollWidth-a.clientWidth}));
 await send('touchMove',[[1,x-130,y],[2,x+90,y]]);
 await expect.poll(()=>area.evaluate(a=>a.scrollLeft)).toBeGreaterThan(capped.left);
 assert.ok(Math.abs(await area.evaluate(a=>a.scrollLeft)-Math.min(capped.max,capped.left+20))<=3,'Pinch translation should pan even at the scale cap');
 await send('touchEnd');
 await send('touchStart',[[1,x-60,y],[2,x+60,y]]);await send('touchMove',[[1,x-5,y],[2,x+5,y]]);
 await expect(level).toHaveText('100%');await send('touchEnd');
 // A third contact cancels the gesture until every contact lifts.
 await send('touchStart',[[1,x-25,y],[2,x+25,y]]);await send('touchStart',[[1,x-25,y],[2,x+25,y],[3,x,y+30]]);
 await send('touchMove',[[1,x-60,y],[2,x+60,y],[3,x,y+30]]);await send('touchEnd');
 await expect(level).toHaveText('100%');await expect(count()).toHaveText('1 / 4');
 await send('touchStart',[[1,x-25,y],[2,x+25,y]]);await send('touchCancel');
 await tap();await expect(level).toHaveText('100%');
 await page.waitForTimeout(350);
 // Long press and a moved contact cannot seed a double tap.
 await send('touchStart',[[1,x,y]]);await page.waitForTimeout(300);await send('touchEnd');await tap();await expect(level).toHaveText('100%');
 await page.waitForTimeout(350);
 await send('touchStart',[[1,x,y]]);await send('touchMove',[[1,x,y+20]]);await send('touchEnd');await tap();await expect(level).toHaveText('100%');
 await page.waitForTimeout(350);
 await doubleTap();await expect(level).toHaveText('200%');
 await viewer.getByRole('button',{name:'Next photo',exact:true}).click();await expect(level).toHaveText('100%');
 await viewer.getByRole('button',{name:'Previous photo',exact:true}).click();await expect(count()).toHaveText('1 / 4');
 await reset();
 await tap();await tap(x-80,y);await expect(level).toHaveText('100%');await page.waitForTimeout(350);
 await send('touchStart',[[1,x,y]]);
 await viewer.getByRole('button',{name:'Next photo',exact:true}).click();await send('touchEnd');
 await expect(count()).toHaveText('2 / 4');await expect(level).toHaveText('100%');
 await viewer.getByRole('button',{name:'Previous photo',exact:true}).click();
}
