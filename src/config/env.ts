
import dotenv from 'dotenv';
import { z } from 'zod';
// logger not imported here to avoid circular dependency since logger calls dotenv.config() and might depend on env

dotenv.config();

const envSchema = z.object({
    TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
    PORT: z.string().default('3000'),
    NOTIFY_API_KEY: z.string().default('hvn-default-secure-key-2024'), // Shared secret between UI and Bot
    ENABLE_SERVER: z.string().default('true'),

    // Firebase Service Account Key
    FIREBASE_SERVICE_ACCOUNT_KEY: z.string().min(1, 'FIREBASE_SERVICE_ACCOUNT_KEY is required'),

    // Telegram Group IDs
    TG_GROUP_INVENTORY: z.string().optional(),
    TG_GROUP_SALES: z.string().optional(),
    TG_GROUP_ACTIVITY: z.string().optional(),
    TG_GROUP_USERS: z.string().optional(),
    TG_GROUP_PREBOOKING: z.string().optional(),
    TG_GROUP_GLOBAL_HISTORY: z.string().optional(),
    TG_GROUP_PARTNERS: z.string().optional(),
    TG_GROUP_POSTPAID_NUMBERS: z.string().optional(),
    TG_GROUP_SIM_LOCATIONS: z.string().optional(),
    TG_GROUP_DEALER_PURCHASES: z.string().optional(),
    TG_GROUP_BASIC_PREMIUM_NUMBERS: z.string().optional(),
    TG_GROUP_WORK_REMINDERS: z.string().optional(),
    TG_GROUP_COCP: z.string().optional(),
    TG_GROUP_DELETED_NUMBERS: z.string().optional(),
    TG_GROUP_CATEGORIES: z.string().optional(),
    TG_MASTER_CHANNEL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error('❌ Environment Variable validation failed:', parsed.error.format());
    process.exit(1);
}

export const env = parsed.data;

export const GROUPS = {
    INVENTORY: env.TG_GROUP_INVENTORY || '',
    SALES: env.TG_GROUP_SALES || '',
    ACTIVITY: env.TG_GROUP_ACTIVITY || '',
    USERS: env.TG_GROUP_USERS || '',
    PREBOOKING: env.TG_GROUP_PREBOOKING || '',
    GLOBAL_HISTORY: env.TG_GROUP_GLOBAL_HISTORY || '',
    PARTNERS: env.TG_GROUP_PARTNERS || '',
    POSTPAID_NUMBERS: env.TG_GROUP_POSTPAID_NUMBERS || '',
    SIM_LOCATIONS: env.TG_GROUP_SIM_LOCATIONS || '',
    DEALER_PURCHASES: env.TG_GROUP_DEALER_PURCHASES || '',
    BASIC_PREMIUM_NUMBERS: env.TG_GROUP_BASIC_PREMIUM_NUMBERS || '',
    WORK_REMINDERS: env.TG_GROUP_WORK_REMINDERS || '',
    COCP: env.TG_GROUP_COCP || '',
    DELETED_NUMBERS: env.TG_GROUP_DELETED_NUMBERS || '',
    CATEGORIES: env.TG_GROUP_CATEGORIES || '',
    MASTER_CHANNEL: env.TG_MASTER_CHANNEL || '',
};

export type GroupName = keyof typeof GROUPS;

