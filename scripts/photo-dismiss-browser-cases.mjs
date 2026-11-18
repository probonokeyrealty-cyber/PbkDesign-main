import assert from 'node:assert/strict';
import {expect} from '@playwright/test';

export async function verifyPhotoDismiss({page,area,viewer,trigger,gesture,nativeSwipe}){
 const swipe=nativeSwipe??gesture;
 await swipe(10,100);
 await expect(viewer).toHaveCount(0);
 await expect(trigger).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>document.body.hasAttribute('data-scroll-locked'))).toBe(false);
 await trigger.click();await expect(viewer).toBeVisible();
 await expect(viewer.getByLabel('Zoom level',{exact:true})).toHaveText('100%');
 for(const [dx,dy,options] of [[0,60],[0,-120],[100,110],[0,120,{cancel:true}]]){
  await gesture(dx,dy,options);await expect(viewer).toBeVisible();
 }
 await swipe(-100,0);await expect(viewer.locator('.pbk-photo-viewer-count')).toHaveText('2 / 4');
 await swipe(100,0);await expect(viewer.locator('.pbk-photo-viewer-count')).toHaveText('1 / 4');
 await viewer.getByRole('button',{name:'Zoom in',exact:true}).click();
 await area.evaluate(a=>{a.scrollTop=Math.min(160,a.scrollHeight-a.clientHeight);});
 const before=await area.evaluate(a=>a.scrollTop);assert.ok(before>0);
 await swipe(0,100);await expect(viewer).toBeVisible();
 assert.ok(await area.evaluate(a=>a.scrollTop)<before,'Downward touch must pan when zoomed');
 await viewer.getByRole('button',{name:'Reset zoom',exact:true}).click();
 await expect(viewer.getByLabel('Zoom level',{exact:true})).toHaveText('100%');
 await gesture(0,120,{multi:true});await expect(viewer).toBeVisible();
 await viewer.getByRole('button',{name:'Reset zoom',exact:true}).click();
 await expect(viewer.getByLabel('Zoom level',{exact:true})).toHaveText('100%');
 // A horizontal-first L gesture must not become dismissal.
 await area.evaluate(a=>{
  const b=a.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
  for(const [type,dx,dy] of [['pointerdown',0,0],['pointermove',60,0],['pointermove',60,150],['pointerup',60,150]])a.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:1,isPrimary:true,clientX:x+dx,clientY:y+dy}));
 });
 await expect(viewer).toBeVisible();
 // Pinch back to fit, lift one finger, then move the residual finger down.
 await area.evaluate(a=>{
  const b=a.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2;
  for(const [type,id,dx,dy] of [['pointerdown',1,-20,0],['pointerdown',2,20,0],['pointermove',1,-40,0],['pointermove',2,40,0],['pointermove',1,-20,0],['pointermove',2,20,0],['pointerup',2,20,0],['pointermove',1,-20,150],['pointerup',1,-20,150]])a.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'touch',pointerId:id,isPrimary:id===1,clientX:x+dx,clientY:y+dy}));
 });
 await expect(viewer).toBeVisible();await expect(viewer.getByLabel('Zoom level',{exact:true})).toHaveText('100%');
 await swipe(0,120);await expect(viewer).toHaveCount(0);await expect(trigger).toBeFocused();
 await trigger.click();await expect(viewer).toBeVisible();
}
