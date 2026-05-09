// 修复数据库表结构并创建测试账户
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DATABASE_URL = 'postgresql://xata:xIpmyAjz9I0Hb3rWE6m2MYDyUMCmc9hY2rnPgfoi6eejjwGlN9KuXrLfVmbHnsG2@ma8pq7vand7rv3dvpeaa1kdbog.us-east-1.xata.tech/xata?sslmode=require';

console.log('🔧 Fixing database schema and creating test user...');

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
        
        // 添加缺失的列
        console.log('📋 Adding missing columns...');
        
        try {
            await client.query('ALTER TABLE users ADD COLUMN nickname TEXT');
            console.log('✅ Added nickname column to users');
        } catch (e) {
            if (e.code !== '42701') { // 42701 是列已存在的错误
                throw e;
            }
            console.log('ℹ️  Nickname column already exists');
        }
        
        try {
            await client.query('ALTER TABLE users ADD COLUMN avatar TEXT');
            console.log('✅ Added avatar column to users');
        } catch (e) {
            if (e.code !== '42701') {
                throw e;
            }
            console.log('ℹ️  Avatar column already exists');
        }
        
        try {
            await client.query('ALTER TABLE messages ADD COLUMN type TEXT DEFAULT \'text\'');
            console.log('✅ Added type column to messages');
        } catch (e) {
            if (e.code !== '42701') {
                throw e;
            }
            console.log('ℹ️  Type column already exists');
        }
        
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
                console.log('ℹ️  Test user already exists, updating...');
                await client.query(
                    'UPDATE users SET password = $1, nickname = $2 WHERE username = $3',
                    [testUser.password, testUser.nickname, testUser.username]
                );
                console.log('✅ Test user updated!');
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