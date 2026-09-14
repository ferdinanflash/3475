# 3475 Transfer Portal — V5 Upgrade

## What changed

1. **Atomic quota protection**
   - Guest submissions now use `submit_transfer_application()`.
   - Admin acceptance uses `accept_transfer_application()`.
   - Both lock `system_settings.id = 1`, preventing the last slot from being consumed twice by simultaneous requests.

2. **Notification permission timing**
   - Browser permission is requested when the guest checks **Get Notification?**, while the action still has user interaction context.
   - Submission no longer waits until after the database request to ask for permission.

3. **PWA cache/versioning**
   - Service-worker cache version is now `2026-09-14-1`.
   - JavaScript/CSS assets use explicit versions so updated deployments are picked up cleanly.

4. **Secure recovery**
   - Each application receives a private 8-character recovery code.
   - Recovery requires **Application ID + Recovery Code**.
   - The recovery check is performed through a server-side RPC instead of a direct ID-only lookup.
   - The device keeps at most 20 tracked applications.

5. **Android/PWA notification UX**
   - Notification clicks focus the existing portal and open **My Application Status**.
   - If the portal is not open, the notification opens the portal with the application context.

6. **Cleaner frontend structure**
   - Inline `<style>` blocks were moved from `index.html` to `portal.css`.
   - Inline bootstrap/submission JavaScript was moved to `portal.js`.
   - `index.html` now references versioned external CSS/JS assets.

7. **ENG / CN / ID**
   - Added a presentation-only language layer.
   - Business logic, Supabase calls, database status values, and realtime channel logic do not depend on the selected language.
   - Language preference is stored in `localStorage`.
   - Static UI, placeholders, status labels, admin actions, recovery UI, confirmations, and notifications are translated.

## Required Supabase step

Before deploying the new frontend, run **`migration_2026-09-14.sql`** in the Supabase SQL Editor.

The migration adds the recovery-code column and creates the three RPC functions required by the new frontend.

## Deployment

Upload the contents of this `3475-main` folder to the web host/GitHub Pages as usual.

After deployment, if an old PWA still shows the previous UI, fully close the installed PWA/browser tab once and reopen it so the new service worker can activate.

## Important security note

The recovery code improves recovery privacy, but realtime visibility still depends on the existing Supabase RLS/Realtime policies for `player_transfers`. Review those policies separately if the public table currently allows broad anonymous SELECT access.
