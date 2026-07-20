/**
 * Magic-link sign-in email. Same plain format as invites + resets so
 * the team can recognize it.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderMagicLinkEmail({ name, magicUrl, ttlMinutes }) {
  const firstName = String(name).split(/\s+/)[0] || name
  const subject = 'Giriş bağlantın — Yükselen Zeka Yayın'

  const text = [
    `Merhaba ${firstName},`,
    '',
    'Yükselen Zeka Yayın Takip\'e giriş yapman için tek kullanımlık bir bağlantı oluşturduk.',
    '',
    'Giriş yapmak için aşağıdaki bağlantıya tıkla:',
    '',
    magicUrl,
    '',
    `Bu bağlantı ${ttlMinutes} dakika geçerlidir ve yalnızca bir kez kullanılabilir.`,
    'Giriş yapmak istemediysen bu e-postayı görmezden gelebilirsin.',
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
      Yükselen Zeka Yayın'a giriş bağlantınız hazır. Detay için e-postayı açın.
    </span>
    <div style="max-width:560px;margin:0 auto;padding:24px 20px;">
      <p>Merhaba ${escapeHtml(firstName)},</p>

      <p>Yükselen Zeka Yayın Takip'e giriş yapman için tek kullanımlık bir bağlantı oluşturduk.</p>

      <p>Giriş yapmak için aşağıdaki bağlantıya tıkla:</p>

      <p><a href="${magicUrl}" style="color:#1155cc;text-decoration:underline;word-break:break-all;">${escapeHtml(magicUrl)}</a></p>

      <p style="color:#888888;font-size:12px;">
        Bu bağlantı ${ttlMinutes} dakika geçerlidir ve yalnızca bir kez kullanılabilir.
        Giriş yapmak istemediysen bu e-postayı görmezden gelebilirsin.
      </p>

      <p>Sevgiyle,<br>
         <strong>Yükselen Zeka Yayın Takip Ekibi</strong></p>
    </div>
  </body>
</html>
  `

  return { subject, text, html }
}

export function buildMagicLinkUrl(token, baseUrl) {
  const base = baseUrl.replace(/\/$/, '')
  return `${base}/auth/magic?token=${encodeURIComponent(token)}`
}
