/**
 * OpenClaw Gateway WebSocket Client
 * Real-time status updates for Tamagotchi display
 * 
 * v2: Clean reconnection logic, no spam
 */

class OpenClawWebSocket {
    constructor(options = {}) {
        this.url = options.url || 'ws://localhost:18789';
        this.token = options.token || '';
        this.ws = null;
        this.connected = false;
        this.authenticated = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.baseReconnectDelay = 5000; // 5 seconds
        this.maxReconnectDelay = 60000; // Max 60 seconds
        this.heartbeatInterval = null;
        this.lastEventTime = Date.now();
        this.connectionTimeout = null;
        this.reconnectTimeout = null; // Track pending reconnect
        this.isReconnecting = false;  // Flag to prevent double reconnects
        
        // Callbacks
        this.onStatusChange = options.onStatusChange || (() => {});
        this.onSessionUpdate = options.onSessionUpdate || (() => {});
        this.onSubagentUpdate = options.onSubagentUpdate || (() => {});
        this.onMessageEvent = options.onMessageEvent || (() => {});
        this.onToolUse = options.onToolUse || (() => {});
        this.onConnectionChange = options.onConnectionChange || (() => {});
        this.onLog = options.onLog || console.log;
        this.onSystemEvent = options.onSystemEvent || (() => {});
        
        // State tracking
        this.state = {
            claudeState: 'idle',
            activity: 'Waiting for messages',
            sessions: 0,
            subagents: 0,
            subagentLabel: null,
            lastUser: null,
            messagesCount: 0,
            toolsUsed: []
        };
    }
    
    /**
     * Connect to the WebSocket server
     */
    connect() {
        // Prevent multiple simultaneous connection attempts
        if (this.isReconnecting) {
            this.onLog('⏳ Connection already in progress...');
            return;
        }
        
        if (this.ws) {
            const state = this.ws.readyState;
            if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) {
                this.onLog('✓ Already connected/connecting');
                return;
            }
            // Clean up old socket
            this.cleanup();
        }
        
        this.isReconnecting = true;
        this.onLog('🔌 Connecting to OpenClaw Gateway...');
        this.onConnectionChange('connecting');
        
        // Set connection timeout
        this.connectionTimeout = setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
                this.onLog('⚠️ Connection timeout');
                this.cleanup();
                this.scheduleReconnect();
            }
        }, 10000);
        
        try {
            this.ws = new WebSocket(this.url);
            this.setupEventHandlers();
        } catch (error) {
            this.onLog('❌ WebSocket connection failed: ' + error.message);
            this.isReconnecting = false;
            this.scheduleReconnect();
        }
    }
    
    /**
     * Clean up WebSocket resources
     */
    cleanup() {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
        this.stopHeartbeat();
        
        if (this.ws) {
            // Remove handlers to prevent callbacks during cleanup
            this.ws.onopen = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            
            if (this.ws.readyState === WebSocket.OPEN || 
                this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close(1000, 'Cleanup');
            }
            this.ws = null;
        }
        
        this.connected = false;
        this.authenticated = false;
    }
    
    /**
     * Setup WebSocket event handlers
     */
    setupEventHandlers() {
        this.ws.onopen = () => {
            clearTimeout(this.connectionTimeout);
            this.onLog('✅ WebSocket connected, sending handshake...');
            this.connected = true;
            this.isReconnecting = false;
            this.reconnectAttempts = 0;
            
            // Cancel any pending reconnect
            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout);
                this.reconnectTimeout = null;
            }
            
            this.onConnectionChange('connected');
            
            // Send connect request immediately (gateway expects it first)
            this.sendConnectRequest();
        };
        
        this.ws.onclose = (event) => {
            clearTimeout(this.connectionTimeout);
            const reason = event.reason || '';
            this.onLog(`🔌 WebSocket closed: ${event.code} ${reason.substring(0, 50)}`);
            
            this.connected = false;
            this.authenticated = false;
            this.isReconnecting = false;
            this.onConnectionChange('disconnected');
            this.stopHeartbeat();
            
            // Don't reconnect if intentionally closed
            if (event.code !== 1000) {
                this.scheduleReconnect();
            }
        };
        
        this.ws.onerror = (error) => {
            this.onLog('❌ WebSocket error');
            this.onConnectionChange('error');
            // Don't call scheduleReconnect here - onclose will be called
        };
        
        this.ws.onmessage = (event) => {
            this.lastEventTime = Date.now();
            this.handleMessage(event.data);
        };
    }
    
    /**
     * Handle incoming WebSocket message
     */
    handleMessage(data) {
        try {
            const msg = JSON.parse(data);
            
            switch (msg.type) {
                case 'event':
                    this.handleEvent(msg.event, msg.payload || msg.data);
                    break;
                    
                case 'error':
                    this.onLog('⚠️ Gateway error: ' + (msg.error || msg.message));
                    break;
                    
                case 'res':
                    if (msg.ok || msg.payload) {
                        if (msg.id && msg.id.startsWith('connect-')) {
                            this.authenticated = true;
                            this.onLog('🔐 Authenticated!');
                            this.onConnectionChange('authenticated');
                            this.startHeartbeat();
                            // Start polling session status
                            this.pollSessionStatus();
                            this.statusPollInterval = setInterval(() => this.pollSessionStatus(), 5000);
                        } else if (msg.id && msg.id.startsWith('sessions-')) {
                            // Handle sessions list response
                            console.log('[SESSIONS]', msg.payload);
                            this.handleSessionsResponse(msg.payload);
                        }
                    } else if (msg.error) {
                        this.onLog('⚠️ Request failed: ' + msg.error);
                    }
                    break;
                    
                case 'pong':
                    break;
                    
                default:
                    if (msg.event) {
                        this.handleEvent(msg.event, msg.payload || msg.data || msg);
                    }
            }
        } catch (error) {
            this.onLog('⚠️ Parse error: ' + error.message);
        }
    }
    
    /**
     * Handle gateway events - THIS IS WHERE THE FACE STATE CHANGES
     */
    handleEvent(eventType, payload = {}) {
        // Log ALL events for debugging
        console.log(`[WS EVENT] ${eventType}`, payload);
        this.onLog(`📡 Event: ${eventType}`);
        
        switch (eventType) {
            // Agent is thinking
            case 'agent.thinking':
            case 'agent.turn.start':
            case 'turn.start':
                this.updateState('thinking', 'Thinking...');
                break;
            
            // Agent is generating/responding
            case 'agent.generating':
            case 'agent.responding':
            case 'content.start':
            case 'content.delta':
                this.updateState('chatting', 'Responding...');
                break;
            
            // Tool use
            case 'tool.start':
            case 'tool.call':
            case 'tool_use.start':
                const toolName = payload?.name || payload?.tool || 'tool';
                this.updateState('working', `Using ${toolName}`);
                this.onToolUse('started', toolName, payload);
                break;
            
            case 'tool.end':
            case 'tool.result':
            case 'tool_use.end':
                this.onToolUse('completed', payload?.name || payload?.tool, payload);
                break;
            
            // Turn/response complete
            case 'agent.turn.end':
            case 'turn.end':
            case 'agent.idle':
            case 'content.end':
                this.updateState('idle', 'Waiting for messages');
                break;
            
            // Message events
            case 'message.user':
            case 'message.received':
            case 'chat.message':
                this.state.messagesCount++;
                const sender = payload?.from || payload?.author || 'User';
                this.updateState('chatting', `Message from ${sender}`);
                this.onMessageEvent('received', payload);
                break;
            
            case 'message.assistant':
            case 'message.sent':
                this.onMessageEvent('sent', payload);
                break;
            
            // Session events
            case 'session.start':
            case 'session.created':
                this.state.sessions++;
                this.onSessionUpdate(this.state.sessions);
                break;
            
            case 'session.end':
            case 'session.closed':
                this.state.sessions = Math.max(0, this.state.sessions - 1);
                this.onSessionUpdate(this.state.sessions);
                if (this.state.sessions === 0 && this.state.subagents === 0) {
                    this.updateState('idle', 'Waiting for messages');
                }
                break;
            
            // Subagent events
            case 'subagent.spawn':
            case 'subagent.start':
                this.state.subagents++;
                const label = payload?.label || payload?.task?.substring(0, 30) || 'Subagent';
                this.state.subagentLabel = label;
                this.updateState('working', `Subagent: ${label}`);
                this.onSubagentUpdate(this.state.subagents, label);
                break;
            
            case 'subagent.end':
            case 'subagent.complete':
                this.state.subagents = Math.max(0, this.state.subagents - 1);
                if (this.state.subagents === 0) {
                    this.state.subagentLabel = null;
                    this.updateState('idle', 'Waiting for messages');
                }
                this.onSubagentUpdate(this.state.subagents, this.state.subagentLabel);
                break;
                
            default:
                // Log unknown events for debugging
                if (!eventType.includes('heartbeat') && !eventType.includes('ping')) {
                    console.debug(`[WS] Unknown event: ${eventType}`, payload);
                }
        }
    }
    
    /**
     * Poll session status from gateway
     */
    pollSessionStatus() {
        const req = {
            type: 'req',
            id: 'sessions-' + Date.now(),
            method: 'sessions.list',
            params: {}
        };
        this.send(req);
    }
    
    /**
     * Handle session list response
     */
    handleSessionsResponse(payload) {
        if (!payload || !payload.sessions) return;
        
        const sessions = payload.sessions;
        const activeSessions = sessions.filter(s => s.status === 'active' || s.status === 'running');
        
        this.state.sessions = sessions.length;
        this.onSessionUpdate(sessions.length);
        
        // Check if any session is currently running (agent is active)
        const runningSession = sessions.find(s => s.status === 'running');
        
        if (runningSession) {
            // Agent is currently processing
            this.updateState('thinking', 'Processing...');
        } else if (activeSessions.length > 0) {
            // Sessions exist but not running
            const lastSession = activeSessions[0];
            if (lastSession.lastMessage) {
                const timeSince = Date.now() - new Date(lastSession.lastMessage.at).getTime();
                if (timeSince < 30000) {
                    // Recent activity
                    this.updateState('chatting', 'Just responded');
                } else {
                    this.updateState('idle', 'Waiting for messages');
                }
            }
        } else {
            this.updateState('idle', 'Waiting for messages');
        }
    }
    
    /**
     * Update state and notify callbacks
     */
    updateState(state, activity) {
        const changed = this.state.claudeState !== state || this.state.activity !== activity;
        
        this.state.claudeState = state;
        this.state.activity = activity;
        
        if (changed) {
            this.onLog(`🎭 State: ${state} - ${activity}`);
            this.onStatusChange(state, activity, this.state);
        }
    }
    
    /**
     * Send the initial connect request
     */
    sendConnectRequest() {
        const connectRequest = {
            type: 'req',
            id: 'connect-' + Date.now(),
            method: 'connect',
            params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                    id: 'webchat-ui',
                    platform: 'linux',
                    mode: 'ui',
                    version: '2.0.0'
                },
                role: 'operator',
                scopes: ['operator.read', 'operator.admin'],
                auth: {
                    token: this.token
                }
            }
        };
        
        this.onLog('📤 Sending connect request...');
        this.send(connectRequest);
    }
    
    /**
     * Send message to WebSocket
     */
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
            return true;
        }
        return false;
    }
    
    /**
     * Schedule reconnection with exponential backoff
     */
    scheduleReconnect() {
        // Don't schedule if already scheduled or max attempts reached
        if (this.reconnectTimeout) {
            return;
        }
        
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.onLog('❌ Max reconnection attempts reached, waiting 5 min...');
            this.onConnectionChange('failed');
            
            this.reconnectTimeout = setTimeout(() => {
                this.reconnectTimeout = null;
                this.reconnectAttempts = 0;
                this.connect();
            }, 300000);
            return;
        }
        
        this.reconnectAttempts++;
        
        const delay = Math.min(
            this.baseReconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );
        
        this.onLog(`🔄 Reconnecting in ${Math.round(delay/1000)}s (attempt ${this.reconnectAttempts})`);
        
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.isReconnecting = false;
            this.connect();
        }, delay);
    }
    
    /**
     * Start heartbeat
     */
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            if (Date.now() - this.lastEventTime > 45000) {
                this.send({ type: 'ping' });
            }
        }, 30000);
    }
    
    /**
     * Stop heartbeat
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
    
    /**
     * Disconnect
     */
    disconnect() {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.statusPollInterval) {
            clearInterval(this.statusPollInterval);
            this.statusPollInterval = null;
        }
        this.cleanup();
    }
    
    /**
     * Check if ready
     */
    isReady() {
        return this.connected && this.authenticated;
    }
    
    getState() {
        return { ...this.state };
    }
}

// Export
if (typeof window !== 'undefined') {
    window.OpenClawWebSocket = OpenClawWebSocket;
}
