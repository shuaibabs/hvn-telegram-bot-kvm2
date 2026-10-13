import type TelegramBot from 'node-telegram-bot-api';
import { randomBytes, randomUUID } from 'crypto';
import { CommandRouter } from '../../../core/router/commandRouter';
import { getSession, setSession, clearSession, hasLegacySession } from '../../../core/bot/sessionManager';
import { env } from '../../../config/env';
import type { NumberRecord, User } from '../../../shared/types/data';
import { inventoryDateFromInput, locationClipboardText, analyzeNumberEntries } from '../../../shared/utils/numberActions';
import { splitPlainTelegramText } from '../../../shared/utils/telegramMessages';
import { indiaDay, isReminderDue } from '../../../shared/utils/systemReminders';
import { logger } from '../../../core/logger/logger';
import {
    getBulkActor, reviewBulkEntries, buildBulkChange, saveBulkChange, validateBulkChange,
    accessibleInventory, filterLocations, describeLocationFilters, queueLocationActivity, reviewLocationExport,
    BulkChange, LocationFilters
} from '../bulkActionsService';

type Kind = BulkChange['kind'] | 'locations';
type FlowSession = {
    kind: Kind; stage: string; actor: User; token: string; busy: boolean;
    entries: ReturnType<typeof analyzeNumberEntries>; change?: BulkChange; operationId: string;
    filters: LocationFilters; inventory: NumberRecord[]; results: NumberRecord[]; selected: string[]; page: number;
};
type Choice = [label: string, action: string];
const key = (userId: number) => `parity:${userId}`;
const PAGE_SIZE = 8;

function releaseSession(chatId: number, userId: number, session: FlowSession) {
    const current = getSession(chatId, key(userId));
    if (current?.token === session.token) current.busy = false;
}

async function sendText(bot: TelegramBot, chatId: number, text: string, keyboard?: TelegramBot.InlineKeyboardButton[][]) {
    const parts = splitPlainTelegramText(text);
    for (let index = 0; index < parts.length; index++) {
        if (index) await new Promise(resolve => setTimeout(resolve, 3100));
        for (let attempt = 0; ; attempt++) {
            try {
                await bot.sendMessage(chatId, parts[index], index === parts.length - 1 && keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {});
                break;
            } catch (error: any) {
                if (error.response?.body?.error_code !== 429 || attempt >= 2) throw error;
                await new Promise(resolve => setTimeout(resolve, ((error.response.body.parameters?.retry_after || 30) + 1) * 1000));
            }
        }
    }
}

async function prompt(bot: TelegramBot, chatId: number, userId: number, session: FlowSession, text: string, choices: Choice[] = []) {
    session.token = randomBytes(6).toString('hex');
    setSession(chatId, key(userId), session);
    const keyboard = [...choices, ['❌ Cancel / Close', 'cancel'] as Choice].map(([label, action]) => [{ text: label, callback_data: `parity_${session.token}_${action}` }]);
    await sendText(bot, chatId, `👤 ${session.actor.displayName} (@${session.actor.telegramUsername})\n\n${text}`, keyboard);
}

async function inputPrompt(bot: TelegramBot, chatId: number, userId: number, session: FlowSession) {
    session.stage = 'NUMBERS'; session.entries = []; session.change = undefined; session.operationId = randomUUID();
    const title = { ownership: 'Bulk Ownership Change', status: 'Bulk Status Change', checkin: 'Bulk Check-In Date', locations: 'Location Search' }[session.kind];
    await prompt(bot, chatId, userId, session, `${title}\n\nEnter 10-digit mobile numbers separated by commas or new lines. Invalid, duplicate and unavailable entries will be shown before confirmation.\nOnly your accessible inventory can be updated.`);
}

async function typePrompt(bot: TelegramBot, chatId: number, userId: number, session: FlowSession) {
    session.stage = 'LOCATION_TYPE';
    await prompt(bot, chatId, userId, session, '📍 Search SIM Locations\n\nChoose a location type:', [['All Types', 'type_all'], ['Store', 'type_Store'], ['Employee', 'type_Employee'], ['Dealer', 'type_Dealer']]);
}

async function startFlow(bot: TelegramBot, chatId: number, user: TelegramBot.User, kind: Kind) {
    if (hasLegacySession(chatId)) {
        await bot.sendMessage(chatId, 'Finish or cancel the current group workflow before starting a bulk/location flow.'); return;
    }
    const existing = getSession(chatId, key(user.id)) as FlowSession | undefined;
    if (existing) {
        await bot.sendMessage(chatId, 'You already have an active bulk/location flow. Finish it or use /cancel before starting another.'); return;
    }
    // Reserve synchronously so two quick start clicks cannot create competing flows.
    setSession(chatId, key(user.id), { stage: 'STARTING', busy: true });
    try {
        const actor = await getBulkActor(user.username);
        const session: FlowSession = {
            kind, stage: 'STARTING', actor, token: '', busy: true, entries: [], operationId: randomUUID(),
            filters: { type: 'all', location: 'all', search: '', mobile: '' }, inventory: [], results: [], selected: [], page: 0
        };
        if (kind === 'locations') await typePrompt(bot, chatId, user.id, session);
        else await inputPrompt(bot, chatId, user.id, session);
        releaseSession(chatId, user.id, session);
    } catch (error) {
        clearSession(chatId, key(user.id));
        await bot.sendMessage(chatId, `❌ ${error instanceof Error ? error.message : 'Unable to start the flow.'}`);
    }
}

export const startBulkStatusFlow = (bot: TelegramBot, chatId: number, user: TelegramBot.User) => startFlow(bot, chatId, user, 'status');

async function verifyActor(session: FlowSession, username?: string) {
    const actor = await getBulkActor(username);
    if (actor.uid !== session.actor.uid || actor.role !== session.actor.role || actor.displayName !== session.actor.displayName) {
        throw new Error('Your account or permissions changed. Cancel and start a new review.');
    }
    return actor;
}

async function confirmPrompt(bot: TelegramBot, chatId: number, userId: number, session: FlowSession) {
    validateBulkChange(session.change!);
    session.stage = 'CONFIRM'; session.operationId = randomUUID();
    const valid = session.entries.filter(entry => entry.number);
    const changes = valid.map(entry => buildBulkChange(entry.number!, session.change!));
    const changed = changes.filter(Boolean).length;
    const text = `Review Changes\n\n${changed} will change; ${valid.length - changed} unchanged; ${session.entries.length - valid.length} invalid, duplicate or unavailable.\nOnly valid changes will be submitted.\n\n` +
        session.entries.map(entry => entry.issue ? `${entry.mobile}: ${entry.issue}` : buildBulkChange(entry.number!, session.change!)?.description || `${entry.mobile}: Unchanged`).join('\n');
    await prompt(bot, chatId, userId, session, text, [...(changed ? [['✅ Confirm & Update', 'confirm'] as Choice] : []), ['⬅️ Enter Numbers Again', 'back']]);
}

async function showResults(bot: TelegramBot, chatId: number, userId: number, session: FlowSession) {
    session.stage = 'RESULTS';
    const maxPage = Math.max(0, Math.ceil(session.results.length / PAGE_SIZE) - 1);
    session.page = Math.min(maxPage, Math.max(0, session.page));
    const offset = session.page * PAGE_SIZE;
    const page = session.results.slice(offset, offset + PAGE_SIZE);
    const selected = new Set(session.selected);
    const text = `📍 SIM Locations (${session.results.length})\n${describeLocationFilters(session.filters)}\nPage ${session.page + 1} of ${maxPage + 1}; ${selected.size} selected across all pages.\n\n` +
        page.map((number, index) => `${offset + index + 1}. ${selected.has(number.id) ? '☑' : '☐'} ${number.mobile} | ${number.currentLocation || 'N/A'} (${number.locationType})\n   Check-in: ${indiaDay(number.checkInDate) || 'Not set'}${isReminderDue(number.checkInDate) ? ' (due)' : ''}`).join('\n');
    const choices: Choice[] = page.map((number, index) => [`${selected.has(number.id) ? '☑ Unselect' : '☐ Select'} ${number.mobile}`, `pick_${offset + index}`]);
    if (session.page > 0) choices.push(['⬅️ Previous Page', 'page_prev']);
    if (session.page < maxPage) choices.push(['Next Page ➡️', 'page_next']);
    if (session.results.length) choices.push(['📋 Copy All Results', 'copy_all'], ['☑ Select All Results', 'select_all'], ['Enter Numbers to Select', 'select_input']);
    if (selected.size) choices.push([`📋 Copy Selected (${selected.size})`, 'copy_selected'], [`📅 Set Check-In Date for Selected (${selected.size})`, 'checkin_selected'], ['Clear Selection', 'select_clear']);
    choices.push(['🔄 Refresh Results', 'refresh'], ['⬅️ Change Filters', 'back']);
    await prompt(bot, chatId, userId, session, text || 'No locations found.', choices);
}

async function search(bot: TelegramBot, chatId: number, userId: number, session: FlowSession, actor: User) {
    const inventory = await accessibleInventory(actor);
    const results = filterLocations(inventory, session.filters);
    await queueLocationActivity(actor, 'Searched SIM Locations', `${describeLocationFilters(session.filters)}. Found ${results.length} accessible number(s).`);
    session.inventory = inventory; session.results = results; session.selected = []; session.page = 0;
    await showResults(bot, chatId, userId, session);
}

async function handleText(bot: TelegramBot, msg: TelegramBot.Message, session: FlowSession) {
    const userId = msg.from!.id, chatId = msg.chat.id, text = msg.text!.trim();
    const actor = await verifyActor(session, msg.from!.username);
    if (session.stage === 'NUMBERS') {
        const entries = await reviewBulkEntries(text, actor);
        session.entries = entries;
        const valid = entries.filter(entry => entry.number);
        await sendText(bot, chatId, `${valid.length} valid; ${entries.length - valid.length} invalid, duplicate or unavailable.\n` + entries.filter(entry => entry.issue).map(entry => `${entry.mobile}: ${entry.issue}`).join('\n'));
        if (!valid.length) { await prompt(bot, chatId, userId, session, 'No valid numbers available. Enter the numbers again.'); return; }
        if (session.kind === 'ownership') {
            session.stage = 'OWNERSHIP';
            await prompt(bot, chatId, userId, session, 'Choose new ownership:', [['Individual', 'own_Individual'], ['Partnership', 'own_Partnership'], ['⬅️ Enter Numbers Again', 'back']]);
        } else if (session.kind === 'status') {
            session.stage = 'STATUS';
            await prompt(bot, chatId, userId, session, 'Choose the new RTP status:', [['RTP', 'status_RTP'], ['Non-RTP', 'status_Non-RTP'], ['⬅️ Enter Numbers Again', 'back']]);
        } else {
            session.stage = 'CHECKIN_DATE';
            await prompt(bot, chatId, userId, session, 'Enter the new check-in date (DD/MM/YYYY or YYYY-MM-DD, IST). It replaces the existing check-in date for every valid number.', [['Use Today', 'today'], ['⬅️ Enter Numbers Again', 'back']]);
        }
    } else if (session.stage === 'PARTNER') {
        session.change = { kind: 'ownership', ownershipType: 'Partnership', partnerName: text };
        await confirmPrompt(bot, chatId, userId, session);
    } else if (session.stage === 'RTP_DATE' || session.stage === 'CHECKIN_DATE') {
        const date = inventoryDateFromInput(session.stage === 'CHECKIN_DATE' && text.toLowerCase() === 'today' ? indiaDay(new Date())! : text);
        if (!date) throw new Error('Invalid calendar date. Use DD/MM/YYYY or YYYY-MM-DD.');
        const change: BulkChange = session.stage === 'RTP_DATE' ? { kind: 'status', status: 'Non-RTP', date } : { kind: 'checkin', date };
        validateBulkChange(change); session.change = change;
        await confirmPrompt(bot, chatId, userId, session);
    } else if (session.stage === 'LOCATION_SEARCH') {
        session.filters.search = text === '*' ? '' : text;
        session.stage = 'MOBILE_SEARCH';
        await prompt(bot, chatId, userId, session, 'Optional mobile number search: enter all or part of the mobile number, or * for all numbers.', [['All Numbers', 'mobile_all'], ['⬅️ Change Filters', 'back']]);
    } else if (session.stage === 'MOBILE_SEARCH') {
        if (text !== '*' && !/^\d{1,10}$/.test(text)) throw new Error('Enter 1–10 digits for mobile search, or * for all.');
        session.filters.mobile = text === '*' ? '' : text;
        await search(bot, chatId, userId, session, actor);
    } else if (session.stage === 'SELECT_INPUT') {
        const entries = analyzeNumberEntries(text, session.results);
        session.selected = [...new Set([...session.selected, ...entries.flatMap(entry => entry.number ? [entry.number.id] : [])])];
        await sendText(bot, chatId, entries.map(entry => `${entry.mobile}: ${entry.issue || 'Selected'}`).join('\n') || 'No numbers entered.');
        await showResults(bot, chatId, userId, session);
    } else await bot.sendMessage(chatId, 'Use the buttons on your latest flow message, or /cancel.');
}

async function handleButton(bot: TelegramBot, query: TelegramBot.CallbackQuery, session: FlowSession, action: string) {
    const chatId = query.message!.chat.id, userId = query.from.id;
    const actor = await verifyActor(session, query.from.username);
    if (action === 'back') {
        if (session.kind === 'locations') await typePrompt(bot, chatId, userId, session);
        else await inputPrompt(bot, chatId, userId, session);
    } else if (session.stage === 'OWNERSHIP' && action === 'own_Individual') {
        session.change = { kind: 'ownership', ownershipType: 'Individual', partnerName: '' };
        await confirmPrompt(bot, chatId, userId, session);
    } else if (session.stage === 'OWNERSHIP' && action === 'own_Partnership') {
        session.stage = 'PARTNER';
        await prompt(bot, chatId, userId, session, 'Enter the partner name (1–120 characters).', [['⬅️ Enter Numbers Again', 'back']]);
    } else if (session.stage === 'STATUS' && action === 'status_RTP') {
        session.change = { kind: 'status', status: 'RTP', date: null };
        await confirmPrompt(bot, chatId, userId, session);
    } else if (session.stage === 'STATUS' && action === 'status_Non-RTP') {
        session.stage = 'RTP_DATE';
        await prompt(bot, chatId, userId, session, 'Enter a future scheduled RTP date (DD/MM/YYYY or YYYY-MM-DD, IST).', [['⬅️ Enter Numbers Again', 'back']]);
    } else if (session.stage === 'CHECKIN_DATE' && action === 'today') {
        session.change = { kind: 'checkin', date: inventoryDateFromInput(indiaDay(new Date())!)! };
        await confirmPrompt(bot, chatId, userId, session);
    } else if (session.stage === 'CONFIRM' && action === 'confirm') {
        session.stage = 'SAVING';
        try {
            const updated = await saveBulkChange(actor, session.entries.flatMap(entry => entry.number && buildBulkChange(entry.number, session.change!) ? [entry.number] : []), session.change!, session.operationId);
            clearSession(chatId, key(userId));
            await bot.sendMessage(chatId, `✅ ${updated} number(s) updated. Activities saved and Telegram notifications queued. The dashboard receives the same changes automatically.`);
        } catch (error) {
            session.stage = 'CONFIRM';
            await prompt(bot, chatId, userId, session, `❌ ${error instanceof Error ? error.message : 'Unable to save.'}\nRetry this exact preview or enter the numbers again for a fresh review.`, [['Retry Confirmed Changes', 'confirm'], ['⬅️ Enter Numbers Again', 'back']]);
        }
    } else if (session.stage === 'LOCATION_TYPE' && /^type_(all|Store|Employee|Dealer)$/.test(action)) {
        session.filters.type = action.slice(5); session.inventory = await accessibleInventory(actor);
        session.stage = 'LOCATION_VALUE'; session.page = 0;
        await locationPrompt(bot, chatId, userId, session);
    } else if (session.stage === 'LOCATION_VALUE' && (action === 'location_all' || /^location_\d+$/.test(action))) {
        const locations = uniqueLocations(session);
        const location = action === 'location_all' ? 'all' : locations[Number(action.slice(9))];
        if (!location) throw new Error('Invalid location. Choose from the current buttons.');
        session.filters.location = location; session.stage = 'LOCATION_SEARCH';
        await prompt(bot, chatId, userId, session, 'Enter a location name or part of it to search (case insensitive), or * for all locations.', [['All Location Names', 'search_all'], ['⬅️ Change Filters', 'back']]);
    } else if (session.stage === 'LOCATION_VALUE' && (action === 'locpage_prev' || action === 'locpage_next')) {
        session.page += action.endsWith('next') ? 1 : -1; await locationPrompt(bot, chatId, userId, session);
    } else if (session.stage === 'LOCATION_SEARCH' && action === 'search_all') {
        session.filters.search = ''; session.stage = 'MOBILE_SEARCH';
        await prompt(bot, chatId, userId, session, 'Enter all or part of a mobile number, or choose All Numbers.', [['All Numbers', 'mobile_all'], ['⬅️ Change Filters', 'back']]);
    } else if (session.stage === 'MOBILE_SEARCH' && action === 'mobile_all') {
        session.filters.mobile = ''; await search(bot, chatId, userId, session, actor);
    } else if (session.stage === 'RESULTS') {
        if (/^pick_\d+$/.test(action)) {
            const number = session.results[Number(action.slice(5))];
            if (!number) throw new Error('Invalid selection. Refresh the results.');
            session.selected = session.selected.includes(number.id) ? session.selected.filter(id => id !== number.id) : [...session.selected, number.id];
        } else if (action === 'page_prev' || action === 'page_next') session.page += action.endsWith('next') ? 1 : -1;
        else if (action === 'select_all') session.selected = session.results.map(number => number.id);
        else if (action === 'select_clear') session.selected = [];
        else if (action === 'select_input') {
            session.stage = 'SELECT_INPUT';
            await prompt(bot, chatId, userId, session, 'Enter numbers from these search results separated by commas or new lines. Existing selections are kept.', [['⬅️ Change Filters', 'back']]); return;
        } else if (action === 'refresh') { await search(bot, chatId, userId, session, actor); return; }
        else if (action === 'checkin_selected') {
            const selected = session.results.filter(number => session.selected.includes(number.id));
            if (!selected.length) throw new Error('Select at least one number first.');
            const records = await reviewLocationExport(actor, selected);
            session.kind = 'checkin'; session.stage = 'CHECKIN_DATE';
            session.entries = records.map(number => ({ mobile: number.mobile, issue: '', number }));
            await prompt(bot, chatId, userId, session, 'Enter the replacement check-in date (DD/MM/YYYY or YYYY-MM-DD, IST) for your selected numbers.', [['Use Today', 'today'], ['⬅️ Enter Numbers Again', 'back']]); return;
        }
        else if (action === 'copy_all' || action === 'copy_selected') {
            const previews = action === 'copy_all' ? session.results : session.results.filter(number => session.selected.includes(number.id));
            if (!previews.length) throw new Error('Select at least one number to copy.');
            const records = await reviewLocationExport(actor, previews);
            const text = locationClipboardText(records);
            await queueLocationActivity(actor, 'Copied SIM Locations', `${describeLocationFilters(session.filters)}. Copied ${records.length} number(s):\n${records.map(number => `${number.mobile} — ${number.currentLocation || 'N/A'}`).join('\n')}`);
            await bot.sendMessage(chatId, '📋 Copy the text below, or download the text file. It contains mobile number and current location only.');
            // A file preserves every row (and tabs) for large searches; no page limit.
            await bot.sendDocument(chatId, Buffer.from(text, 'utf8'), {}, { filename: 'sim-locations.txt', contentType: 'text/plain' });
            if (text.length <= 12000) for (const part of splitPlainTelegramText(text)) {
                await bot.sendMessage(chatId, part, { entities: [{ type: 'pre', offset: 0, length: part.length }] });
            }
        } else throw new Error('Use the buttons on your latest results message.');
        await showResults(bot, chatId, userId, session);
    } else throw new Error('This button does not belong to the current step.');
}

function uniqueLocations(session: FlowSession): string[] {
    return [...new Set(session.inventory.filter(number => session.filters.type === 'all' || number.locationType === session.filters.type).map(number => number.currentLocation).filter(Boolean))].sort();
}

async function locationPrompt(bot: TelegramBot, chatId: number, userId: number, session: FlowSession) {
    const locations = uniqueLocations(session);
    const maxPage = Math.max(0, Math.ceil(locations.length / PAGE_SIZE) - 1);
    session.page = Math.min(maxPage, Math.max(0, session.page));
    const offset = session.page * PAGE_SIZE;
    const choices: Choice[] = locations.slice(offset, offset + PAGE_SIZE).map((location, index) => [location, `location_${offset + index}`]);
    if (session.page > 0) choices.push(['⬅️ Previous Locations', 'locpage_prev']);
    if (session.page < maxPage) choices.push(['Next Locations ➡️', 'locpage_next']);
    choices.push(['All Locations', 'location_all'], ['⬅️ Change Filters', 'back']);
    await prompt(bot, chatId, userId, session, 'Select an exact location, or All Locations to search by name.', choices);
}

export function registerBulkActionsFlow(router: CommandRouter) {
    const bot = router.bot;
    const starts: [string, Kind, string][] = [
        ['parity_start_ownership', 'ownership', env.TG_GROUP_INVENTORY || ''],
        ['parity_start_status', 'status', env.TG_GROUP_INVENTORY || ''],
        ['parity_start_checkin', 'checkin', env.TG_GROUP_SIM_LOCATIONS || ''],
        ['parity_start_locations', 'locations', env.TG_GROUP_SIM_LOCATIONS || '']
    ];
    for (const [callback, kind, group] of starts) router.registerCallback(callback, async query => {
        if (query.message) await startFlow(bot, query.message.chat.id, query.from, kind);
    }, [group]);

    bot.on('message', (msg: TelegramBot.Message) => {
        if (!msg.from || !msg.text) return;
        const session = getSession(msg.chat.id, key(msg.from.id)) as FlowSession | undefined;
        if (!session || /^(?:\/start|start)$/i.test(msg.text.trim())) return;
        if (session.busy || session.stage === 'SAVING') return;
        if (/^\/cancel(?:@\w+)?$/i.test(msg.text.trim())) {
            clearSession(msg.chat.id, key(msg.from.id));
            void bot.sendMessage(msg.chat.id, 'Cancelled. No further changes will be submitted.').catch(error => logger.error(error.message)); return;
        }
        session.busy = true; setSession(msg.chat.id, key(msg.from.id), session);
        void handleText(bot, msg, session).catch(error => bot.sendMessage(msg.chat.id, `❌ ${error.message}`))
            .catch(error => logger.error(`Bulk flow reply failed: ${error.message}`)).finally(() => { releaseSession(msg.chat.id, msg.from!.id, session); });
    });
    router.registerCallback(/^parity_[a-f0-9]{12}_/, async query => {
        if (!query.message) return;
        const session = getSession(query.message.chat.id, key(query.from.id)) as FlowSession | undefined;
        const match = /^parity_([a-f0-9]{12})_(.+)$/.exec(query.data || '');
        if (!session || !match || match[1] !== session.token) {
            await bot.answerCallbackQuery(query.id, { text: 'This preview belongs to another user, expired, or was replaced. Use your latest flow message.', show_alert: true }); return;
        }
        if (session.busy || session.stage === 'SAVING') { await bot.answerCallbackQuery(query.id, { text: 'Your previous action is still processing.' }); return; }
        if (match[2] === 'cancel') {
            clearSession(query.message.chat.id, key(query.from.id));
            await bot.sendMessage(query.message.chat.id, 'Cancelled. No further changes will be submitted.'); return;
        }
        session.busy = true; setSession(query.message.chat.id, key(query.from.id), session);
        try { await handleButton(bot, query, session, match[2]); }
        catch (error) { await bot.sendMessage(query.message.chat.id, `❌ ${error instanceof Error ? error.message : 'Unable to process this action.'}`); }
        finally { releaseSession(query.message.chat.id, query.from.id, session); }
    }, [...new Set(starts.map(([, , group]) => group))]);
}
