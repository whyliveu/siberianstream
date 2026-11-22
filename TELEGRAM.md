# Telegram reminders

Bot: https://t.me/mashkasad_streambot . Website: https://whyliveu.github.io/siberianstream/ .

## Activate (one secret, no terminal)

1. Cloudflare dashboard → Workers & Pages → `siberianstream` → Settings → Variables and Secrets → Add.
2. Select **Secret**, name `TELEGRAM_BOT_TOKEN`, value the token supplied by BotFather. Deploy the change. Do not put the token into a GitHub file, a public message, or a URL.
3. The next minute's scheduled task checks the bot username, installs the authenticated Telegram webhook and publishes its commands automatically. The SQLite-backed Durable Object is provisioned by the Wrangler migration; no separate database setup is needed.
4. Check `https://siberianstream.7marias5.workers.dev/api/telegram/health`: expect `ready:true` and `username:mashkasad_streambot`. False means not configured; a wrong token or a token for a different bot will never report ready.
5. Open the bot and press Start. Confirm a real welcome message, then `/stop`, then Start again. Only after this check replace the website's disabled Telegram placeholder with `https://t.me/mashkasad_streambot?start=sibirskiy-strim-2026-11-27`.

## Profile and message design

Display name: **Сибирский стрим 27nov**. The bot sets its name, empty-chat welcome description, short profile description and generated star avatar automatically through Telegram Bot API. Profile setup is versioned to avoid reuploading the same image on every poll. The avatar is loaded from the local static-assets binding and uploaded as a JPEG multipart attachment; secrets stay in Cloudflare. The same star is used as the site favicon.

Messages use simple HTML emphasis, paragraphs and a clickable DonationAlerts link. A separate support button appears in the post-Start welcome. No broadcast is sent merely because the copy changed; existing subscribers retain their subscription and delivery ledger.

## Behaviour

- Only authenticated private Telegram updates are processed. An incoming public HTTP request cannot subscribe an arbitrary chat.
- `/start` subscribes the current chat. Welcome explains the date, day-before and hour-before reminders, messages and opt-out. No Telegram username, phone number or message history is stored.
- At 26 November 2026, 17:00 Moscow time (14:00 UTC), existing subscribers become eligible for the day-before reminder. The minute-based scheduler may deliver it slightly after that time. Late subscribers do not receive a misleading day-before message.
- At 27 November 2026, 16:00 Moscow time (13:00 UTC), subscribers registered before that deadline become eligible for the hour-before reminder. Existing subscriber records without an hour ledger field are supported. Late arrivals receive the remaining messages only. Day-before catch-up stops at midnight so the bot never says tomorrow on the event day.
- On the real start, update and publish `dist/status.json` to `{"state":"live","joinUrl":"https://meet.google.com/abc-defg-hij"}` with the real room code. The bot reads the **published GitHub Pages** status, the same state as the invitation. It does not announce a start based only on the clock. Allow publication time plus up to one minute for detection.
- With `state:ended` no reminders are sent. New arrivals receive the ended notice. If the status cannot be verified, broadcast waits for a later poll.
- `/stop` removes the subscription. A one-day update-ID tombstone prevents an old retried Start from reversing the opt-out. Duplicate deliveries of known updates are ignored.
- Broadcast is batched into 15 messages per pass, continuing through durable alarms. Telegram 429 and explicit API errors are retried; blocked chats are removed.
- Telegram sendMessage has no idempotency key. Accepted messages are recorded; sends with an ambiguous timeout or a process interruption after the send claim are **not automatically resent** to avoid duplicates. Such deliveries can be missed. Inspect `day`/`hour`/`live` states (`pending`, `sending`, `sent`, `uncertain`) when investigating. This is not an exactly-once delivery guarantee.
- Subscriber data is deleted ten days after the event start. Commands support this one event; the bot can be repurposed by changing the event definition and copy later.

## Hosting and costs

The existing Cloudflare Worker serves the bot API alongside the static files. Only `/api/telegram/*` runs before asset routing; the GitHub Pages site stays static. State and the send ledger are stored in a SQLite-backed Durable Object, available on Workers Free. One cron per minute is used. Up to 1,000 subscriptions are accepted; this event expects fewer than 100. Do not promise capacity beyond the platform's free limits.

Configuration in `wrangler.jsonc` contains public settings only. `WEBHOOK_URL` stays on the existing Worker hostname, which Telegram accesses directly; a visitor does not need to open that hostname to use the bot. After connecting a personal domain update `SITE_URL` if desired. If changing `STATUS_URL`, retain the same state source as the invitation.

## Checks

`node --test tests/bot.test.mjs` runs meaningful mocked integration tests without any credentials or real Telegram messages. They cover webhook authentication, consent, retries, duplicate/out-of-order updates, reminder boundaries, real-start checks, late subscription, blocked/failed sends, batching, opt-out and expiry. A real Start/Stop test remains required after activation.
