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

/* ── migration of doc.execItems (the old model) ── */
const DISCS = [{ id: 'ARCH', label: 'ARCH', full: 'אדריכל' }, { id: 'STRC', label: 'STRC', full: 'קונסטרוקטור' }, { id: 'ELEC', label: 'ELEC', full: 'חשמל' }, { id: 'PM', label: 'PM', full: 'ניהול פרויקט' }];
const R = (id, at, party, name, body, ballTo, kind, more = {}) => ({ id, at, party, name, body, files: [], ballTo, kind, ...more });
const BH = (party, name, from) => ({ id: 'b' + from, party, name, from });
const oldDoc = () => ({
  tracks: [{ id: 'execution', trackValue: 'execution' }],
  sheets: [{ id: 's1', type: 'list', track: 'ongoing', tasks: [] }],
  execSeq: { rfi: 3, issue: 1, submittal: 1, change: 1 },
  finishes: [{ id: 'f1', submittalId: 'sub1', changeId: 'chg1' }],
  execItems: [
    { id: 'rfi1', type: 'rfi', seq: 3, number: 'RFI-003', title: 'שרוולים', description: 'מה הקוטר?', status: 'answered', priority: 'high',
      openedBy: { party: 'contractor', name: 'דנה' }, ball: { party: 'contractor', name: '' }, ownerId: 'st07', dueDate: '2026-09-25', discipline: 'STRC', specSection: '',
      source: { kind: 'meeting', ref: 'm1' }, createdAt: '2026-09-16T09:00:00.000Z', closedAt: null, links: [{ kind: 'meeting', meetingId: 'm1', itemId: 'i1' }],
      responses: [
        R('r1', '2026-09-16T09:00:00.000Z', 'contractor', 'דנה', 'מה הקוטר?', { party: 'architect', name: '' }, 'open', { files: [{ id: 'fa', url: '/data/attachments/a.pdf', name: 'a.pdf' }] }),
        R('r2', '2026-09-17T10:00:00.000Z', 'architect', 'שי', 'הועבר לקונסטרוקטור.', { party: 'consultant', name: 'קונסטרוקציה – אור פקרמן' }, 'reply'),
        R('r3', '2026-09-23T12:00:00.000Z', 'consultant', 'קונסטרוקציה – אור פקרמן', 'שרוולים 6"', { party: 'architect', name: '' }, 'reply'),
        R('r4', '2026-09-24T09:00:00.000Z', 'architect', 'שי', 'מאושר לפי הסקיצה.', { party: 'contractor', name: '' }, 'answer')],
      revisions: [], ballHistory: [BH('architect', '', '2026-09-16T09:00:00.000Z'), BH('consultant', 'קונסטרוקציה – אור פקרמן', '2026-09-17T10:00:00.000Z'), BH('architect', '', '2026-09-23T12:00:00.000Z'), BH('contractor', '', '2026-09-24T09:00:00.000Z')] },
    { id: 'iss1', type: 'issue', seq: 1, number: 'ISS-001', title: 'רטיבות', description: '', status: 'resolved', openedBy: { party: 'supervisor', name: 'רון' }, ball: null, ownerId: '',
      dueDate: '', discipline: 'ARCH', createdAt: '2026-09-08T12:00:00.000Z', closedAt: '2026-09-12T10:00:00.000Z',
      responses: [R('i1', '2026-09-08T12:00:00.000Z', 'supervisor', 'רון', 'כתמי רטיבות', { party: 'contractor', name: '' }, 'open'),
        R('i2', '2026-09-12T10:00:00.000Z', 'architect', 'שי', 'תוקן', null, 'status', { status: 'resolved' })],
      revisions: [], ballHistory: [BH('contractor', '', '2026-09-08T12:00:00.000Z'), BH(null, '', '2026-09-12T10:00:00.000Z')] },
    { id: 'sub1', type: 'submittal', seq: 1, number: 'SUB-001', title: 'HPL', description: 'שופ', status: 'rejected', openedBy: { party: 'contractor', name: 'דנה' },
      ball: { party: 'contractor', name: '' }, ownerId: 'st07', dueDate: '2026-10-17', discipline: 'ARCH', specSection: '09.12.010', createdAt: '2026-09-10T09:00:00.000Z', closedAt: null,
      responses: [R('s1', '2026-09-10T09:00:00.000Z', 'contractor', 'דנה', 'שופ', { party: 'architect', name: '' }, 'open'),
        R('s2', '2026-09-15T10:00:00.000Z', 'architect', 'שי', 'חסר פרט עיגון', null, 'decision'),
        R('s3', '2026-09-24T09:00:00.000Z', 'contractor', 'דנה', 'הוסף פרט', { party: 'architect', name: '' }, 'revision'),
        R('s4', '2026-09-29T11:00:00.000Z', 'architect', 'שי', 'הגוון לא תואם', null, 'decision')],
      revisions: [{ id: 'ra', label: 'A', files: [{ id: 'fr', url: '/data/attachments/r.pdf', name: 'r.pdf' }], submittedAt: '2026-09-10T09:00:00.000Z', decision: 'rejected', decidedAt: '2026-09-15T10:00:00.000Z' },
        { id: 'rb', label: 'B', files: [], submittedAt: '2026-09-24T09:00:00.000Z', decision: 'rejected', decidedAt: '2026-09-29T11:00:00.000Z' }],
      ballHistory: [BH('architect', '', '2026-09-10T09:00:00.000Z'), BH('contractor', '', '2026-09-15T10:00:00.000Z'), BH('architect', '', '2026-09-24T09:00:00.000Z'), BH('contractor', '', '2026-09-29T11:00:00.000Z')] },
    { id: 'chg1', type: 'change', seq: 1, number: 'CHG-001', title: 'Fundermax', description: 'החלפת יצרן', status: 'approved_cond', openedBy: { party: 'contractor', name: 'דנה' },
      ball: null, ownerId: 'st07', dueDate: '2026-09-16', discipline: 'ARCH', createdAt: '2026-09-07T09:00:00.000Z', closedAt: '2026-09-22T11:00:00.000Z',
      tenderSpec: 'Trespa', tenderRef: '09.1', proposed: 'Fundermax', approvedText: 'Fundermax 8 מ"מ',
      responses: [R('c1', '2026-09-07T09:00:00.000Z', 'contractor', 'דנה', 'מציע Fundermax', { party: 'architect', name: '' }, 'open'),
        R('c2', '2026-09-22T11:00:00.000Z', 'architect', 'שי', 'מאושר בתנאי', null, 'decision', { decision: 'approved_cond', approvedText: 'Fundermax 8 מ"מ' })],
      revisions: [], ballHistory: [BH('architect', '', '2026-09-07T09:00:00.000Z'), BH(null, '', '2026-09-22T11:00:00.000Z')] }
  ]
});
const byId = (doc, id) => L.execLogTasks(doc).find(t => t.id === id);
const lastEv = t => t.events[t.events.length - 1];

test('migration: one log sheet, task ids are the old item ids, old items kept as legacy', () => {
  const d = L.execMigrateDoc(oldDoc(), DISCS);
  const sh = L.execLogSheet(d);
  assert.strictEqual(sh.id, 'exlog');
  assert.strictEqual(sh.track, 'execution');
  assert.deepStrictEqual(sh.tasks.map(t => t.id), ['rfi1', 'iss1', 'sub1', 'chg1']);
  assert.strictEqual(d.execItems, undefined);
  assert.strictEqual(d.execItemsLegacy.length, 4);
  assert.deepStrictEqual(d.execSeq, { rfi: 3, issue: 1, submittal: 1, change: 1 });
  assert.strictEqual(d.sheets.length, 2);
});

test('migration: fields and numbers carry over; a change becomes a marked general task', () => {
  const d = L.execMigrateDoc(oldDoc(), DISCS);
  const r = byId(d, 'rfi1');
  assert.deepStrictEqual([r.exType, r.exNo, r.exSeq, r.title, r.description, r.discipline, r.priority, r.dueDate, r.createdAt], ['rfi', 'RFI-003', 3, 'שרוולים', 'מה הקוטר?', 'STRC', 'high', '2026-09-25', '2026-09-16']);
  assert.deepStrictEqual(r.assigneeIds, ['st07']);
  assert.deepStrictEqual(r.exSource, { kind: 'meeting', ref: 'm1' });
  assert.deepStrictEqual(r.exLinks, [{ kind: 'meeting', meetingId: 'm1', itemId: 'i1' }]);
  assert.deepStrictEqual(byId(d, 'iss1').assigneeIds, []);
  const c = byId(d, 'chg1');
  assert.deepStrictEqual([c.exType, c.exNo], ['general', 'CHG-001']);
  assert.deepStrictEqual(c.exChange, { tenderSpec: 'Trespa', tenderRef: '09.1', proposed: 'Fundermax', approvedText: 'Fundermax 8 מ"מ', decision: 'approved_cond', decidedAt: '2026-09-22', decidedBy: 'שי' });
  assert.strictEqual(byId(d, 'sub1').exSpec, '09.12.010');
});

test('migration: the thread becomes updates, ball follows the old ball', () => {
  const d = L.execMigrateDoc(oldDoc(), DISCS);
  const r = byId(d, 'rfi1');
  assert.deepStrictEqual(r.events.map(e => [e.id, e.date, e.assignee]), [['ev-r1', '2026-09-16', 'ARCH'], ['ev-r2', '2026-09-17', 'STRC'], ['ev-r3', '2026-09-23', 'ARCH'], ['ev-r4', '2026-09-24', 'CONT']]);
  assert.ok(r.events[1].note.includes('שי') && r.events[1].note.includes('הועבר לקונסטרוקטור.'));
  assert.strictEqual(L.execBall(r, '2026-10-01'), 'CONT');
  assert.strictEqual(lastEv(r).status, 'sent'); // answered → sent to the side that asked
  assert.strictEqual(L.execTaskClosed(r), false);
});

test('migration: a consultant with no matching discipline keeps the ball on the item discipline and the name in the note', () => {
  const doc = oldDoc();
  const d = L.execMigrateDoc(doc, DISCS.filter(x => x.id !== 'STRC'));
  const e = byId(d, 'rfi1').events[1];
  assert.strictEqual(e.assignee, 'STRC'); // item.discipline
  assert.ok(e.title.includes('אור פקרמן'));
  const doc2 = oldDoc(); doc2.execItems[0].discipline = 'ARCH';
  assert.strictEqual(byId(L.execMigrateDoc(doc2, []), 'rfi1').events[1].assignee, 'ARCH');
  assert.strictEqual(L.execPartyDisc({ party: 'supervisor', name: 'רון' }, {}, DISCS), 'PM');
  assert.strictEqual(L.execPartyDisc({ party: 'consultant', name: 'חשמל – גיל' }, {}, DISCS), 'ELEC');
  assert.strictEqual(L.execPartyDisc({ party: '', name: '' }, {}, DISCS), 'ARCH');
});

test('migration: closed items end approved; a rejected submittal ends in comments with CONT, rounds counted', () => {
  const d = L.execMigrateDoc(oldDoc(), DISCS);
  const i = byId(d, 'iss1');
  assert.strictEqual(L.execTaskClosed(i), true);
  assert.strictEqual(lastEv(i).status, 'approved');
  assert.strictEqual(lastEv(i).date, '2026-09-12');
  const s = byId(d, 'sub1');
  assert.deepStrictEqual([lastEv(s).status, lastEv(s).assignee], ['comments', 'CONT']);
  assert.strictEqual(L.execRound(s), 2);
  assert.strictEqual(s.events[0].round, 1);
  assert.deepStrictEqual(s.attachments.map(a => a.url), ['/data/attachments/r.pdf']);
  assert.deepStrictEqual(byId(d, 'rfi1').attachments.map(a => a.url), ['/data/attachments/a.pdf']);
  assert.strictEqual(L.execTaskClosed(byId(d, 'chg1')), true);
});

test('migration is deterministic and idempotent', () => {
  const a = L.execMigrateDoc(oldDoc(), DISCS), b = L.execMigrateDoc(oldDoc(), DISCS);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(L.execMigrateDoc(a, DISCS), a);
  const plain = { sheets: [] };
  assert.strictEqual(L.execMigrateDoc(plain, DISCS), plain);
});

test('migration folds in an item a stale tab added after the move', () => {
  const a = L.execMigrateDoc(oldDoc(), DISCS);
  const late = { ...oldDoc().execItems[0], id: 'rfi9', seq: 4, number: 'RFI-004' };
  const d = L.execMigrateDoc({ ...a, execItems: [late, oldDoc().execItems[1]] }, DISCS);
  assert.deepStrictEqual(L.execLogTasks(d).map(t => t.id), ['rfi1', 'iss1', 'sub1', 'chg1', 'rfi9']);
  assert.strictEqual(d.execItemsLegacy.length, 5);
  assert.strictEqual(d.execItems, undefined);
});

test('log sheet lookup', () => {
  const doc = { sheets: [{ id: 's1', type: 'list', tasks: [task()] }, { id: 'exlog', type: 'execlog', track: 'execution', tasks: [task({ id: 'k' })] }] };
  assert.strictEqual(L.EXEC_LOG_SHEET_ID, 'exlog');
  assert.strictEqual(L.execLogSheet(doc).id, 'exlog');
  assert.deepStrictEqual(L.execLogTasks(doc).map(t => t.id), ['k']);
  assert.deepStrictEqual(L.execLogTasks({}), []);
  assert.deepStrictEqual(Object.keys(L.EXT_TYPES), ['issue', 'rfi', 'submittal', 'general']);
});

/* ── the page: migration on load, and the log kept out of everything that collects tasks ── */
const fnBody = name => { const i = html.indexOf('function ' + name + '('); assert.ok(i >= 0, name + ' not found'); const j = html.indexOf('\nfunction ', i + 10); return html.slice(i, j < 0 ? i + 200000 : Math.min(j, i + 200000)); };

test('migrateData runs the execution migration with the project disciplines', () => {
  assert.match(fnBody('migrateData'), /return execMigrateDoc\(.*,execDiscsOf\(d\)\);\}/);
  assert.match(html, /'disc-CONT':'#[0-9A-F]{6}'/);
  assert.match(html, /const EXEC_CONT_DISC=\{id:'CONT'/);
});

test('every task collector takes only list sheets, so the execlog sheet stays out', () => {
  for (const name of ['MyTasksView', 'searchItemsOf', 'TracksGanttPanel', 'DashboardView', 'runAutomations', 'QuickUpdate', 'InboxPanel', 'OverviewPage'])
    assert.match(fnBody(name), /type ?=== ?'list'/, name);
  const vs = html.match(/const visibleStages=[^;]*;/)[0];
  assert.ok(!vs.includes('execlog'), 'the log is not a track stage');
});
