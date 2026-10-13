const { test } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
let data;
let sends;
let success;
const ref = { async update(fields) { Object.assign(data, fields); } };
const doc = { id: 'activity', ref, data: () => data };
const db = {
    collection: () => ({ where: () => ({ get: async () => ({ docs: [doc] }) }) }),
    runTransaction: async run => run({ get: async () => doc, update: (ref, fields) => Object.assign(data, fields) })
};
const stub = (name, exports) => { require.cache[require.resolve(name)] = { exports }; };
stub('../dist/config/firebase', { db });
stub('../dist/core/logger/logger', { logger: { info() {}, warn() {}, error() {} } });
stub('../dist/features/broadcast/broadcastService', { async broadcast(group, message, source) {
    sends.push({ group, message, source });
    return success ? { success: true } : { success: false, error: 'Telegram unavailable' };
} });
const { processActivityNotifications } = require('../dist/features/activities/activityNotificationWorker');
function reset() {
    sends = []; success = true;
    data = { action: 'Bulk Updated Ownership', employeeName: 'Employee', description: 'Changed inventory', source: 'UI', groupName: 'INVENTORY', notificationStatus: 'Pending' };
}

test('queued UI actions are delivered by the bot and marked sent', async () => {
    reset();
    await processActivityNotifications();
    assert.equal(sends.length, 1);
    assert.equal(sends[0].group, 'INVENTORY');
    assert.equal(data.notificationStatus, 'Sent');
    assert.equal(data.notificationAttempts, 1);
    await processActivityNotifications();
    assert.equal(sends.length, 1);
});

test('queued bot bulk and location actions preserve their source and use the same delivery worker', async () => {
    for (const group of ['INVENTORY', 'SIM_LOCATIONS']) {
        reset(); data.source = 'BOT'; data.groupName = group;
        data.operationId = 'confirmed-operation'; data.updatedCount = 40;
        await processActivityNotifications();
        assert.equal(sends[0].source, 'BOT'); assert.equal(sends[0].group, group);
        assert.match(sends[0].message, /Bulk Updated Ownership/);
        assert.equal(data.notificationStatus, 'Sent');
        await processActivityNotifications(); assert.equal(sends.length, 1);
    }
});

test('failed notifications remain queued and back off before retrying', async () => {
    reset(); success = false;
    await processActivityNotifications();
    assert.equal(data.notificationStatus, 'Retry');
    assert.ok(data.notificationNextAttemptAt.toMillis() > Date.now());
    await processActivityNotifications();
    assert.equal(sends.length, 1);
    data.notificationNextAttemptAt = admin.firestore.Timestamp.fromMillis(Date.now() - 1);
    success = true;
    await processActivityNotifications();
    assert.equal(sends.length, 2);
    assert.equal(data.notificationStatus, 'Sent');
});

test('active claims are skipped and expired claims recover after a worker restart', async () => {
    reset(); data.notificationStatus = 'Sending';
    data.notificationLeaseUntil = admin.firestore.Timestamp.fromMillis(Date.now() + 100000);
    await processActivityNotifications(); assert.equal(sends.length, 0);
    data.notificationLeaseUntil = admin.firestore.Timestamp.fromMillis(Date.now() - 1);
    await processActivityNotifications(); assert.equal(sends.length, 1);
});
