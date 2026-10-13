// Kept in sync with the dashboard's src/lib/system-reminders.ts.
// This module has no Firebase dependency so both clients use the same date rules.
type DateValue = Date | { toDate(): Date } | string | number | null | undefined;

export function reminderDate(value: DateValue): Date | null {
    if (value === null || value === undefined) return null;
    const date = value instanceof Date ? value
        : typeof value === 'object' ? value.toDate() : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

const indiaDayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
});

export function indiaDay(value: DateValue): string | null {
    const date = reminderDate(value);
    if (!date) return null;
    const parts = indiaDayFormatter.formatToParts(date);
    return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}

export function isReminderDue(value: DateValue, now = new Date()): boolean {
    const day = indiaDay(value);
    return day !== null && day <= indiaDay(now)!;
}

export function formatReminderDate(value: DateValue): string {
    return reminderDate(value)?.toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric'
    }) || 'N/A';
}

export const custodyTasks = [
    { prefix: 'cocp-safecustody-', field: 'safeCustodyDate', label: 'Safe Custody' },
    { prefix: 'cocp-unsafecustody-', field: 'unsafeCustodyDate', label: 'Unsafe Custody' }
] as const;
export const checkInTask = { prefix: 'sim-checkin-', field: 'checkInDate', label: 'Check-In' } as const;

type CustodyNumber = {
    id: string; mobile: string; numberType: string;
    safeCustodyDate?: DateValue; unsafeCustodyDate?: DateValue;
    checkInDate?: DateValue; accountName?: string; assignedTo?: string;
};
type Prebooking = { id: string; mobile: string; originalNumberData: Omit<CustodyNumber, 'id'> & { status?: string } };
type ExistingReminder = {
    id: string; taskId?: string; taskName: string; dueDate: DateValue;
    status: string; assignedTo: string[];
    accountName?: string; mobile?: string; numberId?: string;
};
type ReminderData = {
    taskId: string; taskName: string; dueDate: DateValue;
    assignedTo: string[]; status: 'Pending' | 'Done';
    accountName: string; mobile: string; numberId: string;
};

export function planSystemReminders(
    numbers: CustodyNumber[], prebookings: Prebooking[], reminders: ExistingReminder[],
    admins: string[], now = new Date()
) {
    const desired = new Map<string, Omit<ReminderData, 'status' | 'assignedTo'> & { recipients?: string[] }>();
    const allNumbers = [...numbers, ...prebookings.map(pb => ({ ...pb.originalNumberData, id: pb.id, mobile: pb.mobile }))];
    for (const number of allNumbers) {
        if (number.numberType !== 'COCP') continue;
        for (const task of custodyTasks) {
            const dueDate = number[task.field];
            if (!isReminderDue(dueDate, now)) continue;
            const taskId = task.prefix + number.id;
            desired.set(taskId, { taskId, taskName: `${task.label} Date arrived for ${number.mobile}`, dueDate,
                accountName: number.accountName?.trim() || 'N/A', mobile: number.mobile, numberId: number.id });
        }
    }
    for (const number of numbers) {
        if (!isReminderDue(number.checkInDate, now)) continue;
        const taskId = checkInTask.prefix + number.id;
        const recipients = [...new Set([...admins, ...(number.assignedTo && number.assignedTo !== 'Unassigned' ? [number.assignedTo] : [])])];
        desired.set(taskId, { taskId, taskName: `Check-In Date arrived for ${number.mobile}`, dueDate: number.checkInDate,
            accountName: number.accountName?.trim() || 'N/A', mobile: number.mobile, numberId: number.id, recipients });
    }
    for (const pb of prebookings) {
        if (pb.originalNumberData?.status !== 'RTP') continue;
        const taskId = `prebooked-rtp-${pb.id}`;
        desired.set(taskId, { taskId, taskName: `Pre-Booked Number is now RTP: ${pb.mobile}`, dueDate: now,
            accountName: pb.originalNumberData.accountName?.trim() || 'N/A', mobile: pb.mobile, numberId: pb.id });
    }

    const existing = new Map<string, ExistingReminder[]>();
    for (const reminder of reminders) {
        if (!reminder.taskId || !(custodyTasks.some(t => reminder.taskId!.startsWith(t.prefix)) || reminder.taskId.startsWith(checkInTask.prefix) || reminder.taskId.startsWith('prebooked-rtp-'))) continue;
        const group = existing.get(reminder.taskId) || [];
        group.push(reminder);
        existing.set(reminder.taskId, group);
    }

    const creates: { id: string; data: ReminderData }[] = [];
    const updates: { id: string; data: Partial<ReminderData> }[] = [];
    for (const [taskId, task] of desired) {
        const { recipients, ...taskData } = task;
        const group = existing.get(taskId) || [];
        // Reuse legacy auto-ID documents; new documents use the task ID to prevent duplicates.
        const current = group.find(r => r.status === 'Pending') || group[0];
        if (!current) {
            const assignedTo = recipients || admins;
            if (assignedTo.length) creates.push({ id: taskId, data: { ...taskData, assignedTo, status: 'Pending' } });
        } else {
            const isRecurringDate = taskId.startsWith('cocp-') || taskId.startsWith(checkInTask.prefix);
            const dateChanged = isRecurringDate && indiaDay(current.dueDate) !== indiaDay(task.dueDate);
            const dueDate = isRecurringDate ? task.dueDate : current.dueDate;
            if (dateChanged || current.taskName !== task.taskName ||
                current.accountName !== task.accountName || current.mobile !== task.mobile || current.numberId !== task.numberId ||
                (recipients && JSON.stringify([...current.assignedTo].sort()) !== JSON.stringify([...recipients].sort())) ||
                (current.status === 'Pending' && reminderDate(current.dueDate)?.getTime() !== reminderDate(dueDate)?.getTime())) {
                updates.push({ id: current.id, data: {
                    taskName: task.taskName, dueDate, accountName: task.accountName, mobile: task.mobile, numberId: task.numberId,
                    ...(recipients ? { assignedTo: recipients } : {}),
                    status: dateChanged ? 'Pending' : current.status as 'Pending' | 'Done'
                } });
            }
            for (const duplicate of group) {
                if (duplicate.id !== current.id && duplicate.status === 'Pending') {
                    updates.push({ id: duplicate.id, data: { status: 'Done' } });
                }
            }
        }
        existing.delete(taskId);
    }
    // A future/removed custody date, sold number, or removed prebooking resolves its old task.
    for (const group of existing.values()) {
        for (const reminder of group) {
            if (reminder.status === 'Pending') updates.push({ id: reminder.id, data: { status: 'Done' } });
        }
    }
    return { creates, updates };
}

export function reminderAccountName(
    reminder: { accountName?: string; mobile?: string; taskName: string; numberId?: string; taskId?: string },
    numbers: { id: string; mobile: string; accountName?: string }[],
    prebookings: { id: string; mobile: string; originalNumberData?: { accountName?: string } }[] = []
): string {
    const mobile = reminder.mobile || reminder.taskName.match(/\b\d{10}\b/)?.[0];
    const prefix = [...custodyTasks, checkInTask, { prefix: 'prebooked-rtp-' }]
        .find(task => reminder.taskId?.startsWith(task.prefix))?.prefix;
    const numberId = reminder.numberId || (prefix ? reminder.taskId?.slice(prefix.length) : undefined);
    const number = numbers.find(number => number.id === numberId || (mobile && number.mobile === mobile));
    const prebooking = prebookings.find(pb => pb.id === numberId || (mobile && pb.mobile === mobile));
    return (number ? number.accountName : prebooking ? prebooking.originalNumberData?.accountName : reminder.accountName)?.trim() || 'N/A';
}
