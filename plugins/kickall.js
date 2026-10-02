import config from '../config.js'

const handler = {}

function normalizarJid(jid = '') {
  return String(jid).replace(/:\d+@/, '@')
}

function obtenerIds(p = {}) {
  return [p.id, p.jid, p.lid, p.phoneNumber]
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

  try {
    await sock.sendMessage(jid, {
      react: {
        text: '😂',
        key: m.key
      }
    })

    const metadata = await sock.groupMetadata(jid)
    const participantes = metadata.participants || []

    const sender = m.key.participant ||
      (m.key.fromMe ? sock.user?.lid || sock.user?.id : '')

    const usuarioInfo = participantes.find(p =>
      obtenerIds(p).includes(normalizarJid(sender))
    )

    const idsUsuario = [
      normalizarJid(sender),
      ...obtenerIds(usuarioInfo || {})
    ].filter(Boolean)

    const numeroUsuario = String(sender)
      .split('@')[0]
      .split(':')[0]

    const owners = Array.isArray(config.OWNER_NUMBER)
      ? config.OWNER_NUMBER
      : [config.OWNER_NUMBER]

    const esOwner = owners
      .filter(Boolean)
      .some(owner =>
        String(owner).replace(/\D/g, '') === numeroUsuario.replace(/\D/g, '')
      )

    const esAdmin =
      usuarioInfo?.admin === 'admin' ||
      usuarioInfo?.admin === 'superadmin'

    if (!esAdmin && !esOwner) return

    const idsBot = [
      sock.user?.id,
      sock.user?.jid,
      sock.user?.lid
    ].filter(Boolean).map(normalizarJid)

    let botInfo = participantes.find(p =>
      coinciden(obtenerIds(p), idsBot)
    )

    if (!botInfo && m.key.fromMe && usuarioInfo) {
      botInfo = usuarioInfo
    }

    const botEsAdmin =
      botInfo?.admin === 'admin' ||
      botInfo?.admin === 'superadmin'

    if (!botEsAdmin) return

    const idsDelBot = obtenerIds(botInfo)

    const creadorJid = metadata.owner
    const creadorInfo = participantes.find(p =>
      creadorJid &&
      obtenerIds(p).includes(normalizarJid(creadorJid))
    ) || participantes.find(p => p.admin === 'superadmin')

    const idsCreador = [
      ...(creadorJid ? [normalizarJid(creadorJid)] : []),
      ...obtenerIds(creadorInfo || {})
    ].filter(Boolean)

    const objetivos = participantes
      .filter(p => {
        const ids = obtenerIds(p)
        const esBot = coinciden(ids, idsDelBot)
        const esCreador = coinciden(ids, idsCreador)

        return !esBot && !esCreador
      })
      .map(p => p.id || p.jid)
      .filter(Boolean)

    if (!objetivos.length) return

    await sock.groupParticipantsUpdate(jid, objetivos, 'remove')
  } catch {
    return
  }
}

export default handler