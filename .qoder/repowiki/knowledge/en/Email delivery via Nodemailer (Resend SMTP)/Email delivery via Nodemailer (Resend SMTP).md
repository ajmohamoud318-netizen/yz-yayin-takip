---
kind: external_dependency
name: Email delivery via Nodemailer (Resend SMTP)
slug: nodemailer-resend-smtp
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
---

- Invitation emails and future stage-change notifications are sent through Nodemailer; when `SMTP_HOST` is set the transport connects to an SMTP server (default example points to `smtp.resend.com` with a Resend API key), otherwise Nodemailer's built-in `jsonTransport` renders the email to the server log for local dev / CI.
- Credentials are read from `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`; the invite link base URL is `INVITE_BASE_URL`.
- The mailer is wrapped in `server/src/services/mail.js` so callers never import Nodemailer directly.