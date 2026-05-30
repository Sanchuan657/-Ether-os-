# Ether OS — Lily Chou-Chou Edition

A Windows XP-styled Web desktop inspired by the film *All About Lily Chou-Chou* (リリイ·シュシュのすべて). Built from scratch — no frontend frameworks, no build tools.

**Live:** (self-hosted)

---

## What's inside

### Screening Room
Synchronized video playback with danmaku (bullet comments). Room-based, with an ownership system — the room owner controls playback. Ownership transfers automatically on disconnect.

### Chat Room
Real-time chat with ephemeral memory (last 200 messages). Shared music player with synchronized playback — one person DJs, everyone hears the same track.

### Ether BBS
A CRT terminal-styled blog inspired by early-2000s Japanese BBSes. Scanline effects, phosphor glow, XP-style dialog boxes.

### XP Desktop
Draggable windows, taskbar, minimize/close, wallpaper management — all in vanilla JS/CSS.

---

## Tech

| Layer | Stack |
|-------|-------|
| Backend | Node.js + Express 5 |
| Realtime | Socket.IO 4 |
| Frontend | Vanilla JS + CSS |
| Storage | File-based JSON + Multer |

**One server file.** `server.js` handles everything.

---

## Run

```bash
npm install
node server.js
```

---

## About

A homage to Shunji Iwai's film, to XP aesthetics, and to the idea that ether flows through code.

> *Ether is in me. I am in ether.* — Lily Chou-Chou
