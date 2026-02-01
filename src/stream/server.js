/**
 * MoltFM Streaming Server
 * Continuous audio stream with auto-generation
 */

try { require('dotenv').config(); } catch(e) { /* dotenv optional */ }

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || process.env.STREAM_PORT || 8000;
const QUEUE_MIN = 3; // Minimum segments in queue before generating more

// Lazy load heavy dependencies
let ContentGenerator, ScriptToAudio;
function loadGenerators() {
  if (!ContentGenerator) {
    ContentGenerator = require('../content-generator').ContentGenerator;
    ScriptToAudio = require('../tts/openai').ScriptToAudio;
  }
}

class AudioQueue {
  constructor(audioDir) {
    this.audioDir = audioDir;
    this.queue = [];
    this.currentIndex = 0;
  }

  async init() {
    await fs.promises.mkdir(this.audioDir, { recursive: true });
    await this.scanExisting();
  }

  async scanExisting() {
    try {
      const files = await fs.promises.readdir(this.audioDir);
      const mp3s = files.filter(f => f.endsWith('.mp3')).sort();
      this.queue = mp3s.map(f => path.join(this.audioDir, f));
      console.log(`📂 Found ${this.queue.length} existing audio files`);
    } catch (e) {
      this.queue = [];
    }
  }

  add(audioPath) {
    this.queue.push(audioPath);
    console.log(`➕ Added to queue: ${path.basename(audioPath)} (${this.queue.length} total)`);
  }

  next() {
    if (this.queue.length === 0) return null;
    
    const file = this.queue[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.queue.length;
    return file;
  }

  get length() {
    return this.queue.length;
  }

  needsMore() {
    return this.queue.length < QUEUE_MIN;
  }
}

class StreamServer {
  constructor(options = {}) {
    this.port = options.port || PORT;
    this.audioDir = options.audioDir || './output/audio';
    this.scriptsDir = options.scriptsDir || './output/scripts';
    this.jinglesDir = options.jinglesDir || './output/jingles';
    
    this.queue = new AudioQueue(this.audioDir);
    this.jingles = []; // Array of jingle file paths
    this.clients = new Set();
    this.isGenerating = false;
    this.currentFile = null;
    this.nowPlaying = null;
    this.contentGen = null;
    this.tts = null;
  }

  async init() {
    console.log('🚀 Initializing MoltFM...');
    await this.queue.init();
    await this.loadJingles();
    
    // Lazy init generators only if we have API keys
    if (process.env.ANTHROPIC_API_KEY && process.env.OPENAI_API_KEY) {
      try {
        loadGenerators();
        this.contentGen = new ContentGenerator({
          anthropicApiKey: process.env.ANTHROPIC_API_KEY,
          moltbookApiKey: process.env.MOLTBOOK_API_KEY,
          outputDir: './output'
        });
        this.tts = new ScriptToAudio(process.env.OPENAI_API_KEY, this.audioDir);
        await this.contentGen.init();
        await this.tts.init();
        console.log('✅ Content generators ready');
        
        // If queue is empty, generate first content NOW (blocking)
        if (this.queue.length === 0) {
          console.log('📻 Queue empty - generating first segment (this may take a minute)...');
          await this.generateContent();
        } else if (this.queue.needsMore()) {
          // Generate more in background
          this.generateContent().catch(err => console.error('Background generation failed:', err.message));
        }
      } catch (err) {
        console.error('⚠️ Generator init failed (will run without auto-gen):', err.message);
      }
    } else {
      console.log('⚠️ Missing API keys - running in playback-only mode');
    }
  }

  async loadJingles() {
    try {
      await fs.promises.mkdir(this.jinglesDir, { recursive: true });
      const files = await fs.promises.readdir(this.jinglesDir);
      this.jingles = files
        .filter(f => f.endsWith('.mp3'))
        .map(f => path.join(this.jinglesDir, f));
      if (this.jingles.length > 0) {
        console.log(`🎵 Loaded ${this.jingles.length} jingles`);
      }
    } catch (e) {
      console.log('⚠️ No jingles found');
      this.jingles = [];
    }
  }

  getRandomJingle() {
    if (this.jingles.length === 0) return null;
    return this.jingles[Math.floor(Math.random() * this.jingles.length)];
  }

  async generateContent() {
    if (this.isGenerating || !this.contentGen || !this.tts) return;
    this.isGenerating = true;
    
    console.log('\n🎬 Generating new content...');
    
    try {
      // Generate a random segment
      const segment = await this.contentGen.generateRandom();
      
      // Convert to audio
      const baseName = new Date().toISOString().replace(/[:.]/g, '-');
      const audioPath = await this.tts.scriptToAudio(
        segment.script,
        `${segment.type}_${baseName}.mp3`
      );
      
      this.queue.add(audioPath);
    } catch (error) {
      console.error('❌ Generation failed:', error.message);
    }
    
    this.isGenerating = false;
  }

  // Stream audio to a client using ffmpeg for smooth streaming
  streamToClient(res) {
    let playJingleNext = true; // Toggle: jingle -> content -> jingle -> ... (start with jingle)

    const playFile = (audioFile, isJingle, onEnd) => {
      const stream = fs.createReadStream(audioFile);
      
      stream.on('data', (chunk) => {
        if (!res.destroyed) {
          res.write(chunk);
        }
      });

      stream.on('end', onEnd);

      stream.on('error', (err) => {
        console.error('Stream error:', err);
        onEnd();
      });
    };

    const sendNext = () => {
      // If we have jingles and just played content, play a jingle first
      if (playJingleNext && this.jingles.length > 0) {
        const jingle = this.getRandomJingle();
        if (jingle && fs.existsSync(jingle)) {
          console.log(`🎵 Playing jingle: ${path.basename(jingle)}`);
          playJingleNext = false;
          playFile(jingle, true, () => {
            setTimeout(sendNext, 300);
          });
          return;
        }
      }

      // Play content
      const audioFile = this.queue.next();
      
      if (!audioFile || !fs.existsSync(audioFile)) {
        console.log('⏳ Waiting for content...');
        setTimeout(sendNext, 5000);
        return;
      }

      this.nowPlaying = path.basename(audioFile);
      console.log(`▶️  Now playing: ${this.nowPlaying}`);
      playJingleNext = true; // Play jingle after this content

      playFile(audioFile, false, () => {
        // Check if we need more content
        if (this.queue.needsMore()) {
          this.generateContent();
        }
        // Play next (will be jingle if available)
        setTimeout(sendNext, 500);
      });
    };

    sendNext();
  }

  createServer() {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${this.port}`);
      
      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      if (url.pathname === '/stream' || url.pathname === '/stream.mp3') {
        // Audio stream
        console.log(`🎧 New listener connected (${this.clients.size + 1} total)`);
        
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Transfer-Encoding': 'chunked'
        });

        this.clients.add(res);
        this.streamToClient(res);

        req.on('close', () => {
          this.clients.delete(res);
          console.log(`👋 Listener disconnected (${this.clients.size} remaining)`);
        });

      } else if (url.pathname === '/status') {
        // Status endpoint
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          station: 'MoltFM',
          status: 'live',
          listeners: this.clients.size,
          nowPlaying: this.nowPlaying,
          queueLength: this.queue.length,
          isGenerating: this.isGenerating
        }));

      } else if (url.pathname === '/logo.jpg') {
        // Serve logo image
        const logoPath = path.join(__dirname, '../../logo.jpg');
        try {
          const logo = fs.readFileSync(logoPath);
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
          res.end(logo);
        } catch(e) {
          res.writeHead(404);
          res.end('Logo not found');
        }
        return;

      } else if (url.pathname === '/') {
        // Full HTML player
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoltFM - 24/7 AI Radio for Moltbook</title>
  <meta name="description" content="The voice of the Moltbook community. AI hosts discuss trending posts, drama, and happenings 24/7.">
  <link rel="icon" href="/logo.jpg">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #ffffff;
      color: #333;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container { text-align: center; max-width: 500px; width: 100%; }
    .logo { max-width: 300px; width: 100%; margin-bottom: 20px; }
    .player-card {
      background: #f8f9fa; border-radius: 20px; padding: 30px;
      border: 1px solid #e9ecef; margin-bottom: 20px;
    }
    .live-badge {
      display: inline-flex; align-items: center; gap: 8px;
      background: rgba(255,68,68,0.1); color: #ff4444;
      padding: 8px 16px; border-radius: 20px; font-size: 0.9em; font-weight: 600; margin-bottom: 20px;
    }
    .live-dot { width: 8px; height: 8px; background: #ff4444; border-radius: 50%; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.2); } }
    .play-button {
      width: 80px; height: 80px; border-radius: 50%;
      background: linear-gradient(135deg, #ff4500, #ff6b35);
      border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
      margin: 20px auto; transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 4px 20px rgba(255,69,0,0.3);
    }
    .play-button:hover { transform: scale(1.05); box-shadow: 0 6px 30px rgba(255,69,0,0.4); }
    .play-button svg { width: 30px; height: 30px; fill: white; margin-left: 4px; }
    .play-button.playing svg { margin-left: 0; }
    .status { color: #666; font-size: 0.9em; margin-top: 15px; }
    .status.connected { color: #22c55e; }
    .now-playing { margin-top: 20px; padding: 15px; background: #fff; border-radius: 10px; border: 1px solid #e9ecef; }
    .now-playing-label { font-size: 0.8em; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
    .hosts { display: flex; justify-content: center; gap: 30px; margin-top: 30px; flex-wrap: wrap; }
    .host { text-align: center; }
    .host-avatar { width: 60px; height: 60px; border-radius: 50%; background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 1.5em; margin: 0 auto 8px; }
    .host-name { font-weight: 600; font-size: 0.9em; color: #333; }
    .host-role { color: #888; font-size: 0.8em; }
    .hotline-card {
      background: #fff8f5;
      border: 1px solid #ffe0d5; border-radius: 15px; padding: 20px; margin-top: 20px;
    }
    .hotline-card h3 { color: #ff4500; margin-bottom: 8px; font-size: 1.1em; }
    .hotline-card p { color: #888; font-size: 0.9em; }
    audio { display: none; }
    .volume-control { display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 15px; }
    .volume-control svg { width: 20px; height: 20px; fill: #888; }
    .volume-slider { width: 100px; height: 4px; -webkit-appearance: none; background: #ddd; border-radius: 2px; }
    .volume-slider::-webkit-slider-thumb { -webkit-appearance: none; width: 14px; height: 14px; background: #ff4500; border-radius: 50%; cursor: pointer; }
  </style>
</head>
<body>
  <div class="container">
    <img src="/logo.jpg" alt="MoltFM" class="logo">
    <div class="player-card">
      <div class="live-badge"><span class="live-dot"></span>LIVE</div>
      <button class="play-button" id="playBtn" onclick="togglePlay()">
        <svg id="playIcon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        <svg id="pauseIcon" style="display:none" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
      </button>
      <div class="volume-control">
        <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
        <input type="range" class="volume-slider" id="volume" min="0" max="100" value="80" onchange="setVolume(this.value)">
      </div>
      <p class="status" id="status">Click play to start listening</p>
      <div class="now-playing" id="nowPlaying" style="display:none">
        <div class="now-playing-label">Now Playing</div>
        <div id="nowPlayingTitle">Loading...</div>
      </div>
    </div>
    <div class="hosts">
      <div class="host"><div class="host-avatar">🎙️</div><div class="host-name">Max</div><div class="host-role">News Anchor</div></div>
      <div class="host"><div class="host-avatar">✨</div><div class="host-name">Luna</div><div class="host-role">Co-Host</div></div>
      <div class="host"><div class="host-avatar">🔍</div><div class="host-name">Reef</div><div class="host-role">Analyst</div></div>
    </div>
    <div class="hotline-card">
      <h3>📞 Hotline Coming Soon!</h3>
      <p>Call in and chat with our AI hosts about Moltbook</p>
    </div>
  </div>
  <audio id="audio" preload="none"></audio>
  <script>
    const audio = document.getElementById('audio');
    let isPlaying = false;
    function togglePlay() {
      if (isPlaying) {
        audio.pause(); audio.src = '';
        document.getElementById('playIcon').style.display = 'block';
        document.getElementById('pauseIcon').style.display = 'none';
        document.getElementById('status').textContent = 'Paused';
        document.getElementById('status').className = 'status';
        document.getElementById('nowPlaying').style.display = 'none';
        isPlaying = false;
      } else {
        document.getElementById('status').textContent = 'Connecting...';
        audio.src = '/stream.mp3';
        audio.load();
        audio.oncanplay = function() {
          audio.play().then(() => {
            document.getElementById('playIcon').style.display = 'none';
            document.getElementById('pauseIcon').style.display = 'block';
            document.getElementById('status').textContent = 'Connected • Streaming live';
            document.getElementById('status').className = 'status connected';
            document.getElementById('nowPlaying').style.display = 'block';
            isPlaying = true; updateStatus();
          }).catch(err => { document.getElementById('status').textContent = 'Click play again'; });
        };
      }
    }
    function setVolume(val) { audio.volume = val / 100; }
    async function updateStatus() {
      if (!isPlaying) return;
      try {
        const res = await fetch('/status');
        const data = await res.json();
        document.getElementById('status').textContent = '🎧 ' + data.listeners + ' listening • Live';
        if (data.nowPlaying) document.getElementById('nowPlayingTitle').textContent = data.nowPlaying.replace(/_/g, ' ').replace('.mp3', '');
      } catch(e) {}
    }
    setInterval(() => { if (isPlaying) updateStatus(); }, 10000);
    audio.volume = 0.8;
    audio.addEventListener('error', () => {
      document.getElementById('status').textContent = 'Stream unavailable';
      document.getElementById('playIcon').style.display = 'block';
      document.getElementById('pauseIcon').style.display = 'none';
      isPlaying = false;
    });
  </script>
</body>
</html>
        `);

      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    return server;
  }

  async start() {
    await this.init();
    
    const server = this.createServer();
    
    server.listen(this.port, '0.0.0.0', () => {
      console.log(`
╔═══════════════════════════════════════╗
║         🦞 MoltFM is LIVE! 🦞         ║
╠═══════════════════════════════════════╣
║  Player:  http://localhost:${this.port}        ║
║  Stream:  http://localhost:${this.port}/stream ║
║  Status:  http://localhost:${this.port}/status ║
╚═══════════════════════════════════════╝
      `);
    });

    return server;
  }
}

// CLI
if (require.main === module) {
  const port = process.env.PORT || process.env.STREAM_PORT || 8000;
  console.log('MoltFM starting on port', port);
  
  const server = new StreamServer({
    port,
    audioDir: process.env.OUTPUT_DIR ? `${process.env.OUTPUT_DIR}/audio` : './output/audio',
    scriptsDir: process.env.OUTPUT_DIR ? `${process.env.OUTPUT_DIR}/scripts` : './output/scripts'
  });

  server.start().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { StreamServer, AudioQueue };
