
import config from '../config.js'

const handler = {
    command: ['kickall', 'eliminaratodos', 'sacaratodos'],

    run: async (sock, m) => {
        const jid = m.key.remoteJid

        if (!jid?.endsWith('@g.us')) return

        // Reaccionar a cualquier persona que use el comando.
        try {
            await sock.sendMessage(jid, {
                react: {
                    text: '😂',
                    key: m.key
                }
            })
        } catch (error) {
            console.error('[KICKALL REACTION]', error.message)
        }

        try {
            const metadata = await sock.groupMetadata(jid)
            const participants = metadata.participants || []

            const normalizeJid = id => {
                if (!id) return ''
                return id.split(':')[0].toLowerCase()
            }

            const sender =
                m.key.participant ||
                (m.key.fromMe ? sock.user.id : '')

            const senderParticipant = participants.find(p => {
                const ids = [p.id, p.jid, p.lid].filter(Boolean)

                return ids.some(id =>
                    id === sender ||
                    normalizeJid(id) === normalizeJid(sender)
                )
            })

            const isAdmin =
                senderParticipant?.admin === 'admin' ||
                senderParticipant?.admin === 'superadmin'

            // Reconocer al propietario configurado.
            const owners = Array.isArray(config.OWNER_NUMBER)
                ? config.OWNER_NUMBER
                : config.OWNER_NUMBER
                    ? [config.OWNER_NUMBER]
                    : []

            const senderNumber = sender
                .split('@')[0]
                .split(':')[0]
                .replace(/\D/g, '')

            const isOwner = owners.some(owner => {
                const value = Array.isArray(owner)
                    ? owner[0]
                    : owner

                if (!value) return false

                const ownerNumber = String(value)
                    .replace(/\D/g, '')

                return (
                    ownerNumber !== '' &&
                    ownerNumber === senderNumber
                )
            })

            console.log('[KICKALL SENDER]', {
                sender,
                participanteEncontrado: Boolean(senderParticipant),
                admin: senderParticipant?.admin || null,
                isAdmin,
                isOwner
            })

            // Solo administradores o propietario pueden expulsar.
            if (!isAdmin && !isOwner) {
                console.log('[KICKALL] Usuario sin permisos')
                return
            }

            // Identificadores posibles de la cuenta del bot.
            const botIds = [
                sock.user?.id,
                sock.user?.id?.split(':')[0],
                sock.user?.id?.split('@')[0]
                    ? `${sock.user.id.split('@')[0]}@s.whatsapp.net`
                    : null,
                sock.user?.lid
            ].filter(Boolean)

            const botParticipant = participants.find(p => {
                const participantIds = [
                    p.id,
                    p.jid,
                    p.lid
                ].filter(Boolean)

                return participantIds.some(id =>
                    botIds.some(botId =>
                        id === botId ||
                        normalizeJid(id) === normalizeJid(botId)
                    )
                )
            })

            console.log('[KICKALL BOT ADMIN]', {
                botId: sock.user?.id,
                botLid: sock.user?.lid,
                participanteEncontrado: Boolean(botParticipant),
                identificadorParticipante: botParticipant?.id,
                admin: botParticipant?.admin || null
            })

            const botIsAdmin =
                botParticipant?.admin === 'admin' ||
                botParticipant?.admin === 'superadmin'

            if (!botIsAdmin) {
                console.log(
                    '[KICKALL] No se pudo confirmar que el bot sea administrador'
                )
                return
            }

            // Conservar al bot.
            const botParticipantIds = [
                botParticipant.id,
                botParticipant.jid,
                botParticipant.lid,
                ...botIds
            ].filter(Boolean)

            const toKick = participants
                .filter(p => {
                    const ids = [p.id, p.jid, p.lid].filter(Boolean)

                    const isBot = ids.some(id =>
                        botParticipantIds.some(botId =>
                            id === botId ||
                            normalizeJid(id) === normalizeJid(botId)
                        )
                    )

                    return !isBot
                })
                .map(p => p.id)
                .filter(Boolean)

            if (!toKick.length) {
                console.log('[KICKALL] No hay participantes que retirar')
                return
            }

            console.log(
                `[KICKALL] Intentando retirar ${toKick.length} participantes`
            )

            const results = await sock.groupParticipantsUpdate(
                jid,
                toKick,
                'remove'
            )

            console.log('[KICKALL RESULTADO]', results)

            const expelled = Array.isArray(results)
                ? results.filter(p => String(p.status) === '200').length
                : 0

            await sock.sendMessage(jid, {
                text:
                    `𝐃𝐎𝐌𝐀𝐃𝐎𝐒 𝐗 𝐄𝐗𝐂𝐋𝐔𝐒𝐈𝐕𝐄\n` +
                    `> 𝘨𝘨 𝘴𝘦 𝘧𝘶𝘦𝘳𝘰𝘯 𝘥𝘰𝘮𝘢𝘥𝘰𝘴: ${expelled}`
            })

        } catch (error) {
            console.error(
                '[KICKALL ERROR]',
                error.stack || error.message
            )
        }
    }
}

export default handler
