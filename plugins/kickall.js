
import config from '../config.js'

const handler = {
    command: ['kickall', 'eliminaratodos', 'sacaratodos'],

    run: async (sock, m) => {
        const jid = m.key.remoteJid

        if (!jid.endsWith('@g.us')) return

        try {
            const metadata = await sock.groupMetadata(jid)
            const sender = m.key.participant || m.key.remoteJid

            const normalizeJid = id =>
                id?.split(':')[0].replace(/@lid$/, '@s.whatsapp.net')

            const participants = metadata.participants || []
            const botId = normalizeJid(sock.user.id)

            const senderParticipant = participants.find(
                p => p.id === sender ||
                    normalizeJid(p.id) === normalizeJid(sender)
            )

            const isAdmin =
                senderParticipant?.admin === 'admin' ||
                senderParticipant?.admin === 'superadmin'

            const isOwner = (config.OWNER_NUMBER || []).some(owner => {
                const number = typeof owner === 'string' ? owner : owner[0]
                const ownerJid = String(number).includes('@')
                    ? String(number)
                    : `${number}@s.whatsapp.net`

                return normalizeJid(sender) === normalizeJid(ownerJid)
            })

            if (!isAdmin && !isOwner) return

            const botParticipant = participants.find(
                p => normalizeJid(p.id) === botId
            )

            if (
                botParticipant?.admin !== 'admin' &&
                botParticipant?.admin !== 'superadmin'
            ) {
                await sock.sendMessage(jid, {
                    react: { text: '😂', key: m.key }
                })
                return
            }

            // Conservar únicamente al bot.
            const toKick = participants
                .filter(p => normalizeJid(p.id) !== botId)
                .map(p => p.id)

            if (!toKick.length) return

            const results = await sock.groupParticipantsUpdate(
                jid,
                toKick,
                'remove'
            )

            const expelled = Array.isArray(results)
                ? results.filter(p => p.status === '200').length
                : toKick.length

            await sock.sendMessage(jid, {
                text: `𝐃𝐎𝐌𝐀𝐃𝐎𝐒 𝐗 𝐄𝐗𝐂𝐋𝐔𝐒𝐈𝐕𝐄\n> 𝘨𝘨 𝘴𝘦 𝘧𝘶𝘦𝘳𝘰𝘯 𝘥𝘰𝘮𝘢𝘥𝘰𝘴: ${expelled}`
            })

        } catch (error) {
            console.error('[KICKALL]', error)
        }
    }
}

export default handler
