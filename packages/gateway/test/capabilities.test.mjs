import test from 'node:test';
import assert from 'node:assert/strict';
import {gatewayCapabilities} from '../src/capabilities.mjs';
test('platform capabilities distinguish implemented desktop routing from mobile native prerequisites',()=>{
 for(const platform of ['darwin','win32']){const c=gatewayCapabilities(platform);assert.equal(c.localListener,true);assert.equal(c.lanListener,false);assert.equal(c.manualProxyCoexistence,true);}
 for(const platform of ['android','ios']){const c=gatewayCapabilities(platform);assert.equal(c.localListener,false);assert.equal(c.systemProxy,'unavailable');assert.equal(c.nativeMiniPrograms,'native-platform-bridge-required');assert.equal(c.lanListener,false);}
 assert.equal(gatewayCapabilities('android').exclusiveVpn,true);
});
