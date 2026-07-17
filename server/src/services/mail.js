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
 * The HTML design mirrors the SPA's brand palette (rose-primary
 * `#a5274d`, paper-canvas `#faf6ef`) and Fraunces display type so the
 * email feels like a natural extension of the product rather than a
 * generic transactional message.
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
    `${inviter}, seni Yükselen Zeka Yayın ekibine katılmaya davet etti. 💜`,
    '',
    'Bazen en güzel yolculuklar, tek bir adımla başlar.',
    '',
    'Hayal etmekten vazgeçme.',
    'Üretmekten vazgeçme.',
    'Çünkü birlikte çok daha güçlüyüz. ✨',
    '',
    'Aşağıdaki butona tıklayarak daveti kabul edebilir ve ekibe katılabilirsin.',
    '',
    `✨ Daveti Kabul Et`,
    `   ${inviteUrl}`,
    '',
    'Buton çalışmazsa bu bağlantıyı kullanabilirsin:',
    '',
    inviteUrl,
    '',
    'Sevgiyle,',
    'Yükselen Zeka Yayın Takip Ekibi',
    '',
    '—',
    'Bu daveti beklemiyorsan bu e-postayı güvenle görmezden gelebilirsin.',
    'Yükselen Zeka Yayın ekibi',
  ].join('\n')

  // HTML version — branded, with a warm gradient header, the copy the
  // team_leader requested (verbatim), a single primary CTA, and a
  // Fraunces signature. Inline CSS only (most clients strip <style>).
  const html = `
<!doctype html>
<html lang="tr">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#faf6ef;font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#2b2018;-webkit-font-smoothing:antialiased;">
    <span style="display:none;visibility:none;mso-hide:all;font-size:1px;color:#faf6ef;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
      ${escapeHtml(inviter)} seni Yükselen Zeka Yayın ekibine katılmaya davet etti. Davet bağlantısı için e-postayı açın.
    </span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#faf6ef;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;">

            <!-- Brand mark -->
            <tr>
              <td align="left" style="padding:0 8px 16px;">
                <span style="display:inline-block;font-family:'Fraunces',Georgia,serif;font-size:14px;letter-spacing:.18em;text-transform:uppercase;color:#a5274d;font-weight:600;">
                  Yükselen&nbsp;Zeka · Yayın Takip
                </span>
              </td>
            </tr>

            <!-- Hero card with warm gradient + paper feel -->
            <tr>
              <td style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e6dccd;box-shadow:0 1px 0 #00000008, 0 12px 32px -16px #a5274d22;">

                <div style="background:linear-gradient(135deg,#a5274d 0%,#7a1c39 60%,#2b2018 100%);padding:40px 32px 36px;color:#fdf2f5;">
                  <div style="display:inline-block;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:6px 12px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:600;backdrop-filter:blur(4px);">
                    Yükselen Zeka Yayın
                  </div>
                  <h1 style="margin:18px 0 0;font-family:'Fraunces',Georgia,serif;font-size:30px;line-height:1.2;letter-spacing:-.01em;font-weight:600;color:#ffffff;">
                    Hoş geldin, ${escapeHtml(firstName)}.
                  </h1>
                </div>

                <!-- Body — exact copy the team leader approved -->
                <div style="padding:32px 32px 8px;">

                  <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#2b2018;">
                    Merhaba <strong style="color:#a5274d;">${escapeHtml(firstName)}</strong>,
                  </p>

                  <p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:#2b2018;">
                    <strong style="color:#2b2018;">${escapeHtml(inviter)}</strong>, seni
                    <strong style="color:#a5274d;">Yükselen Zeka Yayın ekibi</strong>ne katılmaya davet etti. 💜
                  </p>

                  <p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:#2b2018;font-style:italic;font-family:'Fraunces',Georgia,serif;">
                    Bazen en güzel yolculuklar, tek bir adımla başlar.
                  </p>

                  <p style="margin:0 0 4px;font-size:16px;line-height:1.7;color:#2b2018;">
                    Hayal etmekten vazgeçme.
                  </p>
                  <p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#2b2018;">
                    Üretmekten vazgeçme.
                  </p>
                  <p style="margin:0 0 24px;font-size:16px;line-height:1.7;color:#2b2018;">
                    Çünkü birlikte çok daha güçlüyüz. ✨
                  </p>

                  <!-- Primary CTA -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px;">
                    <tr>
                      <td align="center" style="padding:8px 0 4px;">
                        <a href="${inviteUrl}"
                           target="_blank"
                           style="display:inline-block;background:linear-gradient(135deg,#a5274d,#7a1c39);color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:18px 40px;border-radius:14px;letter-spacing:.01em;box-shadow:0 8px 20px -8px #a5274d99, 0 0 0 1px #2b201822 inset;">
                          ✨ Daveti Kabul Et
                        </a>
                      </td>
                    </tr>
                  </table>
                </div>

                <!-- Fallback link -->
                <div style="padding:16px 32px 24px;">
                  <div style="background:#faf6ef;border:1px dashed #e6dccd;border-radius:10px;padding:14px 16px;">
                    <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7a6a58;font-weight:600;">
                      Buton çalışmazsa bu bağlantıyı kullanabilirsin
                    </p>
                    <p style="margin:0;font-size:12px;line-height:1.55;color:#2b2018;word-break:break-all;font-family:'Geist Mono',ui-monospace,monospace;">
                      ${escapeHtml(inviteUrl)}
                    </p>
                  </div>
                </div>

                <!-- Signature -->
                <div style="padding:8px 32px 32px;border-top:1px solid #f0e8da;">
                  <p style="margin:16px 0 4px;font-size:14px;color:#2b2018;">
                    Sevgiyle,
                  </p>
                  <p style="margin:0;font-family:'Fraunces',Georgia,serif;font-size:20px;color:#a5274d;font-style:italic;">
                    Yükselen Zeka Yayın Takip Ekibi
                  </p>
                </div>
              </td>
            </tr>

            <!-- Sub-footer -->
            <tr>
              <td align="center" style="padding:18px 8px 0;">
                <p style="margin:0 0 6px;font-size:11px;line-height:1.5;color:#7a6a58;">
                  Bu davet ${escapeHtml(inviter)} tarafından gönderildi.
                  Beklemediğin bir e-posta ise lütfen <a href="mailto:noreply@yt.mucitkarinca.com" style="color:#a5274d;text-decoration:underline;">bize bildir</a>.
                </p>
                <p style="margin:0;font-size:11px;line-height:1.5;color:#7a6a58;">
                  Yükselen Zeka Yayın ekibi
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
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