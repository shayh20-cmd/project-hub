const test = require('node:test');
const assert = require('node:assert');
const C = require('../celebrate.js');

const sheet = (track, tasks) => ({ id: 's' + track, type: 'list', track, tasks });
const doc = (sheets, ms) => ({ sheets, licensingMilestones: ms || [] });

test('a licensing task turning done is counted as licensing', () => {
  const a = doc([sheet('licensing', [{ id: 't1', statusId: 'N', done: false }])]);
  const b = doc([sheet('licensing', [{ id: 't1', statusId: 'C', done: true }])]);
  assert.deepStrictEqual(C.detect(a, b), { licensing: 1, milestones: 0, regular: 0 });
});

test('a regular task turning done is counted as regular; already-done and new tasks are not', () => {
  const a = doc([sheet(null, [{ id: 't1', statusId: 'S' }, { id: 't2', statusId: 'C', done: true }])]);
  const b = doc([sheet(null, [{ id: 't1', statusId: 'C', done: true }, { id: 't2', statusId: 'C', done: true }, { id: 't3', statusId: 'C', done: true }])]);
  assert.deepStrictEqual(C.detect(a, b), { licensing: 0, milestones: 0, regular: 1 });
});

test('a milestone turning done is counted; status wins over the done flag', () => {
  const a = doc([], [{ id: 'm1', status: 'in_progress', done: true }, { id: 'm2', done: false }]);
  const b = doc([], [{ id: 'm1', status: 'done' }, { id: 'm2', done: true }]);
  assert.strictEqual(C.detect(a, b).milestones, 2);
});

test('reopening a task, or missing documents, celebrate nothing', () => {
  const a = doc([sheet(null, [{ id: 't1', statusId: 'C', done: true }])]);
  const b = doc([sheet(null, [{ id: 't1', statusId: 'S', done: false }])]);
  assert.deepStrictEqual(C.detect(a, b), { licensing: 0, milestones: 0, regular: 0 });
  assert.deepStrictEqual(C.detect(null, b), { licensing: 0, milestones: 0, regular: 0 });
});

test('decide: every 20th regular task fires, others do not', () => {
  const reg = n => ({ licensing: 0, milestones: 0, regular: n });
  assert.deepStrictEqual(C.decide(18, reg(1)), { fire: false, count: 19 });
  assert.deepStrictEqual(C.decide(19, reg(1)), { fire: true, count: 20 });
  assert.deepStrictEqual(C.decide(39, reg(3)), { fire: true, count: 42 });
  assert.deepStrictEqual(C.decide(5, { licensing: 1, milestones: 0, regular: 0 }), { fire: true, count: 5 });
  assert.deepStrictEqual(C.decide(5, { licensing: 0, milestones: 1, regular: 0 }), { fire: true, count: 5 });
});
