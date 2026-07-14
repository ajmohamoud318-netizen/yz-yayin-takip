/**
 * Mail service.
 *
 * Wraps nodemailer so the rest of the server never imports it directly.
 *
 * Behaviour:
 *   • If SMTP_HOST is configured, uses real SMTP.
 *   • Otherwise, uses nodemailer's `jsonTransport` and logs the rendered
 *     message to the server console — handy for local dev where you
 *     just copy the invite link out of the terminal.
 *
 * All send failures are caught and returned to the caller. Inviting a
 * user is a side effect of the invite API; we never want a transient
 * SMTP outage to block a team_leader from adding a teammate. Callers
 * surface the invite link as a fallback so they can hand it off manually.
 */

import nodemailer from 'nodemailer'
import { config } from '../config.js'

let cachedTransport = null

function getTransport() {
  if (cachedTransport) return cachedTransport
  if (config.smtp.host) {
    cachedTransport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth:
        config.smtp.user || config.smtp.pass
          ? { user: config.smtp.user, pass: config.smtp.pass }
          : undefined,
    })
  } else {
    // Dev fallback — no SMTP configured. Print the message instead of
    // trying to send it. Useful when booting locally without a mailpit.
    cachedTransport = nodemailer.createTransport({ jsonTransport: true })
  }
  return cachedTransport
}

/**
 * Send an email. Returns `{ ok: true, info }` on success or
 * `{ ok: false, error }` on failure — never throws, so callers can keep
 * the invite flow alive even when the mail server is down.
 */
export async function sendMail({ to, subject, text, html }) {
  try {
    const info = await getTransport().sendMail({
      from: config.smtp.from,
      to,
      subject,
      text,
      html,
    })
    // Dev transport puts the message on info.message as a JSON string.
    if (!config.smtp.host && info?.message) {
      // eslint-disable-next-line no-console
      console.log('[mail] (dev) would have sent:', info.message)
    }
    return { ok: true, info }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[mail] send failed:', error?.message ?? error)
    return { ok: false, error: error?.message ?? 'unknown mail error' }
  }
}

/**
 * Render the invitation email body. Plain text + matching HTML so the
 * recipient's mail client shows something nice even if it doesn't render
 * HTML.
 */
export function renderInviteEmail({ name, role, inviteUrl, invitedBy }) {
  const roleLabel = {
    designer: 'Tasarımcı',
    printer: 'Matbaa',
    satis: 'Satış Ekibi',
    team_leader: 'Takım Lideri',
  }[role] ?? role

  const subject = `${invitedBy ?? 'YZ Yayın Takip'} sizi ekibe davet etti`
  const text = [
    `Merhaba ${name},`,
    '',
    `${invitedBy ?? 'YZ Yayın Takip'} sizi ${roleLabel} olarak ekibe davet etti.`,
    'Hesabınızı aktifleştirmek ve şifrenizi belirlemek için aşağıdaki linke tıklayın:',
    '',
    inviteUrl,
    '',
    'Bu link 7 gün geçerlidir. Link çalışmıyorsa adresi tarayıcınıza yapıştırın.',
    '',
    '— YZ Yayın Takip',
  ].join('\n')

  const html = `
    <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #dc2626; margin: 0 0 16px;">YZ Yayın Takip</h2>
      <p>Merhaba <strong>${escapeHtml(name)}</strong>,</p>
      <p><strong>${escapeHtml(invitedBy ?? 'YZ Yayın Takip')}</strong> sizi <strong>${escapeHtml(roleLabel)}</strong> olarak ekibe davet etti.</p>
      <p>Hesabınızı aktifleştirmek ve şifrenizi belirlemek için aşağıdaki butona tıklayın:</p>
      <p style="margin: 24px 0;">
        <a href="${inviteUrl}"
           style="background: #dc2626; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: 600;">
          Şifre Belirle
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">Bu link 7 gün geçerlidir.</p>
      <p style="color: #666; font-size: 12px;">Buton çalışmıyorsa bu linki tarayıcınıza yapıştırın:<br>
        <span style="color: #999; word-break: break-all;">${inviteUrl}</span></p>
    </div>
  `
  return { subject, text, html }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}