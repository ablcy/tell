const fs = require('fs');

let indexJsContent = fs.readFileSync('./index.js', 'utf8');

indexJsContent = indexJsContent.replace(
    '    if (!avatar) {',
    `    if (!avatar) {`
);

// 添加修改备注的接口
const remarkApi = `app.post('/api/change-remark', async (req, res) => {
    const { friendId, remark } = req.body;
    
    try {
        if (DATABASE_URL) {
            const result = await usersDB.query('UPDATE friendships SET remark = $1 WHERE user1_id = $2 AND user2_id = $3 OR user1_id = $3 AND user2_id = $2', [
                remark,
                req.session.user.id,
                friendId
            ]);
        } else {
            // 本地数据库
            const friendships = await promisifyDB(friendshipsDB.find).call(friendshipsDB, {});
            for (let f of friendships) {
                if ((f.user1Id == req.session.user.id && f.user2Id == friendId) || 
                    (f.user1Id == friendId && f.user2Id == req.session.user.id)) {
                    await promisifyDB(friendshipsDB.update).call(friendshipsDB,
                        { _id: f._id },
                        { $set: { remark: remark } },
                        { multi: false }
                    );
                }
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Change remark error:', error);
        res.status(500).json({ success: false, message: '修改失败' });
    }
});`;

if (!indexJsContent.includes('change-remark')) {
    const insertIndex = indexJsContent.lastIndexOf('app.post');
    const lastApiEnd = indexJsContent.lastIndexOf('});') + 3;
    indexJsContent = indexJsContent.slice(0, lastApiEnd) + '\n\n' + remarkApi + indexJsContent.slice(lastApiEnd);
    console.log('✅ 添加了修改备注接口');
}

// 更新获取好友列表，包含备注
const friendsApiPattern = /app.get\('\/api\/friends', async \(req, res\) => \{[\s\S]*?}\);/g;
let friendsMatch = indexJsContent.match(friendsApiPattern);

if (friendsMatch) {
    const oldFriendsApi = friendsMatch[0];
    const newFriendsApi = `app.get('/api/friends', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: '未登录' });
    }
    
    try {
        let friends = [];
        if (DATABASE_URL) {
            const result = await friendshipsDB.query('SELECT * FROM friendships WHERE user1_id = $1 OR user2_id = $1', [
                req.session.user.id
            ]);
            for (let fs of result.rows) {
                const friendId = fs.user1_id == req.session.user.id ? fs.user2_id : fs.user1_id;
                const friendResult = await usersDB.query('SELECT id, username, avatar, nickname FROM users WHERE id = $1', [
                    friendId
                ]);
                if (friendResult.rows.length > 0) {
                    friends.push({
                        ...friendResult.rows[0],
                        remark: fs.remark
                    });
                }
            }
        } else {
            const allFriendships = await promisifyDB(friendshipsDB.find).call(friendshipsDB, {});
            for (let fs of allFriendships) {
                if (fs.user1Id == req.session.user.id || fs.user2Id == req.session.user.id) {
                    const friendId = fs.user1Id == req.session.user.id ? fs.user2Id : fs.user1Id;
                    const friend = await promisifyDB(usersDB.find).call(usersDB, { id: friendId });
                    if (friend && friend.length > 0) {
                        friends.push({
                            ...friend[0],
                            remark: fs.remark || ''
                        });
                    }
                }
            }
        }
        
        res.json({ success: true, friends });
    } catch (error) {
        console.error('Load friends error:', error);
        res.status(500).json({ success: false, message: '加载好友失败' });
    }
});`;
    
    indexJsContent = indexJsContent.replace(oldFriendsApi, newFriendsApi);
    console.log('✅ 更新了好友列表接口');
}

// 更新注册逻辑，设置默认nickname
const registerPattern = /await usersDB.query\('INSERT INTO users \(id, username, password, avatar\) VALUES \(\$1, \$2, \$3, \$4\)'/;
if (indexJsContent.includes(registerPattern)) {
    indexJsContent = indexJsContent.replace(
        'INSERT INTO users (id, username, password, avatar) VALUES ($1, $2, $3, $4)',
        'INSERT INTO users (id, username, password, avatar, nickname) VALUES ($1, $2, $3, $4, $5)'
    );
    indexJsContent = indexJsContent.replace(
        '[userId, username, hashedPassword, null]',
        '[userId, username, hashedPassword, null, \'\']'
    );
    console.log('✅ 更新了PostgreSQL注册逻辑');
}

// 更新本地数据库注册
const localInsertPattern = /await promisifyDB\(usersDB\.insert\)\.call\(usersDB, \{[\s\S]*?avatar: null,/;
const localMatch = indexJsContent.match(/await promisifyDB\(usersDB\.insert\)\.call\(usersDB, \{[\s\S]*?avatar: null,[\s\S]*?created_at: new Date\(\)\.toISOString\(\)[\s\S]*?\};/);

if (localMatch) {
    const oldInsert = localMatch[0];
    const newInsert = oldInsert.replace('avatar: null,', 'avatar: null, nickname: \'\',');
    indexJsContent = indexJsContent.replace(oldInsert, newInsert);
    console.log('✅ 更新了本地数据库注册逻辑');
}

// 更新登录查询，包含nickname
const loginQueryPattern = /SELECT id, username, password, avatar FROM users WHERE username = \$1/;
if (indexJsContent.includes(loginQueryPattern)) {
    indexJsContent = indexJsContent.replace(
        'SELECT id, username, password, avatar FROM users WHERE username = $1',
        'SELECT id, username, password, avatar, nickname FROM users WHERE username = $1'
    );
    console.log('✅ 更新了登录查询');
}

// 更新添加好友备注的查询
const addFriendQueryPattern = /INSERT INTO friendships \(user1_id, user2_id\) VALUES \(\$1, \$2\)/;
if (indexJsContent.includes(addFriendQueryPattern)) {
    indexJsContent = indexJsContent.replace(
        'INSERT INTO friendships (user1_id, user2_id) VALUES ($1, $2)',
        'INSERT INTO friendships (user1_id, user2_id, remark) VALUES ($1, $2, \'\')'
    );
    console.log('✅ 更新了PostgreSQL添加好友查询');
}

// 更新本地数据库添加好友
const localFriendshipPattern = /await promisifyDB\(friendshipsDB\.insert\)\.call\(friendshipsDB, \{[\s\S]*?user2Id: friend\.id,[\s\S]*?\};\)/;
const localFsMatch = indexJsContent.match(localFriendshipPattern);

if (localFsMatch) {
    const oldFsInsert = localFsMatch[0];
    const newFsInsert = oldFsInsert.replace(
        'user2Id: friend.id,',
        'user2Id: friend.id, remark: \'\', created_at: new Date().toISOString(),'
    );
    indexJsContent = indexJsContent.replace(oldFsInsert, newFsInsert);
    console.log('✅ 更新了本地数据库添加好友逻辑');
}

// 更新查询好友信息的查询
const friendInfoPattern = /SELECT id, username FROM users WHERE username = \$1/;
if (indexJsContent.includes(friendInfoPattern)) {
    indexJsContent = indexJsContent.replace(
        'SELECT id, username FROM users WHERE username = $1',
        'SELECT id, username, avatar, nickname FROM users WHERE username = $1'
    );
    console.log('✅ 更新了查询好友信息');
}

fs.writeFileSync('./index.js', indexJsContent, 'utf8');
console.log('\n✅ 后端代码更新成功！');
