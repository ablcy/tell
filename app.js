const APP_VERSION = typeof VERSION !== 'undefined' ? VERSION.full() : 'v5.9.23';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js');
            console.log('[App] Service Worker registered:', registration.scope);

            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (newWorker) {
                    newWorker.addEventListener('statechange', () => {
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            if (confirm('发现新版本，是否立即更新？')) {
                                newWorker.postMessage({ type: 'SKIP_WAITING' });
                                window.location.reload();
                            }
                        }
                    });
                }
            });

            const version = await navigator.serviceWorker.ready.then(r => r.active?.scriptURL || 'unknown');
            console.log('[App] Service Worker version:', version);
        } catch (error) {
            console.log('[App] Service Worker registration failed:', error);
        }
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[App] Service Worker controller changed');
        window.location.reload();
    });
}

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
        this.burnAfterReadingFriendId = null;
        this.burnAfterReadingGroupId = null;
        
        // WebRTC相关
        this.socket = null;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.isInCall = false;
        this.currentCallTarget = null;
        
        this.loadBurnAfterReadingSetting();
        this.init();
    }

    loadBurnAfterReadingSetting() {
        try {
            const saved = localStorage.getItem('burnAfterReading');
            if (saved) {
                const data = JSON.parse(saved);
                this.burnAfterReadingFriendId = data.friendId || null;
                this.burnAfterReadingGroupId = data.groupId || null;
            }
        } catch {
            this.burnAfterReadingFriendId = null;
            this.burnAfterReadingGroupId = null;
        }
    }

    saveBurnAfterReadingSetting() {
        localStorage.setItem('burnAfterReading', JSON.stringify({
            friendId: this.burnAfterReadingFriendId,
            groupId: this.burnAfterReadingGroupId
        }));
    }

    init() {
        this.bindEvents();
        this.initGroupEvents();
        this.loadLanguage();
        this.loadTheme();
        this.loadUserData();
        this.startUptimeTimer();
        this.initSocket();
    }
    
    initSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Socket connected');
            if (this.currentUser) {
                this.socket.emit('login', this.currentUser.id);
            }
        });
        
        this.socket.on('disconnect', () => {
            console.log('Socket disconnected');
        });
        
        // 监听来电
        this.socket.on('call', (data) => {
            this.handleIncomingCall(data);
        });
        
        // 监听对方应答
        this.socket.on('answer', (data) => {
            this.handleAnswer(data);
        });
        
        // 监听ICE候选
        this.socket.on('ice-candidate', (data) => {
            this.handleIceCandidate(data);
        });
        
        // 监听通话结束
        this.socket.on('call-end', (data) => {
            this.handleCallEnd(data);
        });
        
        // 监听通话拒绝
        this.socket.on('call-reject', (data) => {
            this.handleCallReject(data);
        });
    }
    
    loginSocket() {
        if (this.socket && this.currentUser) {
            this.socket.emit('login', this.currentUser.id);
        }
    }

    initGroupEvents() {
        document.getElementById('create-group-menu-item').addEventListener('click', () => {
            this.showCreateGroupModal();
            this.closeTabPlusMenu();
        });
        document.getElementById('contacts-create-group-menu-item').addEventListener('click', () => {
            this.showCreateGroupModal();
            this.closeTabPlusMenu();
        });

        document.getElementById('close-create-group-modal').addEventListener('click', () => this.closeCreateGroupModal());
        document.getElementById('confirm-create-group-btn').addEventListener('click', () => this.createGroup());

        document.getElementById('contacts-add-friend-btn').addEventListener('click', () => {
            document.getElementById('search-input').focus();
            this.switchTab('chats');
        });

        document.getElementById('contacts-create-group-btn').addEventListener('click', () => this.showCreateGroupModal());

        document.getElementById('tab-plus-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleTabPlusMenu();
        });

        document.getElementById('contacts-plus-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleContactsPlusMenu();
        });



        document.addEventListener('click', () => this.closeTabPlusMenu());

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

        // 群聊阅后即焚事件
        document.getElementById('group-burn-after-reading-toggle').addEventListener('change', (e) => this.toggleGroupBurnAfterReading(e));

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

    toggleTabPlusMenu() {
        const menu = document.getElementById('tab-plus-menu');
        const isVisible = menu.classList.contains('visible');
        if (isVisible) {
            menu.classList.remove('visible');
            setTimeout(() => {
                menu.style.display = 'none';
            }, 150);
        } else {
            menu.style.display = 'block';
            setTimeout(() => {
                menu.classList.add('visible');
            }, 10);
        }
    }

    closeTabPlusMenu() {
        const menu = document.getElementById('tab-plus-menu');
        const contactsMenu = document.getElementById('contacts-plus-menu');
        menu.classList.remove('visible');
        contactsMenu.classList.remove('visible');
        setTimeout(() => {
            menu.style.display = 'none';
            contactsMenu.style.display = 'none';
        }, 150);
    }

    togglePlusMenu() {
        const menu = document.getElementById('plus-menu');
        const isVisible = menu.style.display === 'block';
        if (isVisible) {
            menu.style.display = 'none';
        } else {
            menu.style.display = 'block';
        }
    }

    closePlusMenu() {
        const menu = document.getElementById('plus-menu');
        menu.style.display = 'none';
    }

    async initiateCall() {
        if (!this.currentFriend) {
            alert('请先选择一个好友');
            return;
        }

        if (this.isInCall) {
            alert('您正在通话中');
            return;
        }

        this.currentCallTarget = this.currentFriend;
        this.isInCall = true;

        try {
            // 检查浏览器是否支持 mediaDevices
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('您的浏览器不支持视频通话功能');
            }

            // 先检查权限状态
            const permissionStatus = await navigator.permissions.query({ name: 'camera' }).catch(() => ({ state: 'prompt' }));
            const audioPermissionStatus = await navigator.permissions.query({ name: 'microphone' }).catch(() => ({ state: 'prompt' }));

            if (permissionStatus.state === 'denied' || audioPermissionStatus.state === 'denied') {
                throw new Error('摄像头或麦克风权限被拒绝，请在浏览器设置中开启权限后重试');
            }

            // 获取本地媒体流（视频+音频）
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

            // 创建PeerConnection
            this.peerConnection = this.createPeerConnection();

            // 添加本地流到PeerConnection
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            // 创建Offer
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            // 显示呼叫界面
            this.showCallModal('outgoing');

            // 显示本地视频
            this.showLocalVideo();

            // 发送呼叫请求
            this.socket.emit('call', {
                targetId: this.currentFriend.id,
                fromUsername: this.currentUser.username,
                offer: offer
            });
        } catch (error) {
            console.error('Failed to initiate call:', error);
            let errorMessage = '无法发起通话，请检查麦克风和摄像头权限。\n\n解决方法：\n1. 点击浏览器地址栏左侧的摄像头/麦克风图标\n2. 允许访问摄像头和麦克风\n3. 如果没有图标，请在浏览器设置中开启权限';

            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorMessage = '摄像头或麦克风权限被拒绝。\n\n请按以下步骤开启权限：\n1. 点击浏览器地址栏左侧的锁图标或摄像头图标\n2. 选择"允许"摄像头和麦克风\n3. 重新点击视频通话按钮';
            } else if (error.name === 'NotFoundError') {
                errorMessage = '未找到摄像头或麦克风设备。\n\n请确认您的设备已正确连接摄像头和麦克风。';
            } else if (error.name === 'NotReadableError') {
                errorMessage = '摄像头或麦克风被其他应用占用。\n\n请关闭其他使用摄像头的应用后重试。';
            } else if (error.message && error.message.includes('您的浏览器不支持')) {
                errorMessage = error.message;
            }

            alert(errorMessage);
            this.endCall();
        }
    }
    
    createPeerConnection() {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        
        const iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun.cloudflare.com:3478' },
            { urls: 'stun:stun.qq.com:3478' }
        ];
        
        iceServers.push({
            urls: ['turn:114.215.182.61:3478', 'turn:114.215.182.61:3478?transport=tcp'],
            username: 'telluser',
            credential: 'tellpass2024'
        });
        iceServers.push({
            urls: ['turn:relay.metered.ca:80', 'turn:relay.metered.ca:443'],
            username: 'MeteredTurnServer',
            credential: '8h95q4a7tb8z'
        });
        iceServers.push({
            urls: ['turn:turn.openrelay.metered.ca:80', 'turn:turn.openrelay.metered.ca:443'],
            username: 'openrelayproject',
            credential: 'openrelayproject'
        });
        
        if (isLocal) {
            iceServers.unshift({
                urls: ['turn:localhost:3478', 'turn:localhost:3478?transport=tcp'],
                username: 'test',
                credential: 'test123'
            });
        }
        
        const configuration = {
            iceServers: iceServers,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
            iceCandidatePoolSize: 20,
            sdpSemantics: 'unified-plan'
        };
        
        const pc = new RTCPeerConnection(configuration);
        
        console.log('Created PeerConnection with config:', {
            iceServers: iceServers.length,
            transportPolicy: configuration.iceTransportPolicy
        });
        
        // 监听ICE候选
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('ICE candidate generated - type:', event.candidate.type, ', protocol:', event.candidate.protocol);
                if (this.currentCallTarget) {
                    this.socket.emit('ice-candidate', {
                        targetId: this.currentCallTarget.id,
                        candidate: event.candidate
                    });
                }
            } else {
                console.log('ICE gathering complete');
            }
        };
        
        // 监听ICE连接状态
        pc.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', pc.iceConnectionState);
            if (pc.iceConnectionState === 'failed') {
                console.error('ICE connection failed, retrying...');
                pc.restartIce();
            }
        };
        
        // 监听远程流（标准方式）
        pc.ontrack = (event) => {
            console.log('Remote track received:', event.track.kind);
            
            if (!this.remoteStream) {
                this.remoteStream = new MediaStream();
            }
            
            // 检查轨道是否已存在
            const existingTracks = this.remoteStream.getTracks();
            const trackExists = existingTracks.some(t => t.kind === event.track.kind);
            
            if (!trackExists) {
                this.remoteStream.addTrack(event.track);
                console.log('Added track:', event.track.kind);
            }
            
            // 只收集轨道，不在这里播放，等待连接稳定
            console.log('Remote stream tracks collected, waiting for connection...');
        };
        
        // 备选方式：监听addstream事件（旧浏览器兼容）
        pc.onaddstream = (event) => {
            console.log('onaddstream triggered');
            if (!this.remoteStream) {
                this.remoteStream = event.stream;
            }
            // 不在这里播放，等待连接状态变化
        };
        
        // 监听连接状态变化
        pc.onconnectionstatechange = () => {
            console.log('Connection state:', pc.connectionState);
            if (pc.connectionState === 'connected' || pc.connectionState === 'completed') {
                console.log('WebRTC connection established!');
                // 连接成功后，延迟一点时间确保稳定，然后播放
                if (this.remoteStream && !this.remoteStreamPlaying) {
                    this.remoteStreamPlaying = true;
                    setTimeout(() => {
                        if (this.remoteStreamPlaying && this.remoteStream) {
                            this.playRemoteAudio();
                        }
                    }, 500);
                }
            }
            if (pc.connectionState === 'disconnected') {
                this.endCall();
            }
            if (pc.connectionState === 'failed') {
                console.error('WebRTC connection failed!');
                // 连接失败，显示错误提示
                this.showCallError('连接失败，请检查网络连接');
                this.endCall();
            }
        };
        
        // 监听信令状态变化
        pc.onsignalingstatechange = () => {
            console.log('Signaling state:', pc.signalingState);
        };
        
        return pc;
    }
    
    handleIncomingCall(data) {
        if (this.isInCall) {
            this.socket.emit('call-reject', { targetId: data.from });
            return;
        }
        
        this.currentCallTarget = this.friends.find(f => f.id === data.from);
        
        if (!this.currentCallTarget) {
            return;
        }
        
        this.isInCall = true;
        
        // 显示来电界面
        this.showCallModal('incoming', data.fromUsername);
        
        // 创建PeerConnection
        this.peerConnection = this.createPeerConnection();
        
        // 设置远程描述
        this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer))
            .then(() => {
                console.log('Remote description set successfully');
                // 设置远程描述后，需要创建接收器来接收远程流
                this.peerConnection.getReceivers().forEach(receiver => {
                    console.log('Receiver:', receiver.track?.kind);
                });
            })
            .catch(err => {
                console.error('Failed to set remote description:', err);
            });
    }
    
    async acceptCall() {
        try {
            // 检查浏览器是否支持 mediaDevices
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('您的浏览器不支持视频通话功能');
            }

            // 先检查权限状态
            const permissionStatus = await navigator.permissions.query({ name: 'camera' }).catch(() => ({ state: 'prompt' }));
            const audioPermissionStatus = await navigator.permissions.query({ name: 'microphone' }).catch(() => ({ state: 'prompt' }));

            if (permissionStatus.state === 'denied' || audioPermissionStatus.state === 'denied') {
                throw new Error('摄像头或麦克风权限被拒绝，请在浏览器设置中开启权限后重试');
            }

            // 获取本地媒体流（视频+音频）
            this.localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

            // 确保音频上下文被激活
            if (window.AudioContext || window.webkitAudioContext) {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                await audioContext.resume();
            }

            // 添加本地流
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });

            // 创建Answer
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            // 更新界面为通话中
            this.updateCallModal('connected');

            // 显示本地视频
            this.showLocalVideo();

            // 发送应答
            this.socket.emit('answer', {
                targetId: this.currentCallTarget.id,
                answer: answer
            });
        } catch (error) {
            console.error('Failed to accept call:', error);
            let errorMessage = '无法接听通话，请检查麦克风和摄像头权限。\n\n解决方法：\n1. 点击浏览器地址栏左侧的摄像头/麦克风图标\n2. 允许访问摄像头和麦克风\n3. 如果没有图标，请在浏览器设置中开启权限';

            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                errorMessage = '摄像头或麦克风权限被拒绝。\n\n请按以下步骤开启权限：\n1. 点击浏览器地址栏左侧的锁图标或摄像头图标\n2. 选择"允许"摄像头和麦克风\n3. 重新点击接听按钮';
            } else if (error.name === 'NotFoundError') {
                errorMessage = '未找到摄像头或麦克风设备。\n\n请确认您的设备已正确连接摄像头和麦克风。';
            } else if (error.name === 'NotReadableError') {
                errorMessage = '摄像头或麦克风被其他应用占用。\n\n请关闭其他使用摄像头的应用后重试。';
            } else if (error.message && error.message.includes('您的浏览器不支持')) {
                errorMessage = error.message;
            }

            alert(errorMessage);
            this.rejectCall();
        }
    }
    
    rejectCall() {
        this.socket.emit('call-reject', { targetId: this.currentCallTarget.id });
        this.endCall();
    }
    
    handleAnswer(data) {
        this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        this.updateCallModal('connected');
    }
    
    handleIceCandidate(data) {
        if (data.candidate && this.peerConnection) {
            this.peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    }
    
    handleCallEnd(data) {
        this.endCall();
    }
    
    handleCallReject(data) {
        alert('对方拒绝了通话');
        this.endCall();
    }
    
    endCall() {
        this.isInCall = false;
        this.remoteStreamPlaying = false;
        this.isVideoPlaying = false;
        
        // 关闭本地流
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        // 关闭远程流
        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => track.stop());
            this.remoteStream = null;
        }
        
        // 关闭PeerConnection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // 关闭音频元素
        const remoteAudio = document.getElementById('remote-audio');
        if (remoteAudio) {
            remoteAudio.pause();
            remoteAudio.srcObject = null;
        }
        
        // 关闭视频元素
        const remoteVideo = document.getElementById('remote-video');
        if (remoteVideo) {
            remoteVideo.pause();
            remoteVideo.srcObject = null;
        }
        
        const localVideo = document.getElementById('local-video');
        if (localVideo) {
            localVideo.pause();
            localVideo.srcObject = null;
        }
        
        // 发送结束通知
        if (this.currentCallTarget) {
            this.socket.emit('call-end', { targetId: this.currentCallTarget.id });
            this.currentCallTarget = null;
        }
        
        // 关闭通话界面
        const callModal = document.getElementById('call-modal');
        if (callModal) {
            document.body.removeChild(callModal);
        }
    }
    
    showCallModal(type, callerName = '') {
        const callModal = document.createElement('div');
        callModal.id = 'call-modal';
        callModal.className = 'call-modal';
        
        const friend = this.currentCallTarget;
        const name = type === 'incoming' ? callerName : friend.username;
        
        let actionsHTML = '';
        if (type === 'incoming') {
            actionsHTML = `
                <button class="call-btn call-btn-secondary" id="reject-call-btn">✕ 拒绝</button>
                <button class="call-btn call-btn-primary" id="accept-call-btn">✓ 接听</button>
            `;
        } else if (type === 'outgoing') {
            actionsHTML = `
                <button class="call-btn call-btn-danger" id="end-call-btn">✕ 取消</button>
            `;
        }
        
        callModal.innerHTML = `
            <div class="call-modal-content">
                <div class="call-video-container">
                    <video id="remote-video" autoplay playsinline style="width: 100%; height: 200px; background: #000; border-radius: 12px;"></video>
                    <video id="local-video" autoplay playsinline muted style="width: 80px; height: 80px; background: #333; border-radius: 8px; position: absolute; bottom: 10px; right: 10px; object-fit: cover;"></video>
                </div>
                <div class="call-info">
                    <div class="call-avatar">${name.charAt(0).toUpperCase()}</div>
                    <div class="call-name">${name}</div>
                    <div class="call-status" id="call-status">${type === 'incoming' ? '视频来电中...' : '正在视频呼叫...'}</div>
                </div>
                <audio id="remote-audio" autoplay playsinline controls style="display: none;"></audio>
                <div class="call-actions">${actionsHTML}</div>
            </div>
        `;
        
        document.body.appendChild(callModal);
        callModal.style.display = 'flex';
        
        if (type === 'incoming') {
            const acceptBtn = callModal.querySelector('#accept-call-btn');
            const rejectBtn = callModal.querySelector('#reject-call-btn');
            if (acceptBtn) {
                acceptBtn.addEventListener('click', () => this.acceptCall());
            }
            if (rejectBtn) {
                rejectBtn.addEventListener('click', () => this.rejectCall());
            }
        } else {
            const endBtn = callModal.querySelector('#end-call-btn');
            if (endBtn) {
                endBtn.addEventListener('click', () => this.endCall());
            }
        }
    }
    
    updateCallModal(status) {
        const callModal = document.getElementById('call-modal');
        if (!callModal) return;
        
        const statusEl = document.getElementById('call-status');
        if (statusEl) {
            statusEl.textContent = '通话中...';
        }
        
        const actionsEl = callModal.querySelector('.call-actions');
        if (actionsEl) {
            actionsEl.innerHTML = `
                <button class="call-btn call-btn-danger" id="end-call-btn">✕ 结束通话</button>
            `;
            document.getElementById('end-call-btn').addEventListener('click', () => this.endCall());
        }
    }
    
    playRemoteAudio() {
        const remoteAudio = document.getElementById('remote-audio');
        const remoteVideo = document.getElementById('remote-video');
        
        console.log('playRemoteAudio called, remoteStream:', this.remoteStream);
        
        if (!this.remoteStream) {
            console.log('remoteStream is null');
            return;
        }
        
        console.log('Remote stream tracks:', this.remoteStream.getTracks().map(t => t.kind));
        
        // 先设置视频元素，再标记
        if (remoteVideo) {
            remoteVideo.srcObject = this.remoteStream;
            remoteVideo.autoplay = true;
            remoteVideo.playsinline = true;
            remoteVideo.muted = false;
            
            // 尝试播放
            remoteVideo.play().then(() => {
                console.log('Video playing successfully');
            }).catch(e => {
                console.warn('Video play issue:', e);
            });
        }
        
        // 设置音频元素
        if (remoteAudio) {
            remoteAudio.srcObject = this.remoteStream;
            remoteAudio.muted = false;
            remoteAudio.volume = 1;
            remoteAudio.play().catch(e => console.warn('Audio play issue:', e));
        }
        
        // 最后标记为正在播放
        this.remoteStreamPlaying = true;
        this.isVideoPlaying = true;
    }
    
    setupVideoPlayOnInteraction(videoElement) {
        const callModal = document.getElementById('call-modal');
        if (callModal && videoElement) {
            const handleClick = () => {
                videoElement.play().then(() => {
                    console.log('Video playing after user interaction');
                }).catch(e => {
                    console.error('Still failed to play video:', e);
                });
                callModal.removeEventListener('click', handleClick);
            };
            callModal.addEventListener('click', handleClick);
        }
    }
    
    showCallError(message) {
        const callModal = document.getElementById('call-modal');
        if (callModal) {
            const statusEl = callModal.querySelector('#call-status');
            if (statusEl) {
                statusEl.textContent = message;
                statusEl.style.color = '#ff4757';
            }
        }
    }
    
    showLocalVideo() {
        const localVideo = document.getElementById('local-video');
        if (localVideo && this.localStream) {
            localVideo.srcObject = this.localStream;
            localVideo.play().catch(e => console.error('Failed to play local video:', e));
        }
    }

    toggleContactsPlusMenu() {
        const menu = document.getElementById('contacts-plus-menu');
        const isVisible = menu.classList.contains('visible');
        if (isVisible) {
            menu.classList.remove('visible');
            setTimeout(() => {
                menu.style.display = 'none';
            }, 150);
        } else {
            menu.style.display = 'block';
            setTimeout(() => {
                menu.classList.add('visible');
            }, 10);
        }
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

        // 检查阅后即焚状态
        const shouldBurn = this.burnAfterReadingGroupId === groupId;
        if (shouldBurn) {
            this.groupMessages[groupId] = [];
        }

        // 立即显示预加载的消息，第一次打开时滚动到底部
        this.renderGroupMessages(true);

        // 后台静默加载群成员和最新消息
        const membersResult = await this.fetchData(`/api/group/${groupId}/members`);
        if (membersResult.success) {
            this.currentGroupMembers = membersResult.members;
        }

        // 如果没有开启阅后即焚，才加载消息
        if (!shouldBurn) {
            this.loadGroupMessages(groupId).then(() => {
                this.renderGroupMessages(true); // 加载完成后滚动到底部
            });
        }
    }

    async loadGroupMessages(groupId) {
        if (this.burnAfterReadingGroupId === groupId) {
            return;
        }
        const result = await this.fetchData(`/api/group/${groupId}/messages`);
        if (result.success) {
            this.groupMessages[groupId] = result.messages;
        }
    }

    closeGroupChatView() {
        const shouldBurn = this.currentGroup && this.burnAfterReadingGroupId === this.currentGroup.id;
        if (shouldBurn) {
            const container = document.getElementById('group-messages-container');
            container.innerHTML = '<div class="empty-chat"><p>开始聊天吧！</p></div>';
            delete this.groupMessages[this.currentGroup.id];
        }
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
        burnToggle.checked = this.burnAfterReadingFriendId === this.currentFriend.id;

        document.getElementById('friend-info-modal').style.display = 'flex';
    }

    closeFriendInfoModal() {
        document.getElementById('friend-info-modal').style.display = 'none';
    }

    async deleteFriend() {
        if (!this.currentFriend) return;
        if (this.currentFriend.id === this.currentUser?.id) {
            alert('无法删除自己');
            return;
        }
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
            this.burnAfterReadingFriendId = this.currentFriend.id;
        } else {
            this.burnAfterReadingFriendId = null;
        }
        this.saveBurnAfterReadingSetting();
    }

    toggleGroupBurnAfterReading(e) {
        if (!this.currentGroup) return;

        if (e.target.checked) {
            this.burnAfterReadingGroupId = this.currentGroup.id;
        } else {
            this.burnAfterReadingGroupId = null;
        }
        this.saveBurnAfterReadingSetting();
    }

    renderGroupMessages(scrollToBottom = false) {
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

            const displayName = sender ? sender.username : (msg.senderName || '用户');
            const textColor = isMine ? 'white' : 'var(--text-primary)';
            
            let messageContent = '';
            if (msg.type === 'image') {
                messageContent = `<img src="${msg.content}" alt="" style="max-width: 200px; border-radius: 8px;">`;
            } else {
                messageContent = `<span style="color:${textColor};line-height:1.4;">${msg.content}</span>`;
            }
            
            return `
                <div class="message-item" style="display: flex; flex-direction: ${isMine ? 'row-reverse' : 'row'}; margin-bottom: 12px; padding: 0 12px;">
                    <div class="avatar-container" style="flex-shrink: 0; margin-top: 4px;">
                        ${avatarContent}
                    </div>
                    <div style="display: flex; flex-direction: column; align-items: ${isMine ? 'flex-end' : 'flex-start'}; max-width: 70%;">
                        <span style="font-size: 11px; color: #999; margin-bottom: 2px; padding: 0 4px;">${isMine ? '我' : displayName}</span>
                        <div style="background: ${isMine ? 'linear-gradient(135deg, var(--talk-blue), var(--talk-dark-blue))' : 'var(--white)'}; padding: 10px 14px; border-radius: ${isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px'}; box-shadow: var(--shadow-sm);">
                            ${messageContent}
                        </div>
                        <span style="font-size: 11px; color: #999; margin-top: 4px; padding: 0 4px;">${msg.time}</span>
                    </div>
                </div>
            `;
        }).join('');

        if (scrollToBottom) {
            container.scrollTop = container.scrollHeight;
        }
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
            this.renderGroupMessages(true); // 发送新消息后滚动到底部
        }
    }

    async handleGroupImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const base64Data = await this.compressImageToBase64(file);

            this.setButtonLoading('send-group-btn', true);
            const sendResult = await this.fetchData('/api/group/message', {
                method: 'POST',
                body: JSON.stringify({
                    groupId: this.currentGroup.id,
                    senderId: this.currentUser.id,
                    content: base64Data,
                    type: 'image'
                })
            });
            this.setButtonLoading('send-group-btn', false);

            if (sendResult.success) {
                if (!this.groupMessages[this.currentGroup.id]) {
                    this.groupMessages[this.currentGroup.id] = [];
                }
                this.groupMessages[this.currentGroup.id].push(sendResult.message);
                this.renderGroupMessages(true); // 发送新消息后滚动到底部
            } else {
                alert(sendResult.message || '发送图片失败');
            }
        } catch (error) {
            console.error('发送图片错误:', error);
            alert('发送失败');
        }

        // 清空文件输入
        e.target.value = '';
    }

    async handleGroupAvatarUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const compressedFile = await this.compressImageFile(file, 200, 800);

        const formData = new FormData();
        formData.append('avatar', compressedFile);
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

        // 设置阅后即焚开关状态
        const burnToggle = document.getElementById('group-burn-after-reading-toggle');
        burnToggle.checked = this.burnAfterReadingGroupId === this.currentGroup.id;

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
            
            // 立即显示主界面，提供即时反馈
            this.showMainScreen();
            
            // 先尝试使用本地缓存渲染（如果有）
            const cachedFriends = localStorage.getItem('cachedFriends');
            const cachedGroups = localStorage.getItem('cachedGroups');
            if (cachedFriends) {
                this.friends = JSON.parse(cachedFriends);
                this.renderChatList();
                this.renderContacts();
            }
            if (cachedGroups) {
                this.groups = JSON.parse(cachedGroups);
                if (this.friends.length > 0) {
                    this.renderChatList();
                }
                this.renderContacts();
            }
            
            // 后台并行验证用户和加载数据
            Promise.all([
                this.verifyUser().catch(err => {
                    console.error('Verification failed:', err);
                }),
                this.loadFriends().then(() => {
                    localStorage.setItem('cachedFriends', JSON.stringify(this.friends));
                }),
                this.loadGroups().then(() => {
                    localStorage.setItem('cachedGroups', JSON.stringify(this.groups));
                })
            ]).then(() => {
                this.renderChatList();
                this.renderContacts();
                
                // 消息在后台异步加载
                setTimeout(() => {
                    this.loadMessages();
                    this.startPolling();
                    this.startPasswordVersionCheck();
                }, 100);
            });
        }
    }
    
    async verifyUser() {
        try {
            const result = await this.fetchData('/api/verify', {
                method: 'POST',
                body: JSON.stringify({ userId: this.currentUser.id, passwordVersion: this.currentUser.password_version })
            });
            
            if (!result.success) {
                throw new Error(result.message || '登录状态已失效');
            }
        } catch (error) {
            localStorage.removeItem('currentUser');
            this.currentUser = null;
            this.showAuthScreen();
            alert(error.message || '登录状态已失效，请重新登录');
            throw error;
        }
    }

    startPasswordVersionCheck() {
        this.passwordCheckInterval = setInterval(async () => {
            if (!this.currentUser) return;
            
            try {
                const result = await this.fetchData('/api/verify', {
                    method: 'POST',
                    body: JSON.stringify({ userId: this.currentUser.id, passwordVersion: this.currentUser.password_version })
                });
                
                if (!result.success) {
                    this.stopPasswordVersionCheck();
                    this.logout();
                    alert('密码已被修改，请重新登录');
                }
            } catch (error) {
                // 忽略网络错误
            }
        }, 5000);
    }

    stopPasswordVersionCheck() {
        if (this.passwordCheckInterval) {
            clearInterval(this.passwordCheckInterval);
            this.passwordCheckInterval = null;
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
        document.getElementById('admin-panel-btn').addEventListener('click', () => window.location.href = '/admin');

        document.getElementById('upload-avatar-btn').addEventListener('click', () => {
            document.getElementById('avatar-upload-input').click();
        });
        document.getElementById('profile-avatar-container').addEventListener('click', () => {
            document.getElementById('avatar-upload-input').click();
        });
        document.getElementById('avatar-upload-input').addEventListener('change', (e) => this.handleAvatarUpload(e));

        document.getElementById('plus-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePlusMenu();
        });
        
        document.getElementById('plus-menu-album').addEventListener('click', () => {
            document.getElementById('image-upload-input').click();
            this.closePlusMenu();
        });
        
        document.getElementById('plus-menu-call').addEventListener('click', () => {
            this.initiateCall();
            this.closePlusMenu();
        });
        
        document.getElementById('image-upload-input').addEventListener('change', (e) => this.handleImageUpload(e));
        
        document.addEventListener('click', () => this.closePlusMenu());

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

        // 联系人列表事件委托
        document.getElementById('contacts-groups-section')?.addEventListener('click', (e) => {
            const item = e.target.closest('.contact-item[data-group-id]');
            if (item) {
                this.openGroupChat(item.dataset.groupId);
            }
        });
        document.getElementById('contacts-friends-section')?.addEventListener('click', (e) => {
            const item = e.target.closest('.contact-item[data-friend-id]');
            if (item) {
                this.openChat(item.dataset.friendId);
            }
        });
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

        this.setButtonLoading('login-form-submit-btn', true);
        document.getElementById('login-error').textContent = '';

        const result = await this.fetchData('/api/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });

        if (result.success) {
            this.currentUser = result.user;
            
            try {
                localStorage.setItem('currentUser', JSON.stringify(result.user));
            } catch (e) {
                this.cleanupLocalStorage();
            }

            if (result.friends) this.friends = result.friends;
            if (result.groups) this.groups = result.groups;

            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('main-screen').style.display = 'flex';
            
            this.updateProfileSkeleton();
            this.renderChatListUltraFast();
            this.renderContactsUltraFast();
            
            await this.loadMessagesFast();
            
            this.setButtonLoading('login-form-submit-btn', false);
            
            setTimeout(() => {
                this.lazyLoadAvatars();
            }, 100);
            
            setTimeout(() => {
                this.startPolling();
                this.startPasswordVersionCheck();
                this.loginSocket();
            }, 300);
        } else {
            this.setButtonLoading('login-form-submit-btn', false);
            document.getElementById('login-error').textContent = result.message || '登录失败';
        }
    }

    deferredSaveToStorage(key, value) {
        // 延迟写入localStorage，避免阻塞主线程
        setTimeout(() => {
            try {
                localStorage.setItem(key, value);
            } catch (e) {
                console.warn('LocalStorage save failed:', e);
                // 如果是配额错误，尝试清理旧数据
                if (e.name === 'QuotaExceededError') {
                    this.cleanupLocalStorage();
                    // 重试一次
                    try {
                        localStorage.setItem(key, value);
                    } catch (e2) {
                        console.warn('Retry failed:', e2);
                    }
                }
            }
        }, 0);
    }

    cleanupLocalStorage() {
        // 清理旧消息数据（保留最近的消息）
        try {
            const keysToKeep = ['currentUser', 'cachedFriends', 'cachedGroups'];
            const allKeys = Object.keys(localStorage);
            
            for (const key of allKeys) {
                if (!keysToKeep.includes(key)) {
                    try {
                        // 检查是否是旧消息数据
                        if (key.startsWith('messages-') || key.startsWith('groupMessages-')) {
                            // 可以考虑保留部分消息或直接删除旧数据
                            localStorage.removeItem(key);
                        }
                    } catch (e) {
                        console.warn('Failed to remove key:', key, e);
                    }
                }
            }
        } catch (e) {
            console.warn('Cleanup failed:', e);
        }
    }

    updateProfileSkeleton() {
        // 骨架屏版本：只更新文字，头像用首字母占位
        if (!this.currentUser) return;
        
        const avatarText = document.getElementById('profile-avatar');
        avatarText.textContent = this.currentUser.username.charAt(0).toUpperCase();
        avatarText.style.display = 'flex';
        
        const avatarImg = document.getElementById('profile-avatar-img');
        avatarImg.style.display = 'none';
        
        document.getElementById('profile-username').textContent = this.currentUser.username;
        
        const nicknameEl = document.getElementById('profile-nickname');
        if (this.currentUser.nickname) {
            nicknameEl.textContent = this.currentUser.nickname;
            nicknameEl.style.display = 'inline';
        } else {
            nicknameEl.style.display = 'none';
        }
    }

    async lazyLoadAvatars() {
        // 懒加载所有头像，使用压缩版本
        const avatarImgs = document.querySelectorAll('.avatar img');
        avatarImgs.forEach(img => {
            const src = img.getAttribute('src');
            if (src && !img.dataset.lazyLoaded) {
                img.dataset.lazyLoaded = 'true';
                // 使用图片压缩优化加载速度
                img.onload = () => {
                    this.compressImageIfNeeded(img);
                };
            }
        });
        
        // 延迟加载用户头像
        if (this.currentUser?.avatar) {
            setTimeout(() => {
                const profileImg = document.getElementById('profile-avatar-img');
                profileImg.onload = () => {
                    profileImg.style.display = 'block';
                    document.getElementById('profile-avatar').style.display = 'none';
                    this.compressImageIfNeeded(profileImg);
                };
                profileImg.src = this.currentUser.avatar;
            }, 200);
        }
    }

    compressImageIfNeeded(img) {
        // 如果图片过大，进行压缩
        if (!img.complete) return;
        
        const maxSizeKB = 100;
        const fileSize = (img.src.length * 0.75) / 1024; // 估算Base64大小
        
        if (fileSize > maxSizeKB && img.src.startsWith('data:')) {
            this.compressBase64Image(img.src, (compressedSrc) => {
                if (compressedSrc) {
                    img.src = compressedSrc;
                }
            });
        }
    }

    compressBase64Image(base64, callback) {
        try {
            const img = new Image();
            img.onload = () => {
                const maxWidth = 200;
                const maxHeight = 200;
                
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                if (height > maxHeight) {
                    width = (width * maxHeight) / height;
                    height = maxHeight;
                }
                
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                const compressed = canvas.toDataURL('image/jpeg', 0.8);
                callback(compressed);
            };
            img.onerror = () => callback(null);
            img.src = base64;
        } catch (e) {
            callback(null);
        }
    }

    async compressImageFile(file, maxSizeKB = 200, maxDimension = 1200) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let { width, height } = img;
                    const originalSizeKB = file.size / 1024;

                    if (originalSizeKB <= maxSizeKB && width <= maxDimension && height <= maxDimension) {
                        resolve(file);
                        return;
                    }

                    const ratio = Math.min(maxDimension / width, maxDimension / height, 1);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    let quality = 0.9;
                    let result = canvas.toDataURL('image/jpeg', quality);

                    while (result.length * 0.75 / 1024 > maxSizeKB && quality > 0.3) {
                        quality -= 0.1;
                        result = canvas.toDataURL('image/jpeg', quality);
                    }

                    const byteString = atob(result.split(',')[1]);
                    const mimeType = result.match(/data:(.*?);/)[1];
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) {
                        ia[i] = byteString.charCodeAt(i);
                    }
                    const compressedFile = new File([ab], file.name || 'image.jpg', { type: mimeType });

                    resolve(compressedFile);
                };
                img.onerror = () => resolve(file);
                img.src = e.target.result;
            };
            reader.onerror = () => resolve(file);
            reader.readAsDataURL(file);
        });
    }

    showAuthScreen() {
        document.getElementById('auth-screen').style.display = 'flex';
        document.getElementById('main-screen').style.display = 'none';
    }

    showMainScreen() {
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('main-screen').style.display = 'flex';
        this.updateProfile();
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

        if (username.length < 1) {
            document.getElementById('register-error').textContent = '用户名不能为空';
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
            
            // 立即显示界面
            this.showMainScreen();
            
            // 后台加载数据
            Promise.all([
                this.loadFriends().then(() => {
                    localStorage.setItem('cachedFriends', JSON.stringify(this.friends));
                }),
                this.loadGroups().then(() => {
                    localStorage.setItem('cachedGroups', JSON.stringify(this.groups));
                })
            ]).then(() => {
                this.renderChatList();
                this.renderContacts();
                this.loadMessages();
            });
            
            this.startPolling();
        } else {
            document.getElementById('register-error').textContent = result.message || '注册失败';
        }
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

        const tabContent = document.getElementById(`tab-${tab}`);
        if (tabContent) {
            tabContent.classList.add('active');
        }

        const pageTitle = document.getElementById('page-title');
        if (pageTitle) {
            const titles = {
                chats: 'Tell',
                contacts: '通讯录',
                discover: '发现',
                me: '我'
            };
            pageTitle.textContent = titles[tab] || 'Tell';
        }

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
            const groupHtml = this.groups.map(group => `
                <div class="contact-item" data-group-id="${group.id}">
                    <div class="avatar" style="background: linear-gradient(135deg, #667eea, #764ba2);">
                        ${group.avatar ? `<img src="${group.avatar}" alt="">` : '群'}
                    </div>
                    <span class="contact-name">${group.name || group.account}</span>
                </div>
            `).join('');
            groupList.innerHTML = groupHtml;
        } else {
            groupsSection.style.display = 'none';
            groupList.innerHTML = '';
        }

        if (this.friends.length > 0) {
            friendsSection.style.display = 'block';
            const friendHtml = this.friends.map(friend => `
                <div class="contact-item" data-friend-id="${friend.id}">
                    <div class="avatar" style="background: linear-gradient(135deg, var(--talk-blue), var(--talk-dark-blue));">
                        ${friend.avatar ? `<img src="${friend.avatar}" alt="">` : (friend.nickname || friend.username).charAt(0).toUpperCase()}
                    </div>
                    <span class="contact-name">${friend.nickname || friend.username}${friend.id === this.currentUser?.id ? ' (我)' : ''}</span>
                </div>
            `).join('');
            friendList.innerHTML = friendHtml;
        } else {
            friendsSection.style.display = 'none';
            friendList.innerHTML = '';
        }
    }

    renderChatList() {
        const chatList = document.getElementById('chat-list');
        
        if (this.groups.length === 0 && this.friends.length === 0) {
            chatList.innerHTML = '<div class="empty-state">暂无好友或群聊，请搜索添加</div>';
            return;
        }
        
        const chatItems = [];
        
        for (let i = 0; i < this.groups.length; i++) {
            const group = this.groups[i];
            const groupMsgs = this.groupMessages[group.id];
            const lastMsg = groupMsgs && groupMsgs.length ? groupMsgs[groupMsgs.length - 1] : null;
            const lastTimestamp = lastMsg && lastMsg.timestamp ? lastMsg.timestamp : 0;
            
            let avatarHtml = '';
            if (group.avatar && group.avatar.trim()) {
                avatarHtml = `<div style="width: 100%; height: 100%; border-radius: 50%; overflow: hidden;"><img src="${group.avatar}" alt="" style="width: 100%; height: 100%; object-fit: cover;"></div>`;
            } else {
                avatarHtml = `<div style="width: 100%; height: 100%; border-radius: 50%; background: linear-gradient(135deg, #667eea, #764ba2); color: white; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 500;">G</div>`;
            }
            
            chatItems.push({
                type: 'group',
                id: group.id,
                name: group.name,
                role: group.role,
                avatarHtml,
                lastMsg,
                lastTimestamp,
                isGroup: true
            });
        }
        
        for (let i = 0; i < this.friends.length; i++) {
            const friend = this.friends[i];
            const friendMsgs = this.messages[friend.id];
            const lastMsg = friendMsgs && friendMsgs.length ? friendMsgs[friendMsgs.length - 1] : null;
            const unread = this.getUnreadCount(friend.id);
            const lastTimestamp = lastMsg && lastMsg.timestamp ? lastMsg.timestamp : 0;
            
            let avatarHtml = '';
            if (friend.avatar && friend.avatar.trim()) {
                avatarHtml = `<div style="width: 100%; height: 100%; border-radius: 50%; overflow: hidden;"><img src="${friend.avatar}" alt="" style="width: 100%; height: 100%; object-fit: cover;"></div>`;
            } else {
                const initial = friend.username ? friend.username.charAt(0).toUpperCase() : '?';
                avatarHtml = `<div style="width: 100%; height: 100%; border-radius: 50%; background: var(--talk-blue); color: white; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 500;">${initial}</div>`;
            }
            
            chatItems.push({
                type: 'friend',
                id: friend.id,
                username: friend.username,
                avatarHtml,
                lastMsg,
                lastTimestamp,
                unread,
                isGroup: false
            });
        }
        
        chatItems.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
        
        let html = '';
        for (const item of chatItems) {
            if (item.isGroup) {
                html += `<div class="chat-item group-item" data-group-id="${item.id}" onclick="app.openGroupChat('${item.id}')">
                    <div class="avatar">${item.avatarHtml}</div>
                    <div class="chat-info">
                        <div class="chat-name">${item.name}${item.role === 'owner' ? ' (群主)' : ''}</div>
                        <div class="chat-preview">${item.lastMsg ? item.lastMsg.content : '暂无消息'}</div>
                    </div>
                    <div>${item.lastMsg ? `<div class="chat-time">${item.lastMsg.time}</div>` : ''}</div>
                </div>`;
            } else {
                html += `<div class="chat-item" data-friend-id="${item.id}" onclick="app.openChat('${item.id}')">
                    <div class="avatar">${item.avatarHtml}</div>
                    <div class="chat-info">
                        <div class="chat-name">${item.id === this.currentUser?.id ? item.username + ' (我)' : item.username}</div>
                        <div class="chat-preview">${item.lastMsg ? (item.lastMsg.type === 'image' ? '[图片]' : item.lastMsg.content) : '暂无消息'}</div>
                    </div>
                    <div>${item.lastMsg ? `<div class="chat-time">${item.lastMsg.time}</div>` : ''}${item.unread > 0 ? `<div class="unread-badge">${item.unread}</div>` : ''}</div>
                </div>`;
            }
        }
        
        chatList.innerHTML = html;
    }

    renderChatListFast() {
        const chatList = document.getElementById('chat-list');
        const groupsLen = this.groups.length;
        const friendsLen = this.friends.length;
        
        if (groupsLen === 0 && friendsLen === 0) {
            chatList.innerHTML = '<div class="empty-state">暂无好友或群聊，请搜索添加</div>';
            return;
        }

        const arr = [];
        const push = arr.push.bind(arr);

        for (let i = 0; i < groupsLen; i++) {
            const g = this.groups[i];
            const msgs = this.groupMessages[g.id];
            const lastMsg = msgs && msgs.length ? msgs[msgs.length - 1] : null;
            const avatar = g.avatar && g.avatar.trim() 
                ? `<div style="width:100%;height:100%;border-radius:50%;overflow:hidden;"><img src="${g.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
                : `<div style="width:100%;height:100%;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);color:white;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:500;">G</div>`;
            
            push(`<div class="chat-item group-item" data-group-id="${g.id}" onclick="app.openGroupChat('${g.id}')"><div class="avatar">${avatar}</div><div class="chat-info"><div class="chat-name">${g.name}${g.role === 'owner' ? ' (群主)' : ''}</div><div class="chat-preview">${lastMsg ? lastMsg.content : '暂无消息'}</div></div><div>${lastMsg ? `<div class="chat-time">${lastMsg.time}</div>` : ''}</div></div>`);
        }

        for (let i = 0; i < friendsLen; i++) {
            const f = this.friends[i];
            const msgs = this.messages[f.id];
            const lastMsg = msgs && msgs.length ? msgs[msgs.length - 1] : null;
            const unread = this.getUnreadCount(f.id);
            const initial = f.username ? f.username.charAt(0).toUpperCase() : '?';
            const avatar = f.avatar && f.avatar.trim()
                ? `<div style="width:100%;height:100%;border-radius:50%;overflow:hidden;"><img src="${f.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`
                : `<div style="width:100%;height:100%;border-radius:50%;background:var(--talk-blue);color:white;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:500;">${initial}</div>`;
            
            push(`<div class="chat-item" data-friend-id="${f.id}" onclick="app.openChat('${f.id}')"><div class="avatar">${avatar}</div><div class="chat-info"><div class="chat-name">${f.id === this.currentUser?.id ? f.username + ' (我)' : f.username}</div><div class="chat-preview">${lastMsg ? (lastMsg.type === 'image' ? '[图片]' : lastMsg.content) : '暂无消息'}</div></div><div>${lastMsg ? `<div class="chat-time">${lastMsg.time}</div>` : ''}${unread > 0 ? `<div class="unread-badge">${unread}</div>` : ''}</div></div>`);
        }

        chatList.innerHTML = arr.join('');
    }

    renderChatListUltraFast() {
        const chatList = document.getElementById('chat-list');
        const groups = this.groups;
        const friends = this.friends;
        const groupsLen = groups.length;
        const friendsLen = friends.length;
        const userId = this.currentUser?.id;
        
        if (groupsLen === 0 && friendsLen === 0) {
            chatList.innerHTML = '<div class="empty-state">暂无好友或群聊，请搜索添加</div>';
            return;
        }

        // 使用 DocumentFragment 批量 DOM 操作，比 innerHTML 更快
        const fragment = document.createDocumentFragment();
        
        // 缓存元素创建函数
        const createChatItem = (id, name, isGroup, role, avatar, isSelf) => {
            const div = document.createElement('div');
            div.className = isGroup ? 'chat-item group-item' : 'chat-item';
            div.dataset[isGroup ? 'groupId' : 'friendId'] = id;
            div.dataset.avatar = avatar || '';
            div.onclick = isGroup 
                ? () => this.openGroupChat(id) 
                : () => this.openChat(id);
            
            const avatarInitial = name ? name.charAt(0).toUpperCase() : (isGroup ? 'G' : '?');
            const avatarBg = isGroup 
                ? 'linear-gradient(135deg,#667eea,#764ba2)' 
                : 'var(--talk-blue)';
            
            div.innerHTML = `
                <div class="avatar"><div style="width:100%;height:100%;border-radius:50%;background:${avatarBg};color:white;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:500;">${avatarInitial}</div></div>
                <div class="chat-info">
                    <div class="chat-name">${name}${isGroup && role === 'owner' ? ' (群主)' : ''}${!isGroup && isSelf ? ' (我)' : ''}</div>
                    <div class="chat-preview">暂无消息</div>
                </div>
                <div></div>
            `;
            return div;
        };

        for (let i = 0; i < groupsLen; i++) {
            const g = groups[i];
            fragment.appendChild(createChatItem(g.id, g.name, true, g.role, g.avatar, false));
        }

        for (let i = 0; i < friendsLen; i++) {
            const f = friends[i];
            fragment.appendChild(createChatItem(f.id, f.username, false, null, f.avatar, f.id === userId));
        }

        // 清空并一次性插入
        chatList.innerHTML = '';
        chatList.appendChild(fragment);
    }

    renderContactsUltraFast() {
        const groupList = document.getElementById('contacts-group-list');
        const friendList = document.getElementById('contacts-friend-list');
        const groups = this.groups;
        const friends = this.friends;
        const groupsLen = groups.length;
        const friendsLen = friends.length;
        const userId = this.currentUser?.id;

        const createContactItem = (id, name, isGroup, avatar) => {
            const div = document.createElement('div');
            div.className = 'contact-item';
            div.dataset[isGroup ? 'groupId' : 'friendId'] = id;
            div.dataset.avatar = avatar || '';
            
            const initial = name ? name.charAt(0).toUpperCase() : (isGroup ? '群' : '?');
            const avatarBg = isGroup 
                ? 'linear-gradient(135deg,#667eea,#764ba2)' 
                : 'linear-gradient(135deg,var(--talk-blue),var(--talk-dark-blue))';
            
            div.innerHTML = `
                <div class="avatar" style="background:${avatarBg};">${initial}</div>
                <span class="contact-name">${name}</span>
            `;
            return div;
        };

        if (groupsLen > 0) {
            document.getElementById('contacts-groups-section').style.display = 'block';
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < groupsLen; i++) {
                const g = groups[i];
                fragment.appendChild(createContactItem(g.id, g.name || g.account, true, g.avatar));
            }
            groupList.innerHTML = '';
            groupList.appendChild(fragment);
        } else {
            document.getElementById('contacts-groups-section').style.display = 'none';
            groupList.innerHTML = '';
        }

        if (friendsLen > 0) {
            document.getElementById('contacts-friends-section').style.display = 'block';
            const fragment = document.createDocumentFragment();
            for (let i = 0; i < friendsLen; i++) {
                const f = friends[i];
                const name = (f.nickname || f.username) + (f.id === userId ? ' (我)' : '');
                fragment.appendChild(createContactItem(f.id, name, false, f.avatar));
            }
            friendList.innerHTML = '';
            friendList.appendChild(fragment);
        } else {
            document.getElementById('contacts-friends-section').style.display = 'none';
            friendList.innerHTML = '';
        }
    }

    renderContactsFast() {
        const groupsSection = document.getElementById('contacts-groups-section');
        const friendsSection = document.getElementById('contacts-friends-section');
        const groupList = document.getElementById('contacts-group-list');
        const friendList = document.getElementById('contacts-friend-list');
        const groupsLen = this.groups.length;
        const friendsLen = this.friends.length;

        if (groupsLen > 0) {
            groupsSection.style.display = 'block';
            const arr = [];
            const push = arr.push.bind(arr);
            for (let i = 0; i < groupsLen; i++) {
                const g = this.groups[i];
                push(`<div class="contact-item" data-group-id="${g.id}"><div class="avatar" style="background:linear-gradient(135deg,#667eea,#764ba2);">${g.avatar ? `<img src="${g.avatar}" alt="">` : '群'}</div><span class="contact-name">${g.name || g.account}</span></div>`);
            }
            groupList.innerHTML = arr.join('');
        } else {
            groupsSection.style.display = 'none';
            groupList.innerHTML = '';
        }

        if (friendsLen > 0) {
            friendsSection.style.display = 'block';
            const arr = [];
            const push = arr.push.bind(arr);
            const userId = this.currentUser?.id;
            for (let i = 0; i < friendsLen; i++) {
                const f = this.friends[i];
                const name = f.nickname || f.username;
                push(`<div class="contact-item" data-friend-id="${f.id}"><div class="avatar" style="background:linear-gradient(135deg,var(--talk-blue),var(--talk-dark-blue));">${f.avatar ? `<img src="${f.avatar}" alt="">` : name.charAt(0).toUpperCase()}</div><span class="contact-name">${name}${f.id === userId ? ' (我)' : ''}</span></div>`);
            }
            friendList.innerHTML = arr.join('');
        } else {
            friendsSection.style.display = 'none';
            friendList.innerHTML = '';
        }
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
                    <div class="chat-name">${friend.id === this.currentUser?.id ? friend.username + ' (我)' : friend.username}</div>
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
                if (this.burnAfterReadingFriendId === friend.id) {
                    continue;
                }
                this.messages[friend.id] = result.messages;
            }
        }

        for (const group of this.groups) {
            const result = await this.fetchData(`/api/group/${group.id}/messages`);
            if (result.success) {
                if (this.burnAfterReadingGroupId === group.id) {
                    continue;
                }
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

    async loadMessagesFast() {
        if (!this.currentUser) return;

        const loadPromises = [];
        
        for (const friend of this.friends) {
            if (this.burnAfterReadingFriendId !== friend.id) {
                loadPromises.push(
                    this.fetchData(`/api/messages/${this.currentUser.id}/${friend.id}`)
                        .then(result => {
                            if (result.success) {
                                this.messages[friend.id] = result.messages;
                            }
                        })
                );
            }
        }

        for (const group of this.groups) {
            if (this.burnAfterReadingGroupId !== group.id) {
                loadPromises.push(
                    this.fetchData(`/api/group/${group.id}/messages`)
                        .then(result => {
                            if (result.success) {
                                this.groupMessages[group.id] = result.messages;
                            }
                        })
                );
            }
        }

        await Promise.all(loadPromises);
        this.renderChatList();
    }

    async loadMessagesForFriend(friendId) {
        if (!this.currentUser) return;

        if (this.burnAfterReadingFriendId === friendId) {
            return;
        }

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
        
        const shouldBurn = this.burnAfterReadingFriendId === friendId;
        if (shouldBurn) {
            this.messages[friendId] = [];
        }
        
        this.renderMessages(true); // 第一次打开时滚动到底部
        this.markMessagesAsRead(friendId);
    }

    closeChatView() {
        const shouldBurn = this.currentFriend && this.burnAfterReadingFriendId === this.currentFriend.id;
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

    renderMessages(scrollToBottom = false) {
        const container = document.getElementById('messages-container');

        if (!this.currentFriend) {
            container.innerHTML = '<div class="empty-chat"><p>开始聊天吧！</p></div>';
            return;
        }

        const friendMessages = this.messages[this.currentFriend.id] || [];
        const len = friendMessages.length;

        if (len === 0) {
            container.innerHTML = '<div class="empty-chat"><p>开始聊天吧！</p></div>';
            return;
        }

        // 更快的字符串拼接方式
        const currentUserId = this.currentUser.id;
        const currentFriendAvatar = this.currentFriend.avatar;
        const currentFriendUsername = this.currentFriend.username;
        const currentUserAvatar = this.currentUser.avatar;
        const currentUserUsername = this.currentUser.username;
        
        let html = '';
        
        for (let i = 0; i < len; i++) {
            const msg = friendMessages[i];
            const isMine = msg.senderId === currentUserId;
            const sender = isMine ? this.currentUser : this.currentFriend;
            
            let avatarContent = '';
            if (sender) {
                if (sender.avatar && sender.avatar.trim() !== '') {
                    avatarContent = `<div style="width:40px;height:40px;border-radius:50%;overflow:hidden;flex-shrink:0;"><img src="${sender.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;"></div>`;
                } else {
                    avatarContent = `<div style="width:40px;height:40px;border-radius:50%;background:var(--talk-blue);color:white;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:500;flex-shrink:0;">${sender.username.charAt(0).toUpperCase()}</div>`;
                }
            }

            const direction = isMine ? 'row-reverse' : 'row';
            const alignItems = isMine ? 'flex-end' : 'flex-start';
            const bgColor = isMine ? 'linear-gradient(135deg,var(--talk-blue),var(--talk-dark-blue))' : 'var(--white)';
            const textColor = isMine ? 'white' : 'var(--text-primary)';
            const borderRadius = isMine ? '18px 18px 4px 18px' : '18px 18px 18px 4px';

            let messageContent = '';
            if (msg.type === 'image') {
                messageContent = `<img src="${msg.content}" alt="" style="max-width:200px;border-radius:8px;">`;
            } else {
                messageContent = `<span style="color:${textColor};line-height:1.4;">${msg.content}</span>`;
            }

            html += `<div class="message-item" style="display:flex;flex-direction:${direction};margin-bottom:12px;padding:0 12px;">` +
                `<div class="avatar-container" style="flex-shrink:0;margin-top:4px;">${avatarContent}</div>` +
                `<div style="display:flex;flex-direction:column;align-items:${alignItems};max-width:70%;">` +
                `<div style="background:${bgColor};padding:10px 14px;border-radius:${borderRadius};box-shadow:var(--shadow-sm);">${messageContent}</div>` +
                `<span style="font-size:11px;color:#999;margin-top:4px;padding:0 4px;">${msg.time}</span>` +
                `</div></div>`;
        }

        container.innerHTML = html;

        if (scrollToBottom) {
            container.scrollTop = container.scrollHeight;
        }
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
        this.closePlusMenu();
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
            this.renderMessages(true); // 发送新消息后滚动到底部
            this.renderChatList();
        }
    }

    // 头像上传
    async handleAvatarUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const compressedFile = await this.compressImageFile(file, 200, 800);

        const formData = new FormData();
        formData.append('avatar', compressedFile);
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

        try {
            const base64Data = await this.compressImageToBase64(file);

            const sendResult = await this.fetchData('/api/send-message', {
                method: 'POST',
                body: JSON.stringify({
                    senderId: this.currentUser.id,
                    receiverId: this.currentFriend.id,
                    content: base64Data,
                    type: 'image'
                })
            });

            if (sendResult.success) {
                if (!this.messages[this.currentFriend.id]) {
                    this.messages[this.currentFriend.id] = [];
                }
                this.messages[this.currentFriend.id].push(sendResult.message);
                this.renderMessages(true); // 发送新消息后滚动到底部
                this.renderChatList();
            } else {
                alert('发送失败: ' + (sendResult.message || '未知错误'));
            }
        } catch (error) {
            console.error('发送图片错误:', error);
            alert('发送失败');
        }

        e.target.value = '';
    }

    async compressImageToBase64(file, maxSizeKB = 80, maxDimension = 800) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    let { width, height } = img;
                    const originalSizeKB = file.size / 1024;

                    if (originalSizeKB <= maxSizeKB && width <= maxDimension && height <= maxDimension) {
                        resolve(e.target.result);
                        return;
                    }

                    const ratio = Math.min(maxDimension / width, maxDimension / height, 1);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    let quality = 0.9;
                    let result = canvas.toDataURL('image/jpeg', quality);

                    while (result.length * 0.75 / 1024 > maxSizeKB && quality > 0.3) {
                        quality -= 0.1;
                        result = canvas.toDataURL('image/jpeg', quality);
                    }

                    resolve(result);
                };
                img.onerror = () => reject(new Error('图片加载失败'));
                img.src = e.target.result;
            };
            reader.onerror = () => reject(new Error('文件读取失败'));
            reader.readAsDataURL(file);
        });
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
            this.stopPasswordVersionCheck();
            localStorage.removeItem('currentUser');
            localStorage.removeItem('cachedFriends');
            localStorage.removeItem('cachedGroups');
            localStorage.removeItem('burnAfterReading');
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
            searchPlaceholder: '搜索好友/群聊',
            add: '添加',
            messages: '消息',
            contacts: '通讯录',
            discover: '发现',
            me: '个人',
            shareApp: '分享应用',
            adminPanel: '后台管理',
            darkMode: '深色模式',
            language: '中文/English',
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
            appDesc: '倾听耳边语',
            copyright: '© 2026 Li Chengyan. All Rights Reserved.',
            addFriend: '添加好友',
            createGroup: '创建群聊',
            startGroupChat: '发起群聊',
            myGroups: '我的群聊',
            friendsList: '好友列表',
            tellIntro: 'Tell官方介绍',
            tellAnnouncement: 'Tell官方公告',
            contactDeveloper: '联系开发者',
            otherProjects: '其他项目'
        },
        en: {
            login: 'Login',
            register: 'Register',
            username: 'Username',
            password: 'Password',
            searchPlaceholder: 'Search friends/username',
            add: 'Add',
            messages: 'Messages',
            contacts: 'Contacts',
            discover: 'Discover',
            me: 'Me',
            shareApp: 'Share App',
            adminPanel: 'Admin Panel',
            darkMode: 'Dark Mode',
            language: 'English Mode',
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
            appDesc: 'Listen to whispers',
            copyright: '© 2026 Li Chengyan. All Rights Reserved.',
            addFriend: 'Add Friend',
            createGroup: 'Create Group',
            startGroupChat: 'Start Group Chat',
            myGroups: 'My Groups',
            friendsList: 'Friends List',
            tellIntro: 'Tell Official Intro',
            tellAnnouncement: 'Tell Announcement',
            contactDeveloper: 'Contact Developer',
            otherProjects: 'Other Projects'
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
        document.querySelector('[data-tab="contacts"] span:last-child').textContent = t.contacts;
        document.querySelector('[data-tab="discover"] span:last-child').textContent = t.discover;
        document.querySelector('[data-tab="me"] span:last-child').textContent = t.me;

        // 页面标题
        document.querySelector('#tab-chats .tab-header h2').textContent = t.messages;
        document.querySelector('#tab-contacts .tab-header h2').textContent = t.contacts;
        document.querySelector('#tab-discover .tab-header h2').textContent = t.discover;

        // 通讯录页
        document.querySelector('#contacts-add-friend-btn .contact-name').textContent = t.addFriend;
        document.querySelector('#contacts-create-group-btn .contact-name').textContent = t.createGroup;

        // 加号菜单 - 发起群聊
        document.querySelector('#create-group-menu-item span:last-child').textContent = t.startGroupChat;
        document.querySelector('#contacts-create-group-menu-item span:last-child').textContent = t.startGroupChat;


        // 通讯录分组标题
        const groupSectionTitle = document.querySelector('#contacts-groups-section .contacts-section-title');
        if (groupSectionTitle) {
            groupSectionTitle.textContent = '👥 ' + t.myGroups;
        }
        const friendSectionTitle = document.querySelector('#contacts-friends-section .contacts-section-title');
        if (friendSectionTitle) {
            friendSectionTitle.textContent = '👤 ' + t.friendsList;
        }

        // 发现页
        document.querySelector('#share-app-btn span:nth-child(2)').textContent = t.shareApp;
        document.querySelector('#admin-panel-btn span:nth-child(2)').textContent = t.adminPanel;
        document.querySelector('#tell-intro-btn span:nth-child(2)').textContent = t.tellIntro;
        document.querySelector('#tell-announcement-btn span:nth-child(2)').textContent = t.tellAnnouncement;
        document.querySelector('#contact-developer-btn span:nth-child(2)').textContent = t.contactDeveloper;
        document.querySelector('#other-projects-btn span:nth-child(2)').textContent = t.otherProjects;

        // 更新日志
        const updateTitle = document.querySelector('#update-header h3');
        if (updateTitle) {
            updateTitle.textContent = t.updateLog;
        }

        // 个人页
        document.querySelector('#change-username-btn .settings-item-left span').textContent = t.changeAccount;
        document.querySelector('#upload-avatar-btn .settings-item-left span').textContent = t.changeAvatar;
        document.querySelector('#change-password-btn .settings-item-left span').textContent = t.changePassword;
        document.querySelector('#toggle-theme-btn .settings-item-left span').textContent = t.darkMode;
        document.querySelector('#toggle-lang-btn .settings-item-left span').textContent = t.language;
        document.querySelector('#logout-btn .settings-item-left span').textContent = t.logout;

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
        document.querySelector('.footer-info p:first-child').textContent = 'Tell ' + APP_VERSION;
        document.querySelector('.copyright').textContent = t.copyright;

        // 版本信息
        document.querySelector('.version-info span:first-child').textContent = APP_VERSION;

        // 聊天输入框
        document.getElementById('message-input').placeholder = this.currentLang === 'zh' ? '输入消息...' : 'Type a message...';
        document.getElementById('send-btn').textContent = this.currentLang === 'zh' ? '发送' : 'Send';
    }
}

const app = new ChatApp();
