import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTrustDeviceName } from '@onethu/core';
import { trustDevice } from '../../core/src/auth/cas.js';
import { createAuthFlow } from '../src/auth/flow.js';
import { resolveNodeDeviceName, trustDeviceName } from '../src/node/deviceName.js';

test('device labels distinguish devices and remain Unicode-safe, bounded and idempotent',()=>{
  assert.equal(formatTrustDeviceName('ST 的 MacBook'), 'OneTHU（ST 的 MacBook）');
  assert.equal(formatTrustDeviceName('DESKTOP-WIN'), 'OneTHU（DESKTOP-WIN）');
  assert.equal(formatTrustDeviceName('MatePad Pro'), 'OneTHU（MatePad Pro）');
  assert.equal(formatTrustDeviceName('OneTHU（MatePad Pro）'), 'OneTHU（MatePad Pro）');
  assert.equal(formatTrustDeviceName(' A\n\u202eB\u0000 '), 'OneTHU（A B）');
  assert.equal(formatTrustDeviceName(''), 'OneTHU（此设备）');
  const emoji=formatTrustDeviceName('📱'.repeat(50));
  assert.equal(Array.from(emoji).length,48);assert.equal(emoji.includes('\ufffd'),false);
  assert.equal(formatTrustDeviceName(emoji),emoji);
});

test('trust requests preserve the existing fingerprint and use the normalized device label',async()=>{
  const calls:{url:string;body:URLSearchParams}[]=[];
  const http={async text(url:string,init:any){calls.push({url,body:init.body});return '';}};
  await trustDevice(http as any,'existing-installation-fingerprint','OneTHU（Office PC）');
  assert.equal(calls.length,1);assert.equal(calls[0]!.body.get('fingerprint'),'existing-installation-fingerprint');
  assert.equal(calls[0]!.body.get('deviceName'),'OneTHU（Office PC）');
  assert.equal(calls[0]!.url,'https://id.tsinghua.edu.cn/b/doubleAuth/personal/saveFinger');
});

test('the CLI name hook resolves lazily and does not start a login or trust operation',async()=>{
  let reads=0,logins=0;const helper:any={login(){logins++;}};
  createAuthFlow({helper,trustDeviceName:async()=>{reads++;return 'Office PC';},async prepare(){},async ready(){},failed(){},cancel(){},async resend(){}});
  assert.equal(reads,0);assert.equal(logins,0);
  assert.equal(await helper.trustFingerprintNameHook(),'OneTHU（Office PC）');
  assert.equal(await helper.trustFingerprintHook(),false);assert.equal(logins,0);
});

test('Node resolves one stable OS device label without exposing it in diagnostics',async()=>{
  const [first,second]=await Promise.all([trustDeviceName(),trustDeviceName()]);
  assert.equal(first===second,true);assert.equal(/^OneTHU（.+）$/u.test(first),true);
  assert.equal(Array.from(first).length<=48,true);
});

test('Windows and Mac prefer their configured computer name and tolerate unavailable OS metadata',async()=>{
  const unused=()=>{throw new Error('host fallback must not be read');};
  assert.equal(await resolveNodeDeviceName({platform:'win32',computerName:()=> 'OFFICE-PC',hostName:unused}),'OneTHU（OFFICE-PC）');
  assert.equal(await resolveNodeDeviceName({platform:'darwin',computerName:async()=> '我的 Mac',hostName:unused}),'OneTHU（我的 Mac）');
  const unavailable=()=>{throw new Error('unavailable');};
  assert.equal(await resolveNodeDeviceName({platform:'win32',computerName:unavailable,hostName:()=> 'WIN-FALLBACK'}),'OneTHU（WIN-FALLBACK）');
  assert.equal(await resolveNodeDeviceName({platform:'darwin',computerName:unavailable,hostName:unavailable}),'OneTHU（Mac）');
});
