#!/usr/bin/env python3
"""
Simple HTTP server for the OpenClaw Tamagotchi Display
Serves static files from the canvas directory on port 8793
Includes /stats endpoint for real-time hardware monitoring
"""

import http.server
import socketserver
import os
import sys
import signal
import json
import time

PORT = 8793
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
OPENCLAW_CONFIG_PATH = os.path.expanduser('~/.openclaw/openclaw.json')

def get_openclaw_config():
    """Load OpenClaw configuration"""
    try:
        with open(OPENCLAW_CONFIG_PATH, 'r') as f:
            return json.load(f)
    except Exception:
        return {}

def get_ws_token():
    """Get WebSocket auth token from OpenClaw config"""
    config = get_openclaw_config()
    return config.get('gateway', {}).get('auth', {}).get('token', '')

# CPU tracking for usage calculation
last_cpu_times = None
last_cpu_check = 0

def get_cpu_usage():
    """Get CPU usage percentage from /proc/stat"""
    global last_cpu_times, last_cpu_check
    
    try:
        with open('/proc/stat', 'r') as f:
            line = f.readline()
        
        parts = line.split()
        # cpu user nice system idle iowait irq softirq steal guest guest_nice
        if parts[0] == 'cpu':
            times = [int(x) for x in parts[1:8]]
            idle = times[3]
            total = sum(times)
            
            if last_cpu_times is None:
                last_cpu_times = (idle, total)
                last_cpu_check = time.time()
                return 0
            
            last_idle, last_total = last_cpu_times
            idle_delta = idle - last_idle
            total_delta = total - last_total
            
            last_cpu_times = (idle, total)
            last_cpu_check = time.time()
            
            if total_delta == 0:
                return 0
            
            usage = 100 * (1 - idle_delta / total_delta)
            return round(max(0, min(100, usage)), 1)
    except Exception as e:
        print(f"CPU error: {e}")
        return 0

def get_memory_usage():
    """Get memory usage from /proc/meminfo"""
    try:
        meminfo = {}
        with open('/proc/meminfo', 'r') as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    key = parts[0].rstrip(':')
                    value = int(parts[1])  # in kB
                    meminfo[key] = value
        
        total_kb = meminfo.get('MemTotal', 0)
        available_kb = meminfo.get('MemAvailable', meminfo.get('MemFree', 0))
        used_kb = total_kb - available_kb
        
        # Convert to GB
        total_gb = round(total_kb / 1024 / 1024, 1)
        used_gb = round(used_kb / 1024 / 1024, 1)
        
        return {
            'used': used_gb,
            'total': total_gb,
            'percent': round(100 * used_kb / total_kb, 1) if total_kb > 0 else 0
        }
    except Exception as e:
        print(f"Memory error: {e}")
        return {'used': 0, 'total': 0, 'percent': 0}

def get_disk_usage(path='/'):
    """Get disk usage from os.statvfs"""
    try:
        stat = os.statvfs(path)
        
        # Calculate sizes in bytes, then convert to GB
        total_bytes = stat.f_blocks * stat.f_frsize
        free_bytes = stat.f_bavail * stat.f_frsize
        used_bytes = total_bytes - free_bytes
        
        total_gb = round(total_bytes / 1024 / 1024 / 1024, 1)
        used_gb = round(used_bytes / 1024 / 1024 / 1024, 1)
        
        return {
            'used': used_gb,
            'total': total_gb,
            'percent': round(100 * used_bytes / total_bytes, 1) if total_bytes > 0 else 0
        }
    except Exception as e:
        print(f"Disk error: {e}")
        return {'used': 0, 'total': 0, 'percent': 0}

class TamagotchiHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler with CORS support, /stats endpoint, status updates, and quiet logging"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    
    def end_headers(self):
        # Add CORS headers for API calls
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    
    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_PUT(self):
        """Handle PUT requests for status.json updates"""
        if self.path == '/status.json':
            self.update_status()
            return
        
        self.send_response(405)
        self.end_headers()
    
    def update_status(self):
        """Update status.json file"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            
            # Validate JSON
            status = json.loads(body.decode('utf-8'))
            
            # Write to file
            status_path = os.path.join(DIRECTORY, 'status.json')
            with open(status_path, 'w') as f:
                json.dump(status, f, indent=2)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok": true}')
            
        except Exception as e:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
    
    def do_POST(self):
        """Handle POST requests"""
        if self.path == '/update-status':
            self.handle_status_update()
            return
        
        self.send_response(405)
        self.end_headers()
    
    def handle_status_update(self):
        """Handle status update from WebSocket client"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            
            # Validate JSON
            status = json.loads(body.decode('utf-8'))
            
            # Write to status.json
            status_path = os.path.join(DIRECTORY, 'status.json')
            with open(status_path, 'w') as f:
                json.dump(status, f, indent=2)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"ok": true}')
            
        except Exception as e:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
    
    def do_GET(self):
        # Handle /stats endpoint
        if self.path == '/stats':
            self.send_stats()
            return
        
        # Handle /config endpoint (WebSocket configuration)
        if self.path == '/config':
            self.send_config()
            return
        
        # Handle /agent-status endpoint (live OpenClaw status)
        if self.path == '/agent-status':
            self.send_agent_status()
            return
        
        # Handle /schedule endpoint (scheduled jobs)
        if self.path == '/schedule' or self.path.startswith('/schedule?'):
            self.send_schedule()
            return
        
        # Handle /api/commits endpoint (git history)
        if self.path == '/api/commits':
            self.send_commits()
            return
        
        # Handle /api/skills endpoint (installed skills)
        if self.path == '/api/skills':
            self.send_skills()
            return
        
        # Handle /api/highlights endpoint (today's achievements)
        if self.path == '/api/highlights':
            self.send_highlights()
            return
        
        # Handle /api/gallery endpoint (art gallery)
        if self.path == '/api/gallery':
            self.send_gallery()
            return
        
        # Handle /api/wip endpoint (work in progress art)
        if self.path == '/api/wip':
            self.send_wip()
            return
        
        # Handle /api/subagents endpoint (running sub-agents)
        if self.path == '/api/subagents':
            self.send_subagents()
            return
            return
        
        # Handle /api/network endpoint (IP addresses)
        if self.path == '/api/network':
            self.send_network()
            return
        
        # Handle /api/battery endpoint (power status)
        if self.path == '/api/battery':
            self.send_battery()
            return
        
        # Handle /api/moltbook endpoint (moltbook stats)
        if self.path == '/api/moltbook':
            self.send_moltbook()
            return
        
        # Handle /api/health endpoint (system health check)
        if self.path == '/api/health':
            self.send_health()
            return
        
        # Handle /api/version endpoint (hot reload)
        if self.path == '/api/version':
            self.send_version()
            return
        
        # Serve static files for everything else
        super().do_GET()
    
    def send_agent_status(self):
        """Get live agent status from OpenClaw gateway"""
        import subprocess
        
        try:
            # Run the Node script to get status
            script_path = os.path.join(DIRECTORY, 'get-status.js')
            result = subprocess.run(
                ['node', script_path],
                capture_output=True,
                text=True,
                timeout=6
            )
            
            if result.returncode == 0 and result.stdout:
                response = result.stdout.strip().encode('utf-8')
            else:
                response = json.dumps({
                    'state': 'error',
                    'activity': 'Failed to get status'
                }).encode('utf-8')
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except subprocess.TimeoutExpired:
            response = json.dumps({
                'state': 'timeout',
                'activity': 'Status check timed out'
            }).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            response = json.dumps({
                'state': 'error',
                'activity': str(e)
            }).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
    
    def send_schedule(self):
        """Get scheduled jobs from cached file"""
        try:
            schedule_path = os.path.join(DIRECTORY, 'schedule.json')
            if os.path.exists(schedule_path):
                with open(schedule_path, 'r') as f:
                    response = f.read().encode('utf-8')
            else:
                response = json.dumps({'jobs': [], 'error': 'Schedule not yet loaded'}).encode('utf-8')
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            response = json.dumps({'jobs': [], 'error': str(e)}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
    
    def send_commits(self):
        """Get git commits from workspace"""
        import subprocess
        
        try:
            workspace = os.path.expanduser('~/.openclaw/workspace')
            result = subprocess.run(
                ['git', 'log', '--oneline', '--format=%h|%s|%ar', '-20'],
                capture_output=True,
                text=True,
                cwd=workspace,
                timeout=5
            )
            
            commits = []
            if result.returncode == 0 and result.stdout:
                for line in result.stdout.strip().split('\n'):
                    if '|' in line:
                        parts = line.split('|', 2)
                        if len(parts) >= 2:
                            commits.append({
                                'hash': parts[0],
                                'message': parts[1],
                                'time': parts[2] if len(parts) > 2 else ''
                            })
            
            response = json.dumps({'commits': commits}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            response = json.dumps({'commits': [], 'error': str(e)}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
    
    def send_skills(self):
        """Get installed skills from workspace"""
        try:
            skills_dir = os.path.expanduser('~/.openclaw/workspace/skills')
            skills = []
            
            skill_meta = {
                'telegram': 'Telegram Bot integration',
                'weather': 'Weather forecasts',
                'memory-lite': 'Lightweight memory management',
                'set-reminder': 'Cron-based reminders',
                'self-reflection': 'Track mistakes & lessons',
                'byterover': 'Project knowledge base',
                'proactive-agent': 'Proactive partner patterns',
                'daily-schedule': 'Daily routine management'
            }
            
            if os.path.isdir(skills_dir):
                for name in sorted(os.listdir(skills_dir)):
                    skill_path = os.path.join(skills_dir, name)
                    if os.path.isdir(skill_path) and not name.startswith('.'):
                        skills.append({
                            'name': name,
                            'desc': skill_meta.get(name, '')
                        })
            
            response = json.dumps({'skills': skills}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            response = json.dumps({'skills': [], 'error': str(e)}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
    
    def send_battery(self):
        """Get battery/power status"""
        import subprocess
        
        try:
            result = {
                'hasBattery': False,
                'percentage': None,
                'state': 'unknown',
                'timeToFull': None,
                'timeToEmpty': None
            }
            
            # Try reading from /sys first (faster)
            try:
                bat_path = '/sys/class/power_supply/BAT0'
                if not os.path.exists(bat_path):
                    bat_path = '/sys/class/power_supply/BAT1'
                
                if os.path.exists(bat_path):
                    result['hasBattery'] = True
                    
                    with open(f'{bat_path}/capacity', 'r') as f:
                        result['percentage'] = int(f.read().strip())
                    
                    with open(f'{bat_path}/status', 'r') as f:
                        result['state'] = f.read().strip().lower()
            except:
                pass
            
            # Fallback to upower for more details
            if not result['hasBattery']:
                try:
                    up_result = subprocess.run(
                        ['upower', '-i', '/org/freedesktop/UPower/devices/battery_BAT0'],
                        capture_output=True, text=True, timeout=3
                    )
                    if up_result.returncode == 0:
                        result['hasBattery'] = True
                        for line in up_result.stdout.split('\n'):
                            if 'percentage:' in line:
                                result['percentage'] = int(line.split(':')[1].strip().replace('%', ''))
                            elif 'state:' in line:
                                result['state'] = line.split(':')[1].strip().lower()
                            elif 'time to full:' in line:
                                result['timeToFull'] = line.split(':')[1].strip()
                            elif 'time to empty:' in line:
                                result['timeToEmpty'] = line.split(':')[1].strip()
                except:
                    pass
            
            response = json.dumps(result).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            response = json.dumps({'hasBattery': False, 'error': str(e)}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
    
    # Moltbook cache
    _moltbook_cache = None
    _moltbook_cache_time = 0
    
    def send_moltbook(self):
        """Get Moltbook stats and recent posts (cached 5 min)"""
        import urllib.request
        import urllib.error
        
        cache_ttl = 300  # 5 minutes
        now = time.time()
        
        # Check cache
        if (TamagotchiHandler._moltbook_cache and 
            now - TamagotchiHandler._moltbook_cache_time < cache_ttl):
            response = json.dumps(TamagotchiHandler._moltbook_cache).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            return
        
        api_key = os.environ.get('MOLTBOOK_API_KEY', '')
        headers = {'Authorization': f'Bearer {api_key}'}
        
        result = {
            'karma': 0,
            'postCount': 0,
            'latestPost': None,
            'error': None
        }
        
        try:
            # Fetch agent stats
            req = urllib.request.Request(
                'https://www.moltbook.com/api/v1/agents/me',
                headers=headers
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                result['karma'] = data.get('karma', 0)
                result['postCount'] = data.get('postCount', data.get('post_count', 0))
        except Exception as e:
            result['error'] = f'Stats: {str(e)}'
        
        try:
            # Fetch recent posts
            req = urllib.request.Request(
                'https://www.moltbook.com/api/v1/agents/me/posts',
                headers=headers
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                posts = data.get('posts', data if isinstance(data, list) else [])
                if posts:
                    result['postCount'] = result['postCount'] or len(posts)
                    latest = posts[0] if posts else None
                    if latest:
                        result['latestPost'] = {
                            'title': latest.get('title', latest.get('content', '')[:50]),
                            'id': latest.get('id')
                        }
        except Exception as e:
            if result['error']:
                result['error'] += f'; Posts: {str(e)}'
            else:
                result['error'] = f'Posts: {str(e)}'
        
        # Update cache
        TamagotchiHandler._moltbook_cache = result
        TamagotchiHandler._moltbook_cache_time = now
        
        response = json.dumps(result).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(response))
        self.end_headers()
        self.wfile.write(response)
    
    def send_health(self):
        """Run system health check"""
        import subprocess
        
        try:
            script_path = os.path.expanduser('~/.openclaw/workspace/scripts/health-check.sh')
            # Set SKIP_TAMAGOTCHI_CHECK to avoid deadlock (we're single-threaded, 
            # can't respond to /stats while waiting for this subprocess)
            env = os.environ.copy()
            env['SKIP_TAMAGOTCHI_CHECK'] = '1'
            result = subprocess.run(
                [script_path],
                capture_output=True,
                text=True,
                timeout=10,
                env=env
            )
            
            # Parse output - remove ANSI codes
            import re
            output = re.sub(r'\x1b\[[0-9;]*m', '', result.stdout + result.stderr)
            lines = [l.strip() for l in output.strip().split('\n') if l.strip()]
            
            status = 'healthy' if result.returncode == 0 else ('warning' if result.returncode == 1 else 'critical')
            
            response = json.dumps({
                'status': status,
                'issues': lines,
                'exitCode': result.returncode
            }).encode('utf-8')
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            response = json.dumps({'status': 'error', 'issues': [str(e)]}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
    
    def send_version(self):
        """Return version from .version file (updated by git post-commit hook)"""
        try:
            # Read version from .version file - only changes on git commit
            version_file = os.path.join(DIRECTORY, '.version')
            if os.path.exists(version_file):
                with open(version_file, 'r') as f:
                    version = f.read().strip()
            else:
                version = '0'
            response = json.dumps({'version': version}).encode('utf-8')
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            response = json.dumps({'version': 'error', 'error': str(e)}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
    
    def send_network(self):
        """Get local and external IP addresses"""
        import subprocess
        import socket
        
        try:
            # Get local IP
            local_ip = '?.?.?.?'
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.connect(("8.8.8.8", 80))
                local_ip = s.getsockname()[0]
                s.close()
            except:
                pass
            
            # Get external IP (cached for 5 minutes)
            external_ip = '?.?.?.?'
            cache_file = '/tmp/external_ip_cache'
            cache_valid = False
            
            try:
                if os.path.exists(cache_file):
                    mtime = os.path.getmtime(cache_file)
                    if time.time() - mtime < 300:  # 5 min cache
                        with open(cache_file, 'r') as f:
                            external_ip = f.read().strip()
                            cache_valid = True
                
                if not cache_valid:
                    result = subprocess.run(
                        ['curl', '-4', '-s', '--max-time', '3', 'ifconfig.me'],
                        capture_output=True, text=True, timeout=5
                    )
                    if result.returncode == 0 and result.stdout.strip():
                        external_ip = result.stdout.strip()
                        with open(cache_file, 'w') as f:
                            f.write(external_ip)
            except:
                pass
            
            response = json.dumps({
                'local': local_ip,
                'external': external_ip
            }).encode('utf-8')
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            response = json.dumps({'local': '?', 'external': '?', 'error': str(e)}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
    
    def send_gallery(self):
        """Get art from gallery folder"""
        import re
        
        try:
            art_dir = os.path.expanduser('~/.openclaw/workspace/art')
            art_list = []
            
            if os.path.isdir(art_dir):
                for filename in sorted(os.listdir(art_dir), reverse=True):
                    filepath = os.path.join(art_dir, filename)
                    if os.path.isfile(filepath):
                        # Parse filename: YYYY-MM-DD-HHMM-type.md
                        match = re.match(r'(\d{4}-\d{2}-\d{2})-(\d{4})-(\w+)', filename)
                        if match:
                            date_str = match.group(1)
                            time_str = match.group(2)
                            art_type = match.group(3)
                        else:
                            date_str = filename[:10] if len(filename) > 10 else 'Unknown'
                            art_type = 'unknown'
                        
                        try:
                            with open(filepath, 'r') as f:
                                content = f.read()
                            
                            art_list.append({
                                'filename': filename,
                                'type': art_type,
                                'date': date_str,
                                'content': content[:5000]  # Limit content size
                            })
                        except:
                            pass
            
            response = json.dumps({'art': art_list[:50]}).encode('utf-8')  # Limit to 50 pieces
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            response = json.dumps({'art': [], 'error': str(e)}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
    
    def send_wip(self):
        """Get current work-in-progress art"""
        try:
            wip_path = os.path.expanduser('~/.openclaw/workspace/skills/art/wip.json')
            
            if os.path.exists(wip_path):
                with open(wip_path, 'r') as f:
                    wip_data = json.load(f)
                
                if wip_data and wip_data.get('content'):
                    response = json.dumps({
                        'hasWip': True,
                        'type': wip_data.get('type', 'unknown'),
                        'iterations': wip_data.get('iterations', 1),
                        'content': wip_data.get('content', '')[:3000],  # Limit size
                        'startedAt': wip_data.get('started_at')
                    }).encode('utf-8')
                else:
                    response = json.dumps({'hasWip': False}).encode('utf-8')
            else:
                response = json.dumps({'hasWip': False}).encode('utf-8')
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            response = json.dumps({'hasWip': False, 'error': str(e)}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
    
    def send_subagents(self):
        """Get active sub-agent sessions from gateway"""
        import subprocess
        
        try:
            # Use Node to query gateway for sub-agents
            script = '''
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

let token = '';
try {
    const config = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.openclaw/openclaw.json')));
    token = config?.gateway?.auth?.token || '';
} catch (e) {}

const ws = new WebSocket('ws://localhost:18789');
const timeout = setTimeout(() => { console.log('[]'); process.exit(0); }, 3000);

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
    const msg = JSON.parse(e.data);
    if (msg.type === 'res' && msg.id === 'c' && msg.ok) {
        ws.send(JSON.stringify({ type: 'req', id: 's', method: 'sessions.list', params: {} }));
    }
    if (msg.type === 'res' && msg.id === 's') {
        clearTimeout(timeout);
        const sessions = msg.payload?.sessions || [];
        const subagents = sessions
            .filter(s => s.key?.includes(':subagent:'))
            .map(s => ({
                label: s.label || s.key.split(':').pop().slice(0, 8),
                tokens: s.totalTokens || 0,
                active: (Date.now() - (s.updatedAt || 0)) < 60000
            }));
        console.log(JSON.stringify(subagents));
        ws.close();
        process.exit(0);
    }
};
ws.onerror = () => { console.log('[]'); process.exit(0); };
'''
            result = subprocess.run(
                ['node', '-e', script],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0 and result.stdout.strip():
                response = result.stdout.strip().encode('utf-8')
            else:
                response = b'[]'
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            response = json.dumps([]).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
    
    def send_highlights(self):
        """Get today's highlights from memory"""
        import re
        from datetime import date
        
        try:
            today = date.today().strftime('%Y-%m-%d')
            memory_file = os.path.expanduser(f'~/.openclaw/workspace/memory/{today}.md')
            
            highlights = []
            
            if os.path.exists(memory_file):
                with open(memory_file, 'r') as f:
                    content = f.read()
                
                # Extract bullet points that look like achievements
                lines = content.split('\n')
                for line in lines:
                    line = line.strip()
                    if line.startswith('- ') and len(line) > 10:
                        # Skip meta/heading lines
                        if not any(x in line.lower() for x in ['##', 'memory', 'note:', 'todo:']):
                            highlights.append(line[2:])  # Remove "- "
            
            # Add some defaults if empty
            if not highlights:
                highlights = ['Built "What I Built" dashboard']
            
            response = json.dumps({'highlights': highlights[:10]}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            response = json.dumps({'highlights': [], 'error': str(e)}).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
    
    def send_config(self):
        """Send WebSocket configuration (token for auth)"""
        config = {
            'wsUrl': 'ws://localhost:18789',
            'wsToken': get_ws_token(),
            'pollInterval': 5000,
            'version': '1.0.0'
        }
        
        response = json.dumps(config).encode('utf-8')
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(response))
        self.end_headers()
        self.wfile.write(response)
    
    def send_stats(self):
        """Send hardware stats as JSON"""
        cpu = get_cpu_usage()
        mem = get_memory_usage()
        disk = get_disk_usage('/')
        
        stats = {
            'cpu': cpu,
            'ram_used': mem['used'],
            'ram_total': mem['total'],
            'ram_percent': mem['percent'],
            'disk_used': disk['used'],
            'disk_total': disk['total'],
            'disk_percent': disk['percent'],
            'timestamp': int(time.time() * 1000)
        }
        
        response = json.dumps(stats).encode('utf-8')
        
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(response))
        self.end_headers()
        self.wfile.write(response)
    
    def log_message(self, format, *args):
        # Only log errors, not every request
        if args[1].startswith('4') or args[1].startswith('5'):
            super().log_message(format, *args)

def signal_handler(sig, frame):
    print("\nShutting down server...")
    sys.exit(0)

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    os.chdir(DIRECTORY)
    
    with ReusableTCPServer(("", PORT), TamagotchiHandler) as httpd:
        print(f"🎮 Tamagotchi Display Server running at http://localhost:{PORT}")
        print(f"   Serving files from: {DIRECTORY}")
        print(f"   Hardware stats at: http://localhost:{PORT}/stats")
        print(f"   WebSocket config at: http://localhost:{PORT}/config")
        print(f"   WebSocket: ws://localhost:18789")
        print("   Press Ctrl+C to stop")
        httpd.serve_forever()
