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
        this.groups = [];
        this.currentGroup = null;
        this.groupMessages = {};
        this.burnAfterReadingEnabled = this.loadBurnAfterReadingSetting();
        this.init();
    }

    loadBurnAfterReadingSetting() {
        try {
            const saved = localStorage.getItem('burnAfterReading');
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    }

    saveBurnAfterReadingSetting(friendId) {
        localStorage.setItem('burnAfterReading', JSON.stringify(friendId));
    }

    init() {
        this.bindEvents();
        this.initGroupEvents();
        this.loadLanguage();
        this.loadTheme();
        this.loadUserData();
        this.startUptimeTimer();
    }

    initGroupEvents() {
        document.getElementById('create-group-btn').addEventListener('click', () => this.showCreateGroupModal());
        document.getElementById('close-create-group-modal').addEventListener('click', () => this.closeCreateGroupModal());
        document.getElementById('confirm-create-group-btn').addEventListener('click', () => this.createGroup());

        document.getElementById('contacts-add-friend-btn').addEventListener('click', () => {
            document.getElementById('search-input').focus();
            this.switchTab('chats');
        });

        document.getElementById('contacts-create-group-btn').addEventListener('click', () => this.showCreateGroupModal());

        document.getElementById('close-group-info-modal').addEventListener('click', () => this.closeGroupInfoModal());
        document.getElementById('invite-friends-btn').addEventListener('click', () => this.showInviteFriendsModal());
        document.getElementById('close-invite-modal').addEventListener('click', () => this.closeInviteFriendsModal());
        document.getElementById('confirm-invite-btn').addEventListener('click', () => this.inviteFriendsToGroup());

        // 群设置相关事件
        document.getElementById('group-avatar-preview').addEventListener('click', () => {
            document.getElementById('group-avatar-upload-input').click();
        });
        document.getElementById('group-avatar-upload-input').addEventListener('change', (e) => this.handleGroupAvatarUpload(e));
        document.getElementById('save-group-account-btn').addEventListener('click', () => this.saveGroupAccount());

        document.getElementById('group-back-btn').addEventListener('click', () => this.closeGroupChatView());
        document.getElementById('send-group-btn').addEventListener('click', () => this.sendGroupMessage());
        document.getElementById('group-message-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendGroupMessage();
        });

        document.getElementById('leave-group-btn').addEventListener('click', () => this.leaveGroup());
        document.getElementById('dissolve-group-btn').addEventListener('click', () => this.dissolveGroup());

        // 好友设置相关事件
        document.getElementById('close-friend-info-modal').addEventListener('click', () => this.closeFriendInfoModal());
        document.getElementById('delete-friend-btn').addEventListener('click', () => this.deleteFriend());
        document.getElementById('burn-after-reading-toggle').addEventListener('change', (e) => this.toggleBurnAfterReading(e));

        // 新增：合并搜索入口的加入群聊按钮
        document.getElementById('confirm-join-group-btn').addEventListener('click', () => this.confirmJoinGroup());

        // 群聊图片上传功能
        document.getElementById('group-image-btn').addEventListener('click', () => {
            document.getElementById('group-image-upload-input').click();
        });
        document.getElementById('group-image-upload-input').addEventListener('change', (e) => this.handleGroupImageUpload(e));
    }

    async loadGroups() {
        if (!this.currentUser) return;
        const result = await this.fetchData(`/api/groups/${this.currentUser.id}`);
        if (result.success) {
            this.groups = result.groups;
        }
    }

    showCreateGroupModal() {
        document.getElementById('create-group-modal').style.display = 'flex';
        document.getElementById('group-number-input').value = '';
    }

    closeCreateGroupModal() {
        document.getElementById('create-group-modal').style.display = 'none';
    }

    async createGroup() {
        const groupNumber = document.getElementById('group-number-input').value.trim();

        if (!groupNumber) {
            alert('请填写群号');
            return;
        }

        this.setButtonLoading('confirm-create-group-btn', true);
        const result = await this.fetchData('/api/group/create', {
            method: 'POST',
            body: JSON.stringify({
                userId: this.currentUser.id,
                groupName: groupNumber,
                groupNumber
            })
        });
        this.setButtonLoading('confirm-create-group-btn', false);

        if (result.success) {
            this.closeCreateGroupModal();
            this.groups.push(result.group);
            this.openGroupChat(result.group.id);
        } else {
            alert(result.message || '创建群聊失败');
        }
    }

    async openGroupChat(groupId) {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) return;

        this.currentGroup = group;
        document.getElementById('chat-view').style.display = 'none';
        document.getElementById('group-chat-view').style.display = 'flex';
        document.getElementById('group-chat-name').textContent = group.name;

        // 立即显示预加载的消息
        this.renderGroupMessages();

        // 后台静默加载群成员和最新消息
        const membersResult = await this.fetchData(`/api/group/${groupId}/members`);
        if (membersResult.success) {
            this.currentGroupMembers = membersResult.members;
        }

        // 静默更新消息（在后台更新）
        this.loadGroupMessages(groupId).then(() => {
            this.renderGroupMessages();
        });
    }

    async loadGroupMessages(groupId) {
        const result = await this.fetchData(`/api/group/${groupId}/messages`);
        if (result.success) {
            this.groupMessages[groupId] = result.messages;
        }
    }

    closeGroupChatView() {
        document.getElementById('group-chat-view').style.display = 'none';
        this.currentGroup = null;
        this.renderChatList();
    }

    showFriendInfo() {
        if (!this.currentFriend) return;

        const avatarPreview = document.getElementById('friend-info-avatar');
        if (this.currentFriend.avatar && this.currentFriend.avatar.trim() !== '') {
            avatarPreview.innerHTML = `<img src="${this.currentFriend.avatar}" alt="" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
        } else {
            avatarPreview.innerHTML = this.currentFriend.username.charAt(0);
        }

        document.getElementById('friend-info-name').textContent = this.currentFriend.username;

        const burnToggle = document.getElementById('burn-after-reading-toggle');
        burnToggle.checked = this.burnAfterReadingEnabled === this.currentFriend.id;

        document.getElementById('friend-info-modal').style.display = 'flex';
    }

    closeFriendInfoModal() {
        document.getElementById('friend-info-modal').style.display = 'none';
    }

    async deleteFriend() {
        if (!this.currentFriend) return;
        if (!confirm(`确定要删除好友 ${this.currentFriend.username} 吗？`)) return;

        const result = await this.fetchData('/api/friend/delete', {
            method: 'POST',
            body: JSON.stringify({
                userId: this.currentUser.id,
                friendId: this.currentFriend.id
            })
        });

        if (result.success) {
            this.friends = this.friends.filter(f => f.id !== this.currentFriend.id);
            delete this.messages[this.currentFriend.id];
            this.closeChatView();
        } else {
            alert(result.message || '删除失败');
        }
    }

    toggleBurnAfterReading(e) {
        if (!this.currentFriend) return;

        if (e.target.checked) {
            this.burnAfterReadingEnabled = this.currentFriend.id;
        } else {
            this.burnAfterReadingEnabled = null;
        }
        this.saveBurnAfterReadingSetting(this.burnAfterReadingEnabled);
    }

    renderGroupMessages() {
        const container = document.getElementById('group-messages-container');
        if (!this.currentGroup) {
            container.innerHTML = '<div class="empty-chat"><p>开始聊天吧！</p></div>';
            return;
        }

        const messages = this.groupMessages[this.currentGroup.id] || [];
        if (messages.length === 0) {
            container.innerHTML = '<div class="empty-chat"><p>开始聊天吧！</p></div>';
            return;
        }

        container.innerHTML = messages.map(msg => {
            const isMine = msg.senderId === this.currentUser.id;

            let sender = null;
            if (isMine) {
                sender = this.currentUser;
            } else if (msg.username) {
                sender = {
                    username: msg.username,
                    avatar: msg.avatar || ''
                };
            } else if (this.currentGroupMembers) {
                sender = this.currentGroupMembers.find(m => m.id === msg.senderId);
            }

            let avatarContent = '';
            const avatarUrl = sender?.avatar?.trim() || '';
            if (avatarUrl) {
                avatarContent = `<div style="width: 40px; height: 40px; border-radius: 50%; overflow: hidden; flex-shrink: 0;">
                    <img src="${avatarUrl}" alt="" style="width: 100%; height: 100%; object-fit: cover;">
                </div>`;
            } else {
                avatarContent = `<div style="width: 40px; height: 40px; border-radius: 50%; background: var(--talk-blue); color: white; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 500; flex-shrink: 0;">
                    ${sender?.username?.charAt(0).toUpperCase() || 'U'}
                </div>`;
            }

            let messageContent = '';
            if (msg.type === 'image') {
                messageContent = `<img src="${msg.content}" alt="" style="max-width: 200px; border-radius: 8px;">`;
            } else {
                messageContent = `<p>${msg.content}</p>`;
            }

            const displayName = sender ? sender.username : (msg.senderName || '用户');
            
            return `
                <div class="message-item" style="display: flex; flex-direction: ${isMine ? 'row-reverse' : 'row'}; margin-bottom: 12px; padding: 0 12px;">
                    <div class="avatar-container" style="flex-shrink: 0; margin-top: 4px;">
                        ${avatarContent}
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: ${isMine ? 'flex-end' : 'flex-start'}; max-width: 70%;">
                        <span style="font-size: 11px; color: #999; margin-bottom: 2px; padding: 0 4px;">${isMine ? '我' : displayName}</span>
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

    async sendGroupMessage() {
        if (!this.currentGroup) return;

        const input = document.getElementById('group-message-input');
        const content = input.value.trim();
        if (!content) return;

        this.setButtonLoading('send-group-btn', true);
        const result = await this.fetchData('/api/group/message', {
            method: 'POST',
            body: JSON.stringify({
                groupId: this.currentGroup.id,
                senderId: this.currentUser.id,
                content,
                type: 'text'
            })
        });
        this.setButtonLoading('send-group-btn', false);

        if (result.success) {
            if (!this.groupMessages[this.currentGroup.id]) {
                this.groupMessages[this.currentGroup.id] = [];
            }
            this.groupMessages[this.currentGroup.id].push(result.message);
            input.value = '';
            this.renderGroupMessages();
        }
    }

    async handleGroupImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('image', file);

        const result = await this.fetchData('/api/upload-image', {
            method: 'POST',
            body: formData
        });

        if (result.success) {
            // 发送图片消息
            this.setButtonLoading('send-group-btn', true);
            const sendResult = await this.fetchData('/api/group/message', {
                method: 'POST',
                body: JSON.stringify({
                    groupId: this.currentGroup.id,
                    senderId: this.currentUser.id,
                    content: result.url,
                    type: 'image'
                })
            });
            this.setButtonLoading('send-group-btn', false);

            if (sendResult.success) {
                if (!this.groupMessages[this.currentGroup.id]) {
                    this.groupMessages[this.currentGroup.id] = [];
                }
                this.groupMessages[this.currentGroup.id].push(sendResult.message);
                this.renderGroupMessages();
            }
        } else {
            alert(result.message || '上传图片失败');
        }

        // 清空文件输入
        e.target.value = '';
    }

    async handleGroupAvatarUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('avatar', file);
        formData.append('groupId', this.currentGroup.id);

        try {
            const response = await fetch(`${this.baseUrl}/api/upload-group-avatar`, {
                method: 'POST',
                body: formData
            });
            const result = await response.json();

            if (result.success) {
                // 更新群信息
                const updateResult = await this.fetchData(`/api/group/${this.currentGroup.id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        userId: this.currentUser.id,
                        avatar: result.avatar
                    })
                });
                if (updateResult.success && updateResult.group) {
                    this.currentGroup = updateResult.group;
                    const groupIndex = this.groups.findIndex(g => g.id === this.currentGroup.id);
                    if (groupIndex !== -1) {
                        this.groups[groupIndex] = this.currentGroup;
                    }
                    this.renderChatList();
                    const avatarPreview = document.getElementById('group-avatar-preview');
                    avatarPreview.innerHTML = `<img src="${result.avatar}" alt="" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
                    alert('群头像更新成功');
                } else {
                    alert(updateResult.message || '更新失败');
                }
            } else {
                alert(result.message || '上传图片失败');
            }
        } catch (error) {
            console.error('Upload avatar error:', error);
            alert('上传失败');
        }

        e.target.value = '';
    }

    async saveGroupAccount() {
        const groupAccount = document.getElementById('group-account-input').value.trim();
        if (!groupAccount) {
            alert('请输入群账号');
            return;
        }

        const result = await this.fetchData(`/api/group/${this.currentGroup.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                userId: this.currentUser.id,
                groupNumber: groupAccount,
                name: groupAccount
            })
        });

        if (result.success && result.group) {
            // 使用后端返回的完整群信息更新
            this.currentGroup = result.group;
            // 同时更新groups数组中的群
            const groupIndex = this.groups.findIndex(g => g.id === this.currentGroup.id);
            if (groupIndex !== -1) {
                this.groups[groupIndex] = this.currentGroup;
            }
            this.renderChatList();
            alert('群账号更新成功');
        } else {
            alert(result.message || '更新失败');
        }
    }

    async showGroupInfo() {
        if (!this.currentGroup) return;

        // 显示群头像
        const avatarPreview = document.getElementById('group-avatar-preview');
        if (this.currentGroup.avatar && this.currentGroup.avatar.trim() !== '') {
            avatarPreview.innerHTML = `<img src="${this.currentGroup.avatar}" alt="" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
        } else {
            avatarPreview.innerHTML = '群';
        }

        // 显示群账号（group_number）
        document.getElementById('group-account-input').value = this.currentGroup.group_number || '';

        // 显示群成员
        const result = await this.fetchData(`/api/group/${this.currentGroup.id}/members`);
        if (result.success) {
            this.renderGroupMembers(result.members);
        }

        // 判断当前用户是否是群主，显示/隐藏解散群聊按钮
        const dissolveBtn = document.getElementById('dissolve-group-btn');
        const leaveBtn = document.getElementById('leave-group-btn');
        if (this.currentGroup.role === 'owner') {
            dissolveBtn.style.display = 'block';
            leaveBtn.style.display = 'none';
        } else {
            dissolveBtn.style.display = 'none';
            leaveBtn.style.display = 'block';
        }

        document.getElementById('group-info-modal').style.display = 'flex';
    }

    renderGroupMembers(members) {
        const list = document.getElementById('group-members-list');
        list.innerHTML = members.map(m => `
            <div class="group-member-item">
                <span>${m.username} ${m.role === 'owner' ? '(群主)' : ''}</span>
            </div>
        `).join('');
    }

    closeGroupInfoModal() {
        document.getElementById('group-info-modal').style.display = 'none';
    }

    showInviteFriendsModal() {
        document.getElementById('invite-friends-modal').style.display = 'flex';
        this.renderInviteFriendsList();
    }

    closeInviteFriendsModal() {
        document.getElementById('invite-friends-modal').style.display = 'none';
    }

    renderInviteFriendsList() {
        const list = document.getElementById('invite-friends-list');
        list.innerHTML = this.friends.map(f => `
            <div class="invite-friend-item">
                <label>
                    <input type="checkbox" value="${f.id}" class="invite-friend-checkbox">
                    <span>${f.username}</span>
                </label>
            </div>
        `).join('');
    }

    async inviteFriendsToGroup() {
        if (!this.currentGroup) return;

        const checkboxes = document.querySelectorAll('.invite-friend-checkbox:checked');
        const friendIds = Array.from(checkboxes).map(cb => cb.value);

        if (friendIds.length === 0) {
            alert('请选择要邀请的好友');
            return;
        }

        const result = await this.fetchData('/api/group/invite', {
            method: 'POST',
            body: JSON.stringify({
                groupId: this.currentGroup.id,
                inviterId: this.currentUser.id,
                friendIds
            })
        });

        if (result.success) {
            this.closeInviteFriendsModal();
            alert(result.message);
        } else {
            alert(result.message || '邀请失败');
        }
    }

    async searchGroup() {
        const groupNumber = document.getElementById('group-search-input').value.trim();
        if (!groupNumber) return;

        const result = await this.fetchData(`/api/group/search/${encodeURIComponent(groupNumber)}`);
        if (result.success && result.group) {
            document.getElementById('search-group-result').style.display = 'block';
            document.getElementById('search-group-name').textContent = result.group.name;
            document.getElementById('search-group-number').textContent = '群号: ' + result.group.group_number;
            this.searchedGroup = result.group;
        } else {
            alert('群不存在');
        }
    }

    showJoinGroupModal() {
        document.getElementById('join-group-modal').style.display = 'flex';
        document.getElementById('group-search-input').value = '';
        document.getElementById('search-group-result').style.display = 'none';
    }

    closeJoinGroupModal() {
        document.getElementById('join-group-modal').style.display = 'none';
    }

    async joinGroup() {
        if (!this.searchedGroup) return;

        const result = await this.fetchData('/api/group/join', {
            method: 'POST',
            body: JSON.stringify({
                groupId: this.searchedGroup.id,
                userId: this.currentUser.id
            })
        });

        if (result.success) {
            this.closeJoinGroupModal();
            await this.loadGroups();
            this.openGroupChat(this.searchedGroup.id);
        } else {
            alert(result.message || '加入失败');
        }
    }

    async leaveGroup() {
        if (!this.currentGroup) return;
        if (!confirm('确定要退出群聊吗？')) return;

        const result = await this.fetchData('/api/group/leave', {
            method: 'POST',
            body: JSON.stringify({
                groupId: this.currentGroup.id,
                userId: this.currentUser.id
            })
        });

        if (result.success) {
            this.groups = this.groups.filter(g => g.id !== this.currentGroup.id);
            this.closeGroupChatView();
        } else {
            alert(result.message || '退出失败');
        }
    }

    async dissolveGroup() {
        if (!this.currentGroup) return;
        if (!confirm('确定要解散群聊吗？此操作不可恢复！')) return;

        const result = await this.fetchData('/api/group/dissolve', {
            method: 'POST',
            body: JSON.stringify({
                groupId: this.currentGroup.id,
                userId: this.currentUser.id
            })
        });

        if (result.success) {
            this.groups = this.groups.filter(g => g.id !== this.currentGroup.id);
            this.closeGroupChatView();
        } else {
            alert(result.message || '解散失败');
        }
    }

    async loadUserData() {
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
            this.currentUser = JSON.parse(storedUser);
            
            // 先显示界面，给用户即时反馈
            this.showMainScreen();
            
            // 并行加载好友和群聊
            Promise.all([this.loadFriends(), this.loadGroups()]).then(() => {
                this.renderChatList(); // 加载完立即渲染消息列表
                this.renderContacts(); // 同时渲染通讯录
                
                // 消息在后台异步加载
                setTimeout(() => {
                    this.loadMessages();
                    this.startPolling();
                }, 100);
            });
        }
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

    startPolling() {
        this.pollInterval = setInterval(() => {
            if (this.currentUser) {
                this.loadMessages();
                this.pollGroupMessages();
            }
        }, 2000);
    }

    async pollGroupMessages() {
        // 同时刷新群列表（确保被邀请的人能看到新群）
        if (this.currentUser) {
            await this.loadGroups();
        }
        
        // 刷新群消息
        for (const group of this.groups) {
            await this.loadGroupMessages(group.id);
        }
        
        // 如果在群聊界面，重新加载群成员和渲染消息
        if (this.currentGroup) {
            const membersResult = await this.fetchData(`/api/group/${this.currentGroup.id}/members`);
            if (membersResult.success) {
                this.currentGroupMembers = membersResult.members;
            }
            this.renderGroupMessages();
        }
        
        // 重新渲染聊天列表
        this.renderChatList();
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

        if (!username || !password) {
            document.getElementById('login-error').textContent = '请输入账号和密码';
            return;
        }

        // 极致优化：立即切换界面，显示加载状态
        this.showMainScreenWithLoading();
        
        // 后台异步登录，不阻塞界面显示
        this.setButtonLoading('login-form-submit-btn', true);
        const result = await this.fetchData('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        this.setButtonLoading('login-form-submit-btn', false);

        if (result.success) {
            this.currentUser = result.user;
            localStorage.setItem('currentUser', JSON.stringify(result.user));
            
            // 直接使用登录返回的好友和群聊数据
            if (result.friends) {
                this.friends = result.friends;
            }
            if (result.groups) {
                this.groups = result.groups;
            }
            
            // 更新用户信息和渲染列表
            this.updateProfile();
            this.renderChatList();
            
            // 消息在后台异步加载
            setTimeout(() => {
                this.loadMessages();
                this.startPolling();
            }, 50);
        } else {
            // 登录失败，返回登录界面
            this.logout();
            document.getElementById('login-error').textContent = result.message || '登录失败';
        }
    }
    
    showMainScreenWithLoading() {
        // 立即切换到主界面，不等待数据
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('main-screen').style.display = 'flex';
        
        // 显示加载骨架
        const chatList = document.getElementById('chat-list');
        chatList.innerHTML = `
            <div class="loading-skeleton">
                <div class="skeleton-avatar"></div>
                <div class="skeleton-info">
                    <div class="skeleton-name"></div>
                    <div class="skeleton-preview"></div>
                </div>
            </div>
            <div class="loading-skeleton">
                <div class="skeleton-avatar"></div>
                <div class="skeleton-info">
                    <div class="skeleton-name"></div>
                    <div class="skeleton-preview"></div>
                </div>
            </div>
            <div class="loading-skeleton">
                <div class="skeleton-avatar"></div>
                <div class="skeleton-info">
                    <div class="skeleton-name"></div>
                    <div class="skeleton-preview"></div>
                </div>
            </div>
        `;
        
        // 更新头像为默认状态
        const avatarImg = document.getElementById('profile-avatar-img');
        const avatarText = document.getElementById('profile-avatar');
        avatarImg.style.display = 'none';
        avatarText.textContent = '?';
        avatarText.style.display = 'flex';
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

        if (username.length < 2) {
            document.getElementById('register-error').textContent = '用户名至少需要2个字符';
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
            chats: 'Tell',
            contacts: '通讯录',
            discover: '发现',
            me: '我'
        };
        document.getElementById('page-title').textContent = titles[tab] || 'Tell';

        if (tab === 'chats') {
            this.renderChatList();
        } else if (tab === 'contacts') {
            this.renderContacts();
        }
    }

    renderContacts() {
        const groupsSection = document.getElementById('contacts-groups-section');
        const friendsSection = document.getElementById('contacts-friends-section');
        const groupList = document.getElementById('contacts-group-list');
        const friendList = document.getElementById('contacts-friend-list');

        if (this.groups.length > 0) {
            groupsSection.style.display = 'block';
            groupList.innerHTML = this.groups.map(group => `
                <div class="contact-item" data-group-id="${group.id}">
                    <div class="avatar" style="background: linear-gradient(135deg, #667eea, #764ba2);">
                        ${group.avatar ? `<img src="${group.avatar}" alt="">` : '群'}
                    </div>
                    <span class="contact-name">${group.name || group.account}</span>
                </div>
            `).join('');

            groupList.querySelectorAll('.contact-item').forEach(item => {
                item.addEventListener('click', () => {
                    const groupId = item.dataset.groupId;
                    this.openGroupChat(groupId);
                });
            });
        } else {
            groupsSection.style.display = 'none';
        }

        if (this.friends.length > 0) {
            friendsSection.style.display = 'block';
            friendList.innerHTML = this.friends.map(friend => `
                <div class="contact-item" data-friend-id="${friend.id}">
                    <div class="avatar" style="background: linear-gradient(135deg, var(--talk-blue), var(--talk-dark-blue));">
                        ${friend.avatar ? `<img src="${friend.avatar}" alt="">` : (friend.nickname || friend.username).charAt(0).toUpperCase()}
                    </div>
                    <span class="contact-name">${friend.nickname || friend.username}</span>
                </div>
            `).join('');

            friendList.querySelectorAll('.contact-item').forEach(item => {
                item.addEventListener('click', () => {
                    const friendId = item.dataset.friendId;
                    this.openChat(friendId);
                });
            });
        } else {
            friendsSection.style.display = 'none';
        }
    }

    renderChatList() {
        const chatList = document.getElementById('chat-list');
        
        if (this.groups.length === 0 && this.friends.length === 0) {
            chatList.innerHTML = '<div class="empty-state">暂无好友或群聊，请搜索添加</div>';
            return;
        }
        
        // 极致优化：直接一次性渲染所有内容（数据量不大时最快）
        let html = '';
        
        // 群聊HTML生成
        for (let i = 0; i < this.groups.length; i++) {
            const group = this.groups[i];
            const groupMsgs = this.groupMessages[group.id];
            const lastMsg = groupMsgs && groupMsgs.length ? groupMsgs[groupMsgs.length - 1] : null;
            
            let avatarHtml = '';
            if (group.avatar && group.avatar.trim()) {
                avatarHtml = `<div style="width: 100%; height: 100%; border-radius: 50%; overflow: hidden;"><img src="${group.avatar}" alt="" style="width: 100%; height: 100%; object-fit: cover;"></div>`;
            } else {
                avatarHtml = `<div style="width: 100%; height: 100%; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); color: white; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 500;">G</div>`;
            }
            
            html += `<div class="chat-item group-item" data-group-id="${group.id}" onclick="app.openGroupChat('${group.id}')">
                <div class="avatar">${avatarHtml}</div>
                <div class="chat-info">
                    <div class="chat-name">${group.name}${group.role === 'owner' ? ' (群主)' : ''}</div>
                    <div class="chat-preview">${lastMsg ? lastMsg.content : '暂无消息'}</div>
                </div>
                <div>${lastMsg ? `<div class="chat-time">${lastMsg.time}</div>` : ''}</div>
            </div>`;
        }
        
        // 好友HTML生成
        for (let i = 0; i < this.friends.length; i++) {
            const friend = this.friends[i];
            const friendMsgs = this.messages[friend.id];
            const lastMsg = friendMsgs && friendMsgs.length ? friendMsgs[friendMsgs.length - 1] : null;
            const unread = this.getUnreadCount(friend.id);
            
            let avatarHtml = '';
            if (friend.avatar && friend.avatar.trim()) {
                avatarHtml = `<div style="width: 100%; height: 100%; border-radius: 50%; overflow: hidden;"><img src="${friend.avatar}" alt="" style="width: 100%; height: 100%; object-fit: cover;"></div>`;
            } else {
                const initial = friend.username ? friend.username.charAt(0).toUpperCase() : '?';
                avatarHtml = `<div style="width: 100%; height: 100%; border-radius: 50%; background: var(--talk-blue); color: white; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 500;">${initial}</div>`;
            }
            
            html += `<div class="chat-item" data-friend-id="${friend.id}" onclick="app.openChat('${friend.id}')">
                <div class="avatar">${avatarHtml}</div>
                <div class="chat-info">
                    <div class="chat-name">${friend.username}</div>
                    <div class="chat-preview">${lastMsg ? (lastMsg.type === 'image' ? '[图片]' : lastMsg.content) : '暂无消息'}</div>
                </div>
                <div>${lastMsg ? `<div class="chat-time">${lastMsg.time}</div>` : ''}${unread > 0 ? `<div class="unread-badge">${unread}</div>` : ''}</div>
            </div>`;
        }
        
        // 直接一次性更新DOM（最快的方式）
        chatList.innerHTML = html;
    }
    
    _generateChatListHtml() {
        const htmlArray = [];
        const len = htmlArray.push.bind(htmlArray);
        
        // 群聊HTML生成
        for (let i = 0; i < this.groups.length; i++) {
            const group = this.groups[i];
            const groupMsgs = this.groupMessages[group.id];
            const lastMsg = groupMsgs && groupMsgs.length ? groupMsgs[groupMsgs.length - 1] : null;
            
            let avatarHtml = '';
            if (group.avatar && group.avatar.trim()) {
                avatarHtml = `<div style="width: 100%; height: 100%; border-radius: 50%; overflow: hidden;"><img src="${group.avatar}" alt="" style="width: 100%; height: 100%; object-fit: cover;"></div>`;
            } else {
                avatarHtml = `<div style="width: 100%; height: 100%; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); color: white; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 500;">G</div>`;
            }
            
            len(`<div class="chat-item group-item" data-group-id="${group.id}" onclick="app.openGroupChat('${group.id}')">
                <div class="avatar">${avatarHtml}</div>
                <div class="chat-info">
                    <div class="chat-name">${group.name}${group.role === 'owner' ? ' (群主)' : ''}</div>
                    <div class="chat-preview">${lastMsg ? lastMsg.content : '暂无消息'}</div>
                </div>
                <div>${lastMsg ? `<div class="chat-time">${lastMsg.time}</div>` : ''}</div>
            </div>`);
        }
        
        // 好友HTML生成
        for (let i = 0; i < this.friends.length; i++) {
            const friend = this.friends[i];
            const friendMsgs = this.messages[friend.id];
            const lastMsg = friendMsgs && friendMsgs.length ? friendMsgs[friendMsgs.length - 1] : null;
            const unread = this.getUnreadCount(friend.id);
            
            let avatarHtml = '';
            if (friend.avatar && friend.avatar.trim()) {
                avatarHtml = `<div style="width: 100%; height: 100%; border-radius: 50%; overflow: hidden;"><img src="${friend.avatar}" alt="" style="width: 100%; height: 100%; object-fit: cover;"></div>`;
            } else {
                const initial = friend.username ? friend.username.charAt(0).toUpperCase() : '?';
                avatarHtml = `<div style="width: 100%; height: 100%; border-radius: 50%; background: var(--talk-blue); color: white; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 500;">${initial}</div>`;
            }
            
            len(`<div class="chat-item" data-friend-id="${friend.id}" onclick="app.openChat('${friend.id}')">
                <div class="avatar">${avatarHtml}</div>
                <div class="chat-info">
                    <div class="chat-name">${friend.username}</div>
                    <div class="chat-preview">${lastMsg ? (lastMsg.type === 'image' ? '[图片]' : lastMsg.content) : '暂无消息'}</div>
                </div>
                <div>${lastMsg ? `<div class="chat-time">${lastMsg.time}</div>` : ''}${unread > 0 ? `<div class="unread-badge">${unread}</div>` : ''}</div>
            </div>`);
        }
        
        return htmlArray;
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

        for (const group of this.groups) {
            const result = await this.fetchData(`/api/group/${group.id}/messages`);
            if (result.success) {
                this.groupMessages[group.id] = result.messages;
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
        
        const shouldBurn = this.burnAfterReadingEnabled === friendId;
        if (shouldBurn) {
            this.messages[friendId] = [];
        }
        
        this.renderMessages();
        this.markMessagesAsRead(friendId);
        
        setTimeout(() => {
            const container = document.getElementById('messages-container');
            container.scrollTop = container.scrollHeight;
        }, 100);
    }

    closeChatView() {
        const shouldBurn = this.currentFriend && this.burnAfterReadingEnabled === this.currentFriend.id;
        if (shouldBurn) {
            const container = document.getElementById('messages-container');
            container.innerHTML = '<div class="empty-chat"><p>开始聊天吧！</p></div>';
            delete this.messages[this.currentFriend.id];
        }
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
        const searchText = searchInput.value.trim();

        if (!searchText) {
            return;
        }

        // 隐藏所有搜索结果
        document.getElementById('search-result-item-friend').style.display = 'none';
        document.getElementById('search-result-item-group').style.display = 'none';
        document.getElementById('search-result').style.display = 'none';

        // 1. 先检查是否是群聊（搜索群号）
        const groupResult = await this.fetchData(`/api/group/search/${encodeURIComponent(searchText)}`);
        
        if (groupResult.success && groupResult.group) {
            // 检查是否已经在该群聊中
            const existingGroup = this.groups.find(g => g.id === groupResult.group.id);
            if (existingGroup) {
                this.openGroupChat(existingGroup.id);
                searchInput.value = '';
                return;
            }
            
            // 显示群聊搜索结果
            this.searchedGroup = groupResult.group;
            this.showGroupSearchResult(groupResult.group);
            return;
        }

        // 2. 如果不是群号，搜索用户
        if (searchText === this.currentUser.username) {
            alert('不能添加自己');
            return;
        }

        const existingFriend = this.friends.find(f => f.username === searchText);
        if (existingFriend) {
            this.openChat(existingFriend.id);
            searchInput.value = '';
            return;
        }

        const result = await this.fetchData(`/api/user/${encodeURIComponent(searchText)}`);

        if (result.success && result.user) {
            this.searchedFriend = result.user;
            this.showSearchResult(result.user);
        } else {
            alert('用户或群不存在');
        }
    }

    showSearchResult(user) {
        const searchResult = document.getElementById('search-result');
        const avatarEl = document.getElementById('search-result-avatar');
        const usernameEl = document.getElementById('search-result-username');

        document.getElementById('search-result-item-friend').style.display = 'flex';
        document.getElementById('search-result-item-group').style.display = 'none';

        if (user.avatar && user.avatar.trim() !== '') {
            avatarEl.innerHTML = `<img src="${user.avatar}" alt="">`;
        } else {
            avatarEl.textContent = user.username.charAt(0).toUpperCase();
        }

        usernameEl.textContent = user.username;
        searchResult.style.display = 'block';
    }

    showGroupSearchResult(group) {
        const searchResult = document.getElementById('search-result');
        const groupNameEl = document.getElementById('search-group-name');
        const groupNumberEl = document.getElementById('search-group-number');

        document.getElementById('search-result-item-friend').style.display = 'none';
        document.getElementById('search-result-item-group').style.display = 'flex';

        groupNameEl.textContent = group.name;
        groupNumberEl.textContent = '群号: ' + group.group_number;
        searchResult.style.display = 'block';
    }

    async confirmJoinGroup() {
        if (!this.searchedGroup) return;

        this.setButtonLoading('confirm-join-group-btn', true);
        const result = await this.fetchData('/api/group/join', {
            method: 'POST',
            body: JSON.stringify({
                groupId: this.searchedGroup.id,
                userId: this.currentUser.id
            })
        });
        this.setButtonLoading('confirm-join-group-btn', false);

        if (result.success) {
            await this.loadGroups();
            document.getElementById('search-result').style.display = 'none';
            document.getElementById('search-input').value = '';
            this.openGroupChat(this.searchedGroup.id);
        } else {
            alert(result.message || '加入群聊失败');
        }
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
            this.currentGroup = null;
            this.messages = {};
            this.friends = [];
            this.groups = [];
            this.groupMessages = {};
            
            // 清空所有界面元素，防止隐私泄露
            const chatList = document.getElementById('chat-list');
            if (chatList) {
                chatList.innerHTML = '';
            }
            const messagesContainer = document.getElementById('messages-container');
            if (messagesContainer) {
                messagesContainer.innerHTML = '';
            }
            const groupMessagesContainer = document.getElementById('group-messages-container');
            if (groupMessagesContainer) {
                groupMessagesContainer.innerHTML = '';
            }
            const contactsGroupList = document.getElementById('contacts-group-list');
            if (contactsGroupList) {
                contactsGroupList.innerHTML = '';
            }
            const contactsFriendList = document.getElementById('contacts-friend-list');
            if (contactsFriendList) {
                contactsFriendList.innerHTML = '';
            }
            
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
                title: 'Tell',
                text: '来试试 Tell，简单好用的聊天工具！',
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
            appName: 'Tell',
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
            appName: 'Tell',
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
            updateTitle.textContent = t.updateLog + ' v4.5.8';
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
        document.querySelector('.footer-info p:first-child').textContent = 'Tell v4.5.7';
        document.querySelector('.copyright').textContent = t.copyright;

        // 版本信息
        document.querySelector('.version-info span:first-child').textContent = 'v4.5.8';

        // 聊天输入框
        document.getElementById('message-input').placeholder = this.currentLang === 'zh' ? '输入消息...' : 'Type a message...';
        document.getElementById('send-btn').textContent = this.currentLang === 'zh' ? '发送' : 'Send';
    }
}

const app = new ChatApp();
