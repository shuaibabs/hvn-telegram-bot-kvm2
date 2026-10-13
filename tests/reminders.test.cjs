const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isReminderDue, indiaDay, planSystemReminders } = require('../dist/shared/utils/systemReminders');
const now = new Date('2026-10-13T01:30:00Z'); // 7 AM IST
const today = new Date('2026-10-13T18:00:00Z'); // Still today, later than the scheduler run
const tomorrow = new Date('2026-10-13T18:30:00Z');
const number = (id, date = today) => ({ id, mobile: '9876543210', numberType: 'COCP', safeCustodyDate: date });
const existing = (status = 'Pending', dueDate = today) => ({
    id: 'legacy-auto-id', taskId: 'cocp-safecustody-a', taskName: 'Safe Custody Date arrived for 9876543210',
    assignedTo: ['Admin'], status, dueDate,
    accountName: 'N/A', mobile: '9876543210', numberId: 'a'
});

test('today, overdue and future dates are classified at IST midnight, independent of host timezone', () => {
    assert.equal(isReminderDue(today, now), true);
    assert.equal(isReminderDue(tomorrow, now), false);
    assert.equal(isReminderDue(new Date('2026-10-11'), now), true);
    assert.equal(isReminderDue(null, now), false);
    assert.equal(isReminderDue('invalid date', now), false);
    assert.equal(indiaDay(new Date('2026-10-12T18:30:00Z')), '2026-10-13');
    assert.equal(isReminderDue({ toDate: () => today }, now), true);
});

test('creates safe and unsafe reminders for inventory and pre-booked COCP records', () => {
    const pb = { id: 'pb', mobile: '9123456789', originalNumberData: { ...number('ignored'), unsafeCustodyDate: today, status: 'RTP' } };
    const plan = planSystemReminders([number('a')], [pb], [], ['Admin'], now);
    assert.deepEqual(plan.creates.map(r => r.id), [
        'cocp-safecustody-a', 'cocp-safecustody-pb', 'cocp-unsafecustody-pb', 'prebooked-rtp-pb'
    ]);
    assert.equal(plan.creates[1].data.taskName, 'Safe Custody Date arrived for 9123456789');
});

test('a completed legacy document is reused and reopened for a different custody date', () => {
    const plan = planSystemReminders([number('a')], [], [existing('Done', new Date('2026-09-01'))], ['Admin'], now);
    assert.equal(plan.creates.length, 0);
    assert.equal(plan.updates[0].id, 'legacy-auto-id');
    assert.equal(plan.updates[0].data.status, 'Pending');
    assert.equal(plan.updates[0].data.dueDate, today);
});

test('unchanged pending and completed dates are idempotent; completion for this event is preserved', () => {
    for (const status of ['Done', 'Pending']) {
        assert.deepEqual(planSystemReminders([number('a')], [], [existing(status)], ['Admin'], now), { creates: [], updates: [] });
    }
});

test('future dates, sold/deleted records and duplicate tasks resolve pending reminders', () => {
    assert.equal(planSystemReminders([number('a', tomorrow)], [], [existing()], ['Admin'], now).updates[0].data.status, 'Done');
    assert.equal(planSystemReminders([], [], [existing()], ['Admin'], now).updates[0].data.status, 'Done');
    const duplicate = { ...existing(), id: 'duplicate' };
    const plan = planSystemReminders([number('a')], [], [existing(), duplicate], ['Admin'], now);
    assert.deepEqual(plan.updates, [{ id: 'duplicate', data: { status: 'Done' } }]);
});

test('new system reminders require assignees and manual reminders are untouched', () => {
    const manual = { ...existing(), taskId: undefined };
    assert.deepEqual(planSystemReminders([number('a')], [], [manual], [], now), { creates: [], updates: [] });
});

test('dashboard and server use identical recurring reminder/date rules', {
    skip: !fs.existsSync(path.join(__dirname, '../../hvn-ui-app-kvm2/src/lib/system-reminders.ts'))
}, () => {
    assert.equal(fs.readFileSync(path.join(__dirname, '../src/shared/utils/systemReminders.ts'), 'utf8'),
        fs.readFileSync(path.join(__dirname, '../../hvn-ui-app-kvm2/src/lib/system-reminders.ts'), 'utf8'));
});

test('check-in reminders include account name and reach the assigned employee and admins', () => {
    const record = { ...number('a'), safeCustodyDate: null, checkInDate: today, accountName: 'Acme & Co', assignedTo: 'Employee' };
    const plan = planSystemReminders([record], [], [], ['Admin'], now);
    assert.equal(plan.creates.length, 1);
    assert.equal(plan.creates[0].id, 'sim-checkin-a');
    assert.deepEqual(plan.creates[0].data.assignedTo, ['Admin', 'Employee']);
    assert.equal(plan.creates[0].data.accountName, 'Acme & Co');
    const reminder = { ...plan.creates[0].data, id: plan.creates[0].id };
    assert.deepEqual(planSystemReminders([record], [], [reminder], ['Admin'], now), { creates: [], updates: [] });
    assert.equal(planSystemReminders([{ ...record, checkInDate: tomorrow }], [], [reminder], ['Admin'], now).updates[0].data.status, 'Done');
});

test('account changes refresh existing number reminders without reopening completed tasks', () => {
    const plan = planSystemReminders([{ ...number('a'), accountName: 'New Account' }], [], [existing('Done')], ['Admin'], now);
    assert.equal(plan.updates[0].data.accountName, 'New Account');
    assert.equal(plan.updates[0].data.status, 'Done');
});
