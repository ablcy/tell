class ChatApp {
    constructor() {
        this.currentUser = null;
        this.currentFriend = null;
        this.messages = {};
        this.friends = [];
        this.baseUrl = window.location.origin;
        this.pollInterval = null;
        this.currentTab = 'chats';
        this.searchedFriend = null;
        this.startTime = new Date('2026-05-04T00:54:00+08:00');
        this.supabase = null;
        this.realtimeChannel = null;
        this.currentLang = 'zh';
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadLanguage();
        this.loadTheme();
        this.loadUserData();
        this.startUptimeTimer();
    }

    bindEvents() {
        document.getElementById('login-tab').addEventListener('click', () => this.showLogin());
        document.getElementById('register-tab').addEventListener('click', () => this.showRegister());
        document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('register-form').addEventListener('submit', (e) => this.handleRegister(e));

        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => this.switchTab(item.dataset.tab));
        });

        document.getElementById('back-btn').addEventListener('click', () => this.closeChatView());
        document.getElementById('send-btn').addEventListener('click', () => this.send());
        document.getElementById('message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.send();
        });

        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        document.getElementById('share-app-btn').addEventListener('click', () => this.shareApp());

        document.getElementById('upload-avatar-btn').addEventListener('click', () => {
            document.getElementById('avatar-upload-input').click();
        });
        document.getElementById('profile-avatar-container').addEventListener('click', () => {
            document.getElementById('avatar-upload-input').click();
        });
        document.getElementById('avatar-upload-input').addEventListener('change', (e) => this.handleAvatarUpload(e));

        document.getElementById('image-btn').addEventListener('click', () => {
            document.getElementById('image-upload-input').click();
        });
        document.getElementById('image-upload-input').addEventListener('change', (e) => this.handleImageUpload(e));

        document.getElementById('change-password-btn').addEventListener('click', () => this.showChangePasswordModal());
        document.getElementById('close-password-modal-btn').addEventListener('click', () => this.closeChangePasswordModal());
        document.getElementById('confirm-change-password-btn').addEventListener('click', () => this.changePassword());

        document.getElementById('change-username-btn').addEventListener('click', () => this.showChangeUsernameModal());
        document.getElementById('close-username-modal-btn').addEventListener('click', () => this.closeChangeUsernameModal());
        document.getElementById('confirm-change-username-btn').addEventListener('click', () => this.changeUsername());

        document.getElementById('search-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSearchFriend(e);
        });

        document.getElementById('confirm-add-friend-btn').addEventListener('click', () => this.confirmAddFriend());

        // 更新日志折叠/展开
        document.getElementById('update-header').addEventListener('click', () => this.toggleUpdateLog());

        // 深色模式切换
        document.getElementById('theme-toggle').addEventListener('change', (e) => this.toggleTheme(e.target.checked));

        // 语言切换
        document.getElementById('lang-toggle').addEventListener('change', (e) => this.toggleLanguage(e.target.checked));
    }

    startUptimeTimer() {
        this.updateUptime();
        setInterval(() => this.updateUptime(), 1000);
    }

    updateUptime() {
        const now = new Date();
        const diff = now - this.startTime;

        if (diff < 0) {
            document.getElementById('uptime-display').textContent = '即将上线';
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        document.getElementById('uptime-display').textContent = `${days}d ${hours}h ${minutes}m ${seconds}s`;
    }

    setButtonLoading(btnId, isLoading, originalText = '') {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        if (isLoading) {
            btn.dataset.originalText = btn.textContent;
            btn.innerHTML = '<span class="loading-spinner"></span>';
            btn.classList.add('loading-btn');
        } else {
            btn.textContent = btn.dataset.originalText || originalText;
            btn.classList.remove('loading-btn');
        }
    }

    loadUserData() {
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
            this.currentUser = JSON.parse(storedUser);
            this.loadFriends().then(() => {
                this.loadMessages();
                this.showMainScreen();
                this.startPolling();
            });
        }
    }

    startPolling() {
        this.pollInterval = setInterval(() => {
            if (this.currentUser) {
                this.loadMessages();
            }
        }, 2000);
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    showLogin() {
        document.getElementById('login-tab').classList.add('active');
        document.getElementById('register-tab').classList.remove('active');
        document.getElementById('login-form').style.display = 'flex';
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-error').textContent = '';
        document.getElementById('register-error').textContent = '';
    }

    showRegister() {
        document.getElementById('register-tab').classList.add('active');
        document.getElementById('login-tab').classList.remove('active');
        document.getElementById('register-form').style.display = 'flex';
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('login-error').textContent = '';
        document.getElementById('register-error').textContent = '';
    }

    async handleLogin(e) {
        e.preventDefault();
        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;

        this.setButtonLoading('login-form-submit-btn', true);
        const result = await this.fetchData('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        this.setButtonLoading('login-form-submit-btn', false);

        if (result.success) {
            this.currentUser = result.user;
            localStorage.setItem('currentUser', JSON.stringify(result.user));
            await this.loadFriends();
            this.loadMessages();
            this.showMainScreen();
            this.startPolling();
        } else {
            document.getElementById('login-error').textContent = result.message || '登录失败';
        }
    }

    async handleRegister(e) {
        e.preventDefault();
        const username = document.getElementById('register-username').value.trim();
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-password-confirm').value;

        if (password !== confirmPassword) {
            document.getElementById('register-error').textContent = '两次输入的密码不一致';
            return;
        }

        if (username.length < 3) {
            document.getElementById('register-error').textContent = '用户名至少需要3个字符';
            return;
        }

        this.setButtonLoading('register-form-submit-btn', true);
        const result = await this.fetchData('/api/register', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        this.setButtonLoading('register-form-submit-btn', false);

        if (result.success) {
            this.currentUser = result.user;
            if (!this.currentUser.nickname) {
                this.currentUser.nickname = '';
                localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
            }
            this.friends = [];
            this.messages = {};
            this.loadFriends().then(() => {
                this.loadMessages();
            });
            this.showMainScreen();
            this.startPolling();
        } else {
            document.getElementById('register-error').textContent = result.message || '注册失败';
        }
    }

    showMainScreen() {
        document.getElementById('auth-screen').classList.remove('screen');
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('main-screen').style.display = 'flex';
        this.updateProfile();
        this.renderChatList();
    }

    updateProfile() {
        if (this.currentUser) {
            const avatarImg = document.getElementById('profile-avatar-img');
            const avatarText = document.getElementById('profile-avatar');
            
            if (this.currentUser.avatar) {
                avatarImg.src = this.currentUser.avatar;
                avatarImg.style.display = 'block';
                avatarText.style.display = 'none';
            } else {
                avatarImg.style.display = 'none';
                avatarText.style.display = 'flex';
                avatarText.textContent = this.currentUser.username.charAt(0).toUpperCase();
            }
            
            document.getElementById('profile-username').textContent = this.currentUser.username;

            const nicknameEl = document.getElementById('profile-nickname');
            if (this.currentUser.nickname) {
                nicknameEl.textContent = this.currentUser.nickname;
                nicknameEl.style.display = 'inline';
            } else {
                nicknameEl.style.display = 'none';
            }
        }
    }

    showChangeUsernameModal() {
        document.getElementById('change-username-modal').style.display = 'flex';
        document.getElementById('new-username-input').value = this.currentUser.username || '';
    }

    closeChangeUsernameModal() {
        document.getElementById('change-username-modal').style.display = 'none';
        document.getElementById('change-username-error').textContent = '';
    }

    async changeUsername() {
        const newUsername = document.getElementById('new-username-input').value.trim();

        if (!newUsername) {
            document.getElementById('change-username-error').textContent = '账号不能为空';
            return;
        }

        if (newUsername.length < 3) {
            document.getElementById('change-username-error').textContent = '账号至少需要3个字符';
            return;
        }

        this.setButtonLoading('confirm-change-username-btn', true);
        const result = await this.fetchData('/api/change-username', {
            method: 'POST',
            body: JSON.stringify({
                userId: this.currentUser.id,
                username: newUsername
            })
        });
        this.setButtonLoading('confirm-change-username-btn', false);

        if (result.success) {
            this.currentUser.username = newUsername;
            localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
            this.closeChangeUsernameModal();
            this.updateProfile();
            alert('账号修改成功');
        } else {
            document.getElementById('change-username-error').textContent = result.message || '修改失败';
        }
    }

    switchTab(tab) {
        this.currentTab = tab;

        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.tab === tab) {
                item.classList.add('active');
            }
        });

        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        document.getElementById(`tab-${tab}`).classList.add('active');

        const titles = {
            chats: 'YanTalk',
            discover: '发现',
            me: '我'
        };
        document.getElementById('page-title').textContent = titles[tab] || 'YanTalk';

        if (tab === 'chats') {
            this.renderChatList();
        }
    }

    renderChatList() {
        const chatList = document.getElementById('chat-list');

        if (this.friends.length === 0) {
            chatList.innerHTML = '<div class="empty-state">暂无好友，请在搜索框输入账号添加好友</div>';
            return;
        }

        chatList.innerHTML = this.friends.map(friend => {
            const friendMessages = this.messages[friend.id] || [];
            const lastMessage = friendMessages[friendMessages.length - 1];
            const unreadCount = this.getUnreadCount(friend.id);

            let avatarContent = '';
            if (friend.avatar && friend.avatar.trim() !== '') {
                avatarContent = `<div style="width: 100%; height: 100%; border-radius: 50%; overflow: hidden;">
                    <img src="${friend.avatar}" alt="" style="width: 100%; height: 100%; object-fit: cover;">
                </div>`;
            } else {
                avatarContent = `<div style="width: 100%; height: 100%; border-radius: 50%; background: var(--talk-blue); color: white; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 500;">
                    ${friend.username.charAt(0).toUpperCase()}
                </div>`;
            }

            return `
                <div class="chat-item" data-friend-id="${friend.id}" onclick="app.openChat('${friend.id}')">
                    <div class="avatar">
                        ${avatarContent}
                    </div>
                    <div class="chat-info">
                        <div class="chat-name">${friend.username}</div>
                        <div class="chat-preview">${lastMessage ? (lastMessage.type === 'image' ? '[图片]' : lastMessage.content) : '暂无消息'}</div>
                    </div>
                    <div>
                        ${lastMessage ? `<div class="chat-time">${lastMessage.time}</div>` : ''}
                        ${unreadCount > 0 ? `<div class="unread-badge">${unreadCount}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    getUnreadCount(friendId) {
        const friendMessages = this.messages[friendId] || [];
        return friendMessages.filter(m => !m.read && m.senderId !== this.currentUser.id).length;
    }

    async loadFriends() {
        if (!this.currentUser) return;

        const result = await this.fetchData(`/api/friends/${this.currentUser.id}`);
        if (result.success) {
            this.friends = result.friends;
        }
    }

    async loadMessages() {
        if (!this.currentUser) return;

        let hasNewMessages = false;
        const oldMessages = JSON.parse(JSON.stringify(this.messages));

        for (const friend of this.friends) {
            const result = await this.fetchData(`/api/messages/${this.currentUser.id}/${friend.id}`);
            if (result.success) {
                this.messages[friend.id] = result.messages;
            }
        }

        for (const friend of this.friends) {
            const oldCount = (oldMessages[friend.id] || []).length;
            const newCount = (this.messages[friend.id] || []).length;
            if (newCount > oldCount) {
                hasNewMessages = true;
                break;
            }
        }

        if (hasNewMessages || this.currentTab === 'chats') {
            this.renderChatList();
        }

        if (this.currentFriend) {
            const oldCount = (oldMessages[this.currentFriend.id] || []).length;
            const newCount = (this.messages[this.currentFriend.id] || []).length;
            if (newCount > oldCount) {
                this.renderMessages();
            }
        }
    }

    async loadMessagesForFriend(friendId) {
        if (!this.currentUser) return;

        const result = await this.fetchData(`/api/messages/${this.currentUser.id}/${friendId}`);
        if (result.success) {
            this.messages[friendId] = result.messages;
            this.renderChatList();
            if (this.currentFriend && this.currentFriend.id === friendId) {
                this.renderMessages();
            }
        }
    }

    openChat(friendId) {
        const friend = this.friends.find(f => f.id === friendId);
        if (!friend) return;

        this.currentFriend = friend;
        document.getElementById('chat-friend-name').textContent = friend.username;
        document.getElementById('chat-view').style.display = 'flex';
        this.renderMessages();
        this.markMessagesAsRead(friendId);
        
        setTimeout(() => {
            const container = document.getElementById('messages-container');
            container.scrollTop = container.scrollHeight;
        }, 100);
    }

    closeChatView() {
        document.getElementById('chat-view').style.display = 'none';
        this.currentFriend = null;
        this.renderChatList();
    }

    async markMessagesAsRead(friendId) {
        const friendMessages = this.messages[friendId] || [];
        friendMessages.forEach(m => m.read = true);

        await this.fetchData('/api/mark-read', {
            method: 'POST',
            body: JSON.stringify({ userId: this.currentUser.id, friendId })
        });

        this.renderChatList();
    }

    renderMessages() {
        const container = document.getElementById('messages-container');

        if (!this.currentFriend) {
            container.innerHTML = '<div class="empty-chat"><p>开始聊天吧！</p></div>';
            return;
        }

        const friendMessages = this.messages[this.currentFriend.id] || [];

        if (friendMessages.length === 0) {
            container.innerHTML = '<div class="empty-chat"><p>开始聊天吧！</p></div>';
            return;
        }

        container.innerHTML = friendMessages.map(msg => {
            const isMine = msg.senderId === this.currentUser.id;
            const sender = isMine ? this.currentUser : this.currentFriend;
            
            let avatarContent = '';
            if (sender) {
                if (sender.avatar && sender.avatar.trim() !== '') {
                    // 有头像时显示图片
                    avatarContent = `<div style="width: 40px; height: 40px; border-radius: 50%; overflow: hidden; flex-shrink: 0;">
                        <img src="${sender.avatar}" alt="" style="width: 100%; height: 100%; object-fit: cover;">
                    </div>`;
                } else {
                    // 没有头像时显示首字母
                    avatarContent = `<div style="width: 40px; height: 40px; border-radius: 50%; background: var(--talk-blue); color: white; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 500; flex-shrink: 0;">
                        ${sender.username.charAt(0).toUpperCase()}
                    </div>`;
                }
            }

            let messageContent = '';
            if (msg.type === 'image') {
                messageContent = `<img src="${msg.content}" alt="" style="max-width: 200px; border-radius: 8px;">`;
            } else {
                messageContent = `<p>${msg.content}</p>`;
            }

            return `
                <div class="message-item" style="display: flex; flex-direction: ${isMine ? 'row-reverse' : 'row'}; margin-bottom: 12px; padding: 0 12px;">
                    <div class="avatar-container" style="flex-shrink: 0; margin-top: 4px;">
                        ${avatarContent}
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: ${isMine ? 'flex-end' : 'flex-start'}; max-width: 70%;">
                        <div style="background: ${isMine ? 'linear-gradient(135deg, var(--talk-blue), var(--talk-dark-blue))' : 'var(--white)'}; color: ${isMine ? 'white' : 'var(--text-primary)'}; padding: 10px 14px; border-radius: ${isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px'}; box-shadow: var(--shadow-sm);">
                            ${messageContent}
                        </div>
                        <span style="font-size: 11px; color: #999; margin-top: 4px; padding: 0 4px;">${msg.time}</span>
                    </div>
                </div>
            `;
        }).join('');

        container.scrollTop = container.scrollHeight;
    }

    async handleSearchFriend(e) {
        if (e.key !== 'Enter') return;

        const searchInput = document.getElementById('search-input');
        const friendUsername = searchInput.value.trim();

        if (!friendUsername) {
            return;
        }

        if (friendUsername === this.currentUser.username) {
            alert('不能添加自己');
            return;
        }

        const existingFriend = this.friends.find(f => f.username === friendUsername);
        if (existingFriend) {
            this.openChat(existingFriend.id);
            searchInput.value = '';
            return;
        }

        const result = await this.fetchData(`/api/user/${encodeURIComponent(friendUsername)}`);

        if (result.success && result.user) {
            this.searchedFriend = result.user;
            this.showSearchResult(result.user);
        } else {
            alert('用户不存在');
        }
    }

    showSearchResult(user) {
        const searchResult = document.getElementById('search-result');
        const avatarEl = document.getElementById('search-result-avatar');
        const usernameEl = document.getElementById('search-result-username');

        if (user.avatar && user.avatar.trim() !== '') {
            avatarEl.innerHTML = `<img src="${user.avatar}" alt="">`;
        } else {
            avatarEl.textContent = user.username.charAt(0).toUpperCase();
        }

        usernameEl.textContent = user.username;
        searchResult.style.display = 'block';
    }

    async confirmAddFriend() {
        if (!this.searchedFriend) return;

        this.setButtonLoading('confirm-add-friend-btn', true);
        const result = await this.fetchData('/api/add-friend', {
            method: 'POST',
            body: JSON.stringify({
                userId: this.currentUser.id,
                friendUsername: this.searchedFriend.username
            })
        });
        this.setButtonLoading('confirm-add-friend-btn', false);

        if (result.success) {
            this.friends.push(result.friend);
            this.messages[result.friend.id] = [];
            this.hideSearchResult();
            document.getElementById('search-input').value = '';
            this.renderChatList();
            this.openChat(result.friend.id);
        } else {
            alert(result.message || '添加失败');
        }
    }

    hideSearchResult() {
        document.getElementById('search-result').style.display = 'none';
        this.searchedFriend = null;
    }

    async send() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();
        if (!content) return;

        this.setButtonLoading('send-btn', true);
        const result = await this.fetchData('/api/send-message', {
            method: 'POST',
            body: JSON.stringify({
                senderId: this.currentUser.id,
                receiverId: this.currentFriend.id,
                content,
                type: 'text'
            })
        });
        this.setButtonLoading('send-btn', false);

        if (result.success) {
            if (!this.messages[this.currentFriend.id]) {
                this.messages[this.currentFriend.id] = [];
            }
            this.messages[this.currentFriend.id].push(result.message);
            input.value = '';
            this.renderMessages();
            this.renderChatList();
        }
    }

    // 头像上传
    async handleAvatarUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('avatar', file);
        formData.append('userId', this.currentUser.id);

        try {
            const response = await fetch(`${this.baseUrl}/api/upload-avatar`, {
                method: 'POST',
                body: formData
            });
            const result = await response.json();

            if (result.success) {
                this.currentUser.avatar = result.avatar;
                localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
                this.updateProfile();
                this.renderChatList();
                this.renderMessages();
            } else {
                alert('上传失败: ' + (result.message || '未知错误'));
            }
        } catch (error) {
            console.error('上传头像错误:', error);
            alert('上传失败');
        }

        e.target.value = '';
    }

    // 图片发送
    async handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('image', file);

        try {
            const response = await fetch(`${this.baseUrl}/api/upload-image`, {
                method: 'POST',
                body: formData
            });
            const result = await response.json();

            if (result.success) {
                // 发送图片消息
                const sendResult = await this.fetchData('/api/send-message', {
                    method: 'POST',
                    body: JSON.stringify({
                        senderId: this.currentUser.id,
                        receiverId: this.currentFriend.id,
                        content: result.url,
                        type: 'image'
                    })
                });

                if (sendResult.success) {
                    if (!this.messages[this.currentFriend.id]) {
                        this.messages[this.currentFriend.id] = [];
                    }
                    this.messages[this.currentFriend.id].push(sendResult.message);
                    this.renderMessages();
                    this.renderChatList();
                }
            } else {
                alert('上传失败: ' + (result.message || '未知错误'));
            }
        } catch (error) {
            console.error('上传图片错误:', error);
            alert('上传失败');
        }

        e.target.value = '';
    }

    // 修改密码
    showChangePasswordModal() {
        document.getElementById('change-password-modal').style.display = 'flex';
        document.getElementById('old-password-input').value = '';
        document.getElementById('new-password-input').value = '';
        document.getElementById('confirm-password-input').value = '';
        document.getElementById('change-password-error').textContent = '';
    }

    closeChangePasswordModal() {
        document.getElementById('change-password-modal').style.display = 'none';
    }

    async changePassword() {
        const oldPassword = document.getElementById('old-password-input').value;
        const newPassword = document.getElementById('new-password-input').value;
        const confirmPassword = document.getElementById('confirm-password-input').value;
        const errorElement = document.getElementById('change-password-error');

        if (!oldPassword || !newPassword || !confirmPassword) {
            errorElement.textContent = '请填写完整';
            return;
        }

        if (newPassword !== confirmPassword) {
            errorElement.textContent = '两次输入的新密码不一致';
            return;
        }

        this.setButtonLoading('confirm-change-password-btn', true);
        const result = await this.fetchData('/api/change-password', {
            method: 'POST',
            body: JSON.stringify({
                userId: this.currentUser.id,
                oldPassword,
                newPassword
            })
        });
        this.setButtonLoading('confirm-change-password-btn', false);

        if (result.success) {
            this.closeChangePasswordModal();
            alert('密码修改成功！');
        } else {
            errorElement.textContent = result.message || '修改失败';
        }
    }

    logout() {
        if (confirm('确定要退出登录吗？')) {
            this.stopPolling();
            localStorage.removeItem('currentUser');
            this.currentUser = null;
            this.currentFriend = null;
            this.messages = {};
            this.friends = [];
            document.getElementById('main-screen').style.display = 'none';
            document.getElementById('auth-screen').classList.add('screen');
            document.getElementById('auth-screen').style.display = 'flex';
            this.showLogin();
        }
    }

    shareApp() {
        const url = window.location.href;
        if (navigator.share) {
            navigator.share({
                title: 'YanTalk',
                text: '来试试 YanTalk，简单好用的聊天工具！',
                url: url
            });
        } else {
            navigator.clipboard.writeText(url);
            alert('链接已复制到剪贴板！');
        }
    }

    async fetchData(url, options = {}) {
        try {
            const defaultOptions = {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            };

            // 如果是FormData，删除Content-Type让浏览器自动设置
            if (options.body instanceof FormData) {
                delete defaultOptions.headers['Content-Type'];
            }

            const response = await fetch(`${this.baseUrl}${url}`, defaultOptions);
            return await response.json();
        } catch (error) {
            console.error('Fetch error:', error);
            return { success: false, message: '网络错误' };
        }
    }

    // 加载主题设置
    loadTheme() {
        const savedTheme = localStorage.getItem('darkMode');
        if (savedTheme === 'true') {
            document.body.classList.add('dark-mode');
            document.getElementById('theme-toggle').checked = true;
        }
    }

    // 切换深色/浅色模式
    toggleTheme(isDark) {
        if (isDark) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('darkMode', 'true');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('darkMode', 'false');
        }
    }

    // 折叠/展开更新日志
    toggleUpdateLog() {
        const header = document.getElementById('update-header');
        const content = document.getElementById('update-content');

        header.classList.toggle('expanded');
        content.classList.toggle('expanded');

        if (content.classList.contains('expanded')) {
            // 展开时显示
            content.style.display = 'block';
        } else {
            // 折叠时隐藏
            content.style.display = 'none';
        }
    }

    // 语言包
    translations = {
        zh: {
            login: '登录',
            register: '注册',
            username: '账号',
            password: '密码',
            searchPlaceholder: '搜索好友/账号',
            add: '添加',
            messages: '消息',
            discover: '发现',
            me: '个人',
            shareApp: '分享应用',
            darkMode: '深色模式',
            language: '英文模式',
            updateLog: '更新日志',
            changeAccount: '修改账号',
            changeAvatar: '修改头像',
            changePassword: '修改密码',
            logout: '退出登录',
            startChat: '开始聊天吧！',
            noFriends: '暂无好友，请在搜索框输入账号添加好友',
            changePasswordTitle: '修改密码',
            oldPassword: '原密码',
            newPassword: '新密码',
            confirmNewPassword: '确认新密码',
            changeAccountTitle: '修改账号',
            inputNewAccount: '输入新账号',
            cancel: '取消',
            confirm: '修改',
            logoutConfirm: '确定要退出登录吗？',
            linkCopied: '链接已复制到剪贴板！',
            appName: 'YanTalk',
            appDesc: '即时通讯聊天工具',
            copyright: '© 2026 Li Chengyan. All Rights Reserved.'
        },
        en: {
            login: 'Login',
            register: 'Register',
            username: 'Username',
            password: 'Password',
            searchPlaceholder: 'Search friends/username',
            add: 'Add',
            messages: 'Messages',
            discover: 'Discover',
            me: 'Me',
            shareApp: 'Share App',
            darkMode: 'Dark Mode',
            language: 'Chinese Mode',
            updateLog: 'Update Log',
            changeAccount: 'Change Account',
            changeAvatar: 'Change Avatar',
            changePassword: 'Change Password',
            logout: 'Logout',
            startChat: 'Start chatting!',
            noFriends: 'No friends yet. Search username to add friends',
            changePasswordTitle: 'Change Password',
            oldPassword: 'Old Password',
            newPassword: 'New Password',
            confirmNewPassword: 'Confirm New Password',
            changeAccountTitle: 'Change Account',
            inputNewAccount: 'Input new account',
            cancel: 'Cancel',
            confirm: 'Confirm',
            logoutConfirm: 'Are you sure you want to logout?',
            linkCopied: 'Link copied to clipboard!',
            appName: 'YanTalk',
            appDesc: 'Instant Messaging Chat Tool',
            copyright: '© 2026 Li Chengyan. All Rights Reserved.'
        }
    }

    // 加载语言设置
    loadLanguage() {
        const savedLang = localStorage.getItem('language');
        if (savedLang) {
            this.currentLang = savedLang;
        }
        document.getElementById('lang-toggle').checked = this.currentLang === 'en';
        this.translateUI();
    }

    // 切换语言
    toggleLanguage(isEnglish) {
        this.currentLang = isEnglish ? 'en' : 'zh';
        localStorage.setItem('language', this.currentLang);
        this.translateUI();
    }

    // 翻译界面
    translateUI() {
        const t = this.translations[this.currentLang];
        if (!t) return;

        // 登录/注册页面
        document.querySelector('#login-form input[type="text"]').placeholder = t.username;
        document.querySelector('#login-form input[type="password"]').placeholder = t.password;
        document.getElementById('login-form-submit-btn').textContent = t.login;
        document.getElementById('login-tab').textContent = t.login;
        document.getElementById('register-tab').textContent = t.register;

        document.querySelector('#register-form input[type="text"]').placeholder = t.username + ' (3+ chars)';
        document.querySelectorAll('#register-form input[type="password"]')[0].placeholder = t.password;
        document.querySelectorAll('#register-form input[type="password"]')[1].placeholder = t.password;
        document.getElementById('register-form-submit-btn').textContent = t.register;

        // 搜索框
        document.getElementById('search-input').placeholder = t.searchPlaceholder;
        document.getElementById('confirm-add-friend-btn').textContent = t.add;

        // 导航栏
        document.querySelector('[data-tab="chats"] span:last-child').textContent = t.messages;
        document.querySelector('[data-tab="discover"] span:last-child').textContent = t.discover;
        document.querySelector('[data-tab="me"] span:last-child').textContent = t.me;

        // 发现页
        document.querySelector('#share-app-btn span:nth-child(2)').textContent = t.shareApp;
        document.querySelector('#toggle-theme-btn span:nth-child(2)').textContent = t.darkMode;

        const langLabel = document.querySelector('#lang-toggle-label');
        if (langLabel) {
            langLabel.textContent = t.language;
        }

        // 更新日志
        const updateTitle = document.querySelector('#update-header h3');
        if (updateTitle) {
            updateTitle.textContent = t.updateLog + ' v3.0.1';
        }

        // 个人页
        document.querySelector('#change-username-btn span:first-child').textContent = t.changeAccount;
        document.querySelector('#upload-avatar-btn span:first-child').textContent = t.changeAvatar;
        document.querySelector('#change-password-btn span:first-child').textContent = t.changePassword;
        document.querySelector('#logout-btn span:first-child').textContent = t.logout;

        // 修改密码弹窗
        document.querySelector('#change-password-modal h3').textContent = t.changePasswordTitle;
        document.querySelectorAll('#change-password-modal input')[0].placeholder = t.oldPassword;
        document.querySelectorAll('#change-password-modal input')[1].placeholder = t.newPassword;
        document.querySelectorAll('#change-password-modal input')[2].placeholder = t.confirmNewPassword;
        document.getElementById('confirm-change-password-btn').textContent = t.confirm;

        // 修改账号弹窗
        document.querySelector('#change-username-modal h3').textContent = t.changeAccountTitle;
        document.getElementById('new-username-input').placeholder = t.inputNewAccount;
        document.getElementById('confirm-change-username-btn').textContent = t.confirm;

        // 空状态
        const emptyState = document.querySelector('.empty-state');
        if (emptyState) {
            emptyState.textContent = t.noFriends;
        }

        const emptyChat = document.querySelector('.empty-chat p');
        if (emptyChat) {
            emptyChat.textContent = t.startChat;
        }

        // 页脚
        document.querySelector('.footer-info p:first-child').textContent = 'YanTalk v3.0.1';
        document.querySelector('.copyright').textContent = t.copyright;

        // 版本信息
        document.querySelector('.version-info span:first-child').textContent = 'v3.0.1';

        // 聊天输入框
        document.getElementById('message-input').placeholder = this.currentLang === 'zh' ? '输入消息...' : 'Type a message...';
        document.getElementById('send-btn').textContent = this.currentLang === 'zh' ? '发送' : 'Send';
    }
}

const app = new ChatApp();
