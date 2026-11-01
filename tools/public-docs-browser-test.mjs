import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
const out='/Volumes/OneTHUBuild/artifacts/public-site-0.11/docs-browser';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const expected=JSON.parse(readFileSync('docs/contributors.json','utf8'));
const expectedApi=JSON.parse(readFileSync('docs/api-surface.json','utf8'));const checks=[],errors=[];let passed=false;
const check=(value,label)=>{assert.ok(value,label);checks.push(label);console.log('✓ '+label);};
try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:844}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://onethu.github.io/**',async route=>{const url=new URL(route.request().url());const response=await context.request.get('http://127.0.0.1:8767'+url.pathname+url.search);await route.fulfill({response});});
  await page.goto('https://onethu.github.io/docs/getting-started/');await page.locator('.md-content h1').waitFor();
  const english=page.locator('.md-select__link[hreflang=en]');await english.waitFor({state:'attached'});check((await english.getAttribute('href')).endsWith('/docs/en/getting-started/'),width+': language dropdown preserves current guide');
  await page.locator('.md-content').getByRole('link',{name:'English',exact:true}).click();await page.waitForURL('**/docs/en/getting-started/');check(await page.locator('html').getAttribute('lang')==='en',width+': English theme and guide load');
  await page.screenshot({path:out+'/english-'+width+'.png'});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+': English documentation fits viewport');
  await page.goto('https://onethu.github.io/docs/en/sharing-and-organizations/');const replay=page.locator('.md-content img').first();await replay.scrollIntoViewIfNeeded();await replay.evaluate(image=>image.decode());check((await replay.getAttribute('src')).includes('/en-US/'),width+': English guide uses the separately recorded English animation');
  await page.goto('https://onethu.github.io/docs/en/api-surface/');check(await page.locator('.md-typeset table tbody tr').count()===expectedApi.methods,width+': English API contains every generated method');
  await page.goto('https://onethu.github.io/docs/en/contributors/');check(await page.locator('.md-typeset table tbody tr').count()===expected.contributors.length,width+': contributor directory complete');
  await page.goto('https://onethu.github.io/docs/sharing-and-organizations/');await page.locator('.md-content img').first().scrollIntoViewIfNeeded();check(await page.locator('.md-content img').first().evaluate(image=>image.complete&&image.naturalWidth>0),width+': staging animation asset loads');
  await context.close();
 }
 check(errors.length===0,'No documentation browser runtime errors');passed=true;
}finally{await browser.close();writeFileSync(out+'/report.json',JSON.stringify({passed,checks,errors},null,2)+'\n');}
