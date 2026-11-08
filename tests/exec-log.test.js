// The execution log as planning-style tasks: helpers in the page's exec-logic block.
// Run: node --test tests/exec-log.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'project_hub_01.html'), 'utf8');
const m = html.match(/\/\* ═══ exec-logic ═══ \*\/([\s\S]*?)\/\* ═══ \/exec-logic ═══ \*\//);
if (!m) throw new Error('exec-logic block not found in project_hub_01.html');
let n = 0;
const uid = () => 'x' + ++n;
const NAMES = ['EXT_TYPES', 'EXEC_LOG_SHEET_ID', 'execLogSheet', 'execLogTasks', 'exLatest', 'exCountStart', 'execTaskClosed',
  'execNextNo', 'execNewTask', 'execBall', 'execWaitingT', 'execRound', 'execCountsT', 'execBallSplitT', 'execForMeT',
  'execSetChange', 'execDecideChangeT', 'execPartyDisc', 'execMigrateDoc'];
const L = new Function('uid', m[1] + '\nreturn {' + NAMES.map(k => `${k}:typeof ${k}==='undefined'?undefined:${k}`).join(',') + '};')(uid);

/* the page's own event ordering, to prove the block's copies agree */
const fnSrc = name => { const i = html.indexOf('function ' + name + '('); const j = html.indexOf('\n', i); return html.slice(i, j); };
const P = new Function('todayISO', [fnSrc('evChrono'), fnSrc('evCurrent'), fnSrc('evCountStart')].join('\n') + '\nreturn {evCurrent,evCountStart};')(() => '2026-10-11');

const ev = (id, date, status, assignee, more = {}) => ({ id, date, status, assignee, title: '', note: '', countDays: true, ...more });
const task = (over = {}) => ({ id: 't' + ++n, title: 'x', exType: 'rfi', exNo: 'RFI-001', exSeq: 1, events: [], createdAt: '2026-10-04', ...over });

test('exLatest and exCountStart agree with the page', () => {
  const evs = [ev('a', '2026-10-04', 'progress', 'ARCH'), ev('b', '2026-10-08', 'sent', 'CONT', { countDays: false }), ev('c', '2026-10-06', 'comments', 'STRC'), ev('d', '2026-10-20', 'progress', 'PM')];
  assert.strictEqual(L.exLatest(evs, '2026-10-11').id, P.evCurrent(evs, '2026-10-11').id);
  assert.strictEqual(L.exCountStart(evs, '2026-10-11').id, P.evCountStart(evs, '2026-10-11').id);
  assert.strictEqual(L.exLatest([], '2026-10-11'), null);
});

test('numbers are per type; a migrated CHG number does not move the GEN counter', () => {
  assert.deepStrictEqual(L.execNextNo([], 'rfi', {}), { seq: 1, no: 'RFI-001' });
  const a = task({ exType: 'rfi', exSeq: 1, exNo: 'RFI-001' });
  assert.strictEqual(L.execNextNo([a], 'rfi', {}).no, 'RFI-002');
  assert.strictEqual(L.execNextNo([a], 'rfi', { rfi: 9 }).no, 'RFI-010');
  const chg = task({ exType: 'general', exSeq: 4, exNo: 'CHG-004' });
  assert.strictEqual(L.execNextNo([a, chg], 'general', {}).no, 'GEN-001');
});

test('a new task carries its number and an opening update to the ball holder', () => {
  const t = L.execNewTask([], { type: 'submittal', title: 'ריצוף', ownerId: 'st07', ballTo: 'CONT', dueDate: '2026-11-01' }, {}, '2026-10-04');
  assert.strictEqual(t.exNo, 'SUB-001');
  assert.strictEqual(t.exType, 'submittal');
  assert.deepStrictEqual(t.assigneeIds, ['st07']);
  assert.strictEqual(t.events.length, 1);
  assert.strictEqual(t.events[0].assignee, 'CONT');
  assert.strictEqual(t.events[0].status, 'progress');
  assert.strictEqual(t.events[0].date, '2026-10-04');
  assert.strictEqual(L.execNewTask([], { type: 'general', title: 'g' }, {}, '2026-10-04').events[0].assignee, 'ARCH');
});

test('a task with no updates: no ball, no waiting, open, not "with us"', () => {
  const t = task();
  assert.strictEqual(L.execBall(t), null);
  assert.strictEqual(L.execWaitingT(t, '2026-10-11'), 0);
  assert.strictEqual(L.execTaskClosed(t), false);
  assert.strictEqual(L.execCountsT([t], '2026-10-11').mine, 0);
});

test('ball and waiting follow the latest update', () => {
  const t = task({ events: [ev('a', '2026-10-04', 'progress', 'ARCH'), ev('b', '2026-10-08', 'sent', 'CONT')] });
  assert.strictEqual(L.execBall(t, '2026-10-11'), 'CONT');
  assert.strictEqual(L.execWaitingT(t, '2026-10-11'), 1); // Thu → Sun
});

test('closed: an approved update, or a manual C override', () => {
  assert.strictEqual(L.execTaskClosed(task({ events: [ev('a', '2026-10-04', 'approved', 'ARCH')] })), true);
  assert.strictEqual(L.execTaskClosed(task({ statusOverride: true, statusId: 'C', events: [ev('a', '2026-10-04', 'progress', 'ARCH')] })), true);
  assert.strictEqual(L.execTaskClosed(task({ statusOverride: true, statusId: 'I', events: [ev('a', '2026-10-04', 'approved', 'ARCH')] })), false);
  assert.strictEqual(L.execTaskClosed(task({ statusId: 'C' })), true);
  const closed = task({ events: [ev('a', '2026-10-04', 'progress', 'ARCH'), ev('b', '2026-10-05', 'approved', 'ARCH')] });
  assert.strictEqual(L.execBall(closed), null);
  assert.strictEqual(L.execWaitingT(closed, '2026-10-11'), 0);
});

test('dashboard counts', () => {
  const today = '2026-10-15'; // Thursday
  const ts = [
    task({ exType: 'rfi', events: [ev('r1', '2026-10-04', 'progress', 'ARCH')] }), // 9 workdays → late, with us
    task({ exType: 'rfi', events: [ev('r2', '2026-10-13', 'sent', 'CONT')] }), // fresh
    task({ exType: 'rfi', events: [ev('r3', '2026-10-04', 'approved', 'ARCH')] }), // closed
    task({ exType: 'submittal', events: [ev('s1', '2026-10-04', 'sent', 'ARCH', { round: 1 }), ev('s2', '2026-10-06', 'comments', 'CONT', { round: 2 }), ev('s3', '2026-10-12', 'sent', 'ARCH', { round: 3 })] }),
    task({ exType: 'submittal', events: [ev('s4', '2026-10-12', 'comments', 'CONT', { round: 1 })] }),
    task({ exType: 'issue', createdAt: '2026-09-20', events: [ev('i1', '2026-09-20', 'progress', 'STRC')] }) // > 14 workdays
  ];
  assert.deepStrictEqual(L.execCountsT(ts, today), { rfiOpen: 2, rfiLate: 1, subPending: 2, subRound3: 1, issuesLate: 1, mine: 2, mineAvg: 6 });
  assert.strictEqual(L.execRound(ts[3]), 3);
  assert.strictEqual(L.execRound(ts[0]), 0);
});

test('ball split buckets consultants and skips closed', () => {
  const ts = [
    task({ events: [ev('a', '2026-10-04', 'progress', 'ARCH')] }),
    task({ events: [ev('b', '2026-10-04', 'progress', 'CONT')] }),
    task({ events: [ev('c', '2026-10-04', 'progress', 'PM')] }),
    task({ events: [ev('d', '2026-10-04', 'progress', 'STRC')] }),
    task({ events: [ev('e', '2026-10-04', 'progress', 'HVAC')] }),
    task({ events: [ev('f', '2026-10-04', 'approved', 'CONT')] }),
    task()
  ];
  assert.deepStrictEqual(L.execBallSplitT(ts, '2026-10-11'), { ARCH: 1, CONT: 1, PM: 1, consultants: 2 });
});

test('mine: open, ball with us, assigned to me or unassigned in a project I manage', () => {
  const a = task({ assigneeIds: ['me'], events: [ev('a', '2026-10-04', 'progress', 'ARCH')] });
  const b = task({ assigneeIds: [], events: [ev('b', '2026-10-04', 'progress', 'ARCH')] });
  const c = task({ assigneeIds: ['me'], events: [ev('c', '2026-10-04', 'progress', 'CONT')] });
  const d = task({ assigneeIds: ['other'], events: [ev('d', '2026-10-04', 'progress', 'ARCH')] });
  assert.deepStrictEqual(L.execForMeT([a, b, c, d], 'me', false, '2026-10-11').map(t => t.id), [a.id]);
  assert.deepStrictEqual(L.execForMeT([a, b, c, d], 'me', true, '2026-10-11').map(t => t.id), [a.id, b.id]);
});

test('change mark: set, decide (final closes), reopen', () => {
  let t = task({ exType: 'general', events: [ev('a', '2026-10-04', 'progress', 'ARCH')] });
  t = L.execSetChange(t, { tenderSpec: 'אריח 60/60', proposed: 'אריח 30/60' });
  assert.deepStrictEqual(t.exChange, { tenderSpec: 'אריח 60/60', tenderRef: '', proposed: 'אריח 30/60', approvedText: '', decision: 'requested' });
  t = L.execDecideChangeT(t, { decision: 'in_review' }, '2026-10-05');
  assert.strictEqual(t.exChange.decision, 'in_review');
  assert.strictEqual(L.execTaskClosed(t), false);
  t = L.execDecideChangeT(t, { decision: 'approved_cond', notes: 'בתנאי דוגמה', name: 'שי' }, '2026-10-06');
  assert.strictEqual(t.exChange.decision, 'approved_cond');
  assert.strictEqual(t.exChange.approvedText, 'אריח 30/60');
  assert.strictEqual(L.execTaskClosed(t), true);
  const last = t.events[t.events.length - 1];
  assert.strictEqual(last.status, 'approved');
  assert.strictEqual(last.note, 'בתנאי דוגמה');
  t = L.execDecideChangeT(t, { decision: 'requested' }, '2026-10-07');
  assert.strictEqual(L.execTaskClosed(t), false);
  assert.strictEqual(L.execBall(t, '2026-10-11'), 'ARCH');
  assert.strictEqual(t.exChange.approvedText, '');
  assert.strictEqual(L.execSetChange(t, null).exChange, undefined);
});

test('log sheet lookup', () => {
  const doc = { sheets: [{ id: 's1', type: 'list', tasks: [task()] }, { id: 'exlog', type: 'execlog', track: 'execution', tasks: [task({ id: 'k' })] }] };
  assert.strictEqual(L.EXEC_LOG_SHEET_ID, 'exlog');
  assert.strictEqual(L.execLogSheet(doc).id, 'exlog');
  assert.deepStrictEqual(L.execLogTasks(doc).map(t => t.id), ['k']);
  assert.deepStrictEqual(L.execLogTasks({}), []);
  assert.deepStrictEqual(Object.keys(L.EXT_TYPES), ['issue', 'rfi', 'submittal', 'general']);
});
