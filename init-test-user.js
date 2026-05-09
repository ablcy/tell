// 初始化数据库并创建测试账户
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DATABASE_URL = 'postgresql://xata:xIpmyAjz9I0Hb3rWE6m2MYDyUMCmc9hY2rnPgfoi6eejjwGlN9KuXrLfVmbHnsG2@ma8pq7vand7rv3dvpeaa1kdbog.us-east-1.xata.tech/xata?sslmode=require';

console.log('🚀 Initializing database and creating test user...');

async function main() {
    if (!DATABASE_URL) {
        console.log('❌ No database URL configured');
        return;
    }

    let pool;
    
    try {
        const { Pool } = require('pg');
        pool = new Pool({
            connectionString: DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        const client = await pool.connect();
        console.log('✅ Database connection successful');
        
        // 创建表结构
        console.log('📊 Creating database tables...');
        
        // Users 表
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                avatar TEXT,
                nickname TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Users table created');
        
        // Friendships 表
        await client.query(`
            CREATE TABLE IF NOT EXISTS friendships (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                friend_id TEXT NOT NULL,
                UNIQUE(user_id, friend_id)
            )
        `);
        console.log('✅ Friendships table created');
        
        // Messages 表
        await client.query(`
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
        console.log('✅ Messages table created');
        
        // Groups 表
        await client.query(`
            CREATE TABLE IF NOT EXISTS "groups" (
                id TEXT PRIMARY KEY,
                group_number TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                avatar TEXT,
                owner_id TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Groups table created');
        
        // Group members 表
        await client.query(`
            CREATE TABLE IF NOT EXISTS group_members (
                id SERIAL PRIMARY KEY,
                group_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                role TEXT DEFAULT 'member',
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(group_id, user_id)
            )
        `);
        console.log('✅ Group members table created');
        
        // Group messages 表
        await client.query(`
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
        console.log('✅ Group messages table created');
        
        // 创建测试账户
        console.log('👤 Creating test user...');
        
        const testUser = {
            id: uuidv4(),
            username: 'testuser',
            password: await bcrypt.hash('123456', 10),
            avatar: null,
            nickname: '测试用户'
        };
        
        try {
            await client.query(
                'INSERT INTO users (id, username, password, avatar, nickname) VALUES ($1, $2, $3, $4, $5)',
                [testUser.id, testUser.username, testUser.password, testUser.avatar, testUser.nickname]
            );
            console.log('✅ Test user created successfully!');
        } catch (e) {
            if (e.code === '23505') { // 唯一约束违反
                console.log('ℹ️  Test user already exists');
            } else {
                throw e;
            }
        }
        
        // 验证用户
        const result = await client.query('SELECT id, username, nickname FROM users WHERE username = $1', ['testuser']);
        if (result.rows.length > 0) {
            console.log('');
            console.log('🎉 数据库初始化成功！');
            console.log('');
            console.log('📋 测试账户信息：');
            console.log('   👤 用户名：testuser');
            console.log('   🔑 密码：123456');
            console.log('   📝 昵称：测试用户');
            console.log('   🆔 ID：', result.rows[0].id);
            console.log('');
            console.log('现在你可以用这个账户登录网站了！');
        }
        
        client.release();
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        if (pool) {
            await pool.end();
        }
    }
}

main().catch(console.error);