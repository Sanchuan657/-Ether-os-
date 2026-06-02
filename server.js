const helmet = require("helmet");
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

// --- 目录与数据初始化 ---
const uploadDir = path.join(__dirname, 'public', 'uploads');
const wallpaperDir = path.join(__dirname, 'public', 'wallpapers');
const musicDir = path.join(__dirname, 'public', 'music');
const blogImgDir = path.join(__dirname, 'public', 'post_blog');
const dataDir = path.join(__dirname, 'data');
const postsDir = path.join(dataDir, 'posts');
const SETTINGS_FILE = path.join(dataDir, 'settings.json');
if (!process.env.ADMIN_PASSWORD) {
    console.error('ADMIN_PASSWORD is required');
    process.exit(1);
}

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || require("crypto").randomBytes(16).toString("hex");

[uploadDir, wallpaperDir, musicDir, blogImgDir, dataDir, postsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

let appSettings = { wallpaper: 'https://wallpaperaccess.com/full/1567665.jpg' };
if (fs.existsSync(SETTINGS_FILE)) {
    try { appSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')); } catch(e) {}
}

function saveSettings() { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(appSettings, null, 2), 'utf-8'); }

// --- Multer 配置 ---
const videoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const uploadVideo = multer({ storage: videoStorage, limits: { fileSize: 20 * 1024 * 1024 * 1024 } });

const wpStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, wallpaperDir),
    filename: (req, file, cb) => cb(null, 'wp-' + Date.now() + path.extname(file.originalname))
});
const uploadWp = multer({ storage: wpStorage, limits: { fileSize: 10 * 1024 * 1024 } });

const musicStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, musicDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const uploadMusic = multer({ storage: musicStorage, limits: { fileSize: 50 * 1024 * 1024 } });

const blogImgStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, blogImgDir),
    filename: (req, file, cb) => cb(null, 'blog-' + Date.now() + path.extname(file.originalname))
});
const uploadBlogImg = multer({ storage: blogImgStorage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));

// --- 页面路由 ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/lobby', (req, res) => res.sendFile(path.join(__dirname, 'public', 'lobby.html')));
app.get('/room', (req, res) => res.sendFile(path.join(__dirname, 'public', 'room.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ETHER_CHAT.html')));
app.get('/blog', (req, res) => res.sendFile(path.join(__dirname, 'public', 'blog.html')));

// --- 全局状态 ---
let rooms = {};
const socketNames = {};
const chatMessages = {};
const MAX_CHAT_MESSAGES = 200;
const chatMusicStates = {};

// --- 管理 API ---
app.get('/api/settings', (req, res) => res.json(appSettings));

app.post('/api/admin/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) res.json({ success: true, token: ADMIN_TOKEN });
    else res.status(403).json({ error: '密码错误' });
});

app.get('/api/admin/rooms', (req, res) => {
    const list = Object.keys(rooms).map(roomId => ({
        roomId,
        users: io.sockets.adapter.rooms.get(roomId)?.size || 0,
        ownerName: rooms[roomId]?.ownerName || '无',
        isActive: !!rooms[roomId]
    }));
    res.json({ rooms: list });
});

app.delete('/api/admin/rooms/:roomId', (req, res) => {
    if (req.body.token !== ADMIN_TOKEN) return res.status(403).json({ error: '无权限' });
    const { roomId } = req.params;
    if (rooms[roomId]) {
        io.to(roomId).emit('new-danmaku', { text: '系统: 房间已被管理员关闭', color: '#ff4444' });
        delete rooms[roomId];
    }
    res.json({ success: true });
});

app.post('/api/admin/wallpaper', (req, res) => {
    if (req.body.token !== ADMIN_TOKEN) return res.status(403).json({ error: '无权限' });
    appSettings.wallpaper = req.body.wallpaper;
    saveSettings();
    res.json({ success: true });
});

app.post('/api/admin/uploadWallpaper', uploadWp.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '上传失败' });
    appSettings.wallpaper = '/wallpapers/' + req.file.filename;
    saveSettings();
    res.json({ wallpaper: appSettings.wallpaper });
});

// --- 博客 API ---
app.get('/api/blog/posts', (req, res) => {
    const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.json'));
    const posts = files.map(f => {
        const data = JSON.parse(fs.readFileSync(path.join(postsDir, f), 'utf-8'));
        return { id: f.replace('.json', ''), title: data.title, date: data.date, content: data.content };
    }).sort((a, b) => b.date.localeCompare(a.date));
    res.json({ posts });
});

app.post('/api/blog/post', (req, res) => {
    const { title, content } = req.body;
    if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });
    const id = Date.now().toString(36);
    const post = { title: sanitize(title), content, date: new Date().toISOString(), id };
    fs.writeFileSync(path.join(postsDir, id + '.json'), JSON.stringify(post, null, 2), 'utf-8');
    res.json({ success: true, id });
});


app.post('/api/blog/upload-image', uploadBlogImg.single('image'), (req, res) => {

    if (!req.file) return res.status(400).json({ error: '上传失败' });
    const imageUrl = '/post_blog/' + req.file.filename;
    res.json({ wallpaper: imageUrl });
});

// --- 文件上传与删除 ---
app.post('/upload', uploadVideo.single('video'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '文件上传失败' });
    res.json({ videoUrl: '/uploads/' + req.file.filename });
});

app.post('/upload-music', uploadMusic.single('music'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '音乐上传失败' });
    res.json({ musicUrl: '/music/' + req.file.filename });
});

app.post('/delete', (req, res) => {
    const videoUrl = req.body.videoUrl;
    if (videoUrl && videoUrl.startsWith('/uploads/')) {
        const filePath = path.join(__dirname, 'public', videoUrl);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.json({ success: true });
    } else res.status(400).json({ error: '非法路径' });
});

// --- Socket.io 主逻辑 ---
function sanitize(str) {    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");}
io.on('connection', (socket) => {
    // ===== 放映室 =====
    socket.on('join-room', ({ roomId, name }) => {
        socket.join(roomId);
        socket.data.room = roomId;
        socketNames[socket.id] = name || '用户' + socket.id.slice(0, 4);
        if (!rooms[roomId]) {
            rooms[roomId] = { videoUrl: '', currentTime: 0, isPlaying: false, owner: socket.id, ownerName: socketNames[socket.id] };
        }
        socket.emit('init-room', { isOwner: rooms[roomId].owner === socket.id, ...rooms[roomId] });
        const roomSockets = io.sockets.adapter.rooms.get(roomId);
        const users = roomSockets ? [...roomSockets].map(id => ({ id, name: socketNames[id] })) : [];
        io.to(roomId).emit('user-list', { users });
    });

    socket.on('claim-owner', () => {
        const rid = socket.data.room;
        if (!rooms[rid]) return;
        if (!rooms[rid].owner || rooms[rid].owner === socket.id) {
            rooms[rid].owner = socket.id;
            rooms[rid].ownerName = socketNames[socket.id] || '用户';
            socket.emit('set-owner', true);
        } else {
            io.to(rooms[rid].owner).emit('owner-request', { fromId: socket.id, fromName: socketNames[socket.id] || '用户' });
        }
    });

    socket.on('owner-response', ({ toId, approved }) => {
        const rid = socket.data.room;
        if (!rooms[rid] || rooms[rid].owner !== socket.id) return;
        if (approved) {
            rooms[rid].owner = toId;
            rooms[rid].ownerName = socketNames[toId] || '用户';
            io.to(toId).emit('set-owner', true);
            socket.emit('set-owner', false);
        } else {
            io.to(toId).emit('owner-request-rejected');
        }
    });

    socket.on('media-action', (data) => {
        const rid = socket.data.room;
        if (!rooms[rid]) return;
        if (rooms[rid].owner === socket.id || data.force) {
            Object.assign(rooms[rid], { isPlaying: data.isPlaying, currentTime: data.currentTime, videoUrl: data.videoUrl || rooms[rid].videoUrl });
            socket.to(rid).emit('media-action', rooms[rid]);
        }
    });

    socket.on('send-danmaku', (data) => io.to(data.roomId).emit('new-danmaku', data));

    // ===== 聊天室 =====
    socket.on('join-chat', ({ roomId, name }) => {
        socket.join('chat-' + roomId);
        socket.data.chatRoom = roomId;
        socket.data.chatName = name || '匿名';

        if (!chatMessages[roomId]) chatMessages[roomId] = [];
        if (!chatMusicStates[roomId]) {
            chatMusicStates[roomId] = {
                musicUrl: '', isPlaying: false, currentTime: 0,
                lastUpdateTime: Date.now(), musicOwner: null, musicOwnerName: ''
            };
        }

        socket.emit('chat-history', { messages: chatMessages[roomId].slice(-50), roomId });

        const ms = chatMusicStates[roomId];
        const liveState = { ...ms };

        if (ms.musicOwner) {
            const ownerSocket = io.sockets.sockets.get(ms.musicOwner);
            if (!ownerSocket || ownerSocket.data.chatRoom !== roomId) {
                ms.musicOwner = null; ms.musicOwnerName = '';
                ms.isPlaying = false; ms.currentTime = 0; ms.lastUpdateTime = Date.now();
            } else if (ms.isPlaying) {
                const elapsed = (Date.now() - ms.lastUpdateTime) / 1000;
                liveState.currentTime = ms.currentTime + elapsed;
            }
        }

        socket.emit('chat-music-state', {
            musicUrl: liveState.musicUrl, isPlaying: liveState.isPlaying,
            currentTime: liveState.currentTime, musicOwner: liveState.musicOwner,
            musicOwnerName: liveState.musicOwnerName
        });

        socket.to('chat-' + roomId).emit('chat-message', {
            name: 'SYSTEM', text: `${name || '匿名'} 进入了房间`, time: Date.now(), system: true
        });

        const chatSockets = io.sockets.adapter.rooms.get('chat-' + roomId);
        const users = chatSockets ? [...chatSockets].map(sid => ({
            id: sid, name: io.sockets.sockets.get(sid)?.data?.chatName || '匿名'
        })) : [];
        io.to('chat-' + roomId).emit('chat-users', { users });
    });

    socket.on('chat-message', ({ roomId, text }) => {
        if (!roomId || !text) return;
        const name = socket.data.chatName || '匿名';
        const msg = { name: sanitize(name), text: sanitize(text.trim().slice(0, 300)), time: Date.now() };
        if (!chatMessages[roomId]) chatMessages[roomId] = [];
        chatMessages[roomId].push(msg);
        if (chatMessages[roomId].length > MAX_CHAT_MESSAGES) chatMessages[roomId] = chatMessages[roomId].slice(-MAX_CHAT_MESSAGES);
        io.to('chat-' + roomId).emit('chat-message', msg);
    });

    socket.on('chat-music-upload', (data) => {
        const chatRoom = socket.data.chatRoom; if (!chatRoom) return;
        if (!chatMusicStates[chatRoom]) {
            chatMusicStates[chatRoom] = {
                musicUrl: '', isPlaying: false, currentTime: 0,
                lastUpdateTime: Date.now(), musicOwner: null, musicOwnerName: ''
            };
        }
        chatMusicStates[chatRoom].musicUrl = data.musicUrl;
        chatMusicStates[chatRoom].musicOwner = socket.id;
        chatMusicStates[chatRoom].musicOwnerName = socket.data.chatName || '匿名';
        chatMusicStates[chatRoom].currentTime = 0;
        chatMusicStates[chatRoom].isPlaying = false;
        chatMusicStates[chatRoom].lastUpdateTime = Date.now();
        socket.to('chat-' + chatRoom).emit('chat-music-change', {
            musicUrl: data.musicUrl,
            musicOwnerName: chatMusicStates[chatRoom].musicOwnerName
        });
    });

    socket.on('chat-music-action', (data) => {
        const chatRoom = socket.data.chatRoom; if (!chatRoom) return;
        const ms = chatMusicStates[chatRoom]; if (!ms) return;
        if (ms.musicOwner && ms.musicOwner !== socket.id) return;
        if (!ms.musicOwner) { ms.musicOwner = socket.id; ms.musicOwnerName = socket.data.chatName || '匿名'; }
        ms.isPlaying = data.isPlaying; ms.currentTime = data.currentTime; ms.lastUpdateTime = Date.now();
        socket.to('chat-' + chatRoom).emit('chat-music-action', { isPlaying: data.isPlaying, currentTime: data.currentTime });
    });

    socket.on('disconnect', () => {
        const rid = socket.data.room; delete socketNames[socket.id];
        if (rooms[rid] && rooms[rid].owner === socket.id) {
            const roomSockets = io.sockets.adapter.rooms.get(rid);
            const nextUser = roomSockets?.values().next().value;
            if (nextUser) {
                rooms[rid].owner = nextUser; rooms[rid].ownerName = socketNames[nextUser] || '用户';
                io.to(nextUser).emit('set-owner', true);
            } else delete rooms[rid];
        }
        const chatRoom = socket.data.chatRoom;
        if (chatRoom) {
            const ms = chatMusicStates[chatRoom];
            if (ms && ms.musicOwner === socket.id) {
                const chatSockets = io.sockets.adapter.rooms.get('chat-' + chatRoom);
                if (chatSockets && chatSockets.size > 0) {
                    const nextOwner = [...chatSockets].find(sid => sid !== socket.id);
                    if (nextOwner) {
                        ms.musicOwner = nextOwner;
                        ms.musicOwnerName = io.sockets.sockets.get(nextOwner)?.data?.chatName || '匿名';
                        ms.lastUpdateTime = Date.now();
                        io.to(nextOwner).emit('chat-music-owner', {
                            isOwner: true, musicUrl: ms.musicUrl,
                            currentTime: ms.currentTime, isPlaying: ms.isPlaying
                        });
                    }
                } else { ms.musicOwner = null; ms.musicOwnerName = ''; ms.isPlaying = false; }
            }
            socket.to('chat-' + chatRoom).emit('chat-message', {
                name: 'SYSTEM', text: `${socket.data.chatName || '匿名'} 离开了房间`, time: Date.now(), system: true
            });
            const chatSockets = io.sockets.adapter.rooms.get('chat-' + chatRoom);
            const users = chatSockets ? [...chatSockets].map(sid => ({
                id: sid, name: io.sockets.sockets.get(sid)?.data?.chatName || '匿名'
            })) : [];
            io.to('chat-' + chatRoom).emit('chat-users', { users });
        }
    });
});

server.listen(3001, '0.0.0.0', () => console.log('Lily-XP Server ready'));
