
const handler = {
  command: ['demoteall'],

  run: async (sock, m) => {
    const jid = m.key.remoteJid

    if (!jid.endsWith('@g.us')) return

    const react = async (emoji) => {
      try {
        await sock.sendMessage(jid, {
          react: { text: emoji, key: m.key }
        })
      } catch {}
    }

    try {
      const metadata = await sock.groupMetadata(jid)

      const normalizeJid = (value) =>
        value?.split(':')[0]?.replace(/@.*$/, '') || ''

      const sender = m.key.participant || m.key.remoteJid
      const botJid = sock.user.id

      const senderParticipant = metadata.participants.find(
        p => normalizeJid(p.id) === normalizeJid(sender)
      )

      const botParticipant = metadata.participants.find(
        p => normalizeJid(p.id) === normalizeJid(botJid)
      )

      // Si quien ejecuta no es administrador, solo reacciona.
      if (
        !senderParticipant ||
        !['admin', 'superadmin'].includes(senderParticipant.admin)
      ) {
        await react('👾')
        return
      }

      // El bot debe ser administrador.
      if (
        !botParticipant ||
        !['admin', 'superadmin'].includes(botParticipant.admin)
      ) return

      const admins = metadata.participants.filter(
        p =>
          ['admin', 'superadmin'].includes(p.admin) &&
          normalizeJid(p.id) !== normalizeJid(botJid)
      )

      if (!admins.length) {
        await sock.sendMessage(jid, {
          text: 'Admins removidos: 0'
        })
        return
      }

      let removed = 0

      for (const participant of admins) {
        try {
          await sock.groupParticipantsUpdate(
            jid,
            [participant.id],
            'demote'
          )
          removed++
        } catch {}
      }

      await sock.sendMessage(jid, {
        text: `Admins removidos: ${removed}`
      })
    } catch {}
  }
}

export default handler
