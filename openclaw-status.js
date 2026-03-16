// OpenClaw status monitor for the tamagotchi display
// Provides real-time status updates via status.json file

class OpenClawMonitor {
    constructor(options = {}) {
        this.statusFile = options.statusFile || 'status.json';
        this.pollInterval = options.pollInterval || 5000;
        this.onStatusChange = options.onStatusChange || (() => {});
        this.onActivity = options.onActivity || (() => {});
        
        this.state = {
            connected: false,
            state: 'idle',
            activity: 'Waiting for messages',
            subagent: null,
            sessions: 1
        };
    }
    
    async checkStatus() {
        try {
            const response = await fetch(this.statusFile + '?t=' + Date.now());
            if (!response.ok) throw new Error('Status file not found');
            
            const status = await response.json();
            
            // Update state
            Object.assign(this.state, status);
            this.state.connected = true;
            
            this.onStatusChange(this.state);
            
        } catch (error) {
            this.state.connected = false;
            this.state.state = 'idle';
            this.state.activity = 'Waiting for messages';
            this.state.subagent = null;
            
            this.onStatusChange(this.state);
        }
    }
    
    startMonitoring() {
        this.checkStatus();
        this.intervalId = setInterval(() => this.checkStatus(), this.pollInterval);
    }
    
    stopMonitoring() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
    
    getState() {
        return { ...this.state };
    }
}

// Helper to update status from external scripts (e.g., agent)
// Usage: updateOpenClawStatus({ state: 'working', activity: 'Running task', subagent: 'my-task' })
async function updateOpenClawStatus(status) {
    const current = {
        state: 'idle',
        activity: 'Waiting for messages',
        subagent: null,
        sessions: 1,
        lastUpdate: new Date().toISOString()
    };
    
    Object.assign(current, status);
    
    // Write to status.json via the serve.py endpoint or directly
    try {
        const response = await fetch('status.json', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(current)
        });
        return response.ok;
    } catch (error) {
        console.error('Failed to update status:', error);
        return false;
    }
}

// Export for use in index.html
if (typeof window !== 'undefined') {
    window.OpenClawMonitor = OpenClawMonitor;
    window.updateOpenClawStatus = updateOpenClawStatus;
}
