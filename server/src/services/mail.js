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
 *
 * Plain email design: no gradients, no decorative cards, no brand
 * glyphs — just the message and a clear link. Renders the same in every
 * client, focuses on the content.
 */
export function renderInviteEmail({ name, role, inviteUrl, invitedBy }) {
  const roleLabel = {
    designer: 'Tasarımcı',
    printer: 'Matbaa',
    satis: 'Satış Ekibi',
    team_leader: 'Takım Lideri',
  }[role] ?? role

  const inviter = invitedBy ?? 'Yükselen Zeka Yayın Takip'
  const firstName = String(name).split(/\s+/)[0] || name

  const subject = 'Yükselen Zeka Yayın’a Hoş Geldin'

  // Plain-text version — readable in any client.
  const text = [
    `Merhaba ${firstName},`,
    '',
    `${inviter}, seni Yükselen Zeka Yayın ekibine katılmaya davet etti.`,
    '',
    'Bazen en güzel yolculuklar, tek bir adımla başlar.',
    '',
    'Hayal etmekten vazgeçme.',
    'Üretmekten vazgeçme.',
    'Çünkü birlikte çok daha güçlüyüz.',
    '',
    'Aşağıdaki bağlantıya tıklayarak daveti kabul edebilir ve ekibe katılabilirsin:',
    '',
    inviteUrl,
    '',
    'Sevgiyle,',
    'Yükselen Zeka Yayın Takip Ekibi',
    '',
    'Bu daveti beklemiyorsan bu e-postayı güvenle görmezden gelebilirsin.',
  ].join('\n')

  // Plain HTML version — same content, single underlined link, no
  // images, no gradients, no brand cards. Renders identically in
  // Gmail, Outlook, Apple Mail, mobile.
  const html = `
<!doctype html>
<html lang="tr">
  <head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#222222;font-size:14px;line-height:1.55;">
    <span style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
      ${escapeHtml(inviter)} seni Yükselen Zeka Yayın ekibine katılmaya davet etti. Davet bağlantısı için e-postayı açın.
    </span>
    <div style="max-width:560px;margin:0 auto;padding:24px 20px;">
      <p>Merhaba ${escapeHtml(firstName)},</p>

      <p>${escapeHtml(inviter)}, seni <strong>Yükselen Zeka Yayın ekibi</strong>ne katılmaya davet etti.</p>

      <p>Bazen en güzel yolculuklar, tek bir adımla başlar.</p>

      <p>Hayal etmekten vazgeçme.<br>
         Üretmekten vazgeçme.<br>
         Çünkü birlikte çok daha güçlüyüz.</p>

      <p>Aşağıdaki bağlantıya tıklayarak daveti kabul edebilir ve ekibe katılabilirsin:</p>

      <p><a href="${inviteUrl}" style="color:#1155cc;text-decoration:underline;word-break:break-all;">${escapeHtml(inviteUrl)}</a></p>

      <p>Sevgiyle,<br>
         <strong>Yükselen Zeka Yayın Takip Ekibi</strong></p>

      <p style="color:#888888;font-size:12px;">Bu daveti beklemiyorsan bu e-postayı güvenle görmezden gelebilirsin.</p>
    </div>
  </body>
</html>
  `
  return { subject, text, html }
}

/**
 * Render the password-reset email body. Same plain (unbranded) format
 * as the invite so the system feels consistent.
 */
export function renderResetEmail({ name, resetUrl }) {
  const firstName = String(name).split(/\s+/)[0] || name
  const subject = 'Şifreni sıfırla — Yükselen Zeka Yayın'

  const text = [
    `Merhaba ${firstName},`,
    '',
    'Yükselen Zeka Yayın Takip hesabın için şifre sıfırlama talebi aldık.',
    '',
    'Şifreni sıfırlamak için aşağıdaki bağlantıya tıkla:',
    '',
    resetUrl,
    '',
    'Bu bağlantı 1 saat geçerlidir. Sıfırlama işlemini sen başlatmadıysan bu e-postayı görmezden gelebilirsin, şifren değişmez.',
    '',
    'Sevgiyle,',
    'Yükselen Zeka Yayın Takip Ekibi',
  ].join('\n')

  const html = `
<!doctype html>
<html lang="tr">
  <head><meta charset="utf-8"></head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:#222222;font-size:14px;line-height:1.55;">
    <span style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
      Yükselen Zeka Yayın Takip hesabın için şifre sıfırlama talebi aldık. Bağlantı için e-postayı açın.
    </span>
    <div style="max-width:560px;margin:0 auto;padding:24px 20px;">
      <p>Merhaba ${escapeHtml(firstName)},</p>

      <p>Yükselen Zeka Yayın Takip hesabın için şifre sıfırlama talebi aldık.</p>

      <p>Şifreni sıfırlamak için aşağıdaki bağlantıya tıkla:</p>

      <p><a href="${resetUrl}" style="color:#1155cc;text-decoration:underline;word-break:break-all;">${escapeHtml(resetUrl)}</a></p>

      <p style="color:#888888;font-size:12px;">
        Bu bağlantı 1 saat geçerlidir. Sıfırlama işlemini sen başlatmadıysan bu e-postayı görmezden gelebilirsin, şifren değişmez.
      </p>

      <p>Sevgiyle,<br>
         <strong>Yükselen Zeka Yayın Takip Ekibi</strong></p>
    </div>
  </body>
</html>
  `
  return { subject, text, html }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]))
}