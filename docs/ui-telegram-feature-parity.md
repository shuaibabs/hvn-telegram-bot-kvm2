# UI and Telegram workflows

Both applications use the same `numbers`, `reminders`, and `activities` collections. No data migration or additional Firestore rules are needed for these bot features. The bot uses Firebase Admin SDK; the complete client rules remain in the UI project's `firestore-deployment/firestore.rules`.

| Dashboard feature | Telegram entry point |
| --- | --- |
| Change selected numbers between Individual and Partnership | Inventory → Bulk Ownership Change → enter numbers → choose ownership → partner name if applicable → review → confirm |
| Bulk RTP / Non-RTP status | Inventory → Bulk Status Change → enter numbers → choose status → future RTP date for Non-RTP → review → confirm |
| Existing Update Status → RTP option | Routes into the same validated bulk status workflow |
| Replace check-in dates for multiple numbers | SIM Locations → Bulk Check-In Date → enter numbers → chosen date → review → confirm |
| Location type, exact location, location-name and mobile search | SIM Locations → Search / Select / Copy Locations → choose filters → results |
| Select records across pages and copy all/selected results | Results → select rows, select all, or enter mobile numbers → Copy All Results / Copy Selected |
| Set dates on selected location results | Results → select rows → Set Check-In Date for Selected → chosen date → review → confirm |
| Account names and due-date reminders | Existing Reminders menu, queued reminder notifications and daily summaries use the same reminder records as the dashboard |

Number input accepts commas and newlines, requires exactly ten digits, and reports invalid input, repeated entries, ambiguous duplicate inventory records, and unavailable records. Missing/sold/pre-booked/unassigned numbers are unavailable for these inventory actions. No other employee's inventory is disclosed. Admins can access all inventory; employees can access their assigned numbers. Individual ownership clears the partner name; Partnership requires 1–120 characters. Unchanged records are skipped.

Telegram date input accepts `DD/MM/YYYY` or `YYYY-MM-DD`, rejects impossible calendar dates, and stores midnight in Asia/Kolkata. Non-RTP requires a future RTP date. RTP clears its scheduled date. Check-in replaces the existing check-in date; it does not add a separate date field. Both the server monitor and dashboard check arrived RTP dates using transactions, with one history/activity record per committed conversion. The server performs this check without an open browser.

Search results preserve selections across pages. Copy exports contain only mobile number, a tab, and current location, with one number per line. Telegram cannot modify a user's device clipboard directly: the bot sends copyable text and a complete UTF-8 `sim-locations.txt` file. Large exports use the complete file; small exports also appear as copyable messages. Access and location values are rechecked before export; changed results require refreshing. Searches, copies, bulk changes, and automatic conversions create Activities records and queued notifications for the feature group and master channel.

The new workflows have separate sessions for each chat and Telegram user. Each prompt gets a new short button token. Other users, another chat, expired sessions, and replaced prompts cannot submit a preview. Sessions expire after ten minutes; use `/cancel` or Cancel / Close to exit. A processing lock prevents double clicks or competing text steps. Legacy group-wide workflows must finish before these sessions start, and cannot start while these scoped sessions are open. The two feature menus and additional scoped users remain available.

Before each operation, the bot resolves a unique Telegram username to a complete registered profile. Each update transaction rereads the profile, number, assignment and changed fields. Number changes, histories and activity/notification queue records commit together in chunks of forty. If a later chunk fails, the reply reports saved progress. Retrying the same confirmed operation resumes committed chunks without creating their histories or activities again. A changed preview must be reviewed again.

Build and restart the bot to activate its menus and monitor; rebuild/deploy the UI transaction change too. No production bot, database mutation, or live Telegram send is executed by automated verification. Tests use mocked Firestore and Telegram, and cover identity/access checks, stale previews, session isolation, cancellation, repeated confirmation, partial progress, exports, and automatic date conversion. Publish the separately supplied Firestore rules if they have not already been installed; no rule changes are required for this parity update.
