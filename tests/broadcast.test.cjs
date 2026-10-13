const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitTelegramMessage } = require('../dist/shared/utils/telegramMessages');
const calls = [];
let failSend = () => false;
const stub = (name, exports) => { require.cache[require.resolve(name)] = { exports }; };
stub('node-telegram-bot-api', class { async sendMessage(id, text, options) {
    calls.push({ id, text, options });
    const error = failSend(id, text);
    if (error) throw error;
} });
stub('../dist/config/env', { env: { TELEGRAM_BOT_TOKEN: 'test' }, GROUPS: { WORK_REMINDERS: '-group', MASTER_CHANNEL: '-master' } });
stub('../dist/core/logger/logger', { logger: { info() {}, warn() {}, error() {} } });
const { broadcast } = require('../dist/features/broadcast/broadcastService');
const largeMessage = '**Safe Custody Dates Arrived (COCP)**\n\n**Date: 13 October 2026**\n' +
    Array.from({ length: 594 }, (_, i) => `• \`${9000000000 + i}\`\n`).join('');

async function withoutDelays(run) {
    const original = global.setTimeout;
    global.setTimeout = callback => { queueMicrotask(callback); return 0; };
    try { return await run(); } finally { global.setTimeout = original; }
}

test('594 numbers split without loss, with valid formatting and master header space', () => {
    for (const prefix of ['', '**Master Alert**\n**Source:** BOT\n\n']) {
        const parts = splitTelegramMessage(largeMessage, prefix);
        assert.ok(parts.length > 1);
        let count = 0;
        for (const part of parts) {
            assert.ok(part.text.length <= 4096);
            count += (part.text.match(/9\d{9}/g) || []).length;
            for (const entity of part.entities) {
                assert.ok(entity.offset >= 0 && entity.offset + entity.length <= part.text.length);
                if (entity.type === 'code') assert.match(part.text.slice(entity.offset, entity.offset + entity.length), /^9\d{9}$/);
            }
        }
        assert.equal(count, 594);
    }
});

test('long single entries preserve bold entities and emoji across splits', () => {
    const body = 'a'.repeat(3999) + '😀' + 'b'.repeat(5000);
    const parts = splitTelegramMessage(`**${body}**`);
    assert.equal(parts.map(p => p.text).join(''), body);
    for (const part of parts) {
        assert.ok(part.text.isWellFormed());
        assert.deepEqual(part.entities, [{ type: 'bold', offset: 0, length: part.text.length }]);
    }
});

test('master-only overflow is split and literal HTML-sensitive text is sent safely', async () => {
    calls.length = 0;
    const message = 'x'.repeat(3999) + '<A&B>';
    const result = await withoutDelays(() => broadcast('WORK_REMINDERS', message));
    assert.equal(result.success, true);
    for (const call of calls) {
        assert.ok(call.text.length <= 4096);
        assert.equal(call.options.parse_mode, undefined);
    }
    assert.ok(calls.filter(c => c.id === '-master').length > 1);
    assert.equal(calls.filter(c => c.id === '-group').map(c => c.text).join(''), message);
});

test('429 retries only the failed part, without replaying delivered group messages', async () => {
    calls.length = 0;
    let failed = false;
    failSend = (id) => {
        if (id !== '-master' || failed) return false;
        failed = true;
        return { response: { body: { error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 1 } } } };
    };
    const result = await withoutDelays(() => broadcast('WORK_REMINDERS', largeMessage));
    assert.equal(result.success, true);
    const expected = splitTelegramMessage(largeMessage).length;
    assert.equal(calls.filter(c => c.id === '-group').length, expected);
    const master = calls.filter(c => c.id === '-master');
    assert.equal(master[0].text, master[1].text);
    failSend = () => false;
});

test('a failed group still attempts the master, and reports incomplete delivery', async () => {
    calls.length = 0;
    failSend = id => id === '-group' && new Error('ETELEGRAM: 403 Forbidden');
    const result = await broadcast('WORK_REMINDERS', 'Reminder');
    assert.equal(result.success, false);
    assert.match(result.error, /403/);
    assert.equal(calls.filter(c => c.id === '-master').length, 1);
    failSend = () => false;
});

test('queued retries resume unfinished destinations without repeating delivered master parts', async () => {
    calls.length = 0;
    const progress = {};
    const persisted = [];
    const delivery = { progress, onPartSent: async (id, completed) => persisted.push([id, completed]) };
    failSend = id => id === '-group' && new Error('ETELEGRAM: 403 Forbidden');
    const first = await broadcast('WORK_REMINDERS', 'Queued activity', 'UI', delivery);
    assert.equal(first.success, false);
    assert.equal(progress['-master'], 1);
    failSend = () => false;
    const retry = await broadcast('WORK_REMINDERS', 'Queued activity', 'UI', delivery);
    assert.equal(retry.success, true);
    assert.equal(calls.filter(call => call.id === '-master').length, 1);
    assert.deepEqual(persisted, [['-master', 1], ['-group', 1]]);
});
