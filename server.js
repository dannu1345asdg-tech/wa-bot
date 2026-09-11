const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
const AUTH_DIR = path.join(__dirname, 'auth_info');

let sock = null;
let isConnected = false;
let pairingMode = false;
let lastQR = null;
let lastCode = null;
app.use(express.static(__dirname));

async function startBot() {
    console.log('=== START BOT ===');
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "20.0.0"],
        syncFullHistory: false,
        markOnlineOnConnect: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        console.log('CONN:', connection || '-', '| QR:', qr ? 'YES' : 'NO');

        if (qr && !pairingMode) {
            try {
                const qrURL = await QRCode.toDataURL(qr, { width: 500, margin: 2 });
                lastQR = qrURL;
                io.emit('qr', qrURL);
            } catch (e) { console.log('QR err:', e.message); }
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            isConnected = false;
            io.emit('status', 'disconnected');
            if (code !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 2000);
        } else if (connection === 'open') {
            isConnected = true;
            pairingMode = false;
            lastQR = null;
            lastCode = null;
            io.emit('status', 'connected');
            console.log('✅ BOT CONNECTED!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;
        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const cmd = text.toLowerCase();

        if (cmd === '.menu') {
            const menu = `╔══════════════════════════════╗
║   ✦ NEBOLUSVERSE BOT ✦      ║
╚══════════════════════════════╝

📋 *UTAMA*
• .menu - Menu
• .ping - Cek bot
• .info - Info bot
• .owner - Owner
• .status - Status

🛠️ *TOOLS*
• .calc [angka] - Kalkulator
• .qr [teks] - Bikin QR
• .waktu - Waktu sekarang
• .translate [teks] - Translate

🎮 *GAME*
• .suit [batu/gunting/kertas]
• .dadu - Lempar dadu
• .slot - Slot machine

📸 *MEDIA*
• .viewonce - Info view once
• .saved - File tersimpan
• .mycount - Statistik`;
            await sock.sendMessage(from, { text: menu });
        }

        if (cmd === '.ping') await sock.sendMessage(from, { text: '🏓 Pong!' });
        if (cmd === '.info') await sock.sendMessage(from, { text: '🤖 *NEBOLUSVERSE BOT* v4.0' });
        if (cmd === '.owner') await sock.sendMessage(from, { text: '👤 BELLIOT Ganteng\n📱 081323879987' });
        if (cmd === '.status') await sock.sendMessage(from, { text: '✅ Bot online' });
        if (cmd === '.waktu') await sock.sendMessage(from, { text: `🕐 ${new Date().toLocaleString('id-ID')}` });

        if (cmd.startsWith('.calc ')) {
            try {
                const expr = text.slice(6);
                const result = eval(expr.replace(/[^0-9+\-*/().]/g, ''));
                await sock.sendMessage(from, { text: `🧮 ${expr} = ${result}` });
            } catch { await sock.sendMessage(from, { text: '❌ Contoh: .calc 2+2' }); }
        }

        if (cmd.startsWith('.qr ')) {
            try {
                const buffer = await QRCode.toBuffer(text.slice(4));
                await sock.sendMessage(from, { image: buffer, caption: `QR: ${text.slice(4)}` });
            } catch { await sock.sendMessage(from, { text: '❌ Gagal.' }); }
        }

        if (cmd.startsWith('.suit ')) {
            const pil = ['batu','gunting','kertas'];
            const bot = pil[Math.floor(Math.random()*3)];
            const user = text.slice(6).toLowerCase();
            if (!pil.includes(user)) return sock.sendMessage(from, { text: '❌ Pilih: batu, gunting, kertas' });
            let h = user === bot ? '🤝 Seri!' : ((user==='batu'&&bot==='gunting')||(user==='gunting'&&bot==='kertas')||(user==='kertas'&&bot==='batu')) ? '🎉 Menang!' : '😢 Kalah!';
            await sock.sendMessage(from, { text: `Kamu: ${user}\nBot: ${bot}\n\n${h}` });
        }

        if (cmd === '.dadu') await sock.sendMessage(from, { text: `🎲 ${Math.floor(Math.random()*6)+1}` });

        if (cmd === '.slot') {
            const e = ['🍒','🍋','🍊','💎','7️⃣'];
            const a = e[Math.floor(Math.random()*5)], b = e[Math.floor(Math.random()*5)], c = e[Math.floor(Math.random()*5)];
            await sock.sendMessage(from, { text: `${a} ${b} ${c}\n\n${a===b&&b===c?'🎉 JACKPOT!':'😢 Coba lagi'}` });
        }

        if (cmd === '.translate') await sock.sendMessage(from, { text: '🌐 Contoh: .translate halo (fitur butuh API)' });
    });
}

io.on('connection', (socket) => {
    socket.emit('status', isConnected ? 'connected' : 'disconnected');
    if (lastQR && !isConnected) socket.emit('qr', lastQR);
    if (lastCode && !isConnected) socket.emit('pairing-code', lastCode);

    socket.on('request-pairing', async (phone) => {
        try {
            let num = phone.replace(/[^0-9]/g, '');
            if (num.startsWith('0')) num = '62' + num.slice(1);
            if (isConnected) return socket.emit('pairing-error', 'Bot udah connect.');

            pairingMode = true;
            if (sock) { try { sock.end(); } catch(e) {} sock = null; }
            if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });

            await startBot();
            await new Promise(r => setTimeout(r, 3000));

            if (!sock) {
                pairingMode = false;
                return socket.emit('pairing-error', 'Bot gagal start.');
            }

            const code = await sock.requestPairingCode(num);
            lastCode = code;
            socket.emit('pairing-code', code);
        } catch (e) {
            pairingMode = false;
            socket.emit('pairing-error', e.message || 'Gagal minta kode');
        }
    });

    socket.on('request-qr', async () => {
        try {
            pairingMode = false;
            if (sock) { try { sock.end(); } catch(e) {} sock = null; }
            if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            await startBot();
        } catch (e) {
            socket.emit('pairing-error', e.message);
        }
    });
});

startBot();
server.listen(PORT, () => console.log('🚀 Web jalan di port ' + PORT));
