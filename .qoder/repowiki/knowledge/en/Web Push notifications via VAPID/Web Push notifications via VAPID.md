---
kind: external_dependency
name: Web Push notifications via VAPID
slug: web-push-vapid
category: external_dependency
category_hints:
    - sdk_real_api
    - auth_protocol
scope:
    - '**'
---

- Browser push notifications are sent using the `web-push` npm package with a self-generated VAPID keypair — no third-party push provider is used; the browser's own push services (FCM for Chrome/Android, Apple's for Safari/iOS) deliver messages.
- VAPID keys are configured via `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` environment variables; if either key is missing the push subsystem disables itself gracefully and logs once, so the app still works without push.
- The subject must be a valid `mailto:` or `https:` URI (Apple's push service rejects invalid subjects); default is `mailto:noreply@yukselenzeka.com`.
- Client subscribes through the standard PushManager and exchanges base64url-encoded VAPID public keys with the server; rotation of the private key invalidates every stored subscription so clients must re-subscribe.
- Verify exact subscribe/unsubscribe flow against the `web-push` docs.