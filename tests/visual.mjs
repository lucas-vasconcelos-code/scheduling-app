import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
await mkdir('.cache/screenshots',{recursive:true});
const browser=await chromium.launch();
for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]){
 const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('401'))errors.push(m.text());});
 await page.goto('http://localhost:8081');await page.getByRole('button',{name:'Explore the demo'}).click();await page.getByText(/Good (morning|afternoon|evening), Alex/).waitFor();
 await page.screenshot({path:`.cache/screenshots/${name}-today.png`,fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Calendar',exact:true}).click();await page.getByRole('button',{name:'Next week'}).waitFor();await page.screenshot({path:`.cache/screenshots/${name}-calendar.png`,fullPage:true,animations:'disabled'});
 console.log(JSON.stringify({name,errors,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)}));await page.close();
}
await browser.close();
