require("dotenv").config();

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const express = require("express");
const fileUpload = require("express-fileupload");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { Server } = require("socket.io");
const bcrypt = require("bcrypt");
const session = require("express-session");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set("trust proxy", 1);

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8
  }
});

app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

function requireAuth(req, res, next) {
    if (!req.session?.user) {
        return res.status(401).json({
            success: false,
            message: "Silakan login terlebih dahulu."
        });
    }

    next();
}

function requireAdmin(req, res, next) {
    if (!req.session?.user) {
        return res.status(401).json({
            success: false,
            message: "Silakan login terlebih dahulu."
        });
    }

    if (req.session.user.role !== "admin") {
        return res.status(403).json({
            success: false,
            message: "Akses khusus administrator."
        });
    }

    next();
}

// =====================================================
// FIREBASE
// =====================================================

// =====================================================
// FIREBASE
// =====================================================

// Firebase App Hosting menggunakan Application Default Credentials.
// Saat lokal, gunakan serviceAccountKey.json melalui GOOGLE_APPLICATION_CREDENTIALS.

let firebaseApp;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  firebaseApp = initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    projectId: "esuratfdk-web"
  });
} else if (fs.existsSync(path.join(__dirname, "serviceAccountKey.json"))) {
  firebaseApp = initializeApp({
    credential: cert(require("./serviceAccountKey.json")),
    projectId: "esuratfdk-web"
  });
} else {
  // Untuk Firebase App Hosting
  firebaseApp = initializeApp({
    projectId: "esuratfdk-web"
  });
}

const db = getFirestore(firebaseApp);


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
        const { nama, nim, jurusan, email, password } = req.body;

        if (!nim || !password || !nama) {
            return res.status(400).json({
                success: false,
                message: "Lengkapi semua field pendaftaran!"
            });
        }

        if (String(password).length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password minimal 6 karakter."
            });
        }

        const cleanNim = String(nim).trim();
        const userRef = db.collection("users").doc(cleanNim);
        const userDoc = await userRef.get();

        const existingUser = USERS.find(
            u => String(u.username) === cleanNim
        );

        if (userDoc.exists || existingUser) {
            return res.status(400).json({
                success: false,
                message: "NIM tersebut sudah terdaftar! Silakan login."
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = {
            username: cleanNim,
            password: hashedPassword,
            name: String(nama).trim(),
            nim: cleanNim,
            jurusan: jurusan || "",
            email: email || "",
            role: "mahasiswa"
        };

        await userRef.set(newUser);
        USERS.push(newUser);

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


app.post("/api/login", async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Username/NIM dan password wajib diisi."
            });
        }

        const cleanUsername = String(username).trim();

        // Login admin: sementara masih memakai data admin lama.
        const adminUsername = process.env.ADMIN_USERNAME;
        const adminPassword = process.env.ADMIN_PASSWORD;
        
        // Pemeriksaan sementara: tidak menampilkan kredensial asli.
        console.log("Cek konfigurasi admin:", {
            usernameAda: Boolean(adminUsername),
            passwordAda: Boolean(adminPassword),
            usernameCocok: cleanUsername === adminUsername,
            passwordCocok: password === adminPassword
        });

if (
    adminUsername &&
    adminPassword &&
    cleanUsername === adminUsername &&
    password === adminPassword
) {
            req.session.user = {
    username: adminUsername,
    role: "admin",
    name: "Administrator TU FDK"
};

            return req.session.save(err => {
                if (err) {
                    console.error("Gagal menyimpan session:", err);
                    return res.status(500).json({
                        success: false,
                        message: "Gagal membuat sesi login."
                    });
                }

                return res.json({
                    success: true,
                    user: req.session.user
                });
            });
        }

        // Login mahasiswa: ambil data terbaru dari Firestore.
        const userRef = db.collection("users").doc(cleanUsername);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return res.status(401).json({
                success: false,
                message: "Username/NIM atau password salah."
            });
        }

        const userData = userDoc.data();

        if (userData.role !== "mahasiswa") {
            return res.status(401).json({
                success: false,
                message: "Username/NIM atau password salah."
            });
        }

        
const storedPassword = String(userData.password || "");
let passwordValid = false;

if (/^\$2[aby]\$/.test(storedPassword)) {
  // Akun yang password-nya sudah berupa hash bcrypt
  passwordValid = await bcrypt.compare(
    String(password),
    storedPassword
  );
} else {
  // Akun lama yang password-nya masih berupa teks biasa
  passwordValid = String(password) === storedPassword;

  // Jika benar, langsung migrasikan password menjadi hash bcrypt
  if (passwordValid) {
    const hashedPassword = await bcrypt.hash(
      String(password),
      10
    );

    await userRef.update({
      password: hashedPassword
    });
  }
}

if (!passwordValid) {
  return res.status(401).json({
    success: false,
    message: "Username atau password salah."
  });
}


        req.session.user = {
            username: userData.username || cleanUsername,
            role: "mahasiswa",
            name: userData.name || "",
            nim: userData.nim || cleanUsername,
            jurusan: userData.jurusan || ""
        };

        return req.session.save(err => {
            if (err) {
                console.error("Gagal menyimpan session:", err);
                return res.status(500).json({
                    success: false,
                    message: "Gagal membuat sesi login."
                });
            }

            return res.json({
                success: true,
                user: req.session.user
            });
        });

    } catch (error) {
        console.error("Error login:", error);

        return res.status(500).json({
            success: false,
            message: "Terjadi kesalahan saat login."
        });
    }
});


app.post("/api/reset-password", requireAdmin, async (req, res) => {
    try {
        const nim = String(req.body.nim || "").trim();
        const newPassword = String(req.body.newPassword || "");

        if (!nim || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "NIM dan password baru wajib diisi."
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password baru minimal 6 karakter."
            });
        }

        const userRef = db.collection("users").doc(nim);
        const userDoc = await userRef.get();

        if (!userDoc.exists || userDoc.data().role !== "mahasiswa") {
            return res.status(404).json({
                success: false,
                message: "Data mahasiswa tidak ditemukan."
            });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await userRef.update({
            password: hashedPassword
        });

        return res.json({
            success: true,
            message: "Password mahasiswa berhasil direset."
        });
    } catch (error) {
        console.error("Error reset password:", error);
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


app.post("/api/ajukan-surat", requireAuth, async (req, res) => {
    try {
        const payload = req.body;
        const user = req.session.user;

        // Pengajuan surat hanya untuk mahasiswa.
        if (user.role !== "mahasiswa") {
            return res.status(403).json({
                success: false,
                message: "Hanya mahasiswa yang dapat mengajukan surat."
            });
        }

        const suratId = Date.now().toString();

        // Identitas diambil dari sesi login, bukan dari request browser.
        const nim = String(user.nim || user.username);
        const mahasiswa = user.name || "Mahasiswa";

        if (!payload.jenisSurat) {
            return res.status(400).json({
                success: false,
                message: "Jenis surat wajib dipilih."
            });
        }

        const newSurat = {
            id: suratId,
            mahasiswa,
            nim,
            jenisSurat: payload.jenisSurat,
            nomorSurat: "...",
            bulanKe: payload.bulanKe || "09",
            tahun: payload.tahun || "2026",
            tanggalSurat: payload.tanggalSurat || "28 September 2026",
            formData: {
                ...payload,
                mahasiswa,
                nim
            },
            signedFileUrl: null,
            status: "Diproses",
            createdAt: FieldValue.serverTimestamp()
        };

        await db.collection("surat_keluar")
            .doc(suratId)
            .set(newSurat);

        // Beritahu admin dan mahasiswa yang sedang terhubung.
        io.emit("update_surat_list");

        return res.json({
            success: true,
            message: "Permohonan surat berhasil dikirim ke Admin!",
            data: {
                ...newSurat,
                createdAt: new Date().toLocaleString("id-ID")
            }
        });

    } catch (error) {
        console.error("Error ajukan surat:", error);

        return res.status(500).json({
            success: false,
            message: "Gagal mengajukan surat ke database."
        });
    }
});


// =====================================================
// ENDPOINT 2
// AMBIL DAFTAR SURAT
// =====================================================


app.get("/api/surat", requireAuth, async (req, res) => {
    try {
        const user = req.session.user;

        let queryRef = db.collection("surat_keluar");

        // Mahasiswa hanya boleh melihat surat miliknya sendiri.
        // NIM diambil dari session, bukan query browser.
        if (user.role === "mahasiswa") {
            const nimLogin = String(user.nim || user.username);

            queryRef = queryRef.where("nim", "==", nimLogin);
        } else if (user.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Anda tidak memiliki akses melihat daftar surat."
            });
        }

        const snapshot = await queryRef.get();
        const suratList = [];

        snapshot.forEach((doc) => {
            const data = doc.data();
            let createdAtTime = 0;

            if (data.createdAt && data.createdAt.toDate) {
                createdAtTime = data.createdAt.toDate().getTime();
            }

            suratList.push({
                ...data,
                _createdAtTime: createdAtTime
            });
        });

        // Urutkan terbaru ke terlama.
        suratList.sort(
            (a, b) => b._createdAtTime - a._createdAtTime
        );

        // Hapus field bantuan sebelum dikirim ke browser.
        const result = suratList.map((surat) => {
            const { _createdAtTime, ...data } = surat;

            return {
                ...data,
                createdAt:
                    data.createdAt && data.createdAt.toDate
                        ? data.createdAt.toDate().toLocaleString("id-ID")
                        : data.createdAt
            };
        });

        return res.json(result);

    } catch (error) {
        console.error("Error ambil surat:", error);

        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data surat."
        });
    }
});


// =====================================================
// ENDPOINT MEMBUKA SURAT RESMI
// SURAT DIAMBIL DARI FIRESTORE
// =====================================================


app.get("/api/surat-file/:id", requireAuth, async (req, res) => {
    try {
        const id = String(req.params.id);
        const user = req.session.user;

        // Pastikan surat tercatat di koleksi surat keluar.
        const suratDoc = await db
            .collection("surat_keluar")
            .doc(id)
            .get();

        if (!suratDoc.exists) {
            return res.status(404).send("Surat tidak ditemukan.");
        }

        const surat = suratDoc.data();

        // Mahasiswa hanya boleh membuka surat miliknya sendiri.
        if (
            user.role === "mahasiswa" &&
            String(surat.nim) !== String(user.nim || user.username)
        ) {
            return res.status(403).send("Anda tidak memiliki akses ke surat ini.");
        }

        if (user.role !== "admin" && user.role !== "mahasiswa") {
            return res.status(403).send("Akses ditolak.");
        }

        const fileDoc = await db
            .collection("surat_files")
            .doc(id)
            .get();

        if (!fileDoc.exists) {
            return res.status(404).send("File surat tidak ditemukan.");
        }

        const data = fileDoc.data();

        if (!data.htmlContent) {
            return res.status(404).send("Isi surat tidak tersedia.");
        }

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "private, no-store");

        return res.send(data.htmlContent);

    } catch (error) {
        console.error("Error mengambil file surat:", error);

        return res.status(500).send("Gagal membuka surat.");
    }
});


// =====================================================
// ENDPOINT 3
// ADMIN MEMPROSES DAN MENERBITKAN SURAT
//
// SURAT DISIMPAN KE FIRESTORE
// TIDAK MENGGUNAKAN FIREBASE STORAGE
// =====================================================

app.post("/api/proses-admin-surat", requireAdmin, async (req, res) => {

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

const suratData = suratDoc.data();

const jenis = suratData.jenisSurat || suratData.jenis || '';

const isF4 =
    jenis === 'Surat Keterangan Aktif Kuliah (Anak PNS/TNI/POLRI)';

const paperSize = isF4
    ? '215.9mm 330.2mm'
    : 'A4 portrait';

const maxWidth = isF4
    ? '215.9mm'
    : '210mm';

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
    size: ${paperSize};
    margin:
        15mm
        20mm
        15mm
        20mm;
}
        }

        body {
    font-family:
        'Times New Roman',
        Times,
        serif;
    font-size: 12pt;
    color: #000;
    line-height: 1.15;
    background: #fff;
    margin: 0;
    padding: 0;
}
        .page-container {
    width: 100%;
    max-width: ${maxWidth};
    margin: auto;
    font-family: 'Times New Roman', Times, serif;
    font-size: 12pt;
    line-height: 1.15;
}

.page-container p,
.page-container table,
.page-container td,
.page-container th,
.page-container li,
.page-container span {
    font-size: 12pt !important;
    line-height: 1.15 !important;
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
            🖨️ Cetak Surat / Simpan ke PDF (${isF4 ? 'F4' : 'A4'})
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
    const user = socket.request.session?.user;

    // Tolak koneksi tanpa session login yang valid.
    if (
        !user ||
        !["admin", "mahasiswa"].includes(user.role) ||
        !user.username ||
        (user.role === "mahasiswa" && !user.nim)
    ) {
        socket.disconnect(true);
        return;
    }

    const isAdmin = user.role === "admin";
    const userNim = String(user.nim || user.username);

    console.log("Socket terhubung:", socket.id, user.role);

    // Identitas ditentukan server, bukan data browser.
    socket.on("join_chat_session", async () => {
        try {
            if (isAdmin) {
                socket.join("admin_room");

                socket.emit(
                    "update_chat_rooms",
                    await getRoomListAsync()
                );
                return;
            }

            socket.join(`room_${userNim}`);

            const chatDocRef = db.collection("chats").doc(userNim);
            const chatDoc = await chatDocRef.get();

            let chatData;

            if (chatDoc.exists) {
                chatData = chatDoc.data();
            } else {
                chatData = {
                    nama: user.name || "Mahasiswa",
                    messages: []
                };

                await chatDocRef.set(chatData);
            }

            socket.emit(
                "load_room_messages",
                Array.isArray(chatData.messages) ? chatData.messages : []
            );

            // Daftar seluruh ruang hanya dikirim kepada admin.
            io.to("admin_room").emit(
                "update_chat_rooms",
                await getRoomListAsync()
            );
        } catch (error) {
            console.error("Error join chat:", error);
        }
    });

    // Hanya admin boleh membaca riwayat chat mahasiswa lain.
    socket.on("switch_chat_room", async (data = {}) => {
        if (!isAdmin) {
            socket.emit("load_room_messages", []);
            return;
        }

        try {
            const roomNim = String(data.nim || "").trim();

            if (!roomNim || roomNim.length > 100) {
                socket.emit("load_room_messages", []);
                return;
            }

            const chatDoc = await db.collection("chats")
                .doc(roomNim)
                .get();

            const messages = chatDoc.exists
                ? chatDoc.data().messages
                : [];

            socket.emit(
                "load_room_messages",
                Array.isArray(messages) ? messages : []
            );
        } catch (error) {
            console.error("Error switch chat room:", error);
            socket.emit("load_room_messages", []);
        }
    });

    // Pengirim dan role selalu berasal dari session.
    socket.on("send_private_message", async (data = {}) => {
        try {
            const roomNim = isAdmin
                ? String(data.roomNim || "").trim()
                : userNim;

            const messageText = String(data.text || "").trim();

            if (
                !roomNim ||
                roomNim.length > 100 ||
                !messageText ||
                messageText.length > 5000
            ) {
                return;
            }

            const msg = {
                sender: user.name || (
                    isAdmin ? "Administrator TU FDK" : "Mahasiswa"
                ),
                role: user.role,
                text: messageText,
                time: new Date().toLocaleTimeString("id-ID", {
                    hour: "2-digit",
                    minute: "2-digit"
                })
            };

            const chatDocRef = db.collection("chats").doc(roomNim);
            const chatDoc = await chatDocRef.get();

            let chatData = chatDoc.exists
                ? chatDoc.data()
                : { nama: "", messages: [] };

            if (!Array.isArray(chatData.messages)) {
                chatData.messages = [];
            }

            // Untuk chat baru, ambil nama dari data mahasiswa di Firestore.
            if (!chatData.nama) {
                const studentDoc = await db.collection("users")
                    .doc(roomNim)
                    .get();

                chatData.nama = studentDoc.exists
                    ? (studentDoc.data().name || "Mahasiswa")
                    : "Mahasiswa";
            }

            chatData.messages.push(msg);

            await chatDocRef.set(chatData);

            io.to(`room_${roomNim}`).emit("receive_message", msg);
            io.to("admin_room").emit("receive_message", msg);

            // Daftar ruang hanya untuk admin.
            io.to("admin_room").emit(
                "update_chat_rooms",
                await getRoomListAsync()
            );
        } catch (error) {
            console.error("Error send private message:", error);
        }
    });

    socket.on("disconnect", () => {
        console.log("Socket terputus:", socket.id);
    });
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


app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "SIRAT server is running",
    firebaseProject: "esuratfdk-web"
  });
});

// =====================================================
// SERVER
// =====================================================

const PORT = process.env.PORT || 3000;

console.log("🔥 Firebase Admin berhasil diinisialisasi");
console.log("☁️ Penyimpanan surat: Firestore");
console.log("🖊️ TTD: Base64 embedded");

server.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server berjalan di port " + PORT);
});