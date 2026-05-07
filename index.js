require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 确保uploads目录存在
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 配置multer存储
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + uuidv4();
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB限制
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只允许上传图片文件'));
    }
  }
});

const DATABASE_URL = process.env.DATABASE_URL;
const SALT_ROUNDS = 10;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

let adminTokens = [];

function generateAdminToken() {
  return uuidv4();
}

function validateAdminToken(token) {
  return adminTokens.includes(token);
}

function removeAdminToken(token) {
  const index = adminTokens.indexOf(token);
  if (index > -1) {
    adminTokens.splice(index, 1);
  }
}

function adminAuthMiddleware(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !validateAdminToken(token)) {
    return res.status(401).json({ success: false, message: '未授权访问，请先登录' });
  }
  next();
}

let usersDB, friendshipsDB, messagesDB;

if (DATABASE_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL ? { rejectUnauthorized: false } : false
  });

  const db = {
    query: async (sql, params = []) => {
      const result = await pool.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount };
    },
    run: async (sql, params = []) => {
      const result = await pool.query(sql, params);
      return { lastID: result.rows[0]?.id || null, changes: result.rowCount };
    }
  };

  usersDB = db;
  friendshipsDB = db;
  messagesDB = db;
} else {
  const Datastore = require('nedb');
  usersDB = new Datastore({ filename: './data/users.db', autoload: true });
  friendshipsDB = new Datastore({ filename: './data/friendships.db', autoload: true });
  messagesDB = new Datastore({ filename: './data/messages.db', autoload: true });

  usersDB.ensureIndex({ fieldName: 'username', unique: true });
  friendshipsDB.ensureIndex({ fieldName: 'user_id' });
  friendshipsDB.ensureIndex({ fieldName: ['user_id', 'friend_id'], unique: true });
  messagesDB.ensureIndex({ fieldName: 'sender_id' });
  messagesDB.ensureIndex({ fieldName: 'receiver_id' });
}

async function initDB() {
  if (DATABASE_URL) {
    try {
      await usersDB.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          avatar TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 添加avatar列（如果不存在）
      try {
        await usersDB.query('ALTER TABLE users ADD COLUMN avatar TEXT');
        await usersDB.query('ALTER TABLE users ADD COLUMN nickname TEXT');
      } catch (e) {
        // 列已存在，忽略错误
      }

      await friendshipsDB.query(`
        CREATE TABLE IF NOT EXISTS friendships (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          friend_id TEXT NOT NULL,
          UNIQUE(user_id, friend_id)
        )
      `);

      await messagesDB.query(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          sender_id TEXT NOT NULL,
          receiver_id TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT DEFAULT 'text',
          time TEXT NOT NULL,
          timestamp BIGINT NOT NULL,
          read BOOLEAN DEFAULT FALSE
        )
      `);

      // 添加type列（如果不存在）
      try {
        await messagesDB.query('ALTER TABLE messages ADD COLUMN type TEXT DEFAULT \'text\'');
      } catch (e) {
        // 列已存在，忽略错误
      }

      await messagesDB.query(`
        CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id)
      `);

      await friendshipsDB.query(`
        CREATE INDEX IF NOT EXISTS idx_friendships_user_id ON friendships(user_id)
      `);

      console.log('PostgreSQL database initialized successfully');
    } catch (error) {
      console.error('Database initialization error:', error);
    }
  } else {
    require('fs').mkdirSync('./data', { recursive: true });
    console.log('NeDB database initialized successfully');
  }
}

initDB();

function promisifyDB(method) {
  return function(query, options = {}) {
    return new Promise((resolve, reject) => {
      method.call(this, query, options, (err, docs) => {
        if (err) reject(err);
        else resolve(docs);
      });
    });
  };
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
  }

  if (username.length < 3) {
    return res.status(400).json({ success: false, message: '用户名至少需要3个字符' });
  }

  try {
    let existing;
    if (DATABASE_URL) {
      existing = await usersDB.query('SELECT id FROM users WHERE username = $1', [username]);
    } else {
      existing = await promisifyDB(usersDB.find).call(usersDB, { username });
    }

    if ((DATABASE_URL && existing.rows.length > 0) || (!DATABASE_URL && existing.length > 0)) {
      return res.status(400).json({ success: false, message: '用户名已被使用' });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = uuidv4();

    if (DATABASE_URL) {
      await usersDB.query(
        'INSERT INTO users (id, username, password, avatar, nickname) VALUES ($1, $2, $3, $4, $5)',
        [userId, username, hashedPassword, null, '']
      );
    } else {
      await promisifyDB(usersDB.insert).call(usersDB, {
        _id: userId,
        id: userId,
        username,
        password: hashedPassword,
        avatar: null,
        nickname: '',
        created_at: new Date().toISOString()
      });
    }

    await sendWelcomeMessage(userId, username);

    res.json({ success: true, user: { id: userId, username, avatar: null, nickname: '' } });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: '注册失败' });
  }
});

async function sendWelcomeMessage(userId, username) {
  try {
    let yanTalkUser;
    if (DATABASE_URL) {
      yanTalkUser = await usersDB.query("SELECT id FROM users WHERE username = 'YanTalk'");
    } else {
      yanTalkUser = await promisifyDB(usersDB.find).call(usersDB, { username: 'YanTalk' });
    }

    const yanTalkData = DATABASE_URL ? yanTalkUser.rows[0] : yanTalkUser[0];
    if (!yanTalkData) return;

    const yanTalkId = yanTalkData.id;

    const now = new Date();
    const beijingTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(beijingTime.getUTCDate()).padStart(2, '0');
    const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
    const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
    const formattedTime = `${year}/${month}/${day} ${hours}:${minutes}`;

    if (DATABASE_URL) {
      const existFriendship = await friendshipsDB.query(
        'SELECT id FROM friendships WHERE user_id = $1 AND friend_id = $2',
        [userId, yanTalkId]
      );

      if (existFriendship.rows.length === 0) {
        await friendshipsDB.query(
          'INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($3, $4)',
          [userId, yanTalkId, yanTalkId, userId]
        );
      }

      const messageId = uuidv4();
      await messagesDB.query(
        `INSERT INTO messages (id, sender_id, receiver_id, content, type, time, timestamp, read)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [messageId, yanTalkId, userId, '我是YanTalk官方账号，为了建设更有趣的聊天工具，欢迎提出宝贵的建议～', 'text', formattedTime, Date.now(), false]
      );
    } else {
      const existFriendship = await promisifyDB(friendshipsDB.find).call(friendshipsDB, {
        user_id: userId,
        friend_id: yanTalkId
      });

      if (existFriendship.length === 0) {
        await promisifyDB(friendshipsDB.insert).call(friendshipsDB, {
          user_id: userId,
          friend_id: yanTalkId
        });
        await promisifyDB(friendshipsDB.insert).call(friendshipsDB, {
          user_id: yanTalkId,
          friend_id: userId
        });
      }

      const messageId = uuidv4();
      await promisifyDB(messagesDB.insert).call(messagesDB, {
        _id: messageId,
        id: messageId,
        sender_id: yanTalkId,
        receiver_id: userId,
        content: '我是YanTalk官方账号，为了建设更有趣的聊天工具，欢迎提出宝贵的建议～',
        type: 'text',
        time: formattedTime,
        timestamp: Date.now(),
        read: false
      });
    }

    console.log(`Welcome message sent to ${username}`);
  } catch (error) {
    console.error('Send welcome message error:', error);
  }
}

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
  }

  try {
    let user;
    if (DATABASE_URL) {
      user = await usersDB.query(
        'SELECT id, username, password, avatar, nickname FROM users WHERE username = $1',
        [username]
      );
    } else {
      user = await promisifyDB(usersDB.find).call(usersDB, { username });
      user = user.map(u => ({ ...u, nickname: u.nickname || '' }));
    }

    const userData = DATABASE_URL ? user.rows[0] : user[0];

    if (!userData) {
      return res.status(400).json({ success: false, message: '用户名或密码错误' });
    }

    const passwordMatch = await bcrypt.compare(password, userData.password);

    if (!passwordMatch) {
      return res.status(400).json({ success: false, message: '用户名或密码错误' });
    }

    res.json({ 
      success: true, 
      user: { 
        id: userData.id, 
        username: userData.username,
        avatar: userData.avatar || null,
        nickname: userData.nickname || ''
      } 
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: '登录失败' });
  }
});

app.get('/api/user/:username', async (req, res) => {
  const { username } = req.params;

  if (!username) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }

  try {
    let user;
    if (DATABASE_URL) {
      user = await usersDB.query(
        'SELECT id, username, avatar, nickname FROM users WHERE username = $1',
        [username]
      );
    } else {
      user = await promisifyDB(usersDB.find).call(usersDB, { username });
      user = user.map(u => ({ ...u, nickname: u.nickname || '' }));
    }

    const userData = DATABASE_URL ? user.rows[0] : user[0];

    if (!userData) {
      return res.status(400).json({ success: false, message: '用户不存在' });
    }

    res.json({ success: true, user: userData });
  } catch (error) {
    console.error('Search user error:', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

app.post('/api/add-friend', async (req, res) => {
  const { userId, friendUsername } = req.body;

  if (!userId || !friendUsername) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }

  try {
    let friend;
    if (DATABASE_URL) {
      friend = await usersDB.query(
        'SELECT id, username, avatar, nickname FROM users WHERE username = $1',
        [friendUsername]
      );
    } else {
      friend = await promisifyDB(usersDB.find).call(usersDB, { username: friendUsername });
      friend = friend.map(u => ({ ...u, nickname: u.nickname || '' }));
    }

    const friendData = DATABASE_URL ? friend.rows[0] : friend[0];

    if (!friendData) {
      return res.status(400).json({ success: false, message: '用户不存在' });
    }

    if (userId === friendData.id) {
      return res.status(400).json({ success: false, message: '不能添加自己为好友' });
    }

    let existing;
    if (DATABASE_URL) {
      existing = await friendshipsDB.query(
        'SELECT id FROM friendships WHERE user_id = $1 AND friend_id = $2',
        [userId, friendData.id]
      );
    } else {
      existing = await promisifyDB(friendshipsDB.find).call(friendshipsDB, {
        user_id: userId,
        friend_id: friendData.id
      });
    }

    if ((DATABASE_URL && existing.rows.length > 0) || (!DATABASE_URL && existing.length > 0)) {
      return res.status(400).json({ success: false, message: '已经是好友' });
    }

    if (DATABASE_URL) {
      await friendshipsDB.query(
        'INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($3, $4)',
        [userId, friendData.id, friendData.id, userId]
      );
    } else {
      await promisifyDB(friendshipsDB.insert).call(friendshipsDB, {
        user_id: userId,
        friend_id: friendData.id
      });
      await promisifyDB(friendshipsDB.insert).call(friendshipsDB, {
        user_id: friendData.id,
        friend_id: userId
      });
    }

    res.json({ success: true, friend: friendData });
  } catch (error) {
    console.error('Add friend error:', error);
    res.status(500).json({ success: false, message: '添加失败' });
  }
});

app.get('/api/friends/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }

  try {
    let friendDocs;
    if (DATABASE_URL) {
      friendDocs = await friendshipsDB.query(
        'SELECT friend_id FROM friendships WHERE user_id = $1',
        [userId]
      );
    } else {
      friendDocs = await promisifyDB(friendshipsDB.find).call(friendshipsDB, { user_id: userId });
    }

    const friendIds = (DATABASE_URL ? friendDocs.rows : friendDocs).map(f => f.friend_id);

    if (friendIds.length === 0) {
      return res.json({ success: true, friends: [] });
    }

    let friendsData;
    if (DATABASE_URL) {
      const placeholders = friendIds.map((_, i) => `$${i + 1}`).join(',');
      friendsData = await usersDB.query(
        `SELECT id, username, avatar, nickname FROM users WHERE id IN (${placeholders})`,
        friendIds
      );
    } else {
      friendsData = await promisifyDB(usersDB.find).call(usersDB, {
        id: { $in: friendIds }
      }).map(u => ({ ...u, nickname: u.nickname || '' }));
    }

    res.json({ success: true, friends: DATABASE_URL ? friendsData.rows : friendsData });
  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

app.get('/api/messages/:userId/:friendId', async (req, res) => {
  const { userId, friendId } = req.params;

  if (!userId || !friendId) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }

  try {
    let msgs;
    if (DATABASE_URL) {
      msgs = await messagesDB.query(`
        SELECT id, sender_id, receiver_id, content, type, time, timestamp, read
        FROM messages
        WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $3 AND receiver_id = $4)
        ORDER BY timestamp ASC
      `, [userId, friendId, friendId, userId]);
    } else {
      msgs = await promisifyDB(messagesDB.find).call(messagesDB, {
        $or: [
          { sender_id: userId, receiver_id: friendId },
          { sender_id: friendId, receiver_id: userId }
        ]
      }).sort({ timestamp: 1 });
    }

    const messages = (DATABASE_URL ? msgs.rows : msgs).map(msg => {
      const senderId = DATABASE_URL ? msg.sender_id : (msg.senderId || msg.sender_id);
      const receiverId = DATABASE_URL ? msg.receiver_id : (msg.receiverId || msg.receiver_id);
      return {
        id: msg.id,
        senderId: senderId,
        receiverId: receiverId,
        content: msg.content,
        type: msg.type || 'text',
        time: msg.time,
        timestamp: msg.timestamp,
        read: DATABASE_URL ? msg.read : (msg.read === true || msg.read === 1)
      };
    });

    res.json({ success: true, messages });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

app.post('/api/send-message', async (req, res) => {
  const { senderId, receiverId, content, type = 'text' } = req.body;

  if (!senderId || !receiverId || !content) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }

  try {
    // 获取北京时间
    const now = new Date();
    const beijingTime = new Date(now.getTime() + (8 * 60 * 60 * 1000)); // UTC+8
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(beijingTime.getUTCDate()).padStart(2, '0');
    const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
    const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
    const formattedTime = `${year}/${month}/${day} ${hours}:${minutes}`;

    const message = {
      id: uuidv4(),
      senderId: senderId,
      receiverId: receiverId,
      content,
      type: type,
      time: formattedTime,
      timestamp: Date.now(),
      read: false
    };

    if (DATABASE_URL) {
      await messagesDB.query(`
        INSERT INTO messages (id, sender_id, receiver_id, content, type, time, timestamp, read)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [message.id, message.senderId, message.receiverId, message.content,
          message.type, message.time, message.timestamp, message.read]);
    } else {
      await promisifyDB(messagesDB.insert).call(messagesDB, {
        _id: message.id,
        id: message.id,
        sender_id: message.senderId,
        receiver_id: message.receiverId,
        content: message.content,
        type: message.type,
        time: message.time,
        timestamp: message.timestamp,
        read: false
      });
    }

    res.json({ success: true, message });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ success: false, message: '发送失败' });
  }
});

app.post('/api/mark-read', async (req, res) => {
  const { userId, friendId } = req.body;

  if (!userId || !friendId) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }

  try {
    if (DATABASE_URL) {
      await messagesDB.query(`
        UPDATE messages
        SET read = TRUE
        WHERE receiver_id = $1 AND sender_id = $2 AND read = FALSE
      `, [userId, friendId]);
    } else {
      await promisifyDB(messagesDB.update).call(messagesDB,
        { receiver_id: userId, sender_id: friendId, read: false },
        { $set: { read: true } },
        { multi: true }
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
  }

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: '用户名或密码错误' });
  }

  const token = generateAdminToken();
  adminTokens.push(token);

  res.json({ success: true, token, username: ADMIN_USERNAME });
});

app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token) {
    removeAdminToken(token);
  }
  res.json({ success: true });
});

app.get('/api/admin/verify', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (token && validateAdminToken(token)) {
    res.json({ success: true, username: ADMIN_USERNAME });
  } else {
    res.status(401).json({ success: false, message: '未登录' });
  }
});

app.get('/api/admin/users', adminAuthMiddleware, async (req, res) => {
  try {
    let users;
    if (DATABASE_URL) {
      users = await usersDB.query('SELECT id, username, created_at FROM users ORDER BY created_at DESC');
    } else {
      users = await promisifyDB(usersDB.find).call(usersDB, {}).sort({ created_at: -1 });
    }
    res.json({ success: true, users: DATABASE_URL ? users.rows : users });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

app.get('/api/admin/stats/users', adminAuthMiddleware, async (req, res) => {
  try {
    let count;
    if (DATABASE_URL) {
      const result = await usersDB.query('SELECT COUNT(*) FROM users');
      count = result.rows[0].count;
    } else {
      count = await new Promise((resolve, reject) => {
        usersDB.count({}, (err, n) => {
          if (err) reject(err);
          else resolve(n);
        });
      });
    }
    res.json({ success: true, count: parseInt(count) || 0 });
  } catch (error) {
    console.error('Get user count error:', error);
    res.json({ success: false, count: 0 });
  }
});

app.get('/api/admin/stats/messages', adminAuthMiddleware, async (req, res) => {
  try {
    let count;
    if (DATABASE_URL) {
      const result = await messagesDB.query('SELECT COUNT(*) FROM messages');
      count = result.rows[0].count;
    } else {
      count = await new Promise((resolve, reject) => {
        messagesDB.count({}, (err, n) => {
          if (err) reject(err);
          else resolve(n);
        });
      });
    }
    res.json({ success: true, count: parseInt(count) || 0 });
  } catch (error) {
    console.error('Get message count error:', error);
    res.json({ success: false, count: 0 });
  }
});

app.delete('/api/admin/users/:userId', adminAuthMiddleware, async (req, res) => {
  const { userId } = req.params;

  try {
    if (DATABASE_URL) {
      await usersDB.query('DELETE FROM users WHERE id = $1', [userId]);
      await friendshipsDB.query('DELETE FROM friendships WHERE user_id = $1 OR friend_id = $1', [userId]);
      await messagesDB.query('DELETE FROM messages WHERE sender_id = $1 OR receiver_id = $1', [userId]);
    } else {
      await promisifyDB(usersDB.remove).call(usersDB, { $or: [{ id: userId }, { _id: userId }] }, { multi: false });
      await promisifyDB(friendshipsDB.remove).call(friendshipsDB, { $or: [{ user_id: userId }, { friend_id: userId }] }, { multi: true });
      await promisifyDB(messagesDB.remove).call(messagesDB, { $or: [{ sender_id: userId }, { receiver_id: userId }] }, { multi: true });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// 上传头像API
app.post('/api/upload-avatar', upload.single('avatar'), async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId || !req.file) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }

    const filePath = path.join(uploadsDir, req.file.filename);
    const fileBuffer = fs.readFileSync(filePath);
    const base64Image = `data:${req.file.mimetype};base64,${fileBuffer.toString('base64')}`;
    
    fs.unlinkSync(filePath);

    if (DATABASE_URL) {
      await usersDB.query('UPDATE users SET avatar = $1 WHERE id = $2', [base64Image, userId]);
    } else {
      await promisifyDB(usersDB.update).call(usersDB,
        { id: userId },
        { $set: { avatar: base64Image } },
        { multi: false }
      );
    }

    res.json({ success: true, avatar: base64Image });
  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ success: false, message: '上传失败' });
  }
});

// 修改密码API
app.post('/api/change-password', async (req, res) => {
  const { userId, oldPassword, newPassword } = req.body;

  if (!userId || !oldPassword || !newPassword) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }

  if (newPassword.length < 1) {
    return res.status(400).json({ success: false, message: '新密码不能为空' });
  }

  try {
    let user;
    if (DATABASE_URL) {
      user = await usersDB.query('SELECT id, password FROM users WHERE id = $1', [userId]);
    } else {
      user = await promisifyDB(usersDB.find).call(usersDB, { id: userId });
    }

    const userData = DATABASE_URL ? user.rows[0] : user[0];

    if (!userData) {
      return res.status(400).json({ success: false, message: '用户不存在' });
    }

    const passwordMatch = await bcrypt.compare(oldPassword, userData.password);

    if (!passwordMatch) {
      return res.status(400).json({ success: false, message: '原密码错误' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    if (DATABASE_URL) {
      await usersDB.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, userId]);
    } else {
      await promisifyDB(usersDB.update).call(usersDB,
        { id: userId },
        { $set: { password: hashedPassword } },
        { multi: false }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, message: '修改失败' });
  }
});

// 修改账号API
app.post('/api/change-username', async (req, res) => {
  const { userId, username } = req.body;

  if (!userId || !username) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }

  if (username.length < 3) {
    return res.status(400).json({ success: false, message: '账号至少需要3个字符' });
  }

  if (username.length > 20) {
    return res.status(400).json({ success: false, message: '账号不能超过20个字符' });
  }

  try {
    let existing;
    if (DATABASE_URL) {
      existing = await usersDB.query('SELECT id FROM users WHERE username = $1 AND id != $2', [username, userId]);
    } else {
      existing = await promisifyDB(usersDB.find).call(usersDB, { username, id: { $ne: userId } });
    }

    if ((DATABASE_URL && existing.rows.length > 0) || (!DATABASE_URL && existing.length > 0)) {
      return res.status(400).json({ success: false, message: '该账号已被使用' });
    }

    if (DATABASE_URL) {
      await usersDB.query('UPDATE users SET username = $1 WHERE id = $2', [username, userId]);
    } else {
      await promisifyDB(usersDB.update).call(usersDB,
        { id: userId },
        { $set: { username: username } },
        { multi: false }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Change username error:', error);
    res.status(500).json({ success: false, message: '修改失败' });
  }
});

// 上传图片API
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, url: imageUrl });
  } catch (error) {
    console.error('Upload image error:', error);
    res.status(500).json({ success: false, message: '上传失败' });
  }
});

app.listen(PORT, () => {
  console.log(`Talk server running on port ${PORT}`);
  console.log(DATABASE_URL ? 'Using PostgreSQL' : 'Using NeDB for development');
});

module.exports = app;
