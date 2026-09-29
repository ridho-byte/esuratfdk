const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const express = require("express");
const fileUpload = require("express-fileupload");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// =====================================================
// FIREBASE
// =====================================================

// =====================================================
// FIREBASE
// =====================================================

// Firebase App Hosting menggunakan Application Default Credentials.
// Saat lokal, gunakan serviceAccountKey.json melalui GOOGLE_APPLICATION_CREDENTIALS.

initializeApp({
    credential: applicationDefault()
});

const db = getFirestore();

console.log("🔥 Firebase Admin berhasil diinisialisasi");

// =====================================================
// FOLDER SIGNATURE
// =====================================================

const sigDir = path.join(__dirname, "signatures");

if (!fs.existsSync(sigDir)) {
    fs.mkdirSync(sigDir, { recursive: true });
}

// =====================================================
// EMBED TTD SEBAGAI BASE64
// =====================================================

function getSignatureBase64(filename) {
    const filePath = path.join(sigDir, filename);

    try {
        if (!fs.existsSync(filePath)) {
            console.error(`❌ TTD tidak ditemukan: ${filePath}`);
            return "";
        }

        const base64 = fs.readFileSync(filePath).toString("base64");

        console.log(`✅ TTD terbaca: ${filename}`);

        return `data:image/png;base64,${base64}`;
    } catch (error) {
        console.error(`❌ Gagal membaca TTD ${filename}:`, error);
        return "";
    }
}

const ttdDekan = getSignatureBase64("ttd dekan.png");
const ttdWd1 = getSignatureBase64("ttd wd 1.png");
const ttdWd3 = getSignatureBase64("ttd wd 3.png");

// =====================================================
// MIDDLEWARE
// =====================================================

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(fileUpload());

// =====================================================
// FOLDER STATIC
// =====================================================

app.use(express.static(path.join(__dirname, "public")));

// Folder signature tetap boleh diakses,
// tetapi surat resmi tidak lagi disimpan di folder processed.
app.use("/signatures", express.static(sigDir));

// =====================================================
// DATA USER
// =====================================================

const USERS = [
    {
        username: "fdkuinbandung",
        password: "uinbandung",
        role: "admin",
        name: "Administrator TU FDK"
    },
    {
        username: "1244060082",
        password: "123",
        role: "mahasiswa",
        name: "Muhamad Ridho",
        nim: "1244060082",
        jurusan: "Bimbingan Konseling Islam",
        email: "ridho@uinsgd.ac.id"
    }
];

// =====================================================
// ENDPOINT REGISTER MAHASISWA
// =====================================================

app.post("/api/register", async (req, res) => {
    try {
        const {
            nama,
            nim,
            jurusan,
            email,
            password
        } = req.body;

        if (!nim || !password || !nama) {
            return res.status(400).json({
                success: false,
                message: "Lengkapi semua field pendaftaran!"
            });
        }

        const existingUser = USERS.find(
            u => u.username === nim
        );

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: "NIM tersebut sudah terdaftar! Silakan login."
            });
        }

        const newUser = {
            username: nim,
            password: password,
            name: nama,
            nim: nim,
            jurusan: jurusan,
            email: email,
            role: "mahasiswa"
        };

        USERS.push(newUser);

        // Simpan user ke Firestore
        await db.collection("users").doc(nim).set(newUser);

        return res.json({
            success: true,
            message: "Pendaftaran berhasil! Silakan login menggunakan NIM dan Password Anda."
        });

    } catch (error) {
        console.error("Error register:", error);

        return res.status(500).json({
            success: false,
            message: "Gagal melakukan pendaftaran."
        });
    }
});

// =====================================================
// ENDPOINT LOGIN
// =====================================================

app.post("/api/login", (req, res) => {

    const {
        username,
        password
    } = req.body;

    const user = USERS.find(
        u =>
            u.username === username &&
            u.password === password
    );

    if (user) {

        res.json({
            success: true,
            user: {
                name: user.name,
                role: user.role,
                username: user.username,
                nim: user.nim || "",
                jurusan: user.jurusan || ""
            }
        });

    } else {

        res.status(401).json({
            success: false,
            message: "Username/NIM atau password salah!"
        });

    }
});

// =====================================================
// ENDPOINT RESET PASSWORD MAHASISWA OLEH ADMIN
// =====================================================

app.post("/api/reset-password", async (req, res) => {

    try {

        const {
            nim,
            newPassword,
            adminUsername,
            adminPassword
        } = req.body;

        // Validasi input
        if (
            !nim ||
            !newPassword ||
            !adminUsername ||
            !adminPassword
        ) {
            return res.status(400).json({
                success: false,
                message: "NIM, password baru, dan verifikasi admin wajib diisi."
            });
        }

        // Verifikasi akun admin
        const adminUser = USERS.find(
            u =>
                u.username === adminUsername &&
                u.password === adminPassword &&
                u.role === "admin"
        );

        if (!adminUser) {
            return res.status(401).json({
                success: false,
                message: "Verifikasi admin gagal. Username atau password admin salah."
            });
        }

        // Validasi password baru
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password baru minimal 6 karakter."
            });
        }

        // Cari mahasiswa di Firestore
        const userRef = db
            .collection("users")
            .doc(String(nim));

        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(404).json({
                success: false,
                message: "Mahasiswa dengan NIM tersebut tidak ditemukan."
            });
        }

        // Update password Firestore
        await userRef.update({
            password: newPassword
        });

        // Update password di memory USERS
        const userIndex = USERS.findIndex(
            u => String(u.username) === String(nim)
        );

        if (userIndex !== -1) {

            USERS[userIndex].password = newPassword;

        } else {

            const userData = userDoc.data();

            USERS.push({
                ...userData,
                username: userData.username || nim,
                password: newPassword,
                role: "mahasiswa"
            });
        }

        console.log(
            `✅ Password mahasiswa ${nim} berhasil direset oleh admin.`
        );

        return res.json({
            success: true,
            message: `Password mahasiswa ${nim} berhasil direset.`
        });

    } catch (error) {

        console.error(
            "Error reset password:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Gagal mereset password mahasiswa."
        });
    }
});

// =====================================================
// ENDPOINT 1
// MAHASISWA MENGAJUKAN SURAT
// =====================================================

app.post("/api/ajukan-surat", async (req, res) => {

    try {

        const payload = req.body;

        const suratId = Date.now().toString();

        const newSurat = {

            id: suratId,

            mahasiswa:
                payload.mahasiswa || "Mahasiswa",

            nim:
                payload.nim || "-",

            jenisSurat:
                payload.jenisSurat,

            nomorSurat:
                "...",

            bulanKe:
                payload.bulanKe || "09",

            tahun:
                payload.tahun || "2026",

            tanggalSurat:
                payload.tanggalSurat ||
                "28 September 2026",

            formData:
                payload,

            signedFileUrl:
                null,

            status:
                "Diproses",

            createdAt:
                FieldValue.serverTimestamp()
        };

        // Simpan ke Firestore
        await db
            .collection("surat_keluar")
            .doc(suratId)
            .set(newSurat);

        // Beritahu admin
        io.emit("update_surat_list");

        return res.json({
            success: true,
            message:
                "Permohonan surat berhasil dikirim ke Admin!",
            data: {
                ...newSurat,
                createdAt:
                    new Date().toLocaleString("id-ID")
            }
        });

    } catch (error) {

        console.error(
            "Error ajukan surat:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Gagal mengajukan surat ke database."
        });
    }
});

// =====================================================
// ENDPOINT 2
// AMBIL DAFTAR SURAT
// =====================================================

app.get("/api/surat", async (req, res) => {

    try {

        const {
            nim
        } = req.query;

        let queryRef =
            db.collection("surat_keluar");

        // Jika mahasiswa mengirim NIM,
        // hanya surat milik NIM tersebut yang dikembalikan.
        if (nim) {

            queryRef =
                queryRef.where(
                    "nim",
                    "==",
                    nim
                );
        }

        const snapshot =
            await queryRef.get();

        const suratList = [];

        snapshot.forEach(doc => {

            const data = doc.data();

            suratList.push({

                ...data,

                createdAt:
                    data.createdAt &&
                    data.createdAt.toDate
                        ? data.createdAt
                            .toDate()
                            .toLocaleString("id-ID")
                        : data.createdAt
            });

        });

        return res.json(
            suratList
        );

    } catch (error) {

        console.error(
            "Error ambil surat:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Gagal mengambil data surat."
        });
    }
});

// =====================================================
// ENDPOINT MEMBUKA SURAT RESMI
// SURAT DIAMBIL DARI FIRESTORE
// =====================================================

app.get("/api/surat-file/:id", async (req, res) => {

    try {

        const {
            id
        } = req.params;

        const fileDoc =
            await db
                .collection("surat_files")
                .doc(String(id))
                .get();

        if (!fileDoc.exists) {

            return res.status(404).send(`
                <!DOCTYPE html>
                <html lang="id">
                <head>
                    <meta charset="UTF-8">
                    <title>Surat Tidak Ditemukan</title>
                </head>
                <body>
                    <h2>Surat tidak ditemukan</h2>
                    <p>File surat dengan ID ${id} tidak tersedia.</p>
                </body>
                </html>
            `);
        }

        const data =
            fileDoc.data();

        if (!data.htmlContent) {

            return res.status(404).send(`
                <h2>Isi surat tidak tersedia</h2>
                <p>Data HTML surat tidak ditemukan.</p>
            `);
        }

        res.setHeader(
            "Content-Type",
            "text/html; charset=utf-8"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache"
        );

        return res.send(
            data.htmlContent
        );

    } catch (error) {

        console.error(
            "Error mengambil file surat:",
            error
        );

        return res.status(500).send(`
            <!DOCTYPE html>
            <html lang="id">
            <head>
                <meta charset="UTF-8">
                <title>Error</title>
            </head>
            <body>
                <h2>Gagal membuka surat</h2>
                <p>Terjadi kesalahan saat mengambil surat.</p>
            </body>
            </html>
        `);
    }
});

// =====================================================
// ENDPOINT 3
// ADMIN MEMPROSES DAN MENERBITKAN SURAT
//
// SURAT DISIMPAN KE FIRESTORE
// TIDAK MENGGUNAKAN FIREBASE STORAGE
// =====================================================

app.post("/api/proses-admin-surat", async (req, res) => {

    try {

        const {
            id,
            nomorSurat,
            htmlContent
        } = req.body;

        // -------------------------------------------------
        // VALIDASI
        // -------------------------------------------------

        if (!id) {

            return res.status(400).json({
                success: false,
                message: "ID surat tidak ditemukan."
            });
        }

        if (!htmlContent) {

            return res.status(400).json({
                success: false,
                message: "Isi HTML surat tidak ditemukan."
            });
        }

        if (!nomorSurat) {

            return res.status(400).json({
                success: false,
                message: "Nomor surat wajib diisi."
            });
        }

        // -------------------------------------------------
        // GANTI URL GAMBAR TTD MENJADI BASE64
        // -------------------------------------------------

        let processedHtmlContent =
            htmlContent || "";

        processedHtmlContent =
            processedHtmlContent

                .replace(
                    /(?:https?:\/\/[^"' ]+)?\/?signatures\/ttd(?:%20|\s)dekan\.png/gi,
                    ttdDekan
                )

                .replace(
                    /(?:https?:\/\/[^"' ]+)?\/?signatures\/ttd(?:%20|\s)wd(?:%20|\s)1\.png/gi,
                    ttdWd1
                )

                .replace(
                    /(?:https?:\/\/[^"' ]+)?\/?signatures\/ttd(?:%20|\s)wd(?:%20|\s)3\.png/gi,
                    ttdWd3
                );

        // -------------------------------------------------
        // CEK SURAT DI FIRESTORE
        // -------------------------------------------------

        const suratRef =
            db
                .collection("surat_keluar")
                .doc(String(id));

        const suratDoc =
            await suratRef.get();

        if (!suratDoc.exists) {

            return res.status(404).json({
                success: false,
                message:
                    "Surat tidak ditemukan di database."
            });
        }

        // -------------------------------------------------
        // BANGUN HTML SURAT LENGKAP
        // -------------------------------------------------

        const fileName =
            `SURAT_RESMI_${id}.html`;

        const fullDocumentHtml = `
<!DOCTYPE html>
<html lang="id">

<head>

    <meta charset="UTF-8">

    <meta name="viewport"
          content="width=device-width, initial-scale=1.0">

    <title>
        Surat Resmi - ${nomorSurat}
    </title>

    <style>

        @page {

            size: A4 portrait;

            margin:
                15mm
                20mm
                15mm
                20mm;
        }

        body {

            font-family:
                'Times New Roman',
                Times,
                serif;

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

            .no-print {

                display: none !important;
            }

            body {

                background: white;

                margin: 0;
            }

            .page-container {

                border: none;

                box-shadow: none;

                padding: 0;
            }
        }

    </style>

</head>

<body>

    <div
        class="no-print"
        style="
            margin: 15px;
            text-align: right;
            background: #f8fafc;
            padding: 12px;
            border-bottom: 1px solid #e2e8f0;
        "
    >

        <button
            onclick="window.print()"
            style="
                padding: 10px 20px;
                background: #16a34a;
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-weight: bold;
                font-size: 14px;
            "
        >
            🖨️ Cetak Surat / Simpan ke PDF (A4)
        </button>

    </div>

    <div class="page-container">

        ${processedHtmlContent}

    </div>

</body>

</html>
        `;

        // -------------------------------------------------
        // CEK UKURAN HTML
        //
        // Firestore memiliki batas ukuran dokumen
        // sekitar 1 MiB.
        // Kita batasi sedikit di bawah batas maksimum.
        // -------------------------------------------------

        const htmlSize =
            Buffer.byteLength(
                fullDocumentHtml,
                "utf8"
            );

        console.log(
            `📄 Ukuran HTML surat: ${(htmlSize / 1024).toFixed(2)} KB`
        );

        if (htmlSize > 1000000) {

            console.error(
                `❌ Surat terlalu besar: ${htmlSize} bytes`
            );

            return res.status(413).json({

                success: false,

                message:
                    "Ukuran surat terlalu besar untuk disimpan di Firestore. Ukuran maksimum praktis sekitar 1 MB."
            });
        }

        // -------------------------------------------------
        // SIMPAN HTML SURAT KE FIRESTORE
        //
        // Collection:
        // surat_files
        //
        // ID document:
        // sama dengan ID surat
        // -------------------------------------------------

        const fileRef =
            db
                .collection("surat_files")
                .doc(String(id));

        await fileRef.set({

            suratId:
                String(id),

            fileName:
                fileName,

            htmlContent:
                fullDocumentHtml,

            contentType:
                "text/html",

            sizeBytes:
                htmlSize,

            createdAt:
                FieldValue.serverTimestamp()
        });

        console.log(
            `✅ File surat ${id} berhasil disimpan ke Firestore.`
        );

        // -------------------------------------------------
        // URL SURAT
        //
        // Tidak menggunakan Firebase Storage.
        // Surat dibuka melalui server Express.
        // -------------------------------------------------

        const url =
            `/api/surat-file/${id}`;

        // -------------------------------------------------
        // UPDATE DATA SURAT
        // -------------------------------------------------

        await suratRef.update({

            nomorSurat:
                nomorSurat,

            signedFileUrl:
                url,

            status:
                "Disetujui"
        });

        console.log(
            `✅ Data surat ${id} berhasil diperbarui.`
        );

        // -------------------------------------------------
        // BERITAHU FRONTEND
        // -------------------------------------------------

        io.emit(
            "update_surat_list"
        );

        // -------------------------------------------------
        // RESPONSE
        // -------------------------------------------------

        return res.json({

            success: true,

            message:
                "Surat resmi berhasil disetujui dan diterbitkan!",

            url:
                url
        });

    } catch (err) {

        console.error(
            "❌ Error simpan surat ke Firestore:",
            err
        );

        return res.status(500).json({

            success: false,

            message:
                "Gagal memproses dan menyimpan surat ke cloud.",

            error:
                process.env.NODE_ENV === "development"
                    ? err.message
                    : undefined
        });
    }
});

// =====================================================
// SOCKET.IO
// REALTIME CHAT PRIVATE
// =====================================================

io.on("connection", (socket) => {

    console.log(
        "🔌 Socket terhubung:",
        socket.id
    );

    // =================================================
    // USER JOIN CHAT SESSION
    // =================================================

    socket.on(
        "join_chat_session",
        async (data) => {

            try {

                if (data.role === "mahasiswa") {

                    const nim =
                        data.nim;

                    socket.join(
                        `room_${nim}`
                    );

                    const chatDocRef =
                        db
                            .collection("chats")
                            .doc(nim);

                    const chatDoc =
                        await chatDocRef.get();

                    let chatData = {

                        nama:
                            data.name ||
                            "Mahasiswa",

                        messages: []
                    };

                    if (chatDoc.exists) {

                        chatData =
                            chatDoc.data();

                    } else {

                        await chatDocRef.set(
                            chatData
                        );
                    }

                    socket.emit(
                        "load_room_messages",
                        chatData.messages || []
                    );

                    io.emit(
                        "update_chat_rooms",
                        await getRoomListAsync()
                    );

                } else if (
                    data.role === "admin"
                ) {

                    socket.join(
                        "admin_room"
                    );

                    socket.emit(
                        "update_chat_rooms",
                        await getRoomListAsync()
                    );
                }

            } catch (error) {

                console.error(
                    "Error join chat:",
                    error
                );
            }
        }
    );

    // =================================================
    // ADMIN SWITCH CHAT ROOM
    // =================================================

    socket.on(
        "switch_chat_room",
        async (data) => {

            try {

                const roomNim =
                    data.nim;

                if (!roomNim) {

                    socket.emit(
                        "load_room_messages",
                        []
                    );

                    return;
                }

                const chatDocRef =
                    db
                        .collection("chats")
                        .doc(roomNim);

                const chatDoc =
                    await chatDocRef.get();

                if (chatDoc.exists) {

                    socket.emit(
                        "load_room_messages",
                        chatDoc.data().messages || []
                    );

                } else {

                    socket.emit(
                        "load_room_messages",
                        []
                    );
                }

            } catch (error) {

                console.error(
                    "Error switch chat room:",
                    error
                );

                socket.emit(
                    "load_room_messages",
                    []
                );
            }
        }
    );

    // =================================================
    // SEND PRIVATE MESSAGE
    // =================================================

    socket.on(
        "send_private_message",
        async (data) => {

            try {

                const {
                    roomNim,
                    sender,
                    role,
                    text
                } = data;

                if (!roomNim) {
                    return;
                }

                if (!text || !String(text).trim()) {
                    return;
                }

                const msg = {

                    sender:
                        sender,

                    role:
                        role,

                    text:
                        text,

                    time:
                        new Date().toLocaleTimeString(
                            "id-ID",
                            {
                                hour: "2-digit",
                                minute: "2-digit"
                            }
                        )
                };

                const chatDocRef =
                    db
                        .collection("chats")
                        .doc(roomNim);

                const chatDoc =
                    await chatDocRef.get();

                let chatData = {

                    nama:
                        "Mahasiswa",

                    messages: []
                };

                if (chatDoc.exists) {

                    chatData =
                        chatDoc.data();

                } else {

                    const userObj =
                        USERS.find(
                            u =>
                                u.username ===
                                roomNim
                        );

                    chatData.nama =
                        userObj
                            ? userObj.name
                            : "Mahasiswa";
                }

                if (!Array.isArray(chatData.messages)) {

                    chatData.messages = [];
                }

                chatData.messages.push(
                    msg
                );

                await chatDocRef.set(
                    chatData
                );

                // Broadcast ke mahasiswa
                io.to(
                    `room_${roomNim}`
                ).emit(
                    "receive_message",
                    msg
                );

                // Broadcast ke admin
                io.to(
                    "admin_room"
                ).emit(
                    "receive_message",
                    msg
                );

                // Update daftar room
                io.emit(
                    "update_chat_rooms",
                    await getRoomListAsync()
                );

            } catch (error) {

                console.error(
                    "Error send private message:",
                    error
                );
            }
        }
    );

    // =================================================
    // DISCONNECT
    // =================================================

    socket.on(
        "disconnect",
        () => {

            console.log(
                "🔌 Socket terputus:",
                socket.id
            );

        }
    );

});

// =====================================================
// AMBIL DAFTAR ROOM CHAT
// =====================================================

async function getRoomListAsync() {

    try {

        const snapshot =
            await db
                .collection("chats")
                .get();

        const rooms = [];

        snapshot.forEach(doc => {

            const data =
                doc.data();

            rooms.push({

                nim:
                    doc.id,

                nama:
                    data.nama ||
                    "Mahasiswa"
            });

        });

        return rooms;

    } catch (e) {

        console.error(
            "Gagal mengambil daftar room chat:",
            e
        );

        return [];
    }
}

// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
    "/health",
    (req, res) => {

        res.status(200).json({

            status:
                "OK",

            message:
                "SIRAT server is running",

            firebaseProject:
                serviceAccount.project_id
        });

    }
);

// =====================================================
// SERVER
// =====================================================

const PORT =
    process.env.PORT || 3000;

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `🚀 KEREN: Server sukses berjalan di port ${PORT}`
        );

        console.log(
            "🔥 Firebase Admin berhasil diinisialisasi"
        );

        console.log(
            "☁️ Penyimpanan surat: Firestore"
        );

        console.log(
            "🖊️ TTD: Base64 embedded"
        );

    }
);