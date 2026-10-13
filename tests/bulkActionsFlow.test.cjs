const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { Timestamp } = require('firebase-admin/firestore');
const sessions = require('../dist/core/bot/sessionManager');
const { indiaDay } = require('../dist/shared/utils/systemReminders');
const actualHelpers = require('../dist/shared/utils/numberActions');
let records, saves, activities, documents, actorOverrides, delayedSave;
const users = [
  { id: 101, username: 'first', first_name: 'First' },
  { id: 102, username: 'second', first_name: 'Second' }
];
const profile = user => ({ uid: `uid-${user}`, id: `uid-${user}`, role: 'employee', displayName: user, telegramUsername: user });
const mockService = {
  async getBulkActor(username) { if (actorOverrides.has(username)) throw new Error('Unregistered user'); return profile(username); },
  async reviewBulkEntries(input) { return actualHelpers.analyzeNumberEntries(input, records); },
  buildBulkChange(number, change) {
    if (change.kind === 'ownership') return number.ownershipType === change.ownershipType && (number.partnerName || '') === change.partnerName ? null : { description: `${number.mobile}: ${number.ownershipType} → ${change.ownershipType}` };
    if (change.kind === 'status') return number.status === change.status ? null : { description: `${number.mobile}: ${number.status} → ${change.status}` };
    return { description: `${number.mobile}: Check-in → ${indiaDay(change.date)}` };
  },
  validateBulkChange(change) {
    if (change.kind === 'ownership' && change.ownershipType === 'Partnership' && (!change.partnerName.trim() || change.partnerName.length > 120)) throw new Error('partner name');
    if (change.kind === 'status' && change.status === 'Non-RTP' && (!change.date || indiaDay(change.date) <= indiaDay(new Date()))) throw new Error('future RTP date');
  },
  async saveBulkChange(actor, numbers, change, operationId) {
    saves.push({ actor, numbers, change, operationId });
    if (delayedSave) await delayedSave;
    return numbers.length;
  },
  async accessibleInventory() { return records; },
  filterLocations(numbers, filters) { return numbers.filter(number => (filters.type === 'all' || number.locationType === filters.type) && (filters.location === 'all' || number.currentLocation === filters.location) && number.currentLocation.toLowerCase().includes(filters.search.toLowerCase()) && number.mobile.includes(filters.mobile)); },
  describeLocationFilters(filters) { return JSON.stringify(filters); },
  async queueLocationActivity(actor, action, description) { activities.push({ actor, action, description }); },
  async reviewLocationExport(actor, numbers) { return numbers; }
};
require.cache[require.resolve('../dist/features/inventory/bulkActionsService')] = { exports: mockService };
require.cache[require.resolve('../dist/config/env')] = { exports: { env: { TG_GROUP_INVENTORY: '-10', TG_GROUP_SIM_LOCATIONS: '-20' } } };
require.cache[require.resolve('../dist/core/logger/logger')] = { exports: { logger: { info() {}, warn() {}, error() {} } } };
const { registerBulkActionsFlow } = require('../dist/features/inventory/flows/bulkActionsFlow');
let callbacks, messages, listener, answers, bot;
function reset(count = 2) {
  saves = []; activities = []; documents = []; actorOverrides = new Set(); delayedSave = null;
  records = Array.from({ length: count }, (_, index) => ({ id: `n-${index}`, mobile: String(9000000000 + index), status: 'Non-RTP', rtpDate: null, ownershipType: 'Partnership', partnerName: 'Old', currentLocation: 'Mumbai Store', locationType: 'Store' }));
  callbacks = []; messages = []; answers = [];
  bot = {
    on(event, callback) { if (event === 'message') listener = callback; },
    async sendMessage(chatId, text, options = {}) { const message = { chat: { id: chatId }, message_id: messages.length + 1, text, options }; messages.push(message); return message; },
    async answerCallbackQuery(id, options) { answers.push(options); },
    async sendDocument(chatId, buffer, options, file) { documents.push({ chatId, text: buffer.toString(), file }); }
  };
  registerBulkActionsFlow({ bot, registerCallback(data, callback, groups) { callbacks.push({ data, callback, groups }); } });
}
async function click(data, user = users[0], chatId = -10) {
  const cb = callbacks.find(cb => typeof cb.data === 'string' ? cb.data === data : cb.data.test(data));
  assert.ok(cb, `callback registered for ${data}`);
  if (cb.groups && !cb.groups.includes(String(chatId))) return;
  await cb.callback({ id: 'query', data, from: user, message: { chat: { id: chatId }, message_id: 1 } });
}
function button(action, user = users[0], chatId = -10) {
  const session = sessions.getSession(chatId, `parity:${user.id}`);
  return `parity_${session.token}_${action}`;
}
async function text(value, user = users[0], chatId = -10) {
  listener({ text: value, from: user, chat: { id: chatId } });
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
    if (!sessions.getSession(chatId, `parity:${user.id}`)?.busy) return;
  }
}
afterEach(() => {
  for (const user of users) for (const chat of [-10, -20]) sessions.clearSession(chat, `parity:${user.id}`);
  sessions.clearSession(-10, 'legacy');
});

test('ownership flow validates numbers, previews changes and uses the registered identity when submitting', async () => {
  reset(); await click('parity_start_ownership');
  await text('9000000000,9000000001,9000000000,abc');
  assert.equal(sessions.getSession(-10, 'parity:101').stage, 'OWNERSHIP');
  assert.ok(messages.some(message => /2 valid; 2 invalid/.test(message.text)));
  await click(button('own_Individual'));
  assert.equal(sessions.getSession(-10, 'parity:101').stage, 'CONFIRM');
  await click(button('confirm'));
  assert.equal(saves.length, 1); assert.equal(saves[0].numbers.length, 2);
  assert.equal(saves[0].actor.uid, 'uid-first'); assert.equal(saves[0].change.partnerName, '');
  assert.equal(sessions.getSession(-10, 'parity:101'), undefined);
});

test('different users have isolated sessions and cannot operate each other’s buttons', async () => {
  reset(); await click('parity_start_status'); await click('parity_start_ownership', users[1]);
  await text('9000000000');
  const firstButton = button('status_RTP');
  await click(firstButton, users[1]);
  assert.match(answers.at(-1).text, /another user/);
  assert.equal(sessions.getSession(-10, 'parity:102').stage, 'NUMBERS');
  await click(firstButton);
  assert.equal(sessions.getSession(-10, 'parity:101').stage, 'CONFIRM');
});

test('replaced, expired and wrong-chat previews cannot submit, and cancellation only clears its owner', async () => {
  reset(); await click('parity_start_status'); await text('9000000000'); await click(button('status_RTP'));
  const stale = button('confirm'); await click(button('back')); await text('9000000000'); await click(button('status_RTP'));
  await click(stale); assert.equal(saves.length, 0); assert.match(answers.at(-1).text, /replaced/);
  await click(button('confirm'), users[0], -20); assert.equal(saves.length, 0);
  await click('parity_start_ownership', users[1]); await text('/cancel');
  assert.equal(sessions.getSession(-10, 'parity:101'), undefined);
  assert.ok(sessions.getSession(-10, 'parity:102'));
  await click(stale); assert.equal(saves.length, 0);
});

test('Non-RTP rejects impossible and today dates; check-in replaces the date at midnight IST', async () => {
  reset(); await click('parity_start_status'); await text('9000000000'); await click(button('status_Non-RTP'));
  await text('31/02/2099'); assert.equal(sessions.getSession(-10, 'parity:101').stage, 'RTP_DATE');
  await text(indiaDay(new Date())); assert.equal(sessions.getSession(-10, 'parity:101').stage, 'RTP_DATE');
  await text('02/02/2099'); await click(button('confirm'));
  assert.equal(saves[0].change.date.toISOString(), '2099-02-01T18:30:00.000Z');
  await click('parity_start_checkin', users[0], -20); await text('9000000000', users[0], -20);
  await text('13/10/2026', users[0], -20); await click(button('confirm', users[0], -20), users[0], -20);
  assert.equal(saves[1].change.kind, 'checkin'); assert.equal(saves[1].change.date.toISOString(), '2026-10-12T18:30:00.000Z');
});

test('save lock rejects double confirmation, another start and cancellation while writes are in progress', async () => {
  reset(); await click('parity_start_status'); await text('9000000000'); await click(button('status_RTP'));
  let release; delayedSave = new Promise(resolve => { release = resolve; });
  const confirm = button('confirm'); const first = click(confirm);
  await new Promise(resolve => setImmediate(resolve));
  await click(confirm); await click('parity_start_ownership'); await click(button('cancel'));
  assert.equal(saves.length, 1); assert.ok(sessions.getSession(-10, 'parity:101'));
  release(); await first; assert.equal(sessions.getSession(-10, 'parity:101'), undefined);
});

test('location search selects across pages, copies only mobile/location and queues both actions', async () => {
  reset(12); const chatId = -20;
  await click('parity_start_locations', users[0], chatId);
  await click(button('type_all', users[0], chatId), users[0], chatId);
  await click(button('location_all', users[0], chatId), users[0], chatId);
  await text('mUMbAi', users[0], chatId);
  await click(button('mobile_all', users[0], chatId), users[0], chatId);
  await click(button('pick_0', users[0], chatId), users[0], chatId);
  await click(button('page_next', users[0], chatId), users[0], chatId);
  await click(button('pick_10', users[0], chatId), users[0], chatId);
  await click(button('copy_selected', users[0], chatId), users[0], chatId);
  assert.equal(documents[0].text, '9000000000\tMumbai Store\n9000000010\tMumbai Store');
  assert.equal(activities[0].action, 'Searched SIM Locations'); assert.equal(activities[1].action, 'Copied SIM Locations');
  await click(button('copy_all', users[0], chatId), users[0], chatId);
  assert.equal(documents[1].text.split('\n').length, 12);
  assert.ok(messages.some(message => message.options.entities?.[0].type === 'pre'));
  await click(button('checkin_selected', users[0], chatId), users[0], chatId);
  await click(button('today', users[0], chatId), users[0], chatId);
  await click(button('confirm', users[0], chatId), users[0], chatId);
  assert.deepEqual(saves[0].numbers.map(number => number.mobile), ['9000000000', '9000000010']);
  assert.equal(indiaDay(saves[0].change.date), indiaDay(new Date()));
});

test('role removal prevents submission and legacy workflows cannot overlap new text sessions', async () => {
  reset(); sessions.setSession(-10, 'legacy', {}); await click('parity_start_status');
  assert.equal(sessions.getSession(-10, 'parity:101'), undefined);
  sessions.clearSession(-10, 'legacy'); await click('parity_start_status'); await text('9000000000'); await click(button('status_RTP'));
  actorOverrides.add('first'); await click(button('confirm')); assert.equal(saves.length, 0);
  await click(button('cancel')); assert.equal(sessions.getSession(-10, 'parity:101'), undefined);
});

test('ten-minute session expiry invalidates outstanding confirmation buttons', async () => {
  reset();
  const originalSetTimeout = global.setTimeout;
  let expire;
  global.setTimeout = (callback, ms, ...args) => ms === 600000 ? (expire = callback, {}) : originalSetTimeout(callback, ms, ...args);
  try {
    await click('parity_start_status'); await text('9000000000'); await click(button('status_RTP'));
    const stale = button('confirm'); expire();
    assert.equal(sessions.getSession(-10, 'parity:101'), undefined);
    await click(stale); assert.equal(saves.length, 0); assert.match(answers.at(-1).text, /expired/);
  } finally { global.setTimeout = originalSetTimeout; }
});

test('retry keeps the confirmed operation ID and releases the session lock after errors', async () => {
  reset(); await click('parity_start_status'); await text('9000000000'); await click(button('status_RTP'));
  const originalSave = mockService.saveBulkChange;
  let failed = false;
  mockService.saveBulkChange = async (...args) => {
    if (!failed) { failed = true; saves.push({ operationId: args[3] }); throw new Error('Database unavailable'); }
    return originalSave(...args);
  };
  try {
    await click(button('confirm'));
    assert.equal(sessions.getSession(-10, 'parity:101').stage, 'CONFIRM');
    assert.equal(sessions.getSession(-10, 'parity:101').busy, false);
    await click(button('confirm'));
    assert.equal(saves[0].operationId, saves[1].operationId);
    assert.equal(sessions.getSession(-10, 'parity:101'), undefined);
  } finally { mockService.saveBulkChange = originalSave; }
});
