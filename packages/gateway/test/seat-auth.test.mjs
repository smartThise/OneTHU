import test from 'node:test';
import assert from 'node:assert/strict';
import { SEAT_ORIGIN, SEAT_IDENTITY_URL, normalizeSeatCallback } from '../src/seatAuth.mjs';
const path='/api/id_tsinghua_callback';
const callback=SEAT_ORIGIN+path+'?ticket=official-ticket-012345';

test('Seat preserves the official HTTP or HTTPS callback for private consumption',()=>{
 assert.ok(SEAT_IDENTITY_URL.endsWith('/ef84f6d6784f6b834e5214f432d6173f/0?'+path));
 assert.equal(normalizeSeatCallback(callback),callback);
 const http=callback.replace('https:','http:');assert.equal(normalizeSeatCallback(http),http);
 const encoded=SEAT_ORIGIN+path+'?ticket=official%2Btoken%2Fwith%3D%3D';
 assert.equal(normalizeSeatCallback(encoded),encoded);
});
test('Seat callback rejects other targets, duplicate fields and malformed tickets',()=>{
 for(const value of [
  callback.replace('seat.lib','cab.lib'),callback.replace(SEAT_ORIGIN,SEAT_ORIGIN+':443'),
  callback.replace('seat.lib','user@seat.lib'),callback.replace(path,path+'/'),
  callback.replace(path,'/api/logout'),callback+'&ticket=another',callback+'&redirectUrl=https%3A%2F%2Fevil.test',
  callback+'#fragment',callback.replace('official-ticket-012345',''),callback.replace('ticket=','code='),
  callback.replace('official-ticket-012345','ERROR'),callback.replace('official-ticket-012345','first%0asecond'),
  callback.replace('official-ticket-012345','nested%255cvalue'),callback.replace('official-ticket-012345','a'.repeat(4097)),
 ])assert.equal(normalizeSeatCallback(value),null,value);
});
