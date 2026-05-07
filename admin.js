class AdminPanel {
    constructor() {
        this.baseUrl = window.location.origin;
        this.users = [];
        this.filteredUsers = [];
        this.adminToken = localStorage.getItem('adminToken');
        this.currentUser = null;
        this.init();
    }

    init() {
        if (this.adminToken) {
            this.verifyToken();
        } else {
            this.showLoginScreen();
        }
    }

    async verifyToken() {
        try {
            const response = await fetch(`${this.baseUrl}/api/admin/verify`, {
                headers: { 'x-admin-token': this.adminToken }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.currentUser = data.username;
                this.hideLoginScreen();
                this.bindEvents();
                this.loadStats();
                this.loadUsers();
                this.addLog(`管理员 ${this.currentUser} 登录成功`, '成功');
            } else {
                this.showLoginScreen();
            }
        } catch (error) {
            this.showLoginScreen();
        }
    }

    showLoginScreen() {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('app').style.display = 'none';
        this.bindLoginEvents();
    }

    hideLoginScreen() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app').style.display = 'block';
        document.getElementById('current-user').textContent = `👤 ${this.currentUser}`;
    }

    bindLoginEvents() {
        const loginForm = document.getElementById('login-form');
        loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }

    async handleLogin(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorElement = document.getElementById('login-error');
        
        try {
            const response = await fetch(`${this.baseUrl}/api/admin/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.adminToken = data.token;
                this.currentUser = data.username;
                localStorage.setItem('adminToken', data.token);
                this.hideLoginScreen();
                this.bindEvents();
                this.loadStats();
                this.loadUsers();
            } else {
                errorElement.textContent = data.message || '登录失败';
            }
        } catch (error) {
            errorElement.textContent = '网络错误，请重试';
        }
    }

    async handleLogout() {
        try {
            await fetch(`${this.baseUrl}/api/admin/logout`, {
                method: 'POST',
                headers: { 'x-admin-token': this.adminToken }
            });
        } catch (error) {
            console.error('Logout error:', error);
        }
        
        localStorage.removeItem('adminToken');
        this.adminToken = null;
        this.currentUser = null;
        this.addLog('管理员已退出登录', '信息');
        this.showLoginScreen();
    }

    bindEvents() {
        document.getElementById('refresh-btn').addEventListener('click', () => this.loadUsers());
        document.getElementById('search-user-search').addEventListener('input', (e) => this.filterUsers(e.target.value));
        document.getElementById('clear-logs-btn').addEventListener('click', () => this.clearLogs());
        document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());
        
        document.getElementById('close-modal-btn').addEventListener('click', () => this.closeModal());
        document.getElementById('cancel-btn').addEventListener('click', () => this.closeModal());
        document.getElementById('confirm-btn').addEventListener('click', () => this.confirmAction());
        
        document.getElementById('confirm-modal').addEventListener('click', (e) => {
            if (e.target.id === 'confirm-modal') this.closeModal();
        });
    }

    addLog(message, type = '信息') {
        const logsContainer = document.getElementById('logs-container');
        const logEntry = document.createElement('div');
        logEntry.className = 'log-entry';
        
        const now = new Date();
        const timeString = now.toLocaleTimeString();
        
        logEntry.innerHTML = `
            <span class="log-time">[${timeString}] [${type}]</span>
            <span class="log-message">${message}</span>
        `;
        
        logsContainer.insertBefore(logEntry, logsContainer.firstChild);
    }

    clearLogs() {
        const logsContainer = document.getElementById('logs-container');
        logsContainer.innerHTML = `
            <div class="log-entry">
                <span class="log-time">[系统]</span>
                <span class="log-message">日志已清空</span>
            </div>
        `;
    }

    async loadStats() {
        try {
            const [usersRes, messagesRes] = await Promise.all([
                fetch(`${this.baseUrl}/api/admin/stats/users`, {
                    headers: { 'x-admin-token': this.adminToken }
                }),
                fetch(`${this.baseUrl}/api/admin/stats/messages`, {
                    headers: { 'x-admin-token': this.adminToken }
                })
            ]);
            
            const usersData = await usersRes.json();
            const messagesData = await messagesRes.json();
            
            document.getElementById('total-users').textContent = usersData.count || 0;
            document.getElementById('total-messages').textContent = messagesData.count || 0;
            document.getElementById('total-friendships').textContent = '0';
            
            this.addLog('统计数据加载成功', '成功');
        } catch (error) {
            this.addLog(`加载统计数据失败: ${error.message}`, '错误');
            console.error('Error loading stats:', error);
        }
    }

    async loadUsers() {
        const tbody = document.getElementById('users-table-body');
        tbody.innerHTML = '<tr class="loading-row"><td colspan="7">加载中...</td></tr>';
        
        try {
            const response = await fetch(`${this.baseUrl}/api/admin/users`, {
                headers: { 'x-admin-token': this.adminToken }
            });
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || '获取用户失败');
            }
            
            this.users = data.users || [];
            this.filteredUsers = [...this.users];
            this.renderUsers();
            
            this.addLog(`成功加载 ${this.users.length} 个用户`, '成功');
        } catch (error) {
            this.addLog(`加载用户失败: ${error.message}`, '错误');
            tbody.innerHTML = '<tr class="loading-row"><td colspan="7">加载失败，请刷新重试</td></tr>';
            console.error('Error loading users:', error);
        }
    }

    renderUsers() {
        const tbody = document.getElementById('users-table-body');
        
        if (this.filteredUsers.length === 0) {
            tbody.innerHTML = '<tr class="loading-row"><td colspan="7">暂无用户数据</td></tr>';
            return;
        }
        
        tbody.innerHTML = this.filteredUsers.map(user => {
            let avatarHtml = '';
            if (user.avatar) {
                avatarHtml = `<img src="${user.avatar}" alt="" style="width: 40px; height: 40px; object-fit: cover; border-radius: 50%;">`;
            } else {
                avatarHtml = `<span style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--talk-blue); color: white; border-radius: 50%; font-size: 16px;">${user.username.charAt(0).toUpperCase()}</span>`;
            }
            
            return `
            <tr data-user-id="${user.id}">
                <td>${avatarHtml}</td>
                <td>${user.id.substring(0, 8)}...</td>
                <td><strong>${user.username}</strong></td>
                <td>${new Date(user.created_at).toLocaleString()}</td>
                <td>0</td>
                <td>0</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-view" onclick="admin.viewUser('${user.id}')">查看</button>
                        <button class="btn-delete" onclick="admin.deleteUser('${user.id}', '${user.username}')">删除</button>
                    </div>
                </td>
            </tr>
        `}).join('');
    }

    filterUsers(keyword) {
        const searchTerm = keyword.toLowerCase().trim();
        
        if (!searchTerm) {
            this.filteredUsers = [...this.users];
        } else {
            this.filteredUsers = this.users.filter(user => 
                user.username.toLowerCase().includes(searchTerm) ||
                user.id.toLowerCase().includes(searchTerm)
            );
        }
        
        this.renderUsers();
    }

    viewUser(userId) {
        this.addLog(`查看用户: ${userId}`, '信息');
        alert(`查看用户详情功能开发中...\n用户ID: ${userId}`);
    }

    deleteUser(userId, username) {
        this.currentAction = { type: 'delete', userId, username };
        document.getElementById('modal-title').textContent = '⚠️ 确认删除';
        document.getElementById('modal-message').innerHTML = `
            确定要删除用户 <strong>${username}</strong> 吗？<br>
            <span style="color: var(--talk-red);">此操作不可撤销！</span>
        `;
        document.getElementById('confirm-modal').style.display = 'flex';
    }

    closeModal() {
        document.getElementById('confirm-modal').style.display = 'none';
        this.currentAction = null;
    }

    async confirmAction() {
        if (!this.currentAction) return;
        
        if (this.currentAction.type === 'delete') {
            await this.doDeleteUser(this.currentAction.userId, this.currentAction.username);
        }
        
        this.closeModal();
    }

    async doDeleteUser(userId, username) {
        try {
            const response = await fetch(`${this.baseUrl}/api/admin/users/${userId}`, {
                method: 'DELETE',
                headers: { 'x-admin-token': this.adminToken }
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.addLog(`成功删除用户: ${username}`, '成功');
                this.loadUsers();
                this.loadStats();
            } else {
                this.addLog(`删除用户失败: ${result.message}`, '错误');
            }
        } catch (error) {
            this.addLog(`删除用户失败: ${error.message}`, '错误');
        }
    }
}

const admin = new AdminPanel();