/**
 * SessionManager
 * ---------------------------------------------------------------------------
 * Tracks the multi-step conversation state for each user and each flow.
 * Keyed by Telegram userId (number) and flow name (string).
 *
 * Sessions auto-expire after SESSION_TIMEOUT_MS of inactivity so stale
 * flows do not block users who abandoned a flow mid-way.
 */
import { logger } from '../logger/logger';

export interface Session {
    /** Sub-step within the flow, e.g. 'awaiting_email' */
    stage?: string;
    /** Accumulated data collected across steps */
    [key: string]: any;
    /** Internal: timer handle for auto-expiry */
    _timer?: ReturnType<typeof setTimeout>;
}

const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

const sessions = new Map<number, Map<string, Session>>();

/** Start or overwrite a session for a user in a specific flow */
export function setSession(userId: number, flow: string, session: Omit<Session, '_timer'>): void {
    clearSession(userId, flow); // clear any existing timer first

    const timer = setTimeout(() => {
        if (sessions.has(userId)) {
            sessions.get(userId)!.delete(flow);
            if (sessions.get(userId)!.size === 0) {
                sessions.delete(userId);
            }
        }
        logger.info(`🗑️  [SessionManager] Session expired for user ${userId} in flow ${flow}`);
    }, SESSION_TIMEOUT_MS);

    if (!sessions.has(userId)) {
        sessions.set(userId, new Map());
    }
    const newSession: Session = {
        ...session,
        _timer: timer
    };
    sessions.get(userId)!.set(flow, newSession);
}

/** Get the current session for a user in a specific flow, or undefined if none exists */
export function getSession(userId: number, flow: string): Session | undefined {
    return sessions.get(userId)?.get(flow);
}

/** Remove a session (flow completed or cancelled) */
export function clearSession(userId: number, flow: string): void {
    const session = sessions.get(userId)?.get(flow);
    if (session?._timer) clearTimeout(session._timer);
    if (sessions.has(userId)) {
        sessions.get(userId)!.delete(flow);
        if (sessions.get(userId)!.size === 0) {
            sessions.delete(userId);
        }
    }
}

/** Check whether a user is currently inside a specific flow */
export function hasSession(userId: number, flow: string): boolean {
    return sessions.get(userId)?.has(flow) ?? false;
}

/** Check whether a user is currently inside ANY active flow */
export function hasAnySession(userId: number): boolean {
    return (sessions.get(userId)?.size ?? 0) > 0;
}
