#!/usr/bin/env node
/**
 * Rich status from OpenClaw gateway for tamagotchi display
 * More generous timing to avoid showing "idle" too quickly
 * Includes emotional state computation for tamagotchi visualization
 */

const fs = require('fs');
const path = require('path');

/**
 * Compute emotional state from agent status metrics
 * Returns: { energy, mood, stress, engagement } all 0-100
 */
function computeEmotionalState(status) {
    // Energy: inverse of context usage (full context = tired)
    const energy = Math.max(0, Math.min(100, 100 - (status.contextPercent || 0)));
    
    // Mood: based on current state and recent activity
    // Working/thinking = positive, errors = negative, idle = neutral
    let mood = 50;
    if (status.state === 'working') mood = 75;
    else if (status.state === 'thinking') mood = 65;
    else if (status.state === 'error') mood = 20;
    else if (status.state === 'idle') {
        // Idle mood depends on how long idle
        const idleMinutes = (status.timeSinceUpdate || 0) / 60000;
        mood = idleMinutes > 30 ? 40 : 55; // Slightly sad if idle too long
    }
    
    // Stress: high context = stressed, errors = stressed
    let stress = 0;
    if (status.contextPercent > 70) stress += 40;
    else if (status.contextPercent > 50) stress += 20;
    if (status.state === 'error') stress += 50;
    // Multiple sessions can be stressful
    if ((status.sessions || 0) > 3) stress += 15;
    stress = Math.min(100, stress);
    
    // Engagement: based on recency of activity
    const minutesSinceActivity = (status.timeSinceUpdate || 0) / 60000;
    let engagement;
    if (minutesSinceActivity < 1) engagement = 100;
    else if (minutesSinceActivity < 5) engagement = 80;
    else if (minutesSinceActivity < 15) engagement = 60;
    else if (minutesSinceActivity < 30) engagement = 40;
    else if (minutesSinceActivity < 60) engagement = 20;
    else engagement = 10;
    
    return { energy, mood, stress, engagement };
}

/**
 * Derive visual state from emotional metrics
 * Returns one of: 'happy', 'neutral', 'sleepy', 'overwhelmed', 'frustrated', 'thinking'
 */
function deriveVisualState(emotional, currentState) {
    // If actively processing, show thinking
    if (currentState === 'working' || currentState === 'thinking') {
        return 'thinking';
    }
    
    // Overwhelmed: high stress OR very low energy
    if (emotional.stress > 70 || emotional.energy < 20) {
        return 'overwhelmed';
    }
    
    // Sleepy: low engagement (inactive for a while)
    if (emotional.engagement < 20) {
        return 'sleepy';
    }
    
    // Frustrated: low mood (errors or prolonged issues)
    if (emotional.mood < 30) {
        return 'frustrated';
    }
    
    // Happy: good mood AND low stress
    if (emotional.mood > 70 && emotional.stress < 30) {
        return 'happy';
    }
    
    // Default
    return 'neutral';
}

let token = '';
try {
    const configPath = path.join(process.env.HOME, '.openclaw/openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    token = config?.gateway?.auth?.token || '';
} catch (e) {}

const ws = new WebSocket('ws://localhost:18789', { headers: { 'Origin': 'http://localhost:8793' } });
let pending = 3, sessionData = null, usageData = null, previewData = null;

const timeout = setTimeout(() => {
    console.log(JSON.stringify({ state: 'error', activity: 'Connection timeout' }));
    process.exit(1);
}, 5000);

ws.onopen = () => {
    ws.send(JSON.stringify({
        type: 'req', id: 'c', method: 'connect',
        params: {
            minProtocol: 3, maxProtocol: 3,
            client: { id: 'webchat-ui', platform: 'linux', mode: 'ui', version: '1.0.0' },
            role: 'operator', scopes: ['operator.read'],
            auth: { token }
        }
    }));
};

ws.onmessage = (e) => {
    try {
        const msg = JSON.parse(e.data);
        
        if (msg.type === 'res' && msg.id === 'c' && msg.ok) {
            ws.send(JSON.stringify({ type: 'req', id: 's', method: 'sessions.list', params: {} }));
            ws.send(JSON.stringify({ type: 'req', id: 'u', method: 'usage.cost', params: {} }));
            ws.send(JSON.stringify({ type: 'req', id: 'p', method: 'sessions.preview', params: { keys: ['agent:main:main'] } }));
        }
        
        if (msg.type === 'res' && msg.id === 's') { sessionData = msg.ok ? msg.payload : null; pending--; }
        if (msg.type === 'res' && msg.id === 'u') { usageData = msg.ok ? msg.payload : null; pending--; }
        if (msg.type === 'res' && msg.id === 'p') { previewData = msg.ok ? msg.payload : null; pending--; }
        
        if (pending === 0) {
            clearTimeout(timeout);
            
            const main = sessionData?.sessions?.[0];
            const timeSince = Date.now() - (main?.updatedAt || 0);
            
            // Get last action from preview - detect tool and extract context
            let lastAction = null;
            const preview = previewData?.previews?.[0];
            if (preview?.items?.length > 0) {
                // Scan backwards through items
                for (let i = preview.items.length - 1; i >= 0; i--) {
                    const item = preview.items[i];
                    const text = item.text || '';
                    
                    // Skip if it's user/assistant message (not tool activity)
                    if (item.role === 'user' || item.role === 'assistant') continue;
                    
                    // Check for explicit "call X" tool markers
                    if (text.startsWith('call ')) {
                        const tool = text.replace('call ', '');
                        const nextText = preview.items[i + 1]?.text || '';
                        lastAction = formatToolAction(tool, nextText);
                        break;
                    }
                    
                    // Detect tool from content patterns (for tools without "call X")
                    const detected = detectFromContent(text);
                    if (detected) {
                        lastAction = detected;
                        break;
                    }
                }
            }
            
            function formatToolAction(tool, result) {
                const names = {
                    'exec': 'Running', 'read': 'Reading', 'write': 'Writing', 
                    'edit': 'Editing', 'web_search': 'Searching', 'web_fetch': 'Fetching',
                    'browser': 'Browsing', 'memory_search': 'Searching memory',
                    'memory_get': 'Reading memory', 'sessions_spawn': 'Spawning agent',
                    'cron': 'Managing reminder', 'message': 'Sending message',
                    'image': 'Analyzing image', 'tts': 'Generating speech'
                };
                let base = names[tool] || ('Using ' + tool);
                let detail = '';
                
                try {
                    if (tool === 'exec') {
                        // Try to get first meaningful line of output
                        const line = result.split('\n').find(l => l.trim() && !l.startsWith('{'));
                        if (line && line.length < 60) detail = line.trim();
                    } else if (tool === 'edit') {
                        const match = result.match(/in ([^\s]+\.[\w]+)/);
                        if (match) detail = match[1].split('/').pop();
                    } else if (tool === 'read') {
                        // Filename from path
                        const match = result.match(/reading ([^\s]+)/i);
                        if (match) detail = match[1].split('/').pop();
                    }
                } catch (e) {}
                
                if (detail) base += ': ' + detail;
                return base.length > 55 ? base.substring(0, 52) + '...' : base;
            }
            
            function detectFromContent(text) {
                // Skip our own status output
                if (text.startsWith('{"state"')) return null;
                
                // Web search results
                if (text.includes('"provider"') && text.includes('"query"')) {
                    const match = text.match(/"query":\s*"([^"]+)"/);
                    return 'Searched: ' + (match ? match[1].substring(0, 30) : 'web');
                }
                if (text.includes('"results"') && text.includes('"url"')) return 'Searching web';
                
                // HTML/code file content = reading
                if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) return 'Reading: HTML';
                if (text.startsWith('#!/usr/bin/env python')) return 'Reading: Python';
                if (text.startsWith('#!/usr/bin/env node')) return 'Reading: Node.js';
                if (text.startsWith('#!/')) return 'Reading: script';
                if (text.startsWith('const ') || text.startsWith('let ') || text.startsWith('function ')) return 'Reading: JavaScript';
                if (text.startsWith('import ') || text.startsWith('from ')) return 'Reading: code';
                if (text.startsWith('# ') && text.includes('\n##')) return 'Reading: Markdown';
                
                // Tool results
                if (text.startsWith('Successfully replaced')) {
                    const match = text.match(/in ([^\s]+)/);
                    return 'Edited: ' + (match ? match[1].split('/').pop() : 'file');
                }
                if (text.startsWith('Successfully wrote')) return 'Wrote file';
                
                // Memory operations
                if (text.includes('memory_search') || text.includes('MEMORY.md')) return 'Searching memory';
                
                // File paths list
                if (text.match(/^\/[\w\/-]+\.\w+$/m)) return 'Reading files';
                
                return null;
            }
            
            // More generous timing - assume active unless clearly idle
            let state = 'idle', activity = 'Waiting for messages';
            
            if (timeSince < 45000) {
                // Updated in last 45 seconds - definitely active
                state = 'working';
                activity = lastAction || 'Processing...';
            } else if (timeSince < 90000) {
                // Updated in last 90 seconds - probably still working
                state = 'thinking';
                activity = lastAction || 'Thinking...';
            } else if (timeSince < 300000) {
                // Updated in last 5 minutes - recently active
                state = 'idle';
                activity = 'Recently active';
            } else {
                state = 'idle';
                activity = 'Waiting for messages';
            }
            
            const contextPercent = Math.round(((main?.totalTokens || 0) / (main?.contextTokens || 200000)) * 100);
            
            // Build base status object
            const statusObj = {
                state, 
                activity,
                lastAction,
                sessions: sessionData?.count || 0,
                model: main?.model || sessionData?.defaults?.model || 'unknown',
                totalTokens: main?.totalTokens || 0,
                contextTokens: main?.contextTokens || sessionData?.defaults?.contextTokens || 200000,
                contextPercent,
                channel: main?.channel || main?.lastChannel || null,
                user: main?.origin?.label || null,
                updatedAt: main?.updatedAt || null,
                timeSinceUpdate: timeSince,
                todayCost: Math.round((usageData?.totals?.totalCost || 0) * 100) / 100,
                todayTokens: usageData?.totals?.totalTokens || 0,
                todayInput: usageData?.totals?.input || 0,
                todayOutput: usageData?.totals?.output || 0
            };
            
            // Compute emotional state from metrics
            const emotional = computeEmotionalState(statusObj);
            const visualState = deriveVisualState(emotional, state);
            
            // Add emotional state to output
            statusObj.emotional = emotional;
            statusObj.visualState = visualState;
            
            console.log(JSON.stringify(statusObj));
            ws.close();
            process.exit(0);
        }
    } catch (e) {}
};

ws.onerror = () => { 
    clearTimeout(timeout);
    console.log(JSON.stringify({ state: 'error', activity: 'Gateway unreachable' })); 
    process.exit(1); 
};
