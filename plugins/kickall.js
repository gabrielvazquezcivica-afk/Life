import config from '../config.js'

const handler = {
    command: ['kickall', 'eliminaratodos', 'sacaratodos'],

    run: async (sock, m) => {
        const jid = m.key.remoteJid

        if (!jid?.endsWith('@g.us')) return

        try {
            const metadata = await sock.groupMetadata(jid)
            const participants = metadata.participants || []

            const normalizeJid = id => {
                if (!id) return ''
                return id.split(':')[0]
                    .replace(/@lid$/, '@s.whatsapp.net')
            }

            const sender = m.key.participant || (
                m.key.fromMe ? sock.user.id : ''
            )

            const botId = normalizeJid(sock.user.id)

            const senderParticipant = participants.find(p =>
                p.id === sender ||
                normalizeJid(p.id) === normalizeJid(sender)
            )

            const isAdmin =
                senderParticipant?.admin === 'admin' ||
                senderParticipant?.admin === 'superadmin'

            const owners = Array.isArray(config.OWNER_NUMBER)
                ? config.OWNER_NUMBER
                : config.OWNER_NUMBER
                    ? [config.OWNER_NUMBER]
                    : []

            const senderNormalized = normalizeJid(sender)

            const isOwner = owners.some(owner => {
                const number = Array.isArray(owner)
                    ? owner[0]
                    : owner

                if (!number) return false

                const ownerJid = String(number).includes('@')
                    ? String(number)
                    : `${number.replace(/\D/g, '')}@s.whatsapp.net`

                return normalizeJid(ownerJid) === senderNormalized
            })

            if (!isAdmin && !isOwner) {
                console.log('[KICKALL] Usuario sin permisos')
                return
            }

            const botParticipant = participants.find(p =>
                normalizeJid(p.id) === botId
            )

            if (
                botParticipant?.admin !== 'admin' &&
                botParticipant?.admin !== 'superadmin'
            ) {
                await sock.sendMessage(jid, {
                    react: {
                        text: '😂',
                        key: m.key
                    }
                })
                console.log('[KICKALL] El bot no es administrador')
                return
            }

            // Conservar al bot y no incluirlo en la lista.
            const toKick = participants
                .filter(p => normalizeJid(p.id) !== botId)
                .map(p => p.id)

            if (!toKick.length) return

            console.log(
                `[KICKALL] Intentando retirar ${toKick.length} participantes`
            )

            const results = await sock.groupParticipantsUpdate(
                jid,
                toKick,
                'remove'
            )

            console.log('[KICKALL] Resultado:', results)

            const expelled = Array.isArray(results)
                ? results.filter(p => p.status === '200').length
                : 0

            await sock.sendMessage(jid, {
                text:
                    `𝐃𝐎𝐌𝐀𝐃𝐎𝐒 𝐗 𝐄𝐗𝐂𝐋𝐔𝐒𝐈𝐕𝐄\n` +
                    `> 𝘨𝘨 𝘴𝘦 𝘧𝘶𝘦𝘳𝘰𝘯 𝘥𝘰𝘮𝘢𝘥𝘰𝘴: ${expelled}`
            })
        } catch (error) {
            console.error('[KICKALL ERROR]', error.stack || error.message)
        }
    }
}

export default handler
