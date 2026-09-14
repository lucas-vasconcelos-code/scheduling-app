import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
const origin = 'http://localhost:3107';
const server = spawn(process.execPath, ['apps/server/dist/index.js'], {env: {...process.env, APP_MODE:'demo', NODE_ENV:'development', PORT:'3107', PUBLIC_URL:origin, CLIENT_URL:origin, WEB_ROOT:'apps/client/dist'}, stdio:['ignore','pipe','pipe']});
let output = '';
server.stdout.on('data', d => {output += d;}); server.stderr.on('data', d => {output += d;});
let browser;
try {
  for (let i=0;i<60;i++) {
    if (server.exitCode !== null) throw new Error('Compiled server failed to start: '+output);
    try { if ((await fetch(origin+'/health')).ok) break; } catch {}
    await delay(250);
  }
  browser = await chromium.launch();
  const page = await browser.newPage();
  const failures=[];
  page.on('pageerror', e=>failures.push(e.message));
  await page.goto(origin+'/calendar');
  await page.getByRole('button',{name:'Explore the demo'}).click();
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Account',exact:true}).click();
  await page.getByText('Live updates connected',{exact:true}).waitFor();
  const state = await page.evaluate(async()=>{const r=await fetch('/api/v1/state');return {ok:r.ok,data:await r.json()};});
  if (!state.ok || !state.data.userId || failures.length) throw new Error('Same-origin production web verification failed: '+failures.join(', '));
  await page.screenshot({path:'.cache/screenshots/production-account.png',fullPage:true});
  console.log('PASS: bundled server, exported SPA deep link, same-origin authenticated API, live stream, account screen.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await Promise.race([new Promise(resolve=>server.once('exit',resolve)), delay(5000)]);
  if (server.exitCode === null) server.kill('SIGKILL');
}
