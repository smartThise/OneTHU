/** Actual GUI refresh callback, isolated dependencies and synthetic data only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { deptCodeOf, matchVolRow } from '../packages/core/src/zhjwxk/xk-vol.ts';

const source = fs.readFileSync(new URL('../apps/desktop/src/state/data.ts', import.meta.url), 'utf8');
const start = source.indexOf('  const refreshVol = useCallback(');
const end = source.indexOf('\n  /** 检查点调度链', start);
assert(start >= 0 && end > start);
const callback = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const row = (code, department = '城规系') => ({ code, seq: '01', department, capacity: 40, applied: 10, volRequired: '3,2,1', volElective: '', volOptional: '', volSports: '' });
const pool = (code, department = '城规系') => ({ code, seq: '01', department });

function fixture({ initial = {}, done = {}, dept, course } = {}) {
  const state = { map: initial, states: [], calls: [], updates: 0, now: 1000 };
  const refs = {
    volInflightRef: { current: false }, volPendingRef: { current: null }, volPoolRef: { current: [] },
    volDataRef: { current: initial }, volDeptsRef: { current: done }, volRetriedRef: { current: {} },
    lastVolSyncRef: { current: 123 }, refreshVolRef: { current: null },
  };
  const dependencies = {
    phase: false, status: 'ready', semester: '2099-2100-2', ...refs,
    useCallback: fn => fn, setVolState: value => state.states.push(value),
    setVolMap: update => { state.map = update(state.map); state.updates++; },
    xkSession: () => ({}), deptCodeOf, matchVolRow,
    isSportsCourse: item => /体育/.test(item.department ?? ''),
    Date: class extends Date { static now() { return state.now++; } },
    fetchXkVolunteerByDept: async (session, options) => {
      state.calls.push({ kind: 'dept', options });
      return dept ? dept(options) : {};
    },
    fetchXkVolCourse: async (session, options) => {
      state.calls.push({ kind: 'course', options });
      return course ? course(options) : {};
    },
  };
  const refresh = new Function(...Object.keys(dependencies), callback + '\nreturn refreshVol;')(...Object.values(dependencies));
  refs.refreshVolRef.current = refresh;
  return { state, refs, refresh };
}

async function settle(f) {
  for (let i = 0; i < 20 && (f.refs.volInflightRef.current || f.refs.volPendingRef.current); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(f.refs.volInflightRef.current, false, 'refresh pipeline must settle');
  assert.equal(f.refs.volPendingRef.current, null);
}

test('an empty pool and a completed pool leave data, state and sync time untouched', async () => {
  const initial = { FIX1_01: row('FIX1') };
  const f = fixture({ initial, done: { '001': 111 } });
  await f.refresh([]);
  await f.refresh([pool('FIX1')]);
  assert.equal(f.state.map, initial);
  assert.deepEqual(f.state.states, []);
  assert.deepEqual(f.state.calls, []);
  assert.equal(f.refs.lastVolSyncRef.current, 123);
});

test('streamed success publishes once, and render-driven repeat calls perform no work', async () => {
  const result = { FIX1_01: row('FIX1') };
  const f = fixture({ dept: options => { options.doneMap['001'] = 1; options.onRows?.(result); return result; } });
  await f.refresh([pool('FIX1')]);
  const map = f.state.map;
  const stamp = f.refs.lastVolSyncRef.current;
  for (let i = 0; i < 5; i++) await f.refresh([pool('FIX1')]);
  assert.equal(f.state.map, map);
  assert.equal(f.state.updates, 1);
  assert.equal(f.state.calls.length, 1);
  assert.deepEqual(f.state.states, ['loading', 'ready']);
  assert.equal(f.refs.lastVolSyncRef.current, stamp);
});

test('missing rows get the bounded department and course fallbacks without looping on empty maps', async () => {
  const f = fixture();
  await f.refresh([pool('FIX1')]);
  assert.deepEqual(f.state.calls.map(call => call.kind), ['dept', 'dept', 'course']);
  const map = f.state.map;
  const stamp = f.refs.lastVolSyncRef.current;
  await f.refresh([pool('FIX1')]);
  assert.equal(f.state.calls.length, 3);
  assert.equal(f.state.map, map);
  assert.equal(f.state.updates, 0);
  assert.deepEqual(f.state.states, ['loading', 'ready']);
  assert.equal(f.refs.lastVolSyncRef.current, stamp);
});

test('a failed sports lookup is bounded until explicit force', async () => {
  const f = fixture();
  await f.refresh([pool('SPORT1', '体育')]);
  const count = f.state.calls.length;
  await f.refresh([pool('SPORT1', '体育')]);
  assert.equal(f.state.calls.length, count);
  await f.refresh([pool('SPORT1', '体育')], true);
  assert(f.state.calls.length > count);
});

test('force bypasses completed caches and empty-stage retry uses the last real pool', async () => {
  const result = { FIX1_01: row('FIX1') };
  const f = fixture({ initial: result, done: { '001': 1 }, dept: options => { options.doneMap['001'] = 2; return result; } });
  await f.refresh([pool('FIX1')]);
  await f.refresh([], true);
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.calls[0].options.force, true);
  assert.deepEqual(f.state.states, ['loading', 'ready']);
  assert.notEqual(f.refs.lastVolSyncRef.current, 123);
});

test('force renews an already-known departmentless course once per code', async () => {
  const initial = { FIX1_01: row('FIX1', '') };
  const f = fixture({ initial, course: () => initial });
  await f.refresh([pool('FIX1', ''), { ...pool('FIX1', ''), seq: '1' }], true);
  assert.deepEqual(f.state.calls.map(call => call.kind), ['course']);
});

test('in-flight requests merge incoming pools and retain a requested force pass', async () => {
  let release;
  let first = true;
  const f = fixture({ dept: async options => {
    if (first) { first = false; await new Promise(resolve => { release = resolve; }); }
    const result = {};
    for (const code of options.depts) {
      options.doneMap[code] = 1;
      const id = code === '001' ? 'FIX1' : 'FIX2';
      result[id + '_01'] = row(id, code === '001' ? '城规系' : '建筑系');
    }
    return result;
  } });
  const active = f.refresh([pool('FIX1')]);
  await f.refresh([pool('FIX2', '建筑系')]);
  await f.refresh([pool('FIX1', '')], true);
  release();
  await active;
  await settle(f);
  assert.equal(f.state.calls.length, 2);
  assert.deepEqual(f.state.calls[1].options.depts.sort(), ['001', '002']);
  assert.equal(f.state.calls[1].options.force, true);
  assert(f.state.map.FIX1_01 && f.state.map.FIX2_01);
});

test('a real lookup failure retains the previous map and reports error', async () => {
  const initial = { FIX1_01: row('FIX1') };
  const f = fixture({ initial, dept: () => { throw new Error('fixture unavailable'); } });
  await f.refresh([pool('FIX2', '建筑系')]);
  assert.equal(f.state.map, initial);
  assert.deepEqual(f.state.states, ['loading', 'error']);
  assert.equal(f.refs.lastVolSyncRef.current, 123);
});

test('duplicate in-flight render requests settle without a second lookup or timestamp update', async () => {
  let release;
  const result = { FIX1_01: row('FIX1') };
  const f = fixture({ dept: async options => {
    await new Promise(resolve => { release = resolve; });
    options.doneMap['001'] = 1;
    return result;
  } });
  const first = f.refresh([pool('FIX1')]);
  await f.refresh([pool('FIX1')]);
  release();
  await first;
  const stamp = f.refs.lastVolSyncRef.current;
  await settle(f);
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.refs.lastVolSyncRef.current, stamp);
  assert.deepEqual(f.state.states, ['loading', 'ready']);
});

test('the existing checkpoint timer keeps issuing forced refreshes for the current pool', async () => {
  const result = { FIX1_01: row('FIX1') };
  const f = fixture({ initial: result, done: { '001': 1 }, dept: () => result });
  await f.refresh([pool('FIX1')]);
  const scheduleStart = source.indexOf('  const scheduleVolSync = useCallback(');
  const scheduleEnd = source.indexOf('\n  refreshVolRef.current = refreshVol;', scheduleStart);
  assert(scheduleStart >= 0 && scheduleEnd > scheduleStart);
  const compiled = ts.transpileModule(source.slice(scheduleStart, scheduleEnd), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const timers = [];
  const dependencies = {
    ...f.refs, volTimerRef: { current: null }, useCallback: fn => fn,
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    clearTimeout: () => {}, volNeedsRefresh: () => false,
    nextVolCheckpoint: () => new Date(Date.now() + 60000),
  };
  const schedule = new Function(...Object.keys(dependencies), compiled + '\nreturn scheduleVolSync;')(...Object.values(dependencies));
  schedule();
  assert.equal(f.state.calls.length, 0);
  timers[0].fn();
  await settle(f);
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.calls[0].options.force, true);
  assert.equal(timers.length, 2);
});
