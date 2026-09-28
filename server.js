const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
// Membaca kredensial dari environment variable Railway (aman dan tidak perlu file fisik)
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
  : require("./serviceAccountKey.json");

console.log("Firebase Project ID:", serviceAccount.project_id);

initializeApp({
  credential: cert(serviceAccount),
  storageBucket: "esuratfdk-web.appspot.com"
});

const db = getFirestore();
const bucket = getStorage().bucket();
const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Folder Penyimpanan Sementara (Backup Lokal)
const processedDir = path.join(__dirname, 'processed');
const sigDir = path.join(__dirname, 'signatures');

[processedDir, sigDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(fileUpload());

// Folder Static
app.use(express.static(path.join(__dirname, 'public')));
app.use('/signatures', express.static(sigDir));
app.use('/processed', express.static(processedDir));

// Data User (Admin & Daftar Mahasiswa) - Tetap dipertahankan untuk autentikasi awal
const USERS = [
    { 
        username: 'fdkuinbandung', 
        password: 'uinbandung', 
        role: 'admin', 
        name: 'Administrator TU FDK' 
    },
    { 
        username: '1244060082', 
        password: '123', 
        role: 'mahasiswa', 
        name: 'Muhamad Ridho',
        nim: '1244060082',
        jurusan: 'Bimbingan Konseling Islam',
        email: 'ridho@uinsgd.ac.id'
    }
];

// Endpoint Register Mahasiswa
app.post('/api/register', async (req, res) => {
    try {
        const { nama, nim, jurusan, email, password } = req.body;

        if (!nim || !password || !nama) {
            return res.status(400).json({ success: false, message: 'Lengkapi semua field pendaftaran!' });
        }

        const existingUser = USERS.find(u => u.username === nim);
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'NIM tersebut sudah terdaftar! Silakan login.' });
        }

        const newUser = {
            username: nim,
            password: password,
            name: nama,
            nim: nim,
            jurusan: jurusan,
            email: email,
            role: 'mahasiswa'
        };

        USERS.push(newUser);

        // Opsional: Simpan data user ke Firestore juga jika diperlukan permanen
        await db.collection('users').doc(nim).set(newUser);

        return res.json({ 
            success: true, 
            message: 'Pendaftaran berhasil! Silakan login menggunakan NIM dan Password Anda.' 
        });
    } catch (error) {
        console.error("Error register:", error);
        return res.status(500).json({ success: false, message: 'Gagal melakukan pendaftaran.' });
    }
});

// Endpoint Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = USERS.find(u => u.username === username && u.password === password);
    if (user) {
        res.json({ 
            success: true, 
            user: { 
                name: user.name, 
                role: user.role, 
                username: user.username,
                nim: user.nim || '',
                jurusan: user.jurusan || ''
            } 
        });
    } else {
        res.status(401).json({ success: false, message: 'Username/NIM atau password salah!' });
    }
});

// Endpoint 1: Mahasiswa Mengajukan Surat (Simpan ke Firestore)
app.post('/api/ajukan-surat', async (req, res) => {
    try {
        const payload = req.body;
        const suratId = Date.now().toString();

        const newSurat = {
            id: suratId,
            mahasiswa: payload.mahasiswa || 'Mahasiswa',
            nim: payload.nim || '-',
            jenisSurat: payload.jenisSurat,
            nomorSurat: '...',
            bulanKe: payload.bulanKe || '09',
            tahun: payload.tahun || '2026',
            tanggalSurat: payload.tanggalSurat || '28 September 2026',
            formData: payload,
            signedFileUrl: null,
            status: 'Diproses',
            createdAt: FieldValue.serverTimestamp()
        };

        // Simpan permanen ke Firestore collection 'surat_keluar'
        await db.collection('surat_keluar').doc(suratId).set(newSurat);

        io.emit('update_surat_list');
        return res.json({ success: true, message: 'Permohonan surat berhasil dikirim ke Admin!', data: { ...newSurat, createdAt: new Date().toLocaleString('id-ID') } });
    } catch (error) {
        console.error("Error ajukan surat:", error);
        return res.status(500).json({ success: false, message: 'Gagal mengajukan surat ke database.' });
    }
});

// Endpoint 2: Ambil Daftar Surat dari Firestore (Private Terisolasi Berdasarkan NIM)
app.get('/api/surat', async (req, res) => {
    try {
        const { nim } = req.query;
        let queryRef = db.collection('surat_keluar');

        if (nim) {
            queryRef = queryRef.where('nim', '==', nim);
        }

        const snapshot = await queryRef.get();
        const suratList = [];

        snapshot.forEach(doc => {
            const data = doc.data();
            // Format timestamp firestore agar aman dibaca frontend
            suratList.push({
                ...data,
                createdAt: data.createdAt && data.createdAt.toDate ? data.createdAt.toDate().toLocaleString('id-ID') : data.createdAt
            });
        });

        return res.json(suratList);
    } catch (error) {
        console.error("Error ambil surat:", error);
        return res.status(500).json({ success: false, message: 'Gagal mengambil data surat.' });
    }
});

// Endpoint 3: Admin Menyimpan Surat Resmi A4 (Simpan ke Firebase Storage & Update Firestore)
app.post('/api/proses-admin-surat', async (req, res) => {
    try {
        const { id, nomorSurat, htmlContent } = req.body;
        
        const suratRef = db.collection('surat_keluar').doc(String(id));
        const suratDoc = await suratRef.get();

        if (!suratDoc.exists) {
            return res.status(404).json({ success: false, message: 'Surat tidak ditemukan di database' });
        }

        const fileName = `SURAT_RESMI_${id}.html`;
        const localFilePath = path.join(processedDir, fileName);

        const fullDocumentHtml = `
            <!DOCTYPE html>
            <html lang="id">
            <head>
                <meta charset="UTF-8">
                <title>Surat Resmi - ${nomorSurat}</title>
                <style>
                    @page {
                        size: A4 portrait;
                        margin: 15mm 20mm 15mm 20mm;
                    }
                    body { 
                        font-family: 'Times New Roman', Times, serif; 
                        color: #000; 
                        line-height: 1.5; 
                        background: #fff;
                        margin: 0;
                        padding: 0;
                    }
                    .page-container {
                        width: 100%;
                        max-width: 210mm;
                        margin: auto;
                    }
                    @media print {
                        .no-print { display: none !important; }
                        body { background: white; margin: 0; }
                        .page-container { border: none; box-shadow: none; padding: 0; }
                    }
                </style>
            </head>
            <body>
                <div class="no-print" style="margin: 15px; text-align: right; background: #f8fafc; padding: 12px; border-bottom: 1px solid #e2e8f0;">
                    <button onclick="window.print()" style="padding: 10px 20px; background: #16a34a; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">🖨️ Cetak Surat / Simpan ke PDF (A4)</button>
                </div>
                <div class="page-container">
                    ${htmlContent}
                </div>
            </body>
            </html>
        `;

        // Simpan sementara lokal lalu upload ke Firebase Storage agar permanen
        fs.writeFileSync(localFilePath, fullDocumentHtml);

        const destination = `surat_processed/${fileName}`;
        await bucket.upload(localFilePath, {
            destination: destination,
            public: true,
            metadata: { contentType: 'text/html' }
        });

        // Dapatkan Public URL dari Firebase Storage
        const fileRef = bucket.file(destination);
        const [url] = await fileRef.getSignedUrl({
            action: 'read',
            expires: '03-01-2500' // Berlaku jangka panjang
        }).catch(() => {
            // Fallback jika signed url gagal, gunakan public url bawaan bucket
            return [`https://storage.googleapis.com/${bucket.name}/${destination}`];
        });

        // Update status di Firestore
        await suratRef.update({
            nomorSurat: nomorSurat,
            signedFileUrl: url,
            status: 'Disetujui'
        });

        io.emit('update_surat_list');
        res.json({ success: true, message: 'Surat resmi berhasil disetujui, diunggah ke Cloud Storage, & diterbitkan!' });
    } catch (err) {
        console.error("Error simpan surat ke firebase:", err);
        res.status(500).json({ success: false, message: 'Gagal memproses dan menyimpan surat ke cloud.' });
    }
});

// Socket.io Realtime Chat Private (WhatsApp Style) dengan sinkronisasi Firestore
io.on('connection', (socket) => {

    // Inisialisasi room chat saat user login
    socket.on('join_chat_session', async (data) => {
        if (data.role === 'mahasiswa') {
            const nim = data.nim;
            socket.join(`room_${nim}`);

            const chatDocRef = db.collection('chats').doc(nim);
            const chatDoc = await chatDocRef.get();

            let chatData = { nama: data.name || 'Mahasiswa', messages: [] };
            if (chatDoc.exists) {
                chatData = chatDoc.data();
            } else {
                await chatDocRef.set(chatData);
            }

            socket.emit('load_room_messages', chatData.messages);
            io.emit('update_chat_rooms', await getRoomListAsync());
        } else if (data.role === 'admin') {
            socket.join('admin_room');
            socket.emit('update_chat_rooms', await getRoomListAsync());
        }
    });

    // Admin memilih/berpindah ke chat room mahasiswa tertentu
    socket.on('switch_chat_room', async (data) => {
        const roomNim = data.nim;
        const chatDocRef = db.collection('chats').doc(roomNim);
        const chatDoc = await chatDocRef.get();

        if (chatDoc.exists) {
            socket.emit('load_room_messages', chatDoc.data().messages);
        } else {
            socket.emit('load_room_messages', []);
        }
    });

    // Mengirim pesan privat dan menyimpannya ke Firestore
    socket.on('send_private_message', async (data) => {
        const { roomNim, sender, role, text } = data;
        if (!roomNim) return;

        const msg = {
            sender: sender,
            role: role,
            text: text,
            time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        };

        const chatDocRef = db.collection('chats').doc(roomNim);
        const chatDoc = await chatDocRef.get();

        let chatData = { nama: 'Mahasiswa', messages: [] };
        if (chatDoc.exists) {
            chatData = chatDoc.data();
        } else {
            const userObj = USERS.find(u => u.username === roomNim);
            chatData.nama = userObj ? userObj.name : 'Mahasiswa';
        }

        chatData.messages.push(msg);
        await chatDocRef.set(chatData);

        // Broadcast ke room mahasiswa dan admin aktif
        io.to(`room_${roomNim}`).emit('receive_message', msg);
        io.to('admin_room').emit('receive_message', msg);

        io.emit('update_chat_rooms', await getRoomListAsync());
    });
});

async function getRoomListAsync() {
    try {
        const snapshot = await db.collection('chats').get();
        const rooms = [];
        snapshot.forEach(doc => {
            rooms.push({
                nim: doc.id,
                nama: doc.data().nama || 'Mahasiswa'
            });
        });
        return rooms;
    } catch (e) {
        console.error("Gagal mengambil daftar room chat:", e);
        return [];
    }
}

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "SIRAT server is running"
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`KEREN: Server sukses berjalan di port ${PORT}`);
});