const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

process.on('unhandledRejection', (err) => console.log('UNHANDLED:', err?.message || err));
process.on('uncaughtException', (err) => console.log('UNCAUGHT:', err?.message || err));

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
let reconnectCount = 0;

app.use(express.static(__dirname));

app.get('/health', (req, res) => res.send('OK'));

async function startBot() {
    try {
        if (sock) {
            try { sock.end(); } catch(e) {}
            sock = null;
        }

        console.log('=== START BOT ===');
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

        sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            auth: state,
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "20.0.0"],
            syncFullHistory: false,
            markOnlineOnConnect: false,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            console.log('CONN:', connection || '-', '| QR:', qr ? 'YES' : 'NO');

            if (qr && !pairingMode) {
                try {
                    lastQR = await QRCode.toDataURL(qr, { width: 500, margin: 2 });
                    io.emit('qr', lastQR);
                } catch (e) { console.log('QR err:', e.message); }
            }

            if (connection === 'open') {
                isConnected = true;
                pairingMode = false;
                lastQR = null;
                lastCode = null;
                reconnectCount = 0;
                io.emit('status', 'connected');
                console.log('BOT CONNECTED');
            }

            if (connection === 'close') {
                isConnected = false;
                io.emit('status', 'disconnected');
                const code = lastDisconnect?.error?.output?.statusCode;
                console.log('CLOSED. Code:', code);
                
                // Kalo logged out, jangan reconnect
                if (code === DisconnectReason.loggedOut) {
                    console.log('LOGGED OUT. Hapus auth_info.');
                    try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch(e) {}
                    return;
                }
                
                // Reconnect max 3x, jeda 5 detik
                reconnectCount++;
                if (reconnectCount <= 3) {
                    console.log('Reconnect ke-' + reconnectCount);
                    setTimeout(() => startBot(), 5000);
                } else {
                    console.log('Terlalu banyak reconnect. Stop.');
                }
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message) return;
            const from = msg.key.remoteJid;
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim().toLowerCase();

            if (text === '.menu') await sock.sendMessage(from, { text: 'MENU:\n.menu\n.ping\n.info\n.owner' });
            if (text === '.ping') await sock.sendMessage(from, { text: 'Pong!' });
            if (text === '.info') await sock.sendMessage(from, { text: 'NEBOLUSVERSE BOT' });
            if (text === '.owner') await sock.sendMessage(from, { text: 'BELLIOT Ganteng' });
        });

    } catch (e) {
        console.log('START BOT ERROR:', e.message);
        setTimeout(() => startBot(), 5000);
    }
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
            await new Promise(r => setTimeout(r, 4000));

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
        } catch (e) { socket.emit('pairing-error', e.message); }
    });
});

// Start server DULU, baru bot
server.listen(PORT, () => console.log('Web jalan di port ' + PORT));
setTimeout(() => startBot(), 1000);
