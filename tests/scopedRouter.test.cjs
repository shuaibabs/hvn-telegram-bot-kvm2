const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
require.cache[require.resolve('../dist/config/env')] = { exports: { env: {} } };
require.cache[require.resolve('../dist/core/logger/logger')] = { exports: { logger: { info() {}, warn() {}, error() {} } } };
const { CommandRouter } = require('../dist/core/router/commandRouter');
const { setSession, clearSession } = require('../dist/core/bot/sessionManager');
afterEach(() => clearSession(-10, 'parity:101'));

test('scoped group sessions allow their callbacks/menus but block legacy actions including names ending in start', async () => {
  const routed = [], answers = [];
  const router = new CommandRouter({ async answerCallbackQuery(id, options) { answers.push(options); } });
  for (const data of ['parity_start_status', 'inventory_start', 'delete_act_start', 'inv_upd_stat']) {
    router.registerCallback(data, async () => { routed.push(data); }, ['-10']);
  }
  setSession(-10, 'parity:101', {});
  for (const data of ['parity_start_status', 'inventory_start', 'delete_act_start', 'inv_upd_stat']) {
    await router.handleCallbackQuery({ id: 'query', data, from: { id: 101 }, message: { chat: { id: -10 } } });
  }
  assert.deepEqual(routed, ['parity_start_status', 'inventory_start']);
  assert.equal(answers.filter(answer => answer?.show_alert).length, 2);
  clearSession(-10, 'parity:101');
  await router.handleCallbackQuery({ id: 'query', data: 'inv_upd_stat', from: { id: 101 }, message: { chat: { id: -10 } } });
  assert.equal(routed.at(-1), 'inv_upd_stat');
});

test('scoped text avoids fallback and legacy command starts while preserving the start menu', async () => {
  const routed = [];
  const router = new CommandRouter({});
  router.register(/^legacy$/, async () => routed.push('legacy'));
  router.register(/^\/start$/, async () => routed.push('start'));
  router.setFallbackHandler(async () => routed.push('fallback'));
  setSession(-10, 'parity:101', {});
  for (const text of ['9000000000', 'legacy', '/cancel', '/start']) await router.handleMessage({ text, chat: { id: -10 } });
  assert.deepEqual(routed, ['start']);
  clearSession(-10, 'parity:101');
  await router.handleMessage({ text: 'legacy', chat: { id: -10 } });
  assert.deepEqual(routed, ['start', 'legacy']);
});
