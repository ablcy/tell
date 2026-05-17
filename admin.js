class AdminPanel {
    constructor() {
        this.baseUrl = window.location.origin;
        this.users = [];
        this.filteredUsers = [];
        this.groups = [];
        this.filteredGroups = [];
        this.targetUserId = null;
        this.userSelectMode = false;
        this.groupSelectMode = false;
        this.selectedUsers = new Set();
        this.selectedGroups = new Set();
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
        this.loadGroups();
        const version = typeof VERSION !== 'undefined' ? VERSION.full() : 'v5.9.43';
        this.addLog(`Tell Admin ${version} 启动成功`, '系统');
    }

    bindEvents() {
        document.getElementById('refresh-users-btn').addEventListener('click', () => this.loadUsers());
        document.getElementById('search-user-search').addEventListener('input', (e) => this.searchUsers(e.target.value));
        document.getElementById('refresh-groups-btn').addEventListener('click', () => this.loadGroups());
        document.getElementById('search-group-search').addEventListener('input', (e) => this.searchGroups(e.target.value));
        document.getElementById('clear-logs-btn').addEventListener('click', () => this.clearLogs());
        document.getElementById('change-pwd-btn').addEventListener('click', () => this.showChangePasswordModal());
        document.getElementById('toggle-changelog-btn').addEventListener('click', () => this.toggleChangelog());
        
        document.getElementById('close-modal-btn').addEventListener('click', () => this.closeModal());
        document.getElementById('cancel-btn').addEventListener('click', () => this.closeModal());
        
        document.getElementById('close-pwd-modal-btn').addEventListener('click', () => this.closeChangePasswordModal());
        document.getElementById('cancel-pwd-btn').addEventListener('click', () => this.closeChangePasswordModal());
        document.getElementById('save-pwd-btn').addEventListener('click', () => this.changeAdminPassword());
        
        document.getElementById('close-user-pwd-modal-btn').addEventListener('click', () => this.closeChangeUserPasswordModal());
        document.getElementById('cancel-user-pwd-btn').addEventListener('click', () => this.closeChangeUserPasswordModal());
        document.getElementById('save-user-pwd-btn').addEventListener('click', () => this.changeUserPassword());
        
        document.getElementById('toggle-user-select-btn').addEventListener('click', () => this.toggleUserSelectMode());
        document.getElementById('toggle-group-select-btn').addEventListener('click', () => this.toggleGroupSelectMode());
        document.getElementById('select-all-users').addEventListener('change', (e) => this.selectAllUsers(e.target.checked));
        document.getElementById('select-all-groups').addEventListener('change', (e) => this.selectAllGroups(e.target.checked));
        document.getElementById('batch-user-delete-btn').addEventListener('click', () => this.showBatchUserDeleteConfirm());
        document.getElementById('batch-user-pwd-btn').addEventListener('click', () => this.showBatchUserPasswordModal());
        document.getElementById('batch-group-delete-btn').addEventListener('click', () => this.showBatchGroupDeleteConfirm());
        
        document.getElementById('close-batch-user-pwd-modal-btn').addEventListener('click', () => this.closeBatchUserPasswordModal());
        document.getElementById('cancel-batch-user-pwd-btn').addEventListener('click', () => this.closeBatchUserPasswordModal());
        document.getElementById('save-batch-user-pwd-btn').addEventListener('click', () => this.changeBatchUserPassword());
        
        document.getElementById('close-batch-modal-btn').addEventListener('click', () => this.closeBatchConfirmModal());
        document.getElementById('cancel-batch-btn').addEventListener('click', () => this.closeBatchConfirmModal());
        document.getElementById('confirm-batch-btn').addEventListener('click', () => this.executeBatchOperation());
    }

    toggleChangelog() {
        const content = document.getElementById('changelog-content');
        const button = document.getElementById('toggle-changelog-btn');
        
        if (content.style.display === 'none') {
            content.style.display = 'block';
            button.textContent = '▲ 收起';
        } else {
            content.style.display = 'none';
            button.textContent = '▼ 展开';
        }
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
            tbody.innerHTML = '<tr><td colspan="5">暂无用户</td></tr>';
            return;
        }

        tbody.innerHTML = this.filteredUsers.map(user => {
            const createdAt = user.created_at ? new Date(user.created_at).toLocaleString('zh-CN') : '未知';
            const isSelected = this.selectedUsers.has(user.id);
            return `
                <tr>
                    <td style="display: ${this.userSelectMode ? 'table-cell' : 'none'}">
                        <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="admin.toggleUserSelect('${user.id}', this.checked)">
                    </td>
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

    toggleUserSelectMode() {
        this.userSelectMode = !this.userSelectMode;
        const toggleBtn = document.getElementById('toggle-user-select-btn');
        const selectAllTh = document.getElementById('select-all-users-th');
        const batchDeleteBtn = document.getElementById('batch-user-delete-btn');
        const batchPwdBtn = document.getElementById('batch-user-pwd-btn');
        
        if (this.userSelectMode) {
            toggleBtn.textContent = '❌ 取消多选';
            selectAllTh.style.display = 'table-cell';
            batchDeleteBtn.style.display = 'inline-block';
            batchPwdBtn.style.display = 'inline-block';
        } else {
            toggleBtn.textContent = '☑️ 多选';
            selectAllTh.style.display = 'none';
            batchDeleteBtn.style.display = 'none';
            batchPwdBtn.style.display = 'none';
            this.selectedUsers.clear();
            document.getElementById('select-all-users').checked = false;
        }
        this.renderUsers();
    }

    toggleUserSelect(userId, checked) {
        if (checked) {
            this.selectedUsers.add(userId);
        } else {
            this.selectedUsers.delete(userId);
        }
        this.updateSelectAllUsersCheckbox();
    }

    selectAllUsers(checked) {
        this.selectedUsers.clear();
        if (checked) {
            this.filteredUsers.forEach(user => {
                this.selectedUsers.add(user.id);
            });
        }
        this.renderUsers();
    }

    updateSelectAllUsersCheckbox() {
        const selectAll = document.getElementById('select-all-users');
        selectAll.checked = this.selectedUsers.size === this.filteredUsers.length && this.filteredUsers.length > 0;
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

    async loadGroups() {
        try {
            const response = await fetch(`${this.baseUrl}/api/admin/groups`);
            const data = await response.json();

            if (data.success) {
                this.groups = data.groups;
                this.filteredGroups = data.groups;
                this.renderGroups();
                this.addLog('群列表已刷新', '系统');
            }
        } catch (error) {
            console.error('Load groups error:', error);
        }
    }

    renderGroups() {
        const tbody = document.getElementById('groups-table-body');
        
        if (this.filteredGroups.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">暂无群聊</td></tr>';
            return;
        }

        tbody.innerHTML = this.filteredGroups.map(group => {
            const createdAt = group.created_at ? new Date(group.created_at).toLocaleString('zh-CN') : '未知';
            const isSelected = this.selectedGroups.has(group.id);
            return `
                <tr>
                    <td style="display: ${this.groupSelectMode ? 'table-cell' : 'none'}">
                        <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="admin.toggleGroupSelect('${group.id}', this.checked)">
                    </td>
                    <td>${group.group_number}</td>
                    <td>${group.owner_name}</td>
                    <td>${group.member_count}</td>
                    <td>${createdAt}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn btn-danger btn-sm" onclick="admin.deleteGroup('${group.id}', '${group.group_number}')">解散</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    toggleGroupSelectMode() {
        this.groupSelectMode = !this.groupSelectMode;
        const toggleBtn = document.getElementById('toggle-group-select-btn');
        const selectAllTh = document.getElementById('select-all-groups-th');
        const batchDeleteBtn = document.getElementById('batch-group-delete-btn');
        
        if (this.groupSelectMode) {
            toggleBtn.textContent = '❌ 取消多选';
            selectAllTh.style.display = 'table-cell';
            batchDeleteBtn.style.display = 'inline-block';
        } else {
            toggleBtn.textContent = '☑️ 多选';
            selectAllTh.style.display = 'none';
            batchDeleteBtn.style.display = 'none';
            this.selectedGroups.clear();
            document.getElementById('select-all-groups').checked = false;
        }
        this.renderGroups();
    }

    toggleGroupSelect(groupId, checked) {
        if (checked) {
            this.selectedGroups.add(groupId);
        } else {
            this.selectedGroups.delete(groupId);
        }
        this.updateSelectAllGroupsCheckbox();
    }

    selectAllGroups(checked) {
        this.selectedGroups.clear();
        if (checked) {
            this.filteredGroups.forEach(group => {
                this.selectedGroups.add(group.id);
            });
        }
        this.renderGroups();
    }

    updateSelectAllGroupsCheckbox() {
        const selectAll = document.getElementById('select-all-groups');
        selectAll.checked = this.selectedGroups.size === this.filteredGroups.length && this.filteredGroups.length > 0;
    }

    searchGroups(keyword) {
        if (!keyword) {
            this.filteredGroups = this.groups;
        } else {
            this.filteredGroups = this.groups.filter(g => 
                g.name.toLowerCase().includes(keyword.toLowerCase()) ||
                g.group_number.toLowerCase().includes(keyword.toLowerCase()) ||
                g.owner_name.toLowerCase().includes(keyword.toLowerCase())
            );
        }
        this.renderGroups();
    }

    showBatchUserDeleteConfirm() {
        if (this.selectedUsers.size === 0) {
            alert('请先选择要删除的用户');
            return;
        }
        this.currentBatchOperation = 'deleteUsers';
        document.getElementById('batch-modal-title').textContent = '批量删除用户';
        document.getElementById('batch-modal-message').textContent = `确定要删除选中的用户吗？此操作不可恢复！`;
        document.getElementById('batch-selected-count').textContent = `共选中 ${this.selectedUsers.size} 位用户`;
        document.getElementById('batch-confirm-modal').style.display = 'block';
    }

    showBatchGroupDeleteConfirm() {
        if (this.selectedGroups.size === 0) {
            alert('请先选择要解散的群聊');
            return;
        }
        this.currentBatchOperation = 'deleteGroups';
        document.getElementById('batch-modal-title').textContent = '批量解散群聊';
        document.getElementById('batch-modal-message').textContent = `确定要解散选中的群聊吗？此操作不可恢复！`;
        document.getElementById('batch-selected-count').textContent = `共选中 ${this.selectedGroups.size} 个群聊`;
        document.getElementById('batch-confirm-modal').style.display = 'block';
    }

    showBatchUserPasswordModal() {
        if (this.selectedUsers.size === 0) {
            alert('请先选择要修改密码的用户');
            return;
        }
        document.getElementById('selected-user-count').textContent = this.selectedUsers.size;
        document.getElementById('batch-user-pwd-modal').style.display = 'block';
    }

    closeBatchUserPasswordModal() {
        document.getElementById('batch-user-pwd-modal').style.display = 'none';
        document.getElementById('batch-user-pwd-error').textContent = '';
        document.getElementById('batch-user-new-password').value = '';
        document.getElementById('batch-user-confirm-password').value = '';
    }

    closeBatchConfirmModal() {
        document.getElementById('batch-confirm-modal').style.display = 'none';
        this.currentBatchOperation = null;
    }

    async executeBatchOperation() {
        if (this.currentBatchOperation === 'deleteUsers') {
            await this.batchDeleteUsers();
        } else if (this.currentBatchOperation === 'deleteGroups') {
            await this.batchDeleteGroups();
        }
        this.closeBatchConfirmModal();
    }

    async batchDeleteUsers() {
        const userIds = Array.from(this.selectedUsers);
        let successCount = 0;
        
        for (const userId of userIds) {
            try {
                const response = await fetch(`${this.baseUrl}/api/admin/users/${userId}`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                if (data.success) {
                    successCount++;
                }
            } catch (error) {
                console.error('Delete user error:', error);
            }
        }
        
        this.selectedUsers.clear();
        this.toggleUserSelectMode();
        this.loadUsers();
        this.loadStats();
        this.addLog(`批量删除用户完成，成功删除 ${successCount}/${userIds.length} 位用户`, '删除');
        alert(`批量删除完成，成功删除 ${successCount}/${userIds.length} 位用户`);
    }

    async batchDeleteGroups() {
        const groupIds = Array.from(this.selectedGroups);
        let successCount = 0;
        
        for (const groupId of groupIds) {
            try {
                const response = await fetch(`${this.baseUrl}/api/admin/groups/${groupId}`, {
                    method: 'DELETE'
                });
                const data = await response.json();
                if (data.success) {
                    successCount++;
                }
            } catch (error) {
                console.error('Delete group error:', error);
            }
        }
        
        this.selectedGroups.clear();
        this.toggleGroupSelectMode();
        this.loadGroups();
        this.addLog(`批量解散群聊完成，成功解散 ${successCount}/${groupIds.length} 个群聊`, '删除');
        alert(`批量解散完成，成功解散 ${successCount}/${groupIds.length} 个群聊`);
    }

    async changeBatchUserPassword() {
        const newPassword = document.getElementById('batch-user-new-password').value;
        const confirmPassword = document.getElementById('batch-user-confirm-password').value;
        const errorElement = document.getElementById('batch-user-pwd-error');

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

        const userIds = Array.from(this.selectedUsers);
        let successCount = 0;
        
        for (const userId of userIds) {
            try {
                const response = await fetch(`${this.baseUrl}/api/admin/users/${userId}/password`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ newPassword })
                });
                const data = await response.json();
                if (data.success) {
                    successCount++;
                }
            } catch (error) {
                console.error('Change password error:', error);
            }
        }
        
        this.closeBatchUserPasswordModal();
        this.selectedUsers.clear();
        this.toggleUserSelectMode();
        this.addLog(`批量修改密码完成，成功修改 ${successCount}/${userIds.length} 位用户的密码`, '系统');
        alert(`批量修改密码完成，成功修改 ${successCount}/${userIds.length} 位用户的密码`);
    }

    async deleteGroup(groupId, groupName) {
        if (!confirm(`确定要解散群聊 "${groupName}" 吗？此操作不可恢复！`)) return;

        try {
            const response = await fetch(`${this.baseUrl}/api/admin/groups/${groupId}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.success) {
                this.loadGroups();
                this.addLog(`群聊 ${groupName} 已解散`, '删除');
            } else {
                alert('解散失败');
            }
        } catch (error) {
            console.error('Delete group error:', error);
            alert('解散失败');
        }
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