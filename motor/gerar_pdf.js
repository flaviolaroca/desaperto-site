const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('playwright-core'); } })();
(async()=>{const [,,src,out,png]=process.argv;const b=await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});const p=await b.newPage();
await p.goto('file://'+require('path').resolve(src));await p.waitForSelector('body[data-pronto]',{timeout:15000}).catch(()=>{});await p.waitForTimeout(200);
await p.pdf({path:out,width:'108mm',height:'192mm',printBackground:true,preferCSSPageSize:true});
if(png){await p.setViewportSize({width:408,height:726});const n=await p.$$eval('.pag',e=>e.length);
 for(let i=0;i<n;i++){const el=(await p.$$('.pag'))[i];await el.screenshot({path:png.replace('N',String(i+1).padStart(2,'0'))});}}
await b.close();})();
