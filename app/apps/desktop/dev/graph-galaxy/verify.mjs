// SPDX-License-Identifier: Apache-2.0
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../../../../../docs/galaxy/', import.meta.url).pathname;
const base = process.env.GALAXY_URL || 'http://127.0.0.1:1435';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--enable-unsafe-webgpu']});
const errors=[]; const results=[];
for(const [count,platform,theme,renderer] of [[200,'macos','light',''],[2000,'windows','dark',''],[20000,'macos','dark',''],[2000,'windows','light','webgl']]) {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',message=>{if(message.type()==='error') errors.push(message.text());});
 const start=Date.now();
 await page.goto(`${base}/dev/graph-galaxy/?count=${count}&platform=${platform}&theme=${theme}&renderer=${renderer}`);
 await page.waitForFunction(n=>document.querySelector('.graph-galaxy-canvas')?.dataset.nodes===String(n),count,{timeout:120000});
 const firstFrameMs=Date.now()-start;
 const interactionStart=Date.now();
 await page.getByRole('button',{name:'Graph settings'}).click();
 await page.getByPlaceholder('Filter by title…').waitFor();
 const firstInteractionMs=Date.now()-interactionStart;
 await page.getByRole('button',{name:'Graph settings'}).click();
 await page.waitForFunction(()=>!document.querySelector('.is-settling') && document.querySelector('.graph-galaxy-host')?.dataset.layout==='settled',null,{timeout:180000});
 await page.waitForTimeout(2000);
 const readyMs=Date.now()-start;
 await page.screenshot({path:`${root}${platform}-${count}-${theme}${renderer?'-'+renderer:''}.png`});
 // A held drag drives genuine OrbitControls and a render every animation frame.
 await page.mouse.move(700,500); await page.mouse.down();
 const measuring=page.evaluate(()=>window.galaxyLab.measure(6000));
 const orbitStart=Date.now();
 while(Date.now()-orbitStart<6200) {
   const t=(Date.now()-orbitStart)/1000;
   await page.mouse.move(700+100*Math.sin(t),500+40*Math.sin(t*.8));
   await page.waitForTimeout(15);
 }
 await page.mouse.up();
 const metric=await measuring;
 assert.ok(['WebGPU','WebGL2'].includes(metric.backend));
 if(renderer==='webgl') assert.equal(metric.backend,'WebGL2');
 results.push({...metric,platform,theme,firstFrameMs,firstInteractionMs,readyMs});console.log(results.at(-1));
 // Keyboard selection announces an actual title and opens through the production handler.
 await page.locator('.graph-canvas').focus();await page.keyboard.press('ArrowRight');
 await page.waitForSelector('[role=status]');
 assert.ok((await page.locator('[role=status]').innerText()).length>0);
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>!!document.body.dataset.openedNote);
 assert.ok((await page.evaluate(()=>document.body.dataset.openedNote)).endsWith('.md'));
 if(count===200) {
   await page.getByRole('button',{name:'Graph settings'}).click();
   await page.getByLabel('Min links',{exact:true}).focus(); await page.keyboard.press('End');
   await page.getByText('Your graph is empty',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Reset',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.graph-galaxy-canvas')?.dataset.nodes==='200');
   await page.getByLabel('Filter notes by title').fill('perspective');
   await page.waitForTimeout(300);
   await page.screenshot({path:root+'search-filter.png'});
 }
 await page.close();
}
await writeFile(root+'performance.json',JSON.stringify({browser:await browser.version(),viewport:'1440x1000, DPR 1',results,errors},null,2));
await browser.close();
assert.deepEqual(errors,[]);
