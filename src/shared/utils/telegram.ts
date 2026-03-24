
/**
 * Utilities for Telegram message formatting and sanitization.
 */

/**
 * Escapes characters that break Legacy Markdown (V1).
 * Specifically addresses: _, *, [
 */
export function escapeMarkdown(text: string): string {
    if (!text) return '';
    // Legacy Markdown (V1) only needs to escape _, *, [
    // We escape them with a backslash.
    return text.replace(/[_*\[]/g, '\\$&');
}

/**
 * Format timestamp for consistent logging.
 */
export function formatTime(date: Date = new Date()): string {
    return date.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
}

/**
 * Common response templates.
 */
export const RESPONSES = {
    ERROR: (msg: string) => `❌ **Error:** ${msg}`,
    SUCCESS: (msg: string) => `✅ **Success:** ${msg}`,
    WARNING: (msg: string) => `⚠️ **Warning:** ${msg}`,
    LOADING: `⏳ **Processing request...**`,
};

