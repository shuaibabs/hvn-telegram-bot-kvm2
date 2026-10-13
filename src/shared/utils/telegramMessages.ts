import type TelegramBot from 'node-telegram-bot-api';

type Message = { text: string; entities: TelegramBot.MessageEntity[] };

/** For untrusted user fields and copy exports: no markup is interpreted. */
export function splitPlainTelegramText(text: string): string[] {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + 4000, text.length);
        if (end < text.length) {
            const newline = text.lastIndexOf('\n', end - 1);
            if (newline >= start + 2000) end = newline + 1;
            const code = text.charCodeAt(end - 1);
            if (code >= 0xD800 && code <= 0xDBFF) end--;
        }
        chunks.push(text.slice(start, end));
        start = end;
    }
    return chunks;
}

function parseMessage(message: string): Message {
    let text = '';
    let position = 0;
    const entities: TelegramBot.MessageEntity[] = [];
    const pattern = /\*\*([\s\S]+?)\*\*|`([^`\n]+)`/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(message))) {
        text += message.slice(position, match.index);
        const content = match[1] ?? match[2];
        entities.push({ type: match[1] !== undefined ? 'bold' : 'code', offset: text.length, length: content.length });
        text += content;
        position = pattern.lastIndex;
    }
    return { text: text + message.slice(position), entities };
}

/** Split rendered text, preserving Unicode and formatting, with room for each master header. */
export function splitTelegramMessage(message: string, prefix = ''): Message[] {
    const body = parseMessage(message);
    const header = parseMessage(prefix);
    const limit = 4000 - header.text.length;
    if (limit < 2) throw new Error('Telegram message prefix is too long');
    const chunks: Message[] = [];
    let start = 0;
    while (start < body.text.length) {
        let end = Math.min(start + limit, body.text.length);
        if (end < body.text.length) {
            const newline = body.text.lastIndexOf('\n', end - 1);
            if (newline >= start + limit / 2) end = newline + 1;
            // Never separate the two UTF-16 code units of an emoji.
            const code = body.text.charCodeAt(end - 1);
            if (code >= 0xD800 && code <= 0xDBFF) end--;
        }
        const entities = header.entities.map(entity => ({ ...entity }));
        for (const entity of body.entities) {
            const from = Math.max(start, entity.offset);
            const to = Math.min(end, entity.offset + entity.length);
            if (to > from) entities.push({ ...entity, offset: header.text.length + from - start, length: to - from });
        }
        chunks.push({ text: header.text + body.text.slice(start, end), entities });
        start = end;
    }
    return chunks;
}
