import express, { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { broadcast } from '../../features/broadcast/broadcastService';
import TelegramBot from 'node-telegram-bot-api';
import { logger } from '../logger/logger';
import { db, auth } from '../../config/firebase';
import { deleteUser } from '../../features/users/userService';

const NotifySchema = z.object({
    groupName: z.string().optional(),
    action: z.string().min(1, 'Action is required'),
    employeeName: z.string().min(1, 'Employee name is required'),
    description: z.string().min(1, 'Description is required'),
    source: z.enum(['UI', 'BOT']).default('UI'),
});

const DeleteUserSchema = z.object({
    userId: z.string().min(1, 'User ID is required'),
});

/**
 * Limit incoming requests to 100 per 15 minutes per IP to prevent DDoS.
 */
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

/**
 * Middleware for authentication between UI and Bot using X-API-Key.
 */
const apiKeyGuard = (req: Request, res: Response, next: NextFunction) => {
    const incomingKey = req.headers['x-api-key'];
    if (incomingKey !== env.NOTIFY_API_KEY) {
        logger.warn(`[SECURITY] Unauthorized API access attempt from IP: ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }
    next();
};

export function startServer(bot: TelegramBot) {
    const app = express();

    // Apply Security Middlewares
    app.use(helmet());
    app.use(cors()); // Enable CORS for UI App access
    app.use(express.json({ limit: '10kb' })); // Limit body size to prevent memory-filling attacks
    app.use(limiter);

    // Health check (Publicly accessible but rate-limited)
    app.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.floor(process.uptime()) }));

    // Secure API Notification Endpoint
    app.post('/api/notify', apiKeyGuard, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parseResult = NotifySchema.safeParse(req.body);

            if (!parseResult.success) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: parseResult.error.format()
                });
            }

            const { groupName, action, employeeName, description, source } = parseResult.data;
            const { escapeMarkdown } = await import('../../shared/utils/telegram');

            // Format message consistently and escape for Markdown
            const escapedAction = escapeMarkdown(action);
            const escapedEmployee = escapeMarkdown(employeeName);
            const escapedDesc = escapeMarkdown(description);

            const message = `**Action:** ${escapedAction}\n**Performed By:** ${escapedEmployee}\n**Details:** ${escapedDesc}`;

            // Route to correct group if not provided (though UI sends it)
            const userActions = ['Updated User', 'Deleted User', 'Added User'];
            const targetGroup = groupName || (userActions.includes(action) ? 'USERS' : 'ACTIVITY');

            const result = await broadcast(targetGroup, message, source);

            if (result.success) {
                return res.status(200).json({ success: true });
            } else {
                return res.status(500).json({ error: result.error });
            }
        } catch (error) {
            next(error); // Forward to global error handler
        }
    });

    // Secure Admin Delete User Endpoint
    app.post('/api/admin/delete-user', apiKeyGuard, async (req: Request, res: Response, next: NextFunction) => {
        try {
            const parseResult = DeleteUserSchema.safeParse(req.body);

            if (!parseResult.success) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: parseResult.error.format()
                });
            }

            const { userId } = parseResult.data;

            try {
                // Get user details before deletion for the notification message
                const userSnapshot = await db.collection('users').doc(userId).get();
                const userData = userSnapshot.data();
                const userName = userData?.displayName || userData?.email || 'Unknown User';

                await deleteUser(userId);

                // Log Activity to Firestore with source: 'BOT'
                const activityDescription = `Deleted the user account for ${userName} (${userData?.email || 'No email'}).`;
                await db.collection('activities').add({
                    employeeName: 'System (Bot)',
                    action: 'Deleted User',
                    description: activityDescription,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    createdBy: 'BOT_SERVER',
                    source: 'BOT',
                    groupName: 'USERS'
                });

                // Broadcast the deletion
                await broadcast(
                    'USERS',
                    `🗑️ **User Account Deleted**\n\n**Action:** Deleted User\n**Performed By:** System (Bot)\n**Details:** ${activityDescription}`,
                    'UI' // Pass UI to trigger broadcast (broadcast service usually filters by source)
                );

                return res.status(200).json({ success: true });
            } catch (error: any) {
                logger.error(`[ADMIN ERROR]: Failed to delete user ${userId}: ${error.message}`);
                return res.status(500).json({ error: error.message });
            }
        } catch (error) {
            next(error);
        }
    });

    // Global Error Handler (Prevents stack trace leaks)
    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
        logger.error(`[CRITICAL ERROR]: ${err.message}`);
        res.status(500).json({ error: 'Internal Server Security Incident tracked.' });
    });

    const PORT = env.PORT;
    app.listen(PORT, () => {
        logger.info(`🚀 [SHIELDED] Notification server active on Port ${PORT}`);
    });

    return app;
}
