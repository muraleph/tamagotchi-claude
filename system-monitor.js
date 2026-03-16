// System monitor for OpenClaw Tamagotchi display
// NOTE: Hardware stats are now fetched via the /stats endpoint in index.html

class SystemMonitor {
    constructor() {
        this.cpuUsage = 0;
        this.memoryUsage = 0;
        this.lastUpdateTime = new Date();
        this.uptimeStart = new Date();
        this.systemInfo = document.getElementById('system-info');
        
        // Start monitoring
        this.updateSystemInfo();
        setInterval(() => this.updateSystemInfo(), 30000);
    }
    
    formatUptime() {
        const now = new Date();
        const uptimeMs = now - this.uptimeStart;
        const hours = Math.floor(uptimeMs / (1000 * 60 * 60));
        const minutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
        
        return `${hours}h ${minutes}m`;
    }
    
    async updateSystemInfo() {
        try {
            this.lastUpdateTime = new Date();
            
            // Update the system info display
            if (this.systemInfo) {
                this.systemInfo.innerHTML = `OpenClaw | Uptime: ${this.formatUptime()}`;
            }
        } catch (error) {
            console.error('Error updating system info:', error);
        }
    }
}

// Initialize the system monitor when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.systemMonitor = new SystemMonitor();
});
