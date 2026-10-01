
const handler = {
    command: ['p', 'ping', 'velocidad'],
    help: ['p'],
    tags: ['informacion'],
    menu: true,

    run: async (sock, m, args) => {
        const inicio = Date.now()

        const sent = await sock.sendMessage(
            m.key.remoteJid,
            { text: '🏓 Calculando velocidad...' },
            { quoted: m }
        )

        const velocidad = Date.now() - inicio

        await sock.sendMessage(
            m.key.remoteJid,
            {
                text: `🏓 *PONG!*\n\n` +
                    `⚡ Velocidad: *${velocidad} ms*\n` +
                    `🤖 Bot: *EXCLUSIVE*`
            },
            { quoted: m }
        )
    }
}

export default handler
