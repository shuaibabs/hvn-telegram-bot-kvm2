const { test } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const collections = { numbers: new Map(), prebookings: new Map(), reminders: new Map(), users: new Map(), activities: new Map() };
const batches = [];
let reads = 0;
const timestamp = date => admin.firestore.Timestamp.fromDate(date);
const day = (days = 0) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return timestamp(date);
};
const document = (name, id) => ({ id, ref: { name, id }, exists: collections[name].has(id), data: () => collections[name].get(id) });
const db = {
    collection(name) {
        const filters = [];
        let ordering;
        let maxResults;
        const query = {
            where(field, op, value) { filters.push([field, value]); return query; },
            orderBy(field, direction) { ordering = [field, direction]; return query; },
            limit(count) { maxResults = count; return query; },
            async get() {
                reads++;
                let docs = [...collections[name].keys()]
                    .filter(id => filters.every(([field, value]) => collections[name].get(id)[field] === value))
                    .map(id => document(name, id));
                if (ordering) docs.sort((a, b) => (a.data()[ordering[0]] - b.data()[ordering[0]]) * (ordering[1] === 'desc' ? -1 : 1));
                if (maxResults) docs = docs.slice(0, maxResults);
                return { docs, empty: docs.length === 0 };
            },
            onSnapshot(callback) { void query.get().then(callback); return () => {}; },
            doc(id = `auto-${collections[name].size}-${batches.length}`) { return { name, id, get: async () => document(name, id) }; }
        };
        return query;
    },
    batch() {
        const writes = [];
        return {
            set(ref, data) { writes.push({ ref, data, create: true }); },
            update(ref, data) { writes.push({ ref, data, create: false }); },
            async commit() {
                batches.push(writes.length);
                assert.ok(writes.length <= 450);
                for (const { ref, data, create } of writes) {
                    const result = create ? {} : { ...collections[ref.name].get(ref.id) };
                    for (const [key, value] of Object.entries(data)) {
                        if (value instanceof admin.firestore.FieldValue) {
                            if (value.isEqual(admin.firestore.FieldValue.delete())) delete result[key];
                            else result[key] = timestamp(new Date());
                        } else result[key] = value;
                    }
                    collections[ref.name].set(ref.id, result);
                }
            }
        };
    }
};
require.cache[require.resolve('../dist/config/firebase')] = { exports: { db } };
require.cache[require.resolve('../dist/core/logger/logger')] = { exports: { logger: { info() {}, warn() {}, error() {} } } };
const { getDueReminders, syncSystemReminders, canMarkReminderDone, startSystemReminderMonitor } = require('../dist/features/reminders/remindersService');
function reset() {
    for (const collection of Object.values(collections)) collection.clear();
    batches.length = 0;
    collections.users.set('admin', { role: 'admin', displayName: 'Admin' });
}

test('scheduler fetch creates and delivers all 594 missing reminders without a dashboard', async () => {
    reset();
    for (let i = 0; i < 594; i++) {
        collections.numbers.set(`n-${i}`, { mobile: `${9000000000 + i}`, numberType: 'COCP', safeCustodyDate: day(-1) });
    }
    const due = await getDueReminders();
    assert.equal(due.length, 594);
    assert.deepEqual(batches, [450, 146]);
    assert.equal(collections.activities.size, 2);
    assert.equal([...collections.activities.values()][0].notificationStatus, 'Pending');
    assert.equal(new Set(due.map(r => r.srNo)).size, 594);
    assert.deepEqual(due[0].assignedTo, ['Admin']);
    batches.length = 0;
    assert.equal((await getDueReminders()).length, 594);
    assert.deepEqual(batches, []);
});

test('arrived check-in dates on prepaid inventory produce account-aware reminders', async () => {
    reset();
    collections.numbers.set('sim', { mobile: '9876543210', numberType: 'Prepaid', accountName: 'Test Account', assignedTo: 'Employee', checkInDate: day(-1) });
    const due = await getDueReminders();
    assert.equal(due.length, 1);
    assert.equal(due[0].taskId, 'sim-checkin-sim');
    assert.equal(due[0].accountName, 'Test Account');
    assert.deepEqual(due[0].assignedTo, ['Admin', 'Employee']);
});

test('future date resolves old task; next arrived date reopens same document and clears completion', async () => {
    reset();
    collections.numbers.set('n', { mobile: '9876543210', numberType: 'COCP', safeCustodyDate: day(-2) });
    await syncSystemReminders();
    collections.numbers.get('n').safeCustodyDate = day(10);
    assert.equal((await getDueReminders()).length, 0);
    const reminder = collections.reminders.get('cocp-safecustody-n');
    assert.equal(reminder.status, 'Done');
    assert.ok(reminder.completionDate);
    collections.numbers.get('n').safeCustodyDate = day(-1);
    const due = await getDueReminders();
    assert.equal(due.length, 1);
    assert.equal(due[0].id, 'cocp-safecustody-n');
    assert.equal(due[0].completionDate, undefined);
    assert.equal(collections.reminders.size, 1);
});

test('pre-booked safe and unsafe tasks cannot be dismissed while custody dates remain due', async () => {
    reset();
    collections.prebookings.set('pb', { mobile: '9123456789', originalNumberData: {
        numberType: 'COCP', status: 'Non-RTP', safeCustodyDate: day(-1), unsafeCustodyDate: day(-1)
    } });
    const due = await getDueReminders();
    assert.equal(due.length, 2);
    for (const reminder of due) assert.equal((await canMarkReminderDone(reminder)).canBeDone, false);
    collections.prebookings.get('pb').originalNumberData.safeCustodyDate = day(2);
    const safe = due.find(r => r.taskId.startsWith('cocp-safecustody-'));
    assert.equal((await canMarkReminderDone(safe)).canBeDone, true);
});

test('invalid manual dates are skipped and overdue manual tasks survive synchronization', async () => {
    reset();
    collections.reminders.set('manual', { taskName: 'Manual', status: 'Pending', assignedTo: ['Admin'], dueDate: day(-1) });
    collections.reminders.set('invalid', { taskName: 'Invalid', status: 'Pending', assignedTo: ['Admin'], dueDate: null });
    const due = await getDueReminders();
    assert.deepEqual(due.map(r => r.id), ['manual']);
    assert.equal(collections.reminders.get('invalid').status, 'Pending');
});

test('the live monitor reuses snapshots for unchanged inventories rather than rereading every minute', async () => {
    reset();
    const original = global.setInterval;
    global.setInterval = () => 0;
    try {
        startSystemReminderMonitor();
        await new Promise(resolve => setImmediate(resolve));
        const initialReads = reads;
        await syncSystemReminders();
        await syncSystemReminders();
        assert.equal(reads, initialReads);
    } finally { global.setInterval = original; }
});
