// Run: node --test tests/mcp-exec.test.js
// The connector's execution-track tools against a throwaway project file: the log is the project's
// execlog sheet of tasks (old doc.execItems are converted on first touch).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const createMcp = require('../tools/local-server/mcp.js');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-mcp-exec-'));
const PH01 = path.join(tmp, 'project_hub_01.json');
const REG = path.join(tmp, 'hub_projects.json');
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const writeJsonAtomic = (f, v) => fs.writeFileSync(f, JSON.stringify(v));
fs.writeFileSync(REG, '{}');
const FINISH = { id: 'f1', category: 'ריצוף', element: 'ריצוף לובי', location: 'קומת קרקע', material: 'גרניט פורצלן', finish: 'מט', color: 'אפור', colorHex: '', supplier: 'נגב', approvedAt: '', approvedBy: '', files: [], image: null, submittalId: null, changeId: null, specSection: '', discipline: '', notes: '' };
const reset = (extra = {}) => writeJsonAtomic(PH01, {
  sheets: [{ id: 's1', type: 'list', name: 'משימות שוטפות', tasks: [], groups: [] }], tracks: [],
  team: [{ staffId: 'st07' }, { staffId: 'st08' }],
  finishes: [{ ...FINISH }], ...extra
});
const mcp = createMcp({
  DATA_DIR: tmp, STATIC_ROOT: ROOT, SITE_MODE: 'local', PROJECTS_DIR: tmp,
  APPS: { 'hub-projects': REG, 'project-hub-01': PH01 },
  readJson, writeJsonAtomic, sendJson() {}, readRequestBody() {}
});
const { handleRpc, identify } = mcp._test;
const ctxFor = email => ({ me: identify({ email }, {}), reg: {}, base: 'https://hub' });
const SHAY = ctxFor('shay@kkarc.com'), ASSAF = ctxFor('assaf@kkarc.com');
let id = 0;
async function call(c, name, args) {
  const r = await handleRpc({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } }, c);
  if (r.result.isError) { const e = new Error(r.result.content[0].text); e.tool = true; throw e; }
  return r.result.structuredContent;
}
const listNames = async c => (await handleRpc({ jsonrpc: '2.0', id: ++id, method: 'tools/list' }, c)).result.tools.map(t => t.name);
const logTasks = () => (readJson(PH01).sheets.find(s => s.type === 'execlog') || { tasks: [] }).tasks;

test('execution tools are listed only for the trial user; the log never shows in the task tools', async () => {
  assert.ok((await listNames(SHAY)).includes('update_finish'));
  const other = await listNames(ASSAF);
  assert.ok(!other.some(n => /exec|finish/.test(n)));
  assert.ok(other.includes('update_task'));
  reset();
  await assert.rejects(call(ASSAF, 'list_finishes', { project: 'PH01' }), /not open to you/);
  await call(SHAY, 'create_exec_item', { project: 'PH01', type: 'rfi', title: 'שאלת גובה ייחודית' });
  const found = await call(SHAY, 'search_tasks', { query: 'שאלת גובה ייחודית' });
  assert.strictEqual(JSON.stringify(found).includes('שאלת גובה ייחודית'), false);
});

test('update a finishes row: material, colour, approval', async () => {
  reset();
  const r = await call(SHAY, 'update_finish', { project: 'PH01', row: 'ריצוף לובי', material: 'גרניט פורצלן 60/120', color: 'אפור בהיר', approved_at: '2026-10-15', approved_by: 'שי' });
  assert.strictEqual(r.added, false);
  assert.strictEqual(r.row.status, 'מאושר');
  const row = readJson(PH01).finishes[0];
  assert.strictEqual(row.material, 'גרניט פורצלן 60/120');
  assert.strictEqual(row.approvedAt, '2026-10-15');
  await assert.rejects(call(SHAY, 'update_finish', { project: 'PH01', row: 'אין כזה' }), /No finishes row/);
  const z = await call(SHAY, 'update_finish', { project: 'PH01', element: 'ריצוף רחבת כניסה', zone: 'חוץ', category: 'ריצוף' });
  assert.strictEqual(z.row.zone, 'חוץ');
  const ext = await call(SHAY, 'list_finishes', { project: 'PH01', zone: 'exterior' });
  assert.deepStrictEqual(ext.rows.map(r => r.element), ['ריצוף רחבת כניסה']);
});

test('RFI: open, answer passing the ball, close — as updates on a log task', async () => {
  reset();
  const c1 = await call(SHAY, 'create_exec_item', { project: 'PH01', type: 'RFI', title: 'גובה תקרה במסדרון', description: 'מה הגובה?', opened_by: { party: 'קבלן', name: 'דנה' } });
  assert.strictEqual(c1.created.number, 'RFI-001');
  assert.strictEqual(c1.created.ball, 'אדריכל');
  assert.match(c1.link, /exec=/);
  const t = logTasks()[0];
  assert.deepStrictEqual([t.exType, t.exNo, t.groupId, t.exOpenedBy.party, t.events.length], ['rfi', 'RFI-001', 'exg-rfi', 'contractor', 1]);
  const u = await call(SHAY, 'update_exec_item', { project: 'PH01', item: 'rfi-1', action: 'answer', text: '2.60 נטו', ball_to: { party: 'contractor' } });
  assert.strictEqual(u.updated.status, 'נשלח');
  assert.strictEqual(u.updated.ball, 'קבלן');
  const done = await call(SHAY, 'update_exec_item', { project: 'PH01', item: 'RFI-001', action: 'close' });
  assert.strictEqual(done.updated.closed, true);
  await assert.rejects(call(SHAY, 'update_exec_item', { project: 'PH01', item: 'RFI-001', action: 'close' }), /already closed/);
  assert.strictEqual((await call(SHAY, 'list_exec_items', { project: 'PH01' })).count, 0);
  assert.strictEqual((await call(SHAY, 'list_exec_items', { project: 'PH01', include_closed: true })).count, 1);
  const full = await call(SHAY, 'get_exec_item', { project: 'PH01', item: 'RFI-001' });
  assert.deepStrictEqual(full.item.updates.map(x => [x.status, x.to]), [['בעבודה', 'אדריכל'], ['נשלח', 'קבלן'], ['מאושר', 'קבלן']]);
});

test('submittal: rejected, a new round, approved with notes, then a finishes row from it', async () => {
  reset();
  await call(SHAY, 'create_exec_item', { project: 'PH01', type: 'submittal', title: 'חיפוי HPL' });
  const rj = await call(SHAY, 'update_exec_item', { project: 'PH01', item: 'SUB-001', action: 'decide', decision: 'rejected', text: 'חסר פרט' });
  assert.deepStrictEqual([rj.updated.status, rj.updated.ball], ['יש הערות', 'קבלן']);
  const nr = await call(SHAY, 'update_exec_item', { project: 'PH01', item: 'SUB-001', action: 'new_revision', text: 'Rev B' });
  assert.deepStrictEqual([nr.updated.round, nr.updated.ball], [2, 'אדריכל']);
  await assert.rejects(call(SHAY, 'update_finish', { project: 'PH01', from_submittal: 'SUB-001' }), /not approved/);
  const d = await call(SHAY, 'update_exec_item', { project: 'PH01', item: 'SUB-001', action: 'decide', decision: 'approved_notes', text: 'לתקן פרט פינה' });
  assert.deepStrictEqual([d.updated.status, d.updated.closed], ['אושר עם הערות', true]);
  await assert.rejects(call(SHAY, 'update_exec_item', { project: 'PH01', item: 'SUB-001', action: 'decide', decision: 'approved' }), /already decided/);
  const f = await call(SHAY, 'update_finish', { project: 'PH01', from_submittal: 'SUB-001', category: 'חזיתות', material: 'HPL', color_hex: '#B0A890' });
  assert.strictEqual(f.added, true);
  assert.strictEqual(f.row.element, 'חיפוי HPL');
  assert.match(f.row.submittal, /SUB-001/);
  assert.strictEqual(f.row.status, 'מאושר');
  await assert.rejects(call(SHAY, 'update_finish', { project: 'PH01', from_submittal: 'SUB-001' }), /already has a finishes row/);
});

test('change request: a marked General task; approved changes a finishes row; new numbers are GEN', async () => {
  reset();
  const c = await call(SHAY, 'create_exec_item', { project: 'PH01', type: 'change', title: 'החלפת ריצוף', tender_spec: 'גרניט פורצלן', proposed: 'טרצו' });
  assert.deepStrictEqual([c.created.number, c.created.type, c.created.change_request, c.created.ball], ['GEN-001', 'general', true, 'אדריכל']);
  await assert.rejects(call(SHAY, 'update_exec_item', { project: 'PH01', item: 'GEN-001', action: 'decide', decision: 'rejected' }), /needs notes/);
  const d = await call(SHAY, 'update_exec_item', { project: 'PH01', item: 'GEN-001', action: 'decide', decision: 'approved', finish_row: 'f1' });
  assert.deepStrictEqual([d.updated.approved_text, d.updated.status, d.updated.closed], ['טרצו', 'אושר', true]);
  const row = readJson(PH01).finishes[0];
  assert.strictEqual(row.changeId, logTasks()[0].id);
  assert.match(row.notes, /שונה לפי GEN-001: טרצו/);
  const e = await call(SHAY, 'update_exec_item', { project: 'PH01', item: 'GEN-001', fields: { tender_ref: '11.02.010' } });
  assert.deepStrictEqual(e.changed, ['סעיף מכרז']);
  await assert.rejects(call(SHAY, 'update_exec_item', { project: 'PH01', item: 'GEN-001', action: 'close' }), /decide/);
  const listed = await call(SHAY, 'list_exec_items', { project: 'PH01', type: 'change', include_closed: true });
  assert.strictEqual(listed.count, 1);
});

test('issue status, General tasks and helpful errors', async () => {
  reset();
  await call(SHAY, 'create_exec_item', { project: 'PH01', type: 'issue', title: 'רטיבות בקיר' });
  const s = await call(SHAY, 'update_exec_item', { project: 'PH01', item: 'ISS-001', action: 'status', status: 'נשלח', ball_to: { party: 'consultant', name: 'חשמל' } });
  assert.deepStrictEqual([s.updated.status, s.updated.ball], ['נשלח', 'חשמל']);
  const old = await call(SHAY, 'update_exec_item', { project: 'PH01', item: 'ISS-001', action: 'status', status: 'בטיפול' });
  assert.strictEqual(old.updated.status, 'בעבודה');
  await assert.rejects(call(SHAY, 'update_exec_item', { project: 'PH01', item: 'ISS-001', action: 'status', status: 'xyz' }), /Statuses:/);
  await assert.rejects(call(SHAY, 'update_exec_item', { project: 'PH01', item: 'ISS-001' }), /Nothing to change/);
  await assert.rejects(call(SHAY, 'create_exec_item', { project: 'PH01', type: 'memo', title: 'x' }), /Unknown item type/);
  const g = await call(SHAY, 'create_exec_item', { project: 'PH01', type: 'כללי', title: 'לתאם סיור' });
  assert.strictEqual(g.created.number, 'GEN-001');
});

test('a project file still holding the old items is converted on first touch and written converted', async () => {
  reset({
    execSeq: { rfi: 4 },
    execItems: [{ id: 'old1', type: 'rfi', seq: 4, number: 'RFI-004', title: 'ישן', description: '', status: 'pending', openedBy: { party: 'contractor', name: 'דנה' }, ball: { party: 'architect', name: '' }, ownerId: 'st07',
      dueDate: '', discipline: 'ARCH', createdAt: '2026-10-01T08:00:00.000Z', closedAt: null, revisions: [], links: [],
      responses: [{ id: 'r1', at: '2026-10-01T08:00:00.000Z', party: 'contractor', name: 'דנה', body: 'שאלה', files: [], ballTo: { party: 'architect', name: '' }, kind: 'open' }],
      ballHistory: [{ id: 'b1', party: 'architect', name: '', from: '2026-10-01T08:00:00.000Z' }] }]
  });
  const l = await call(SHAY, 'list_exec_items', { project: 'PH01' });
  assert.deepStrictEqual(l.items.map(i => i.number), ['RFI-004']);
  assert.ok(readJson(PH01).execItems, 'a read does not write');
  const c = await call(SHAY, 'create_exec_item', { project: 'PH01', type: 'rfi', title: 'חדש' });
  assert.strictEqual(c.created.number, 'RFI-005');
  const doc = readJson(PH01);
  assert.strictEqual(doc.execItems, undefined);
  assert.strictEqual(doc.execItemsLegacy.length, 1);
  assert.deepStrictEqual(logTasks().map(t => t.exNo), ['RFI-004', 'RFI-005']);
});
