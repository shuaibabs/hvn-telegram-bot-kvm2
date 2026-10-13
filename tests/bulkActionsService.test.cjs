const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Timestamp } = require('firebase-admin/firestore');
const tables = Object.fromEntries(['users', 'numbers', 'activities'].map(name => [name, new Map()]));
let writes = [], autoId = 0, failChunk = null;
const ref = (name, id) => ({ name, id, async get() { return snapshot(name, id); }, async set(data) { tables[name].set(id, data); } });
const snapshot = (name, id) => ({ id, ref: ref(name, id), exists: tables[name].has(id), data: () => tables[name].get(id) });
const db = {
  collection(name) {
    const filters = []; let ordering, count;
    const query = {
      where(field, op, value) { filters.push([field, op, value]); return query; },
      orderBy(field, direction) { ordering = [field, direction]; return query; },
      limit(value) { count = value; return query; },
      doc(id = `auto-${++autoId}`) { return ref(name, id); },
      async get() {
        let docs = [...tables[name].keys()].filter(id => filters.every(([field, op, value]) => op === 'in' ? value.includes(tables[name].get(id)[field]) : tables[name].get(id)[field] === value)).map(id => snapshot(name, id));
        if (ordering) docs.sort((a, b) => (a.data()[ordering[0]] - b.data()[ordering[0]]) * (ordering[1] === 'desc' ? -1 : 1));
        if (count) docs = docs.slice(0, count);
        return { docs, empty: !docs.length };
      }
    }; return query;
  },
  async runTransaction(run) {
    const staged = [];
    const result = await run({
      async get(doc) { if (failChunk && doc.id === failChunk) throw new Error('Database unavailable'); return snapshot(doc.name, doc.id); },
      update(doc, data) { staged.push({ doc, data, update: true }); },
      set(doc, data) { staged.push({ doc, data, update: false }); }
    });
    for (const { doc, data, update } of staged) {
      const previous = tables[doc.name].get(doc.id) || {};
      const converted = { ...data };
      if (converted.history?.union) converted.history = [...(previous.history || []), ...converted.history.union];
      tables[doc.name].set(doc.id, update ? { ...previous, ...converted } : converted);
    }
    writes.push(staged); return result;
  }
};
require.cache[require.resolve('../dist/config/firebase')] = { exports: { db } };
require.cache[require.resolve('firebase-admin/firestore')] = { exports: {
  Timestamp, FieldValue: { arrayUnion: (...values) => ({ union: values }), serverTimestamp: () => 'server-time' }
} };
const service = require('../dist/features/inventory/bulkActionsService');
const helpers = require('../dist/shared/utils/numberActions');
const { activateScheduledRtp } = require('../dist/features/inventory/scheduledRtpService');
let actor, numbers;
function reset(count = 2, role = 'employee') {
  Object.values(tables).forEach(table => table.clear()); writes = []; autoId = 0; failChunk = null;
  actor = { id: 'uid', uid: 'uid', displayName: 'Employee', telegramUsername: 'employee', role };
  tables.users.set(actor.id, { ...actor });
  numbers = Array.from({ length: count }, (_, index) => ({
    id: `n-${index}`, mobile: String(9000000000 + index), assignedTo: 'Employee',
    status: 'Non-RTP', rtpDate: Timestamp.fromDate(new Date('2099-01-01')), checkInDate: null,
    ownershipType: 'Partnership', partnerName: 'Old', currentLocation: 'Mumbai Store', locationType: 'Store', uploadStatus: 'Pending'
  }));
  numbers.forEach(number => tables.numbers.set(number.id, { ...number }));
}

test('actor lookup rejects missing, duplicate and unsupported-role Telegram identities', async () => {
  reset(); assert.equal((await service.getBulkActor('employee')).uid, 'uid');
  await assert.rejects(service.getBulkActor(), /username/);
  tables.users.set('duplicate', { ...actor }); await assert.rejects(service.getBulkActor('employee'), /exactly one/);
  tables.users.delete('duplicate'); tables.users.get('uid').role = 'viewer';
  await assert.rejects(service.getBulkActor('employee'), /admin or employee/);
});

test('review reports invalid, duplicate, ambiguous, unavailable and unassigned entries without exposing other inventory', async () => {
  reset(); tables.numbers.get('n-1').assignedTo = 'Other';
  const result = await service.reviewBulkEntries('9000000000,9000000001\n9000000000,abc,123\n9123456789', actor);
  assert.equal(result.filter(entry => entry.number).length, 1);
  assert.match(result[1].issue, /Not available/); assert.match(result[2].issue, /Duplicate/);
  assert.match(result[3].issue, /Invalid/); assert.match(result[4].issue, /Invalid/);
  tables.numbers.set('duplicate', { ...numbers[0], id: 'duplicate' });
  assert.match((await service.reviewBulkEntries('9000000000', actor))[0].issue, /Multiple/);
});

test('ownership change saves history and queued activity atomically and repeating operation cannot apply it twice', async () => {
  reset(); const change = { kind: 'ownership', ownershipType: 'Individual', partnerName: 'ignored' };
  assert.equal(await service.saveBulkChange(actor, numbers, change, 'operation'), 2);
  for (const number of tables.numbers.values()) {
    assert.equal(number.ownershipType, 'Individual'); assert.equal(number.partnerName, '');
    assert.equal(number.uploadStatus, 'Pending'); assert.equal(number.history.length, 1);
    assert.equal(number.history[0].performedBy, 'Employee');
  }
  const activity = [...tables.activities.values()][0];
  assert.equal(activity.source, 'BOT'); assert.equal(activity.notificationStatus, 'Pending');
  assert.equal(activity.createdBy, 'uid'); assert.match(activity.description, /9000000000/);
  assert.equal(await service.saveBulkChange(actor, numbers, change, 'operation'), 2);
  assert.equal(tables.activities.size, 1); assert.equal(tables.numbers.get('n-0').history.length, 1);
});

test('RTP clears the date, Non-RTP requires a future date, check-in replacement stores IST midnight', async () => {
  reset(); await service.saveBulkChange(actor, numbers, { kind: 'status', status: 'RTP', date: null }, 'rtp');
  assert.equal(tables.numbers.get('n-0').rtpDate, null);
  assert.equal(tables.numbers.get('n-0').status, 'RTP');
  const current = [...tables.numbers.values()].map(number => ({ ...number }));
  const future = helpers.inventoryDateFromInput('02/02/2099');
  await service.saveBulkChange(actor, current, { kind: 'status', status: 'Non-RTP', date: future }, 'nonrtp');
  assert.equal(tables.numbers.get('n-0').rtpDate.toMillis(), future.getTime());
  await service.saveBulkChange(actor, [...tables.numbers.values()], { kind: 'checkin', date: helpers.inventoryDateFromInput('13/10/2026') }, 'checkin');
  assert.equal(tables.numbers.get('n-0').checkInDate.toDate().toISOString(), '2026-10-12T18:30:00.000Z');
  assert.equal([...tables.activities.values()].at(-1).groupName, 'SIM_LOCATIONS');
  for (const date of [null, new Date('invalid'), new Date(), new Date('2020-01-01')]) {
    assert.throws(() => service.validateBulkChange({ kind: 'status', status: 'Non-RTP', date }), /future/);
  }
  assert.throws(() => service.validateBulkChange({ kind: 'ownership', ownershipType: 'Partnership', partnerName: ' ' }), /partner name/);
  assert.throws(() => service.validateBulkChange({ kind: 'ownership', ownershipType: 'Partnership', partnerName: 'x'.repeat(121) }), /partner name/);
});

test('concurrent edits, reassignment, deletion or changed roles reject the chunk without any writes', async () => {
  for (const mutation of [
    () => { tables.numbers.get('n-1').status = 'RTP'; },
    () => { tables.numbers.get('n-1').rtpDate = Timestamp.now(); },
    () => { tables.numbers.get('n-1').assignedTo = 'Other'; },
    () => tables.numbers.delete('n-1'),
    () => { tables.users.get('uid').role = 'viewer'; }
  ]) {
    reset(); mutation();
    await assert.rejects(service.saveBulkChange(actor, numbers, { kind: 'status', status: 'RTP', date: null }, 'conflict'));
    assert.equal(tables.numbers.get('n-0').status, 'Non-RTP'); assert.equal(writes.length, 0); assert.equal(tables.activities.size, 0);
  }
});

test('large changes use safe chunks; interrupted operations resume without duplicating activities', async () => {
  reset(85, 'admin'); failChunk = 'n-40';
  const change = { kind: 'ownership', ownershipType: 'Individual', partnerName: '' };
  await assert.rejects(service.saveBulkChange(actor, numbers, change, 'resume'), /40 number\(s\) already saved/);
  assert.equal(tables.activities.size, 1); failChunk = null;
  assert.equal(await service.saveBulkChange(actor, numbers, change, 'resume'), 85);
  assert.equal(tables.activities.size, 3);
  for (const number of tables.numbers.values()) assert.equal(number.history.length, 1);
  assert.ok(writes.every(chunk => chunk.length <= 41));
});

test('location search filters match UI behavior and exports revalidate access/current location', async () => {
  reset(); tables.numbers.get('n-1').currentLocation = 'Delhi';
  const filters = { type: 'Store', location: 'all', search: 'mUmBAI', mobile: '9000' };
  const results = service.filterLocations(await service.accessibleInventory(actor), filters);
  assert.equal(results.length, 1); assert.equal(results[0].mobile, '9000000000');
  assert.equal(helpers.locationClipboardText(await service.reviewLocationExport(actor, results)), '9000000000\tMumbai Store');
  tables.numbers.get('n-0').currentLocation = 'Moved';
  await assert.rejects(service.reviewLocationExport(actor, results), /changed/);
  tables.numbers.get('n-0').assignedTo = 'Other';
  await assert.rejects(service.reviewLocationExport(actor, results), /changed/);
  await service.queueLocationActivity(actor, 'Searched SIM Locations', 'Store');
  const activity = [...tables.activities.values()][0];
  assert.equal(activity.notificationStatus, 'Pending'); assert.equal(activity.createdBy, actor.uid);
});

test('Telegram helpers stay equivalent to UI input analysis, IST date parsing and clipboard output', () => {
  const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
  const filename = path.resolve(__dirname, '../../hvn-ui-app-kvm2/src/lib/number-actions.ts');
  const loaded = new Module(filename, module);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  reset();
  const input = '9000000000\n9000000000,123,abc,9876543210';
  assert.deepEqual(helpers.analyzeNumberEntries(input, numbers), loaded.exports.analyzeNumberEntries(input, numbers));
  assert.equal(helpers.locationClipboardText(numbers), loaded.exports.locationClipboardText(numbers));
  assert.equal(helpers.inventoryDateFromInput('2026-10-13').getTime(), loaded.exports.checkInDateFromInput('2026-10-13').getTime());
  for (const invalid of ['31/02/2026', '2026-13-01', '', '1/1/2026']) assert.equal(helpers.inventoryDateFromInput(invalid), null);
});

test('server activates overdue RTP schedules without a dashboard and queues one audit per safe chunk', async () => {
  reset(85);
  numbers.forEach(number => { number.rtpDate = Timestamp.fromDate(new Date('2020-01-01')); tables.numbers.get(number.id).rtpDate = number.rtpDate; });
  assert.equal((await activateScheduledRtp(numbers)).size, 85);
  assert.equal(tables.activities.size, 3);
  for (const number of tables.numbers.values()) {
    assert.equal(number.status, 'RTP'); assert.equal(number.rtpDate, null);
    assert.equal(number.history[0].performedBy, 'System'); assert.equal(number.history.length, 1);
  }
  assert.equal((await activateScheduledRtp(numbers)).size, 0);
  assert.equal(tables.activities.size, 3);
});

test('automatic RTP rechecks schedules and ignores deleted, postponed or already-converted records', async () => {
  reset(4);
  numbers.forEach(number => { number.rtpDate = Timestamp.fromDate(new Date('2020-01-01')); tables.numbers.get(number.id).rtpDate = number.rtpDate; });
  tables.numbers.delete('n-0'); tables.numbers.get('n-1').rtpDate = Timestamp.fromDate(new Date('2099-01-01'));
  tables.numbers.get('n-2').status = 'RTP';
  assert.deepEqual([...(await activateScheduledRtp(numbers))], ['n-3']);
  assert.equal(tables.numbers.get('n-1').status, 'Non-RTP');
  assert.equal(tables.numbers.get('n-2').history, undefined);
  assert.equal(tables.activities.size, 1);
});
