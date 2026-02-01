/**
 * MoltFM Streaming Server
 * Continuous audio stream with auto-generation
 */

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ContentGenerator } = require('../content-generator');
const { ScriptToAudio } = require('../tts/openai');

const PORT = process.env.PORT || process.env.STREAM_PORT || 8000;
const QUEUE_MIN = 3; // Minimum segments in queue before generating more

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
    
    this.queue = new AudioQueue(this.audioDir);
    this.clients = new Set();
    this.isGenerating = false;
    this.currentFile = null;
    this.nowPlaying = null;
    
    // Content generation
    this.contentGen = new ContentGenerator({
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      moltbookApiKey: process.env.MOLTBOOK_API_KEY,
      outputDir: './output'
    });
    
    this.tts = new ScriptToAudio(
      process.env.OPENAI_API_KEY,
      this.audioDir
    );
  }

  async init() {
    await this.queue.init();
    await this.contentGen.init();
    await this.tts.init();
    
    // Generate initial content in background (don't block startup)
    if (this.queue.needsMore()) {
      this.generateContent().catch(err => console.error('Background generation failed:', err.message));
    }
  }

  async generateContent() {
    if (this.isGenerating) return;
    this.isGenerating = true;
    
    console.log('\n🎬 Generating new content...');
    
    try {
      // Generate a random segment
      const segment = await this.contentGen.generateRandom();
      
      // Convert to audio
      const baseName = path.basename(segment.timestamp).replace(/[:.]/g, '-');
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
    const sendNext = () => {
      const audioFile = this.queue.next();
      
      if (!audioFile || !fs.existsSync(audioFile)) {
        console.log('⏳ Waiting for content...');
        setTimeout(sendNext, 5000);
        return;
      }

      this.nowPlaying = path.basename(audioFile);
      console.log(`▶️  Now playing: ${this.nowPlaying}`);

      const stream = fs.createReadStream(audioFile);
      
      stream.on('data', (chunk) => {
        if (!res.destroyed) {
          res.write(chunk);
        }
      });

      stream.on('end', () => {
        // Check if we need more content
        if (this.queue.needsMore()) {
          this.generateContent();
        }
        // Play next
        setTimeout(sendNext, 500);
      });

      stream.on('error', (err) => {
        console.error('Stream error:', err);
        setTimeout(sendNext, 1000);
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

      } else if (url.pathname === '/') {
        // Simple HTML player
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>MoltFM - AI Radio for Moltbook</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
      min-height: 100vh;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .player {
      text-align: center;
      padding: 40px;
      background: rgba(255,255,255,0.05);
      border-radius: 20px;
      backdrop-filter: blur(10px);
      max-width: 400px;
      width: 90%;
    }
    h1 { 
      margin: 0 0 10px; 
      font-size: 2.5em;
    }
    .emoji { font-size: 3em; margin-bottom: 20px; }
    .tagline { 
      color: #888; 
      margin-bottom: 30px;
      font-size: 1.1em;
    }
    audio { 
      width: 100%; 
      margin: 20px 0;
    }
    .status {
      font-size: 0.9em;
      color: #888;
      margin-top: 20px;
    }
    .live {
      display: inline-block;
      background: #ff4444;
      color: white;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.8em;
      font-weight: bold;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    .hotline {
      margin-top: 30px;
      padding: 15px;
      background: rgba(255,69,0,0.2);
      border-radius: 10px;
      font-size: 0.9em;
    }
    .hotline strong { color: #ff4500; }
  </style>
</head>
<body>
  <div class="player">
    <div class="emoji">📻🦞</div>
    <h1>MoltFM</h1>
    <p class="tagline">24/7 AI Radio for Moltbook</p>
    <span class="live">● LIVE</span>
    <audio controls autoplay>
      <source src="/stream.mp3" type="audio/mpeg">
    </audio>
    <div class="status" id="status">Connecting...</div>
    <div class="hotline">
      <strong>📞 Hotline Coming Soon!</strong><br>
      Call in and talk to our AI hosts
    </div>
  </div>
  <script>
    async function updateStatus() {
      try {
        const res = await fetch('/status');
        const data = await res.json();
        document.getElementById('status').textContent = 
          '🎧 ' + data.listeners + ' listening • ' + (data.nowPlaying || 'Loading...');
      } catch(e) {}
    }
    setInterval(updateStatus, 5000);
    updateStatus();
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
  const server = new StreamServer({
    port: process.env.STREAM_PORT || 8000,
    audioDir: process.env.OUTPUT_DIR ? `${process.env.OUTPUT_DIR}/audio` : './output/audio',
    scriptsDir: process.env.OUTPUT_DIR ? `${process.env.OUTPUT_DIR}/scripts` : './output/scripts'
  });

  server.start().catch(console.error);
}

module.exports = { StreamServer, AudioQueue };
