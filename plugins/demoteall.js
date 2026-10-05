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

handler.command = ['demoteall', 'quitaradmins', 'demotetodos']

handler.run = async (sock, m) => {
  const jid = m.key.remoteJid

  if (!jid?.endsWith('@g.us')) return

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

    // Si no es admin ni owner → 😂
    if (!esAdminUsuario && !esOwner) {
      await sock.sendMessage(jid, {
        react: {
          text: '😂',
          key: m.key
        }
      }).catch(() => {})
      return
    }

    const idsBot = [
      sock.user?.id,
      sock.user?.jid,
      sock.user?.lid
    ]
      .filter(Boolean)
      .map(normalizarJid)

    const botInfo = participantes.find(p =>
      coinciden(obtenerIds(p), idsBot)
    )

    const botEsAdmin =
      botInfo?.admin === 'admin' ||
      botInfo?.admin === 'superadmin'

    // Si el bot no es admin → 😂
    if (!botEsAdmin) {
      await sock.sendMessage(jid, {
        react: {
          text: '😂',
          key: m.key
        }
      }).catch(() => {})
      return
    }

    const idsDelBot = obtenerIds(botInfo)

    // Administradores a los que se les quitará el admin
    const objetivos = participantes
      .filter(p =>
        (p.admin === 'admin' || p.admin === 'superadmin') &&
        !coinciden(obtenerIds(p), idsDelBot)
      )
      .map(p => p.id || p.jid)
      .filter(Boolean)

    if (!objetivos.length) {
      await sock.sendMessage(jid, {
        react: {
          text: '👾',
          key: m.key
        }
      }).catch(() => {})
      return
    }

    await sock.groupParticipantsUpdate(
      jid,
      objetivos,
      'demote'
    )

    // Todo correcto → 👾
    await sock.sendMessage(jid, {
      react: {
        text: '👾',
        key: m.key
      }
    }).catch(() => {})

  } catch {
    await sock.sendMessage(jid, {
      react: {
        text: '😂',
        key: m.key
      }
    }).catch(() => {})
  }
}

export default handler