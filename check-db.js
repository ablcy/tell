// 测试 Xata PostgreSQL 数据库连接
const DATABASE_URL = 'postgresql://xata:xIpmyAjz9I0Hb3rWE6m2MYDyUMCmc9hY2rnPgfoi6eejjwGlN9KuXrLfVmbHnsG2@ma8pq7vand7rv3dvpeaa1kdbog.us-east-1.xata.tech/xata?sslmode=require';

console.log('Testing Xata PostgreSQL database connection...');

async function testConnection() {
    if (!DATABASE_URL) {
        console.log('❌ No database URL configured');
        return;
    }

    try {
        const { Pool } = require('pg');
        const pool = new Pool({
            connectionString: DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        const client = await pool.connect();
        console.log('✅ Database connection successful');

        // 尝试查询表
        try {
            const result = await client.query('SELECT COUNT(*) FROM users');
            console.log('👥 Total users:', result.rows[0].count);
        } catch (e) {
            console.log('ℹ️  users table not found (expected for new database)');
        }

        // 检查数据库列表
        const dbResult = await client.query('SELECT current_database()');
        console.log('📊 Current database:', dbResult.rows[0].current_database);

        client.release();
        await pool.end();
        
        console.log('');
        console.log('🎉 Xata 数据库连接成功！');
        console.log('接下来需要初始化数据库表结构');
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
    }
}

testConnection();