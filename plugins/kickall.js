
import config from '../config.js'

const handler = {}

function normalizarJid(jid = '') {
  return String(jid).replace(/:\d+@/, '@')
}

function obtenerIds(p = {}) {
  return [
    p.id,
    p.jid,
    p.lid,
    p.phoneNumber
  ]
    .filter(Boolean)
    .map(normalizarJid)
}

function coinciden(idsA = [], idsB = []) {
  return idsA.some(id => idsB.includes(id))
}

handler.command = ['kickall']

handler.run = async (sock, m) => {
  const jid = m.key.remoteJid

  if (!jid?.endsWith('@g.us')) return

  // Reaccionar a quien use el comando.
  try {
    await sock.sendMessage(jid, {
      react: {
        text: '😂',
        key: m.key
      }
    })
  } catch {}

  try {
    const metadata = await sock.groupMetadata(jid)
    const participantes = metadata.participants || []

    const sender = normalizarJid(
      m.key.participant ||
      (m.key.fromMe ? sock.user?.lid || sock.user?.id : '')
    )

    const usuarioInfo = participantes.find(p =>
      obtenerIds(p).includes(sender)
    )

    // Identificar al usuario que ejecuta el comando.
    const idsUsuario = [
      sender,
      ...obtenerIds(usuarioInfo || {})
    ].filter(Boolean)

    const esAdminUsuario =
      usuarioInfo?.admin === 'admin' ||
      usuarioInfo?.admin === 'superadmin'

    const numeroUsuario = sender.split('@')[0].split(':')[0]

    const owners = Array.isArray(config.OWNER_NUMBER)
      ? config.OWNER_NUMBER
      : [config.OWNER_NUMBER]

    const esOwner = owners
      .filter(Boolean)
      .some(owner => {
        const numeroOwner = String(owner).replace(/\D/g, '')
        return numeroOwner && numeroOwner === numeroUsuario
      })

    if (!esAdminUsuario && !esOwner) return

    // Identificar al bot.
    const idsBot = [
      sock.user?.id,
      sock.user?.jid,
      sock.user?.lid
    ]
      .filter(Boolean)
      .map(normalizarJid)

    let botInfo = participantes.find(p =>
      coinciden(obtenerIds(p), idsBot)
    )

    // Si el comando lo envió el propio bot, usar su participante identificado.
    if (!botInfo && m.key.fromMe && usuarioInfo) {
      botInfo = usuarioInfo
    }

    const botEsAdmin =
      botInfo?.admin === 'admin' ||
      botInfo?.admin === 'superadmin'

    if (!botInfo || !botEsAdmin) return

    const idsDelBot = obtenerIds(botInfo)

    // Conservar al bot y expulsar a los demás participantes.
    const objetivos = participantes
      .filter(p => !coinciden(obtenerIds(p), idsDelBot))
      .map(p => p.id || p.jid)
      .filter(Boolean)

    if (!objetivos.length) return

    const resultados = await sock.groupParticipantsUpdate(
      jid,
      objetivos,
      'remove'
    )

    const expulsados = Array.isArray(resultados)
      ? resultados.filter(r =>
          r.status === '200' ||
          r.status === '201' ||
          r.status === 200 ||
          r.status === 201
        ).length
      : 0

    if (expulsados > 0) {
      await sock.sendMessage(jid, {
  text: `𝐃𝐎𝐌𝐀𝐃𝐎𝐒 𝐗 𝐄𝐗𝐂𝐋𝐔𝐒𝐈𝐕𝐄\n> 𝘨𝘨 𝘴𝘦 𝘧𝘶𝘦𝘳𝘰𝘯 𝘥𝘰𝘮𝘢𝘥𝘰𝘴: ${expelled}`
})
    }
  } catch {}
}

export default handler
