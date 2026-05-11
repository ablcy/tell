class AdminPanel {
    constructor() {
        this.baseUrl = window.location.origin;
        this.users = [];
        this.filteredUsers = [];
        this.targetUserId = null;
        this.init();
    }

    init() {
        this.bindPasswordEvents();
    }

    bindPasswordEvents() {
        const passwordForm = document.getElementById('password-form');
        passwordForm.addEventListener('submit', (e) => this.handlePasswordSubmit(e));
        
        document.getElementById('back-btn').addEventListener('click', () => {
            window.location.href = '/';
        });
    }

    async handlePasswordSubmit(e) {
        e.preventDefault();
        
        const password = document.getElementById('admin-password').value;
        const errorElement = document.getElementById('password-error');
        
        try {
            const response = await fetch(`${this.baseUrl}/api/admin/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            const data = await response.json();

            if (data.success) {
                this.showApp();
            } else {
                errorElement.textContent = '密码错误，请重试';
            }
        } catch (error) {
            errorElement.textContent = '连接失败，请稍后重试';
        }
    }

    showApp() {
        document.getElementById('password-screen').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        this.bindEvents();
        this.loadStats();
        this.loadUsers();
        this.addLog('Tell Admin v1.1.0 启动成功', '系统');
    }

    bindEvents() {
        document.getElementById('refresh-btn').addEventListener('click', () => this.loadUsers());
        document.getElementById('search-user-search').addEventListener('input', (e) => this.searchUsers(e.target.value));
        document.getElementById('clear-logs-btn').addEventListener('click', () => this.clearLogs());
        document.getElementById('change-pwd-btn').addEventListener('click', () => this.showChangePasswordModal());
        
        document.getElementById('close-modal-btn').addEventListener('click', () => this.closeModal());
        document.getElementById('cancel-btn').addEventListener('click', () => this.closeModal());
        
        document.getElementById('close-pwd-modal-btn').addEventListener('click', () => this.closeChangePasswordModal());
        document.getElementById('cancel-pwd-btn').addEventListener('click', () => this.closeChangePasswordModal());
        document.getElementById('save-pwd-btn').addEventListener('click', () => this.changeAdminPassword());
        
        document.getElementById('close-user-pwd-modal-btn').addEventListener('click', () => this.closeChangeUserPasswordModal());
        document.getElementById('cancel-user-pwd-btn').addEventListener('click', () => this.closeChangeUserPasswordModal());
        document.getElementById('save-user-pwd-btn').addEventListener('click', () => this.changeUserPassword());
    }

    async loadStats() {
        try {
            const [usersRes, messagesRes, friendshipsRes] = await Promise.all([
                fetch(`${this.baseUrl}/api/admin/stats/users`),
                fetch(`${this.baseUrl}/api/admin/stats/messages`),
                fetch(`${this.baseUrl}/api/admin/stats/friendships`)
            ]);

            const usersData = await usersRes.json();
            const messagesData = await messagesRes.json();
            const friendshipsData = await friendshipsRes.json();

            document.getElementById('total-users').textContent = usersData.count || 0;
            document.getElementById('total-messages').textContent = messagesData.count || 0;
            document.getElementById('total-friendships').textContent = friendshipsData.count || 0;
        } catch (error) {
            console.error('Load stats error:', error);
        }
    }

    async loadUsers() {
        try {
            const response = await fetch(`${this.baseUrl}/api/admin/users`);
            const data = await response.json();

            if (data.success) {
                this.users = data.users;
                this.filteredUsers = data.users;
                this.renderUsers();
                this.addLog('用户列表已刷新', '系统');
            }
        } catch (error) {
            console.error('Load users error:', error);
        }
    }

    renderUsers() {
        const tbody = document.getElementById('users-table-body');
        
        if (this.filteredUsers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4">暂无用户</td></tr>';
            return;
        }

        tbody.innerHTML = this.filteredUsers.map(user => {
            const createdAt = user.created_at ? new Date(user.created_at).toLocaleString('zh-CN') : '未知';
            return `
                <tr>
                    <td><div class="user-avatar">${user.username.charAt(0).toUpperCase()}</div></td>
                    <td>${user.username}</td>
                    <td>${createdAt}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn btn-primary btn-sm" onclick="admin.showChangeUserPasswordModal('${user.id}', '${user.username}')">修改密码</button>
                            <button class="btn btn-danger btn-sm" onclick="admin.deleteUser('${user.id}', '${user.username}')">删除</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    searchUsers(keyword) {
        if (!keyword) {
            this.filteredUsers = this.users;
        } else {
            this.filteredUsers = this.users.filter(u => 
                u.username.toLowerCase().includes(keyword.toLowerCase()) ||
                u.id.toLowerCase().includes(keyword.toLowerCase())
            );
        }
        this.renderUsers();
    }

    showChangePasswordModal() {
        document.getElementById('change-pwd-modal').style.display = 'block';
    }

    closeChangePasswordModal() {
        document.getElementById('change-pwd-modal').style.display = 'none';
        document.getElementById('pwd-error').textContent = '';
        document.getElementById('old-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
    }

    async changeAdminPassword() {
        const oldPassword = document.getElementById('old-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        const errorElement = document.getElementById('pwd-error');

        if (!oldPassword || !newPassword || !confirmPassword) {
            errorElement.textContent = '请填写所有字段';
            return;
        }

        if (newPassword !== confirmPassword) {
            errorElement.textContent = '两次输入的密码不一致';
            return;
        }

        if (newPassword.length < 6) {
            errorElement.textContent = '密码至少需要6个字符';
            return;
        }

        try {
            const response = await fetch(`${this.baseUrl}/api/admin/change-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPassword, newPassword })
            });

            const data = await response.json();

            if (data.success) {
                alert('密码修改成功');
                this.closeChangePasswordModal();
                this.addLog('管理员密码已修改', '系统');
            } else {
                errorElement.textContent = data.message || '修改失败';
            }
        } catch (error) {
            errorElement.textContent = '修改失败，请稍后重试';
        }
    }

    showChangeUserPasswordModal(userId, username) {
        this.targetUserId = userId;
        document.getElementById('target-username').textContent = username;
        document.getElementById('change-user-pwd-modal').style.display = 'block';
    }

    closeChangeUserPasswordModal() {
        document.getElementById('change-user-pwd-modal').style.display = 'none';
        document.getElementById('user-pwd-error').textContent = '';
        document.getElementById('user-new-password').value = '';
        document.getElementById('user-confirm-password').value = '';
        this.targetUserId = null;
    }

    async changeUserPassword() {
        const newPassword = document.getElementById('user-new-password').value;
        const confirmPassword = document.getElementById('user-confirm-password').value;
        const errorElement = document.getElementById('user-pwd-error');

        if (!newPassword || !confirmPassword) {
            errorElement.textContent = '请填写所有字段';
            return;
        }

        if (newPassword !== confirmPassword) {
            errorElement.textContent = '两次输入的密码不一致';
            return;
        }

        if (newPassword.length < 1) {
            errorElement.textContent = '密码不能为空';
            return;
        }

        try {
            const response = await fetch(`${this.baseUrl}/api/admin/users/${this.targetUserId}/password`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newPassword })
            });

            const data = await response.json();

            if (data.success) {
                alert('密码修改成功');
                this.closeChangeUserPasswordModal();
                this.addLog(`用户密码已修改`, '系统');
            } else {
                errorElement.textContent = data.message || '修改失败';
            }
        } catch (error) {
            errorElement.textContent = '修改失败，请稍后重试';
        }
    }

    async deleteUser(userId, username) {
        if (!confirm(`确定要删除用户 ${username} 吗？此操作不可恢复！`)) return;

        try {
            const response = await fetch(`${this.baseUrl}/api/admin/users/${userId}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.success) {
                this.loadUsers();
                this.loadStats();
                this.addLog(`用户 ${username} 已删除`, '删除');
            } else {
                alert('删除失败');
            }
        } catch (error) {
            console.error('Delete user error:', error);
            alert('删除失败');
        }
    }

    addLog(message, type = '信息') {
        const logsContainer = document.getElementById('logs-container');
        const now = new Date();
        const timeStr = now.toLocaleTimeString('zh-CN');
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        logEntry.innerHTML = `<span class="log-time">[${timeStr}]</span><span class="log-message">${message}</span>`;
        logsContainer.appendChild(logEntry);
        logsContainer.scrollTop = logsContainer.scrollHeight;
    }

    clearLogs() {
        document.getElementById('logs-container').innerHTML = '<div class="log-entry"><span class="log-time">[系统]</span><span class="log-message">日志已清空</span></div>';
    }

    closeModal() {
        document.getElementById('confirm-modal').style.display = 'none';
    }
}

const admin = new AdminPanel();