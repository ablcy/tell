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

// 纭繚uploads鐩綍瀛樺湪
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 閰嶇疆multer瀛樺偍
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB闄愬埗
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('鍙厑璁镐笂浼犲浘鐗囨枃浠?));
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
    return res.status(401).json({ success: false, message: '鏈巿鏉冭闂紝璇峰厛鐧诲綍' });
  }
  next();
}

let usersDB, friendshipsDB, messagesDB, groupsDB, groupMembersDB, groupMessagesDB;

if (DATABASE_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
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
  const Datastore = require('nedb');
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
      console.log('Initializing PostgreSQL database...');

      await usersDB.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          avatar TEXT,
          nickname TEXT DEFAULT '',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('Users table created/verified');

      // 纭繚 nickname 鍒楀瓨鍦?
      try {
        await usersDB.query('ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT \'\'');
        console.log('Added nickname column to users table');
      } catch (e) {
        console.log('Nickname column already exists');
      }

      // 纭繚 avatar 鍒楀瓨鍦?
      try {
        await usersDB.query('ALTER TABLE users ADD COLUMN avatar TEXT');
        console.log('Added avatar column to users table');
      } catch (e) {
        console.log('Avatar column already exists');
      }

      await friendshipsDB.query(`
        CREATE TABLE IF NOT EXISTS friendships (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          friend_id TEXT NOT NULL,
          UNIQUE(user_id, friend_id)
        )
      `);
      console.log('Friendships table created/verified');

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
      console.log('Messages table created/verified');

      // 娣诲姞type鍒楋紙濡傛灉涓嶅瓨鍦級
      try {
        await messagesDB.query('ALTER TABLE messages ADD COLUMN type TEXT DEFAULT \'text\'');
        console.log('Added type column to messages table');
      } catch (e) {
        console.log('Type column already exists in messages');
      }

      await messagesDB.query(`
        CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id)
      `);
      console.log('Created messages index');

      await friendshipsDB.query(`
        CREATE INDEX IF NOT EXISTS idx_friendships_user_id ON friendships(user_id)
      `);
      console.log('Created friendships index');

      console.log('PostgreSQL database initialized successfully');
    } catch (error) {
      console.error('Database initialization error:', error.message || error);
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

  console.log('Register attempt:', { username, hasPassword: !!password });

  if (!username || !password) {
    return res.status(400).json({ success: false, message: '鐢ㄦ埛鍚嶅拰瀵嗙爜涓嶈兘涓虹┖' });
  }

  if (username.length < 3) {
    return res.status(400).json({ success: false, message: '鐢ㄦ埛鍚嶈嚦灏戦渶瑕?涓瓧绗? });
  }

  try {
    let existing;
    if (DATABASE_URL) {
      console.log('Checking existing user in PostgreSQL...');
      existing = await usersDB.query('SELECT id FROM users WHERE username = $1', [username]);
      console.log('Existing check result:', existing.rows.length);
    } else {
      existing = await promisifyDB(usersDB.find).call(usersDB, { username });
    }

    if ((DATABASE_URL && existing.rows.length > 0) || (!DATABASE_URL && existing.length > 0)) {
      return res.status(400).json({ success: false, message: '鐢ㄦ埛鍚嶅凡琚娇鐢? });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = uuidv4();

    console.log('Creating new user:', { userId, username });

    if (DATABASE_URL) {
      await usersDB.query(
        'INSERT INTO users (id, username, password, avatar, nickname) VALUES ($1, $2, $3, $4, $5)',
        [userId, username, hashedPassword, null, '']
      );
      console.log('User inserted into PostgreSQL');
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
    console.error('Register error:', error.message || error);
    res.status(500).json({ success: false, message: '娉ㄥ唽澶辫触: ' + (error.message || '鏈煡閿欒') });
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
        [messageId, yanTalkId, userId, '鎴戞槸YanTalk瀹樻柟璐﹀彿锛屼负浜嗗缓璁炬洿鏈夎叮鐨勮亰澶╁伐鍏凤紝娆㈣繋鎻愬嚭瀹濊吹鐨勫缓璁綖', 'text', formattedTime, Date.now(), false]
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
        content: '鎴戞槸YanTalk瀹樻柟璐﹀彿锛屼负浜嗗缓璁炬洿鏈夎叮鐨勮亰澶╁伐鍏凤紝娆㈣繋鎻愬嚭瀹濊吹鐨勫缓璁綖',
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
    return res.status(400).json({ success: false, message: '鐢ㄦ埛鍚嶅拰瀵嗙爜涓嶈兘涓虹┖' });
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
      return res.status(400).json({ success: false, message: '鐢ㄦ埛鍚嶆垨瀵嗙爜閿欒' });
    }

    const passwordMatch = await bcrypt.compare(password, userData.password);

    if (!passwordMatch) {
      return res.status(400).json({ success: false, message: '鐢ㄦ埛鍚嶆垨瀵嗙爜閿欒' });
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
    res.status(500).json({ success: false, message: '鐧诲綍澶辫触' });
  }
});

app.get('/api/user/:username', async (req, res) => {
  const { username } = req.params;

  if (!username) {
    return res.status(400).json({ success: false, message: '鍙傛暟閿欒' });
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
      return res.status(400).json({ success: false, message: '鐢ㄦ埛涓嶅瓨鍦? });
    }

    res.json({ success: true, user: userData });
  } catch (error) {
    console.error('Search user error:', error);
    res.status(500).json({ success: false, message: '鏌ヨ澶辫触' });
  }
});

app.post('/api/add-friend', async (req, res) => {
  const { userId, friendUsername } = req.body;

  if (!userId || !friendUsername) {
    return res.status(400).json({ success: false, message: '鍙傛暟閿欒' });
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
      return res.status(400).json({ success: false, message: '鐢ㄦ埛涓嶅瓨鍦? });
    }

    if (userId === friendData.id) {
      return res.status(400).json({ success: false, message: '涓嶈兘娣诲姞鑷繁涓哄ソ鍙? });
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
      return res.status(400).json({ success: false, message: '宸茬粡鏄ソ鍙? });
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
    res.status(500).json({ success: false, message: '娣诲姞澶辫触' });
  }
});

app.get('/api/friends/:userId', async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ success: false, message: '鍙傛暟閿欒' });
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
    res.status(500).json({ success: false, message: '鏌ヨ澶辫触' });
  }
});

app.get('/api/messages/:userId/:friendId', async (req, res) => {
  const { userId, friendId } = req.params;

  if (!userId || !friendId) {
    return res.status(400).json({ success: false, message: '鍙傛暟閿欒' });
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
    res.status(500).json({ success: false, message: '鏌ヨ澶辫触' });
  }
});

app.post('/api/send-message', async (req, res) => {
  const { senderId, receiverId, content, type = 'text' } = req.body;

  if (!senderId || !receiverId || !content) {
    return res.status(400).json({ success: false, message: '鍙傛暟閿欒' });
  }

  try {
    // 鑾峰彇鍖椾含鏃堕棿
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
    res.status(500).json({ success: false, message: '鍙戦�佸け璐? });
  }
});

app.post('/api/mark-read', async (req, res) => {
  const { userId, friendId } = req.body;

  if (!userId || !friendId) {
    return res.status(400).json({ success: false, message: '鍙傛暟閿欒' });
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
    res.status(500).json({ success: false, message: '鏇存柊澶辫触' });
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
    return res.status(400).json({ success: false, message: '鐢ㄦ埛鍚嶅拰瀵嗙爜涓嶈兘涓虹┖' });
  }

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: '鐢ㄦ埛鍚嶆垨瀵嗙爜閿欒' });
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
    res.status(401).json({ success: false, message: '鏈櫥褰? });
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
    res.status(500).json({ success: false, message: '鏌ヨ澶辫触' });
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
    res.status(500).json({ success: false, message: '鍒犻櫎澶辫触' });
  }
});

// 涓婁紶澶村儚API
app.post('/api/upload-avatar', upload.single('avatar'), async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId || !req.file) {
      return res.status(400).json({ success: false, message: '鍙傛暟閿欒' });
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
    res.status(500).json({ success: false, message: '涓婁紶澶辫触' });
  }
});

// 淇敼瀵嗙爜API
app.post('/api/change-password', async (req, res) => {
  const { userId, oldPassword, newPassword } = req.body;

  if (!userId || !oldPassword || !newPassword) {
    return res.status(400).json({ success: false, message: '鍙傛暟閿欒' });
  }

  if (newPassword.length < 1) {
    return res.status(400).json({ success: false, message: '鏂板瘑鐮佷笉鑳戒负绌? });
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
      return res.status(400).json({ success: false, message: '鐢ㄦ埛涓嶅瓨鍦? });
    }

    const passwordMatch = await bcrypt.compare(oldPassword, userData.password);

    if (!passwordMatch) {
      return res.status(400).json({ success: false, message: '鍘熷瘑鐮侀敊璇? });
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
    res.status(500).json({ success: false, message: '淇敼澶辫触' });
  }
});

// 淇敼璐﹀彿API
app.post('/api/change-username', async (req, res) => {
  const { userId, username } = req.body;

  if (!userId || !username) {
    return res.status(400).json({ success: false, message: '鍙傛暟閿欒' });
  }

  if (username.length < 3) {
    return res.status(400).json({ success: false, message: '璐﹀彿鑷冲皯闇�瑕?涓瓧绗? });
  }

  if (username.length > 20) {
    return res.status(400).json({ success: false, message: '璐﹀彿涓嶈兘瓒呰繃20涓瓧绗? });
  }

  try {
    let existing;
    if (DATABASE_URL) {
      existing = await usersDB.query('SELECT id FROM users WHERE username = $1 AND id != $2', [username, userId]);
    } else {
      existing = await promisifyDB(usersDB.find).call(usersDB, { username, id: { $ne: userId } });
    }

    if ((DATABASE_URL && existing.rows.length > 0) || (!DATABASE_URL && existing.length > 0)) {
      return res.status(400).json({ success: false, message: '璇ヨ处鍙峰凡琚娇鐢? });
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
    res.status(500).json({ success: false, message: '淇敼澶辫触' });
  }
});

// 鏁版嵁搴撲慨澶岮PI
app.post('/api/fix-db', async (req, res) => {
  if (!DATABASE_URL) {
    return res.json({ success: true, message: 'Not using PostgreSQL' });
  }
  
  try {
    console.log('Fixing database schema...');
    
    // 娣诲姞 nickname 鍒?
    try {
      await usersDB.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT DEFAULT \'\'');
      console.log('Fixed nickname column');
    } catch (e) {
      console.log('Nickname column fix error:', e.message);
    }
    
    // 娣诲姞 avatar 鍒?
    try {
      await usersDB.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT');
      console.log('Fixed avatar column');
    } catch (e) {
      console.log('Avatar column fix error:', e.message);
    }
    
    // 娣诲姞 type 鍒楀埌 messages
    try {
      await messagesDB.query('ALTER TABLE messages ADD COLUMN IF NOT EXISTS type TEXT DEFAULT \'text\'');
      console.log('Fixed type column in messages');
    } catch (e) {
      console.log('Type column fix error:', e.message);
    }
    
    res.json({ success: true, message: 'Database schema fixed successfully' });
  } catch (error) {
    console.error('Database fix error:', error);
    res.status(500).json({ success: false, message: 'Database fix failed: ' + error.message });
  }
});

// 涓婁紶鍥剧墖API
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '鍙傛暟閿欒' });
    }

    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, url: imageUrl });
  } catch (error) {
    console.error('Upload image error:', error);
    res.status(500).json({ success: false, message: '涓婁紶澶辫触' });
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
      const existingGroup = await groupsDB.query('SELECT id FROM `groups` WHERE group_number = $1', [groupNumber]);
      if (existingGroup.rows.length > 0) {
        return res.status(400).json({ success: false, message: '群号已被使用' });
      }

      const groupId = uuidv4();
      await groupsDB.query(
        'INSERT INTO `groups` (id, group_number, name, owner_id) VALUES ($1, $2, $3, $4)',
        [groupId, groupNumber, groupName, userId]
      );

      await groupMembersDB.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
        [groupId, userId, 'owner']
      );

      res.json({ success: true, group: { id: groupId, group_number: groupNumber, name: groupName, owner_id: userId } });
    } else {
      const existingGroup = await promisifyDB(groupsDB.findOne).call(groupsDB, { group_number: groupNumber });
      if (existingGroup) {
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
        _id: uuidv4(),
        group_id: groupId,
        user_id: userId,
        role: 'owner',
        joined_at: new Date().toISOString()
      });

      res.json({ success: true, group: { id: groupId, group_number: groupNumber, name: groupName, owner_id: userId } });
    }
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ success: false, message: '创建群聊失败' });
  }
});

// 获取用户所在的所有群
app.get('/api/groups/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    let groups = [];
    if (DATABASE_URL) {
      const result = await groupMembersDB.query(
        'SELECT g.id, g.group_number, g.name, g.avatar, g.owner_id FROM `groups` g INNER JOIN group_members gm ON g.id = gm.group_id WHERE gm.user_id = $1',
        [userId]
      );
      groups = result.rows;
    } else {
      const memberships = await promisifyDB(groupMembersDB.find).call(groupMembersDB, { user_id: userId });
      for (const m of memberships) {
        const group = await promisifyDB(groupsDB.findOne).call(groupsDB, { id: m.group_id });
        if (group) groups.push(group);
      }
    }

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

    let members = [];
    if (DATABASE_URL) {
      const result = await groupMembersDB.query(
        'SELECT gm.role, gm.joined_at, u.id, u.username, u.avatar, u.nickname FROM group_members gm INNER JOIN users u ON gm.user_id = u.id WHERE gm.group_id = $1',
        [groupId]
      );
      members = result.rows;
    } else {
      members = await promisifyDB(groupMembersDB.find).call(groupMembersDB, { group_id: groupId });
      for (const m of members) {
        const user = await promisifyDB(usersDB.findOne).call(usersDB, { id: m.user_id });
        if (user) {
          m.username = user.username;
          m.avatar = user.avatar;
          m.nickname = user.nickname;
        }
      }
    }

    res.json({ success: true, members });
  } catch (error) {
    console.error('Get group members error:', error);
    res.status(500).json({ success: false, message: '获取群成员失败' });
  }
});

// 群主拉好友进群
app.post('/api/group/invite', async (req, res) => {
  try {
    const { groupId, friendIds, ownerId } = req.body;

    let group = null;
    if (DATABASE_URL) {
      const result = await groupsDB.query('SELECT owner_id FROM `groups` WHERE id = $1', [groupId]);
      if (result.rows.length > 0) group = result.rows[0];
    } else {
      group = await promisifyDB(groupsDB.findOne).call(groupsDB, { id: groupId });
    }

    if (!group || group.owner_id !== ownerId) {
      return res.status(403).json({ success: false, message: '只有群主可以拉人' });
    }

    const addedMembers = [];
    for (const friendId of friendIds) {
      if (DATABASE_URL) {
        try {
          await groupMembersDB.query(
            'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
            [groupId, friendId, 'member']
          );
          addedMembers.push(friendId);
        } catch (e) {
          console.log('Member already in group or error:', e.message);
        }
      } else {
        const existing = await promisifyDB(groupMembersDB.findOne).call(groupMembersDB, { group_id: groupId, user_id: friendId });
        if (!existing) {
          await promisifyDB(groupMembersDB.insert).call(groupMembersDB, {
            _id: uuidv4(),
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

// 发送群消息
app.post('/api/group/message', async (req, res) => {
  try {
    const { groupId, senderId, content, type = 'text' } = req.body;

    let member = null;
    if (DATABASE_URL) {
      const result = await groupMembersDB.query('SELECT id FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, senderId]);
      if (result.rows.length > 0) member = result.rows[0];
    } else {
      member = await promisifyDB(groupMembersDB.findOne).call(groupMembersDB, { group_id: groupId, user_id: senderId });
    }

    if (!member) {
      return res.status(403).json({ success: false, message: '你不是群成员' });
    }

    const messageId = uuidv4();
    const time = new Date().toLocaleString('zh-CN', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit', 
      hour: '2-digit', 
      minute: '2-digit' 
    }).replace(/\//g, '-');
    const timestamp = Date.now();

    if (DATABASE_URL) {
      await groupMessagesDB.query(
        'INSERT INTO group_messages (id, group_id, sender_id, content, type, time, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [messageId, groupId, senderId, content, type, time, timestamp]
      );
    } else {
      await promisifyDB(groupMessagesDB.insert).call(groupMessagesDB, {
        _id: messageId,
        id: messageId,
        group_id: groupId,
        sender_id: senderId,
        content,
        type,
        time,
        timestamp
      });
    }

    res.json({ success: true, message: { id: messageId, group_id: groupId, sender_id: senderId, content, type, time, timestamp } });
  } catch (error) {
    console.error('Send group message error:', error);
    res.status(500).json({ success: false, message: '发送群消息失败' });
  }
});

// 获取群消息
app.get('/api/group/:groupId/messages', async (req, res) => {
  try {
    const { groupId } = req.params;
    const { limit = 50 } = req.query;

    let messages = [];
    if (DATABASE_URL) {
      const result = await groupMessagesDB.query(
        'SELECT gm.id, gm.sender_id, gm.content, gm.type, gm.time, u.username FROM group_messages gm INNER JOIN users u ON gm.sender_id = u.id WHERE gm.group_id = $1 ORDER BY gm.timestamp ASC LIMIT $2',
        [groupId, parseInt(limit)]
      );
      messages = result.rows;
    } else {
      messages = await promisifyDB(groupMessagesDB.find).call(groupMessagesDB, { group_id: groupId });
      messages.sort((a, b) => a.timestamp - b.timestamp);
      messages = messages.slice(-parseInt(limit));
      for (const m of messages) {
        const user = await promisifyDB(usersDB.findOne).call(usersDB, { id: m.sender_id });
        if (user) m.username = user.username;
      }
    }

    res.json({ success: true, messages });
  } catch (error) {
    console.error('Get group messages error:', error);
    res.status(500).json({ success: false, message: '获取群消息失败' });
  }
});

// 退出群
app.post('/api/group/leave', async (req, res) => {
  try {
    const { groupId, userId } = req.body;

    let group = null;
    if (DATABASE_URL) {
      const result = await groupsDB.query('SELECT owner_id FROM `groups` WHERE id = $1', [groupId]);
      if (result.rows.length > 0) group = result.rows[0];
    } else {
      group = await promisifyDB(groupsDB.findOne).call(groupsDB, { id: groupId });
    }

    if (group && group.owner_id === userId) {
      return res.status(400).json({ success: false, message: '群主不能退出群，请先解散群' });
    }

    if (DATABASE_URL) {
      await groupMembersDB.query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [groupId, userId]);
    } else {
      await promisifyDB(groupMembersDB.remove).call(groupMembersDB, { group_id: groupId, user_id: userId });
    }

    res.json({ success: true, message: '已退出群' });
  } catch (error) {
    console.error('Leave group error:', error);
    res.status(500).json({ success: false, message: '退出群失败' });
  }
});

// 解散群（群主）
app.post('/api/group/dissolve', async (req, res) => {
  try {
    const { groupId, userId } = req.body;

    let group = null;
    if (DATABASE_URL) {
      const result = await groupsDB.query('SELECT owner_id FROM `groups` WHERE id = $1', [groupId]);
      if (result.rows.length > 0) group = result.rows[0];
    } else {
      group = await promisifyDB(groupsDB.findOne).call(groupsDB, { id: groupId });
    }

    if (!group || group.owner_id !== userId) {
      return res.status(403).json({ success: false, message: '只有群主可以解散群' });
    }

    if (DATABASE_URL) {
      await groupMessagesDB.query('DELETE FROM group_messages WHERE group_id = $1', [groupId]);
      await groupMembersDB.query('DELETE FROM group_members WHERE group_id = $1', [groupId]);
      await groupsDB.query('DELETE FROM `groups` WHERE id = $1', [groupId]);
    } else {
      await groupMessagesDB.remove({ group_id: groupId });
      await groupMembersDB.remove({ group_id: groupId });
      await groupsDB.remove({ id: groupId });
    }

    res.json({ success: true, message: '群已解散' });
  } catch (error) {
    console.error('Dissolve group error:', error);
    res.status(500).json({ success: false, message: '解散群失败' });
  }
});

async function startServer() {
  await initDB();
  app.listen(PORT, () => {
    console.log(`Tell server running on port ${PORT}`);
    console.log(DATABASE_URL ? 'Using PostgreSQL' : 'Using NeDB for development');
    if (DATABASE_URL) {
      console.log('Database URL configured, tables should be initialized');
    }
  });
}

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = app;
