# TikTok Live AI Avatar 🎭⚡

Aplikasi host live stream interaktif cerdas untuk **TikTok Live** yang ditenagai oleh **Gemini Live API** (`gemini-3.1-flash-live-preview` / `gemini-3.8-live`) dengan **Avatar 3D real-time Lip-Sync**, dibangun dengan **Tauri 2.0** untuk Windows (`.exe`) dan Android (`.apk`).

---

## ✨ Fitur Utama

- 🎙️ **Gemini Live API (Native Voice Generation):** 
  Menggunakan model `gemini-3.1-flash-live-preview` / `gemini-3.8-live` via WebSocket dua arah (`BidiGenerateContent`). AI langsung menghasilkan suara manusia (PCM 24kHz) tanpa perlu TTS pihak ketiga.
- 🗣️ **Pilihan Suara Karakter:** 
  Tersedia pilihan suara bawaan Gemini: `Puck`, `Charon`, `Kore`, `Fenrir`, dan `Aoede`.
- 🎭 **3D Avatar & Real-time Lip-Sync:**
  - **Custom VRM Support:** Drag & drop atau upload file `.vrm` (karakter VTuber dari VRoid Studio). Mulut avatar membuka-menutup otomatis mengikuti vokal suara Gemini (`aa`, `ih`, `ou`).
  - **Procedural 3D Cyber Core Avatar:** Avatar 3D bawaan langsung siap pakai tanpa perlu download file tambahan.
- 📱 **TikTok Live Connector & Event Queue:**
  - Mendukung koneksi via TikFinity WebSocket lokal (`ws://localhost:21213`).
  - Sistem antrian pintar dengan pengaturan jeda (cooldown) dan filter respon (semua chat, hanya pertanyaan, atau mention `@ai`).
  - Respon instan berprioritas tinggi jika penonton mengirim **Gift / Mawar**!
- 🧪 **Built-in Chat Simulator:**
  Tombol simulasi chat & gift bawaan di aplikasi untuk menguji coba respon suara dan gerakan avatar secara langsung.
- 🎥 **OBS Overlay Mode (Transparan):**
  Tombol satu klik untuk mengubah tampilan menjadi transparan agar mudah di-capture di OBS Studio / TikTok Live Studio.
- 🔒 **Aman (Local Storage):**
  API Key Gemini dimasukkan lewat UI dan disimpan aman di penyimpanan lokal perangkat masing-masing pengguna.

---

## 🚀 Menjalankan Secara Lokal (Development)

Untuk mencoba tampilan dan fitur di browser:

```bash
# 1. Install dependencies
npm install

# 2. Jalankan dev server
npm run dev
```

Buka URL lokal yang muncul (misalnya `http://localhost:1420`) di browser Chrome / Edge.

---

## 🛠️ Build Windows (.exe) dan Android (.apk) di GitHub

Karena build Tauri untuk Windows dan Android membutuhkan compiler C++ MSVC dan Android NDK yang berat di laptop lokal, repository ini sudah dilengkapi dengan **GitHub Actions Workflow** otomatis di [`.github/workflows/build-and-release.yml`](.github/workflows/build-and-release.yml).

### Langkah Build di GitHub:

1. Buat repository baru di akun GitHub kamu.
2. Push seluruh kode ini ke GitHub:
   ```bash
   git add .
   git commit -m "feat: initial commit tiktok live ai avatar"
   git branch -M main
   git remote add origin https://github.com/USERNAME/REPO_NAME.git
   git push -u origin main
   ```
3. **Cara Build Otomatis:**
   - **Opsi A (Manual via GitHub Web):** Buka tab **Actions** di repositori GitHub kamu, pilih workflow **Build and Release (Windows & Android)**, lalu klik tombol **Run workflow**.
   - **Opsi B (Via Release Tag):** Buat tag rilis:
     ```bash
     git tag v1.0.0
     git push origin v1.0.0
     ```
4. GitHub Actions akan otomatis meng-compile:
   - File installer Windows **`.exe`**
   - File installer Android **`.apk`**
5. Download hasilnya di tab **Releases** atau **Artifacts** di GitHub!
