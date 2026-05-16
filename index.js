require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// 存储在线用户和socket映射
const onlineUsers = new Map();

io.on('connection', (socket) => {
  socket.on('login', (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
    console.log(`User ${userId} connected`);
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      console.log(`User ${socket.userId} disconnected`);
    }
  });

  // 信令消息转发
  socket.on('call', (data) => {
    const targetSocketId = onlineUsers.get(data.targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call', {
        from: socket.userId,
        fromUsername: data.fromUsername,
        offer: data.offer
      });
    }
  });

  socket.on('answer', (data) => {
    const targetSocketId = onlineUsers.get(data.targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('answer', {
        from: socket.userId,
        answer: data.answer
      });
    }
  });

  socket.on('ice-candidate', (data) => {
    const targetSocketId = onlineUsers.get(data.targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', {
        from: socket.userId,
        candidate: data.candidate
      });
    }
  });

  socket.on('call-end', (data) => {
    const targetSocketId = onlineUsers.get(data.targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-end', { from: socket.userId });
    }
  });

  socket.on('call-reject', (data) => {
    const targetSocketId = onlineUsers.get(data.targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-reject', { from: socket.userId });
    }
  });
});

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

let ADMIN_PASSWORD = 'admin';
const ADMIN_USERNAME = 'admin';
const ADMIN_CONFIG_KEY = 'admin_password';

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

async function initAdminPassword() {
  if (DATABASE_URL) {
    try {
      await usersDB.query(`
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      
      const result = await usersDB.query('SELECT value FROM config WHERE key = $1', [ADMIN_CONFIG_KEY]);
      if (result.rows.length > 0) {
        ADMIN_PASSWORD = result.rows[0].value;
        console.log('Admin password loaded from database');
      } else {
        await usersDB.query('INSERT INTO config (key, value) VALUES ($1, $2)', [ADMIN_CONFIG_KEY, ADMIN_PASSWORD]);
        console.log('Admin password initialized with default');
      }
    } catch (error) {
      console.error('Init admin password error:', error);
    }
  }
}

async function saveAdminPassword(password) {
  if (DATABASE_URL) {
    try {
      await usersDB.query('UPDATE config SET value = $1 WHERE key = $2', [password, ADMIN_CONFIG_KEY]);
      console.log('Admin password saved to database');
    } catch (error) {
      console.error('Save admin password error:', error);
    }
  }
}

let usersDB, friendshipsDB, messagesDB, groupsDB, groupMembersDB, groupMessagesDB;

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
  groupsDB = db;
  groupMembersDB = db;
  groupMessagesDB = db;
} else {
  const Datastore = require('@seald-io/nedb');
  usersDB = new Datastore({ filename: './data/users.db', autoload: true });
  friendshipsDB = new Datastore({ filename: './data/friendships.db', autoload: true });
  messagesDB = new Datastore({ filename: './data/messages.db', autoload: true });
  groupsDB = new Datastore({ filename: './data/groups.db', autoload: true });
  groupMembersDB = new Datastore({ filename: './data/group_members.db', autoload: true });
  groupMessagesDB = new Datastore({ filename: './data/group_messages.db', autoload: true });

  usersDB.ensureIndex({ fieldName: 'username', unique: true });
  friendshipsDB.ensureIndex({ fieldName: 'user_id' });
  friendshipsDB.ensureIndex({ fieldName: ['user_id', 'friend_id'], unique: true });
  messagesDB.ensureIndex({ fieldName: 'sender_id' });
  messagesDB.ensureIndex({ fieldName: 'receiver_id' });
  groupsDB.ensureIndex({ fieldName: 'group_number', unique: true });
  groupMembersDB.ensureIndex({ fieldName: 'group_id' });
  groupMembersDB.ensureIndex({ fieldName: ['group_id', 'user_id'], unique: true });
  groupMessagesDB.ensureIndex({ fieldName: 'group_id' });
}

async function initDB() {
  if (DATABASE_URL) {
    try {
      await usersDB.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          password_version INTEGER DEFAULT 1,
          avatar TEXT,
          nickname TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 添加缺失的列（如果不存在）
      try {
        await usersDB.query('ALTER TABLE users ADD COLUMN avatar TEXT');
      } catch (e) {
        // 列已存在，忽略错误
      }
      
      try {
        await usersDB.query('ALTER TABLE users ADD COLUMN nickname TEXT');
      } catch (e) {
        // 列已存在，忽略错误
      }
      
      try {
        await usersDB.query('ALTER TABLE users ADD COLUMN password_version INTEGER DEFAULT 1');
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

      await groupsDB.query(`
        CREATE TABLE IF NOT EXISTS "groups" (
          id TEXT PRIMARY KEY,
          group_number TEXT UNIQUE NOT NULL,
          name TEXT NOT NULL,
          avatar TEXT,
          owner_id TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await groupMembersDB.query(`
        CREATE TABLE IF NOT EXISTS group_members (
          id SERIAL PRIMARY KEY,
          group_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT DEFAULT 'member',
          joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(group_id, user_id)
        )
      `);

      await groupMessagesDB.query(`
        CREATE TABLE IF NOT EXISTS group_messages (
          id TEXT PRIMARY KEY,
          group_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT DEFAULT 'text',
          time TEXT NOT NULL,
          timestamp BIGINT NOT NULL
        )
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

initDB().then(() => {
  initAdminPassword();
  initAIAgent();
});

let AI_AGENT_ID = null;
const AI_AGENT_USERNAME = 'AI助手';
const AI_AGENT_NICKNAME = 'AI智能助手';
let AI_API_KEY = process.env.AI_API_KEY || 'de2da1e5f1f24c54b645051fbe551e32.OdKI3urA59V4evNo';

async function initAIAgent() {
  try {
    let aiUser;
    if (DATABASE_URL) {
      aiUser = await usersDB.query('SELECT id FROM users WHERE username = $1', [AI_AGENT_USERNAME]);
    } else {
      aiUser = await promisifyDB(usersDB.find).call(usersDB, { username: AI_AGENT_USERNAME });
    }

    const aiUserData = DATABASE_URL ? aiUser.rows[0] : aiUser[0];

    if (!aiUserData) {
      const hashedPassword = await bcrypt.hash('aiagent123', SALT_ROUNDS);
      const aiId = uuidv4();

      if (DATABASE_URL) {
        await usersDB.query(
          'INSERT INTO users (id, username, password, avatar, nickname) VALUES ($1, $2, $3, $4, $5)',
          [aiId, AI_AGENT_USERNAME, hashedPassword, null, AI_AGENT_NICKNAME]
        );
      } else {
        await promisifyDB(usersDB.insert).call(usersDB, {
          _id: aiId,
          id: aiId,
          username: AI_AGENT_USERNAME,
          password: hashedPassword,
          avatar: null,
          nickname: AI_AGENT_NICKNAME,
          created_at: new Date().toISOString()
        });
      }

      AI_AGENT_ID = aiId;
      console.log('AI Agent created successfully');
    } else {
      AI_AGENT_ID = aiUserData.id;
      console.log('AI Agent loaded');
    }

    await addAIAgentToAllUsers();
  } catch (error) {
    console.error('Init AI Agent error:', error);
  }
}

async function addAIAgentToAllUsers() {
  if (!AI_AGENT_ID) return;

  try {
    let allUsers;
    if (DATABASE_URL) {
      allUsers = await usersDB.query('SELECT id, username FROM users WHERE id != $1', [AI_AGENT_ID]);
      allUsers = allUsers.rows;
    } else {
      allUsers = await promisifyDB(usersDB.find).call(usersDB, { id: { $ne: AI_AGENT_ID } });
    }

    for (const user of allUsers) {
      await addAIAgentAsFriend(user.id, user.username, true);
    }
  } catch (error) {
    console.error('Add AI Agent to all users error:', error);
  }
}

async function addAIAgentAsFriend(userId, username, skipMessage = false) {
  if (!AI_AGENT_ID) return;

  try {
    if (DATABASE_URL) {
      const existFriendship = await friendshipsDB.query(
        'SELECT id FROM friendships WHERE user_id = $1 AND friend_id = $2',
        [userId, AI_AGENT_ID]
      );

      if (existFriendship.rows.length === 0) {
        await friendshipsDB.query(
          'INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2), ($3, $4)',
          [userId, AI_AGENT_ID, AI_AGENT_ID, userId]
        );

        if (!skipMessage) {
          await sendAIIntroduction(userId);
        }
      }
    } else {
      const existFriendship = await promisifyDB(friendshipsDB.find).call(friendshipsDB, {
        user_id: userId,
        friend_id: AI_AGENT_ID
      });

      if (existFriendship.length === 0) {
        await promisifyDB(friendshipsDB.insert).call(friendshipsDB, {
          user_id: userId,
          friend_id: AI_AGENT_ID
        });
        await promisifyDB(friendshipsDB.insert).call(friendshipsDB, {
          user_id: AI_AGENT_ID,
          friend_id: userId
        });

        if (!skipMessage) {
          await sendAIIntroduction(userId);
        }
      }
    }
  } catch (error) {
    console.error('Add AI Agent as friend error:', error);
  }
}

async function sendAIIntroduction(userId) {
  if (!AI_AGENT_ID) return;

  const now = new Date();
  const beijingTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
  const year = beijingTime.getUTCFullYear();
  const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijingTime.getUTCDate()).padStart(2, '0');
  const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
  const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
  const formattedTime = `${year}/${month}/${day} ${hours}:${minutes}`;

  const messageId = uuidv4();
  const introduction = '你好！我是AI智能助手，很高兴认识你！我可以帮你回答问题、聊天解闷。有什么需要帮助的，随时告诉我哦～';

  if (DATABASE_URL) {
    await messagesDB.query(
      `INSERT INTO messages (id, sender_id, receiver_id, content, type, time, timestamp, read)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [messageId, AI_AGENT_ID, userId, introduction, 'text', formattedTime, Date.now(), false]
    );
  } else {
    await promisifyDB(messagesDB.insert).call(messagesDB, {
      _id: messageId,
      id: messageId,
      sender_id: AI_AGENT_ID,
      receiver_id: userId,
      content: introduction,
      type: 'text',
      time: formattedTime,
      timestamp: Date.now(),
      read: false
    });
  }
}

async function handleAIMessage(userId, userContent) {
  if (!AI_AGENT_ID) return;

  try {
    let aiResponse = '';

    if (AI_API_KEY && AI_API_KEY.includes('.')) {
      aiResponse = await callZhipuAPI(userContent);
    } else {
      aiResponse = getSimpleResponse(userContent);
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    const now = new Date();
    const beijingTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(beijingTime.getUTCDate()).padStart(2, '0');
    const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
    const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
    const formattedTime = `${year}/${month}/${day} ${hours}:${minutes}`;

    const messageId = uuidv4();

    if (DATABASE_URL) {
      await messagesDB.query(
        `INSERT INTO messages (id, sender_id, receiver_id, content, type, time, timestamp, read)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [messageId, AI_AGENT_ID, userId, aiResponse, 'text', formattedTime, Date.now(), false]
      );
    } else {
      await promisifyDB(messagesDB.insert).call(messagesDB, {
        _id: messageId,
        id: messageId,
        sender_id: AI_AGENT_ID,
        receiver_id: userId,
        content: aiResponse,
        type: 'text',
        time: formattedTime,
        timestamp: Date.now(),
        read: false
      });
    }

    const targetSocketId = onlineUsers.get(userId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('new-message', {
        id: messageId,
        sender_id: AI_AGENT_ID,
        sender_username: AI_AGENT_USERNAME,
        receiver_id: userId,
        content: aiResponse,
        type: 'text',
        time: formattedTime,
        timestamp: Date.now()
      });
    }
  } catch (error) {
    console.error('Handle AI message error:', error);
  }
}

function getSimpleResponse(userContent) {
  const lowerContent = userContent.toLowerCase();

  if (lowerContent.includes('你好') || lowerContent.includes('哈喽') || lowerContent.includes('hi')) {
    return '你好呀！很高兴和你聊天～';
  } else if (lowerContent.includes('帮助') || lowerContent.includes('帮忙') || lowerContent.includes('怎么')) {
    return '我可以帮你回答问题、聊天解闷。有什么想聊的，随时告诉我哦！';
  } else if (lowerContent.includes('时间') || lowerContent.includes('几点')) {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
    const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
    return `现在是北京时间 ${hours}:${minutes} 哦～`;
  } else if (lowerContent.includes('谢谢') || lowerContent.includes('感谢')) {
    return '不用客气！能帮到你我很开心～';
  } else {
    return `收到你的消息："${userContent}"～让我想想怎么回复你...有什么想聊的随时告诉我！`;
  }
}

async function callZhipuAPI(prompt) {
  try {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'glm-4-flash',
        messages: [
          {
            role: 'system',
            content: '你是一个友好的AI助手，名字叫AI助手。你的任务是帮助用户解决问题、聊天交流。请用自然、友好的中文回复用户。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 512,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.choices && data.choices[0] && data.choices[0].message) {
      return data.choices[0].message.content.trim();
    } else if (data.response) {
      return data.response.trim();
    } else {
      throw new Error('Unexpected API response format');
    }
  } catch (error) {
    console.error('Zhipu API error:', error);
    return getSimpleResponse(prompt);
  }
}

function promisifyDB(method) {
  return function(query, options = {}) {
    return new Promise((resolve, reject) => {
      const methodString = method.toString();
      if (methodString.includes('insert')) {
        method.call(this, query, (err, doc) => {
          if (err) reject(err);
          else resolve(doc);
        });
      } else {
        method.call(this, query, options, (err, docs) => {
          if (err) reject(err);
          else resolve(docs);
        });
      }
    });
  };
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
  }

  if (username.length < 1) {
    return res.status(400).json({ success: false, message: '用户名不能为空' });
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

    try {
      await sendWelcomeMessage(userId, username);
    } catch (welcomeError) {
      console.error('Send welcome message error:', welcomeError);
    }

    try {
      await addSelfAsFriend(userId);
    } catch (selfFriendError) {
      console.error('Add self as friend error:', selfFriendError);
    }

    try {
      await addAIAgentAsFriend(userId, username, false);
    } catch (aiFriendError) {
      console.error('Add AI Agent as friend error:', aiFriendError);
    }

    res.json({ success: true, user: { id: userId, username, avatar: null, nickname: '' } });
  } catch (error) {
    console.error('Register error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: `注册失败: ${error.message}` });
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

async function addSelfAsFriend(userId) {
  if (DATABASE_URL) {
    const existFriendship = await friendshipsDB.query(
      'SELECT id FROM friendships WHERE user_id = $1 AND friend_id = $2',
      [userId, userId]
    );

    if (existFriendship.rows.length === 0) {
      await friendshipsDB.query(
        'INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2)',
        [userId, userId]
      );
    }
  } else {
    const existFriendship = await promisifyDB(friendshipsDB.find).call(friendshipsDB, {
      user_id: userId,
      friend_id: userId
    });

    if (existFriendship.length === 0) {
      await promisifyDB(friendshipsDB.insert).call(friendshipsDB, {
        user_id: userId,
        friend_id: userId
      });
    }
  }
  console.log(`Self friendship added for user ${userId}`);
}

app.post('/api/verify', async (req, res) => {
  const { userId, passwordVersion } = req.body;
  
  if (!userId) {
    return res.status(400).json({ success: false, message: '用户ID不能为空' });
  }

  try {
    let user;
    if (DATABASE_URL) {
      user = await usersDB.query('SELECT id, username, password_version FROM users WHERE id = $1', [userId]);
    } else {
      user = await promisifyDB(usersDB.find).call(usersDB, { id: userId });
    }

    const userData = DATABASE_URL ? user.rows[0] : user[0];

    if (!userData) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }

    const currentVersion = userData.password_version || 1;
    
    if (passwordVersion && currentVersion > passwordVersion) {
      return res.status(401).json({ success: false, message: '密码已被修改，请重新登录' });
    }

    res.json({ success: true, user: { id: userData.id, username: userData.username, password_version: currentVersion } });
  } catch (error) {
    console.error('Verify user error:', error);
    res.status(500).json({ success: false, message: '验证失败' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
  }

  try {
    let user;
    if (DATABASE_URL) {
      user = await usersDB.query(
        'SELECT id, username, password, password_version, avatar, nickname FROM users WHERE username = $1',
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

    const passwordMatch = await bcrypt.compare(password, userData.password);

    if (!passwordMatch) {
      return res.status(400).json({ success: false, message: '密码错误' });
    }

    // 批量加载好友和群聊数据
    const userId = userData.id;
    
    let friendsData = [];
    let groupsData = [];
    
    // 并行加载好友和群聊
    if (DATABASE_URL) {
      const [friendsResult, groupMembersResult] = await Promise.all([
        usersDB.query(
          `SELECT u.id, u.username, u.avatar, u.nickname 
           FROM friendships f
           JOIN users u ON f.friend_id = u.id
           WHERE f.user_id = $1`,
          [userId]
        ),
        usersDB.query(
          `SELECT gm.group_id, g.group_number, g.name, g.avatar, g.owner_id
           FROM group_members gm
           JOIN "groups" g ON gm.group_id = g.id
           WHERE gm.user_id = $1`,
          [userId]
        )
      ]);
      friendsData = friendsResult.rows;
      groupsData = groupMembersResult.rows.map(g => ({
        id: g.group_id,
        group_number: g.group_number,
        name: g.name,
        avatar: g.avatar,
        owner_id: g.owner_id
      }));
    } else {
      const [friendships, groupMembers] = await Promise.all([
        promisifyDB(friendshipsDB.find).call(friendshipsDB, { user_id: userId }),
        promisifyDB(groupMembersDB.find).call(groupMembersDB, { user_id: userId })
      ]);
      
      const friendIds = friendships.map(f => f.friend_id);
      const groupIds = groupMembers.map(g => g.group_id);
      
      const [friends, groups] = await Promise.all([
        promisifyDB(usersDB.find).call(usersDB, { id: { $in: friendIds } }),
        promisifyDB(groupsDB.find).call(groupsDB, { id: { $in: groupIds } })
      ]);
      
      friendsData = friends.map(f => ({ ...f, nickname: f.nickname || '' }));
      groupsData = groups;
    }

    res.json({ 
      success: true, 
      user: { 
        id: userData.id, 
        username: userData.username,
        avatar: userData.avatar || null,
        nickname: userData.nickname || '',
        password_version: userData.password_version || 1
      },
      friends: friendsData,
      groups: groupsData
    });
  } catch (error) {
    console.error('Login error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ success: false, message: `登录失败: ${error.message}` });
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

app.post('/api/friend/delete', async (req, res) => {
  const { userId, friendId } = req.body;

  if (!userId || !friendId) {
    return res.status(400).json({ success: false, message: '参数错误' });
  }

  try {
    if (DATABASE_URL) {
      await friendshipsDB.query(
        'DELETE FROM friendships WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)',
        [userId, friendId]
      );
    } else {
      await promisifyDB(friendshipsDB.remove).call(friendshipsDB, {
        $or: [
          { user_id: userId, friend_id: friendId },
          { user_id: friendId, friend_id: userId }
        ]
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete friend error:', error);
    res.status(500).json({ success: false, message: '删除失败' });
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

    if (receiverId === AI_AGENT_ID && senderId !== AI_AGENT_ID) {
      await handleAIMessage(senderId, content);
    }
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

app.post('/api/admin/verify', (req, res) => {
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({ success: false, message: '密码不能为空' });
  }

  if (password === ADMIN_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: '密码错误' });
  }
});

app.get('/api/admin/config/ai-key', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  if (!adminToken) {
    return res.status(401).json({ success: false, message: '未授权' });
  }
  res.json({ success: true, apiKey: AI_API_KEY ? (AI_API_KEY.substring(0, 10) + '...') : '' });
});

app.post('/api/admin/config/ai-key', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  if (!adminToken) {
    return res.status(401).json({ success: false, message: '未授权' });
  }

  const { apiKey } = req.body;
  if (!apiKey) {
    return res.status(400).json({ success: false, message: 'API Key不能为空' });
  }
  AI_API_KEY = apiKey;
  res.json({ success: true });
});

app.post('/api/admin/change-password', async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ success: false, message: '请填写所有字段' });
  }

  if (oldPassword !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: '原密码错误' });
  }

  ADMIN_PASSWORD = newPassword;
  await saveAdminPassword(newPassword);
  res.json({ success: true, message: '密码修改成功' });
});

app.put('/api/admin/users/:userId/password', async (req, res) => {
  const { userId } = req.params;
  const { newPassword } = req.body;
  
  if (!newPassword) {
    return res.status(400).json({ success: false, message: '密码不能为空' });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    if (DATABASE_URL) {
      await usersDB.query('UPDATE users SET password = $1, password_version = password_version + 1 WHERE id = $2', [hashedPassword, userId]);
    } else {
      await promisifyDB(usersDB.update).call(usersDB, { id: userId }, { $set: { password: hashedPassword, password_version: (Date.now() / 1000) | 0 } });
    }

    res.json({ success: true, message: '密码修改成功' });
  } catch (error) {
    console.error('Update user password error:', error);
    res.status(500).json({ success: false, message: '修改失败' });
  }
});

app.get('/api/admin/users', async (req, res) => {
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

app.get('/api/admin/stats/users', async (req, res) => {
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

app.get('/api/admin/stats/friendships', async (req, res) => {
  try {
    let count;
    if (DATABASE_URL) {
      const result = await friendshipsDB.query('SELECT COUNT(*) FROM friendships');
      count = result.rows[0].count;
    } else {
      count = await new Promise((resolve, reject) => {
        friendshipsDB.count({}, (err, n) => {
          if (err) reject(err);
          else resolve(n);
        });
      });
    }
    res.json({ success: true, count: parseInt(count) || 0 });
  } catch (error) {
    console.error('Get friendship count error:', error);
    res.json({ success: false, count: 0 });
  }
});

app.get('/api/admin/stats/messages', async (req, res) => {
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

app.get('/api/admin/groups', async (req, res) => {
  try {
    let groups;
    if (DATABASE_URL) {
      groups = await groupsDB.query('SELECT id, group_number, name, owner_id, created_at FROM "groups" ORDER BY created_at DESC');
    } else {
      groups = await promisifyDB(groupsDB.find).call(groupsDB, {}).sort({ created_at: -1 });
    }
    
    const groupList = DATABASE_URL ? groups.rows : groups;
    
    const result = await Promise.all(groupList.map(async group => {
      let memberCount;
      if (DATABASE_URL) {
        const countResult = await groupMembersDB.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [group.id]);
        memberCount = countResult.rows[0].count;
      } else {
        memberCount = await new Promise((resolve, reject) => {
          groupMembersDB.count({ group_id: group.id }, (err, n) => {
            if (err) reject(err);
            else resolve(n);
          });
        });
      }
      
      let ownerName;
      if (DATABASE_URL) {
        const ownerResult = await usersDB.query('SELECT username FROM users WHERE id = $1', [group.owner_id]);
        ownerName = ownerResult.rows[0]?.username || 'Unknown';
      } else {
        const owner = await promisifyDB(usersDB.find).call(usersDB, { id: group.owner_id });
        ownerName = owner[0]?.username || 'Unknown';
      }
      
      return {
        ...group,
        // 合并群名称和群号为群号，优先显示群名称，没有则显示群号
        group_number: group.name || group.group_number,
        member_count: parseInt(memberCount) || 0,
        owner_name: ownerName
      };
    }));
    
    res.json({ success: true, groups: result });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

app.delete('/api/admin/groups/:groupId', async (req, res) => {
  const { groupId } = req.params;

  try {
    if (DATABASE_URL) {
      await groupMessagesDB.query('DELETE FROM group_messages WHERE group_id = $1', [groupId]);
      await groupMembersDB.query('DELETE FROM group_members WHERE group_id = $1', [groupId]);
      await groupsDB.query('DELETE FROM "groups" WHERE id = $1', [groupId]);
    } else {
      await promisifyDB(groupMessagesDB.remove).call(groupMessagesDB, { group_id: groupId }, { multi: true });
      await promisifyDB(groupMembersDB.remove).call(groupMembersDB, { group_id: groupId }, { multi: true });
      await promisifyDB(groupsDB.remove).call(groupsDB, { id: groupId }, { multi: false });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete group error:', error);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

app.delete('/api/admin/users/:userId', async (req, res) => {
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

// 上传群头像API
app.post('/api/upload-group-avatar', upload.single('avatar'), async (req, res) => {
  try {
    const { groupId } = req.body;

    if (!groupId || !req.file) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }

    const filePath = path.join(uploadsDir, req.file.filename);
    const fileBuffer = fs.readFileSync(filePath);
    const base64Image = `data:${req.file.mimetype};base64,${fileBuffer.toString('base64')}`;
    
    fs.unlinkSync(filePath);

    if (DATABASE_URL) {
      await groupsDB.query('UPDATE "groups" SET avatar = $1 WHERE id = $2', [base64Image, groupId]);
    } else {
      await promisifyDB(groupsDB.update).call(groupsDB,
        { id: groupId },
        { $set: { avatar: base64Image } },
        { multi: false }
      );
    }

    res.json({ success: true, avatar: base64Image });
  } catch (error) {
    console.error('Upload group avatar error:', error);
    res.status(500).json({ success: false, message: '上传失败' });
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

  if (username.length < 2) {
    return res.status(400).json({ success: false, message: '账号至少需要2个字符' });
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

// 创建群聊
app.post('/api/group/create', async (req, res) => {
  try {
    const { userId, groupName, groupNumber } = req.body;

    if (!userId || !groupName || !groupNumber) {
      return res.status(400).json({ success: false, message: '参数不完整' });
    }

    if (DATABASE_URL) {
      const existingGroup = await groupsDB.query('SELECT id FROM "groups" WHERE group_number = $1', [groupNumber]);
      if (existingGroup.rows.length > 0) {
        return res.status(400).json({ success: false, message: '群号已被使用' });
      }

      const groupId = uuidv4();
      await groupsDB.query(
        'INSERT INTO "groups" (id, group_number, name, owner_id) VALUES ($1, $2, $3, $4)',
        [groupId, groupNumber, groupName, userId]
      );

      await groupMembersDB.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
        [groupId, userId, 'owner']
      );

      res.json({ success: true, group: { id: groupId, group_number: groupNumber, name: groupName, owner_id: userId, avatar: null } });
    } else {
      const existingGroup = await promisifyDB(groupsDB.find).call(groupsDB, { group_number: groupNumber });
      if (existingGroup.length > 0) {
        return res.status(400).json({ success: false, message: '群号已被使用' });
      }

      const groupId = uuidv4();
      await promisifyDB(groupsDB.insert).call(groupsDB, {
        _id: groupId,
        id: groupId,
        group_number: groupNumber,
        name: groupName,
        owner_id: userId,
        created_at: new Date().toISOString()
      });

      await promisifyDB(groupMembersDB.insert).call(groupMembersDB, {
        group_id: groupId,
        user_id: userId,
        role: 'owner',
        joined_at: new Date().toISOString()
      });

      res.json({ success: true, group: { id: groupId, group_number: groupNumber, name: groupName, owner_id: userId, avatar: null } });
    }
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ success: false, message: '创建群聊失败' });
  }
});

// 获取用户所在的群聊列表
app.get('/api/groups/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    let groupDocs;
    if (DATABASE_URL) {
      groupDocs = await groupMembersDB.query(
        'SELECT group_id, role FROM group_members WHERE user_id = $1',
        [userId]
      );
    } else {
      groupDocs = await promisifyDB(groupMembersDB.find).call(groupMembersDB, { user_id: userId });
    }

    const memberGroups = DATABASE_URL ? groupDocs.rows : groupDocs;
    if (memberGroups.length === 0) {
      return res.json({ success: true, groups: [] });
    }

    const groupIds = memberGroups.map(m => m.group_id);
    let groupsData;
    if (DATABASE_URL) {
      const placeholders = groupIds.map((_, i) => `$${i + 1}`).join(',');
      groupsData = await groupsDB.query(
        `SELECT id, group_number, name, avatar, owner_id, created_at FROM "groups" WHERE id IN (${placeholders})`,
        groupIds
      );
    } else {
      groupsData = await promisifyDB(groupsDB.find).call(groupsDB, { id: { $in: groupIds } });
    }

    const groups = (DATABASE_URL ? groupsData.rows : groupsData).map(g => {
      const member = memberGroups.find(m => m.group_id === g.id);
      return { ...g, role: member?.role || 'member' };
    });

    res.json({ success: true, groups });
  } catch (error) {
    console.error('Get groups error:', error);
    res.status(500).json({ success: false, message: '获取群列表失败' });
  }
});

// 获取群成员
app.get('/api/group/:groupId/members', async (req, res) => {
  try {
    const { groupId } = req.params;

    let memberDocs;
    if (DATABASE_URL) {
      memberDocs = await groupMembersDB.query(
        'SELECT user_id, role FROM group_members WHERE group_id = $1',
        [groupId]
      );
    } else {
      memberDocs = await promisifyDB(groupMembersDB.find).call(groupMembersDB, { group_id: groupId });
    }

    const members = DATABASE_URL ? memberDocs.rows : memberDocs;
    if (members.length === 0) {
      return res.json({ success: true, members: [] });
    }

    const userIds = members.map(m => m.user_id);
    let usersData;
    if (DATABASE_URL) {
      const placeholders = userIds.map((_, i) => `$${i + 1}`).join(',');
      usersData = await usersDB.query(
        `SELECT id, username, avatar, nickname FROM users WHERE id IN (${placeholders})`,
        userIds
      );
    } else {
      usersData = await promisifyDB(usersDB.find).call(usersDB, { id: { $in: userIds } });
    }

    const membersWithInfo = (DATABASE_URL ? usersData.rows : usersData).map(u => {
      const member = members.find(m => m.user_id === u.id);
      return { ...u, role: member?.role || 'member' };
    });

    res.json({ success: true, members: membersWithInfo });
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({ success: false, message: '获取群成员失败' });
  }
});

// 邀请好友入群
app.post('/api/group/invite', async (req, res) => {
  try {
    const { groupId, inviterId, friendIds } = req.body;

    if (!groupId || !inviterId || !friendIds || !Array.isArray(friendIds)) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }

    if (DATABASE_URL) {
      const ownerCheck = await groupMembersDB.query(
        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, inviterId]
      );
      if (ownerCheck.rows.length === 0 || ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ success: false, message: '只有群主可以邀请' });
      }
    } else {
      const ownerCheck = await promisifyDB(groupMembersDB.find).call(groupMembersDB, {
        group_id: groupId,
        user_id: inviterId
      });
      if (ownerCheck.length === 0 || ownerCheck[0].role !== 'owner') {
        return res.status(403).json({ success: false, message: '只有群主可以邀请' });
      }
    }

    const addedMembers = [];
    for (const friendId of friendIds) {
      if (DATABASE_URL) {
        const existing = await groupMembersDB.query(
          'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
          [groupId, friendId]
        );
        if (existing.rows.length === 0) {
          await groupMembersDB.query(
            'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
            [groupId, friendId, 'member']
          );
          addedMembers.push(friendId);
        }
      } else {
        const existing = await promisifyDB(groupMembersDB.find).call(groupMembersDB, {
          group_id: groupId,
          user_id: friendId
        });
        if (existing.length === 0) {
          await promisifyDB(groupMembersDB.insert).call(groupMembersDB, {
            group_id: groupId,
            user_id: friendId,
            role: 'member',
            joined_at: new Date().toISOString()
          });
          addedMembers.push(friendId);
        }
      }
    }

    res.json({ success: true, message: '已成功邀请' + addedMembers.length + '人', addedMembers });
  } catch (error) {
    console.error('Invite to group error:', error);
    res.status(500).json({ success: false, message: '邀请入群失败' });
  }
});

// 更新群信息
app.put('/api/group/:groupId', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { userId, groupNumber, avatar, name } = req.body;

    if (!groupId || !userId) {
      return res.status(400).json({ success: false, message: '参数不完整' });
    }

    // 检查用户是否是群主
    if (DATABASE_URL) {
      const ownerCheck = await groupMembersDB.query(
        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      if (ownerCheck.rows.length === 0 || ownerCheck.rows[0].role !== 'owner') {
        return res.status(403).json({ success: false, message: '只有群主可以修改群信息' });
      }
    } else {
      const ownerCheck = await promisifyDB(groupMembersDB.find).call(groupMembersDB, {
        group_id: groupId,
        user_id: userId
      });
      if (ownerCheck.length === 0 || ownerCheck[0].role !== 'owner') {
        return res.status(403).json({ success: false, message: '只有群主可以修改群信息' });
      }
    }

    // 如果要更新群号，检查群号是否被使用
    if (groupNumber) {
      if (DATABASE_URL) {
        const existingGroup = await groupsDB.query('SELECT id FROM "groups" WHERE group_number = $1 AND id != $2', [groupNumber, groupId]);
        if (existingGroup.rows.length > 0) {
          return res.status(400).json({ success: false, message: '群号已被使用' });
        }
      } else {
        const existingGroup = await promisifyDB(groupsDB.find).call(groupsDB, { group_number: groupNumber, id: { $ne: groupId } });
        if (existingGroup.length > 0) {
          return res.status(400).json({ success: false, message: '群号已被使用' });
        }
      }
    }

    // 更新群信息
    if (DATABASE_URL) {
      const updateFields = [];
      const updateValues = [];
      let paramIndex = 1;

      if (groupNumber) {
        updateFields.push(`group_number = $${paramIndex++}`);
        updateValues.push(groupNumber);
      }
      if (avatar !== undefined) { // 允许设置为空字符串
        updateFields.push(`avatar = $${paramIndex++}`);
        updateValues.push(avatar);
      }
      if (name) {
        updateFields.push(`name = $${paramIndex++}`);
        updateValues.push(name);
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ success: false, message: '没有要更新的内容' });
      }

      updateValues.push(groupId);

      await groupsDB.query(
        `UPDATE "groups" SET ${updateFields.join(', ')} WHERE id = $${paramIndex}`,
        updateValues
      );

      // 获取更新后的群信息
      const result = await groupsDB.query('SELECT id, group_number, name, avatar, owner_id FROM "groups" WHERE id = $1', [groupId]);
      res.json({ success: true, message: '更新成功', group: result.rows[0] });
    } else {
      const updateData = {};
      if (groupNumber) updateData.group_number = groupNumber;
      if (avatar !== undefined) updateData.avatar = avatar;
      if (name) updateData.name = name;
      await promisifyDB(groupsDB.update).call(groupsDB, { id: groupId }, { $set: updateData });

      // 获取更新后的群信息
      const groups = await promisifyDB(groupsDB.find).call(groupsDB, { id: groupId });
      res.json({ success: true, message: '更新成功', group: groups[0] });
    }
  } catch (error) {
    console.error('Update group error:', error);
    res.status(500).json({ success: false, message: '更新群信息失败' });
  }
});

// 发送群消息
app.post('/api/group/message', async (req, res) => {
  try {
    const { groupId, senderId, content, type = 'text' } = req.body;

    if (!groupId || !senderId || !content) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }

    if (DATABASE_URL) {
      const memberCheck = await groupMembersDB.query(
        'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, senderId]
      );
      if (memberCheck.rows.length === 0) {
        return res.status(403).json({ success: false, message: '你不是群成员' });
      }
    } else {
      const memberCheck = await promisifyDB(groupMembersDB.find).call(groupMembersDB, {
        group_id: groupId,
        user_id: senderId
      });
      if (memberCheck.length === 0) {
        return res.status(403).json({ success: false, message: '你不是群成员' });
      }
    }

    const now = new Date();
    const beijingTime = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const year = beijingTime.getUTCFullYear();
    const month = String(beijingTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(beijingTime.getUTCDate()).padStart(2, '0');
    const hours = String(beijingTime.getUTCHours()).padStart(2, '0');
    const minutes = String(beijingTime.getUTCMinutes()).padStart(2, '0');
    const formattedTime = `${year}/${month}/${day} ${hours}:${minutes}`;

    const messageId = uuidv4();
    const message = {
      id: messageId,
      groupId: groupId,
      senderId: senderId,
      content,
      type,
      time: formattedTime,
      timestamp: Date.now()
    };

    if (DATABASE_URL) {
      await groupMessagesDB.query(
        `INSERT INTO group_messages (id, group_id, sender_id, content, type, time, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [messageId, groupId, senderId, content, type, formattedTime, Date.now()]
      );
    } else {
      await promisifyDB(groupMessagesDB.insert).call(groupMessagesDB, {
        _id: messageId,
        id: messageId,
        group_id: groupId,
        sender_id: senderId,
        content,
        type,
        time: formattedTime,
        timestamp: Date.now()
      });
    }

    let senderInfo;
    if (DATABASE_URL) {
      const sender = await usersDB.query('SELECT username FROM users WHERE id = $1', [senderId]);
      senderInfo = sender.rows[0];
    } else {
      const sender = await promisifyDB(usersDB.find).call(usersDB, { id: senderId });
      senderInfo = sender[0];
    }

    res.json({
      success: true,
      message: { ...message, senderName: senderInfo?.username || 'Unknown' }
    });
  } catch (error) {
    console.error('Send group message error:', error);
    res.status(500).json({ success: false, message: '发送群消息失败' });
  }
});

// 获取群消息
app.get('/api/group/:groupId/messages', async (req, res) => {
  try {
    const { groupId } = req.params;

    let msgs;
    if (DATABASE_URL) {
      msgs = await groupMessagesDB.query(
        `SELECT gm.id, gm.group_id, gm.sender_id, gm.content, gm.type, gm.time, gm.timestamp,
                u.username, u.avatar
         FROM group_messages gm
         LEFT JOIN users u ON gm.sender_id = u.id
         WHERE gm.group_id = $1 ORDER BY gm.timestamp ASC`,
        [groupId]
      );
    } else {
      msgs = await promisifyDB(groupMessagesDB.find).call(groupMessagesDB, { group_id: groupId });
      msgs = msgs.sort((a, b) => a.timestamp - b.timestamp);

      const userIds = [...new Set(msgs.map(m => m.sender_id || m.senderId))];
      let usersData = [];
      if (userIds.length > 0) {
        const users = await promisifyDB(usersDB.find).call(usersDB, { id: { $in: userIds } });
        usersData = users;
      }

      msgs = msgs.map(msg => {
        const senderId = msg.sender_id || msg.senderId;
        const sender = usersData.find(u => u.id === senderId);
        return {
          ...msg,
          senderId: senderId,
          username: sender?.username || 'Unknown',
          avatar: sender?.avatar || ''
        };
      });

      return res.json({ success: true, messages: msgs });
    }

    const messages = msgs.rows.map(msg => ({
      id: msg.id,
      groupId: msg.group_id,
      senderId: msg.sender_id,
      content: msg.content,
      type: msg.type || 'text',
      time: msg.time,
      timestamp: msg.timestamp,
      username: msg.username || 'Unknown',
      avatar: msg.avatar || ''
    }));

    res.json({ success: true, messages });
  } catch (error) {
    console.error('Get group messages error:', error);
    res.status(500).json({ success: false, message: '获取群消息失败' });
  }
});

// 退出群聊
app.post('/api/group/leave', async (req, res) => {
  try {
    const { groupId, userId } = req.body;

    if (!groupId || !userId) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }

    let ownerCheck;
    if (DATABASE_URL) {
      ownerCheck = await groupMembersDB.query(
        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
    } else {
      ownerCheck = await promisifyDB(groupMembersDB.find).call(groupMembersDB, {
        group_id: groupId,
        user_id: userId
      });
    }

    const member = DATABASE_URL ? ownerCheck.rows[0] : ownerCheck[0];
    if (member?.role === 'owner') {
      return res.status(400).json({ success: false, message: '群主无法退出群聊，请先解散群' });
    }

    if (DATABASE_URL) {
      await groupMembersDB.query(
        'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
    } else {
      await promisifyDB(groupMembersDB.remove).call(groupMembersDB, {
        group_id: groupId,
        user_id: userId
      }, { multi: true });
    }

    res.json({ success: true, message: '已退出群聊' });
  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({ success: false, message: '退出群聊失败' });
  }
});

// 解散群聊
app.post('/api/group/dissolve', async (req, res) => {
  try {
    const { groupId, userId } = req.body;

    if (!groupId || !userId) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }

    let ownerCheck;
    if (DATABASE_URL) {
      ownerCheck = await groupMembersDB.query(
        'SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
    } else {
      ownerCheck = await promisifyDB(groupMembersDB.find).call(groupMembersDB, {
        group_id: groupId,
        user_id: userId
      });
    }

    const member = DATABASE_URL ? ownerCheck.rows[0] : ownerCheck[0];
    if (!member || member.role !== 'owner') {
      return res.status(403).json({ success: false, message: '只有群主可以解散群' });
    }

    if (DATABASE_URL) {
      await groupMessagesDB.query('DELETE FROM group_messages WHERE group_id = $1', [groupId]);
      await groupMembersDB.query('DELETE FROM group_members WHERE group_id = $1', [groupId]);
      await groupsDB.query('DELETE FROM "groups" WHERE id = $1', [groupId]);
    } else {
      await promisifyDB(groupMessagesDB.remove).call(groupMessagesDB, { group_id: groupId }, { multi: true });
      await promisifyDB(groupMembersDB.remove).call(groupMembersDB, { group_id: groupId }, { multi: true });
      await promisifyDB(groupsDB.remove).call(groupsDB, { id: groupId }, { multi: false });
    }

    res.json({ success: true, message: '群已解散' });
  } catch (error) {
    console.error('Dissolve group error:', error);
    res.status(500).json({ success: false, message: '解散群失败' });
  }
});

// 根据群号搜索群
app.get('/api/group/search/:groupNumber', async (req, res) => {
  try {
    const { groupNumber } = req.params;

    let group;
    if (DATABASE_URL) {
      group = await groupsDB.query('SELECT id, group_number, name, avatar, owner_id FROM "groups" WHERE group_number = $1', [groupNumber]);
    } else {
      group = await promisifyDB(groupsDB.find).call(groupsDB, { group_number: groupNumber });
    }

    const groupData = DATABASE_URL ? group.rows[0] : group[0];
    if (!groupData) {
      return res.status(404).json({ success: false, message: '群不存在' });
    }

    res.json({ success: true, group: groupData });
  } catch (error) {
    console.error('Search group error:', error);
    res.status(500).json({ success: false, message: '搜索群失败' });
  }
});

// 申请加入群
app.post('/api/group/join', async (req, res) => {
  try {
    const { groupId, userId } = req.body;

    if (!groupId || !userId) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }

    if (DATABASE_URL) {
      const existing = await groupMembersDB.query(
        'SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2',
        [groupId, userId]
      );
      if (existing.rows.length > 0) {
        return res.status(400).json({ success: false, message: '你已经是群成员' });
      }

      await groupMembersDB.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
        [groupId, userId, 'member']
      );
    } else {
      const existing = await promisifyDB(groupMembersDB.find).call(groupMembersDB, {
        group_id: groupId,
        user_id: userId
      });
      if (existing.length > 0) {
        return res.status(400).json({ success: false, message: '你已经是群成员' });
      }

      await promisifyDB(groupMembersDB.insert).call(groupMembersDB, {
        group_id: groupId,
        user_id: userId,
        role: 'member',
        joined_at: new Date().toISOString()
      });
    }

    res.json({ success: true, message: '加入成功' });
  } catch (error) {
    console.error('Join group error:', error);
    res.status(500).json({ success: false, message: '加入群失败' });
  }
});

app.get('/api/fix-db', async (req, res) => {
  if (!DATABASE_URL) {
    return res.json({ success: false, message: 'Not using PostgreSQL' });
  }
  
  try {
    // 添加nickname列
    try {
      await usersDB.query('ALTER TABLE users ADD COLUMN nickname TEXT');
      console.log('Added nickname column');
    } catch (e) {
      console.log('nickname column may already exist');
    }
    
    // 添加avatar列
    try {
      await usersDB.query('ALTER TABLE users ADD COLUMN avatar TEXT');
      console.log('Added avatar column');
    } catch (e) {
      console.log('avatar column may already exist');
    }
    
    // 添加type列到messages
    try {
      await messagesDB.query("ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text'");
      console.log('Added type column to messages');
    } catch (e) {
      console.log('type column may already exist in messages');
    }
    
    res.json({ success: true, message: 'Database fixed successfully' });
  } catch (error) {
    console.error('Fix DB error:', error);
    res.status(500).json({ success: false, message: `Fix failed: ${error.message}` });
  }
});

server.listen(PORT, () => {
  console.log(`Tell server running on port ${PORT}`);
  console.log(DATABASE_URL ? 'Using PostgreSQL' : 'Using NeDB for development');
});

module.exports = app;
