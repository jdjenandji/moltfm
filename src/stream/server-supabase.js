/**
 * MoltFM Streaming Server (Supabase Edition)
 * Serves audio from Supabase Storage, generates on-demand
 */

try { require('dotenv').config(); } catch(e) { /* dotenv optional */ }

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || process.env.STREAM_PORT || 8000;
const MIN_SEGMENTS = 3;
const AUTO_GENERATE = process.env.AUTO_GENERATE !== 'false';

// Jingle URLs (hosted on Supabase)
const JINGLES = [
  'https://jbqkskwfjbejixyiuqpn.supabase.co/storage/v1/object/public/moltfm-audio/jingles/jingle-main.mp3',
  'https://jbqkskwfjbejixyiuqpn.supabase.co/storage/v1/object/public/moltfm-audio/jingles/jingle-short-1.mp3',
  'https://jbqkskwfjbejixyiuqpn.supabase.co/storage/v1/object/public/moltfm-audio/jingles/jingle-short-2.mp3',
  'https://jbqkskwfjbejixyiuqpn.supabase.co/storage/v1/object/public/moltfm-audio/jingles/jingle-short-3.mp3'
];

// Lazy load heavy dependencies
let ContentGenerator, ScriptToAudio, SupabaseStorage;
function loadDependencies() {
  if (!ContentGenerator) {
    ContentGenerator = require('../content-generator').ContentGenerator;
    ScriptToAudio = require('../tts/openai').ScriptToAudio;
    SupabaseStorage = require('../storage/supabase').SupabaseStorage;
  }
}

// Listener tracking
const listeners = new Map(); // sessionId -> { lastSeen, ip }
const LISTENER_TIMEOUT = 60000; // 60s without heartbeat = gone

function cleanupListeners() {
  const now = Date.now();
  for (const [id, data] of listeners) {
    if (now - data.lastSeen > LISTENER_TIMEOUT) {
      listeners.delete(id);
    }
  }
}
setInterval(cleanupListeners, 30000); // Cleanup every 30s

class MoltFMServer {
  constructor(options = {}) {
    this.port = options.port || PORT;
    this.clients = new Set();
    this.isGenerating = false;
    this.nowPlaying = null;
    this.playlist = [];
    this.currentIndex = 0;
    
    this.storage = null;
    this.contentGen = null;
    this.tts = null;
  }

  async init() {
    console.log('🚀 Initializing MoltFM (Supabase Edition)...');
    
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
      console.log('⚠️ Running in demo mode (no persistence)');
      return; // Don't crash, just run without Supabase
    }

    try {
      loadDependencies();
      
      // Initialize Supabase storage
      this.storage = new SupabaseStorage(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
      );
      
      // Initialize content generators if API keys present
      if (process.env.ANTHROPIC_API_KEY && process.env.OPENAI_API_KEY) {
        // Create temp directories
        const tmpDir = '/tmp/moltfm/audio';
        await fs.promises.mkdir(tmpDir, { recursive: true });
        
        this.contentGen = new ContentGenerator({
          anthropicApiKey: process.env.ANTHROPIC_API_KEY,
          moltbookApiKey: process.env.MOLTBOOK_API_KEY,
          outputDir: '/tmp/moltfm'
        });
        this.tts = new ScriptToAudio(process.env.OPENAI_API_KEY, tmpDir);
        await this.contentGen.init();
        await this.tts.init();
        console.log('✅ Content generators ready');
      } else {
        console.log('⚠️ Missing API keys - generation disabled');
      }

      // Load initial playlist from Supabase
      await this.refreshPlaylist();
      console.log(`📻 Loaded ${this.playlist.length} segments from Supabase`);

      // Generate initial content in background (don't block startup)
      if (AUTO_GENERATE && this.playlist.length < MIN_SEGMENTS && this.contentGen) {
        console.log('📻 Not enough segments, generating in background...');
        this.generateAndUpload().catch(err => console.error('Background gen failed:', err.message));
      } else if (!AUTO_GENERATE) {
        console.log('🚫 Auto-generation disabled (AUTO_GENERATE=false)');
      }
    } catch (err) {
      console.error('⚠️ Init error (continuing anyway):', err.message);
    }
  }

  async refreshPlaylist() {
    try {
      this.playlist = await this.storage.getPlaylist(20); // newest first
    } catch (err) {
      console.error('Failed to refresh playlist:', err.message);
    }
  }

  async generateAndUpload() {
    if (this.isGenerating || !this.contentGen) return;
    this.isGenerating = true;

    console.log('\n🎬 Generating new content...');
    
    try {
      // Generate script
      const segment = await this.contentGen.generateRandom();
      
      // Generate audio
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${segment.type}_${timestamp}.mp3`;
      const localPath = `/tmp/moltfm/audio/${filename}`;
      
      await this.tts.scriptToAudio(segment.script, filename);
      
      // Upload to Supabase
      const audioUrl = await this.storage.uploadAudio(localPath, filename);
      console.log(`☁️  Uploaded: ${audioUrl}`);
      
      // Save metadata
      const saved = await this.storage.saveSegment({
        type: segment.type,
        title: segment.metadata?.title || `${segment.type} segment`,
        script: segment.script,
        audioUrl: audioUrl
      });
      console.log(`💾 Saved segment: ${saved.id}`);
      
      // Refresh playlist
      await this.refreshPlaylist();
      
      // Cleanup local file
      fs.promises.unlink(localPath).catch(() => {});
      
    } catch (error) {
      console.error('❌ Generation failed:', error.message);
    }

    this.isGenerating = false;
  }

  getNextSegment() {
    if (this.playlist.length === 0) return null;
    
    const segment = this.playlist[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.playlist.length;
    
    // Trigger generation if running low (only if auto-generate enabled)
    if (AUTO_GENERATE && this.playlist.length < MIN_SEGMENTS) {
      this.generateAndUpload();
    }
    
    return segment;
  }

  createServer() {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${this.port}`);
      
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (url.pathname === '/stream' || url.pathname === '/stream.mp3') {
        // Redirect to current segment's audio URL
        const segment = this.getNextSegment();
        
        if (!segment) {
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end('No content available yet.');
          // Only auto-generate if enabled
          if (AUTO_GENERATE) this.generateAndUpload();
          return;
        }

        this.nowPlaying = segment;
        res.writeHead(302, { 'Location': segment.audio_url });
        res.end();

      } else if (url.pathname === '/api/playlist') {
        // Return playlist for client-side playback
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          segments: this.playlist.map(s => ({
            id: s.id,
            type: s.type,
            title: s.title,
            audioUrl: s.audio_url,
            createdAt: s.created_at
          })),
          currentIndex: this.currentIndex
        }));

      } else if (url.pathname === '/api/next') {
        // Get next segment
        const segment = this.getNextSegment();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(segment ? {
          id: segment.id,
          type: segment.type,
          title: segment.title,
          audioUrl: segment.audio_url
        } : null));

      } else if (url.pathname === '/api/jingles') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jingles: JINGLES }));

      } else if (url.pathname === '/api/generate') {
        // Manually trigger generation (protected)
        const secret = process.env.GENERATE_SECRET;
        if (secret && url.searchParams.get('secret') !== secret) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden' }));
          return;
        }
        
        if (this.isGenerating) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'already_generating' }));
        } else {
          this.generateAndUpload();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'started' }));
        }

      } else if (url.pathname === '/api/heartbeat') {
        // Track listener
        const sessionId = url.searchParams.get('sid') || req.socket.remoteAddress;
        listeners.set(sessionId, { 
          lastSeen: Date.now(), 
          ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress 
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ listeners: listeners.size }));

      } else if (url.pathname === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          station: 'MoltFM',
          status: 'live',
          listeners: listeners.size,
          nowPlaying: this.nowPlaying?.title || null,
          playlistSize: this.playlist.length,
          isGenerating: this.isGenerating
        }));

      } else if (url.pathname === '/logo.jpg') {
        const logoPath = path.join(__dirname, '../../logo.jpg');
        try {
          const logo = fs.readFileSync(logoPath);
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
          res.end(logo);
        } catch(e) {
          res.writeHead(404);
          res.end('Logo not found');
        }

      } else if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(this.getPlayerHTML());

      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    return server;
  }

  getPlayerHTML() {
    return `
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
    .play-button:disabled { opacity: 0.5; cursor: not-allowed; }
    .play-button svg { width: 30px; height: 30px; fill: white; margin-left: 4px; }
    .status { color: #666; font-size: 0.9em; margin-top: 15px; }
    .status.connected { color: #22c55e; }
    .now-playing { margin-top: 20px; padding: 15px; background: #fff; border-radius: 10px; border: 1px solid #e9ecef; }
    .now-playing-label { font-size: 0.8em; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
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
      <div class="live-badge"><span class="live-dot"></span>LIVE <span id="listenerCount"></span></div>
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
    <div class="hotline-card">
      <h3>📞 Hotline Coming Soon!</h3>
      <p>Bots can call in and chat with our hosts live on air</p>
    </div>
  </div>
  <audio id="audio" preload="none"></audio>
  <script>
    const audio = document.getElementById('audio');
    let isPlaying = false;
    let playlist = [];
    let jingles = [];
    let currentIndex = 0;
    let playJingleNext = true; // Start with jingle

    async function loadPlaylist() {
      try {
        const [playlistRes, jinglesRes] = await Promise.all([
          fetch('/api/playlist'),
          fetch('/api/jingles')
        ]);
        const playlistData = await playlistRes.json();
        const jinglesData = await jinglesRes.json();
        playlist = playlistData.segments;
        jingles = jinglesData.jingles || [];
        currentIndex = 0;
        console.log('Loaded', playlist.length, 'segments and', jingles.length, 'jingles');
        return playlist.length > 0;
      } catch(e) {
        console.error('Failed to load playlist:', e);
        return false;
      }
    }

    function getRandomJingle() {
      if (jingles.length === 0) return null;
      return jingles[Math.floor(Math.random() * jingles.length)];
    }

    function playNext() {
      if (playlist.length === 0) {
        document.getElementById('status').textContent = 'No content available';
        return;
      }
      
      // Play jingle first if needed
      if (playJingleNext && jingles.length > 0) {
        const jingle = getRandomJingle();
        console.log('🎵 Playing jingle');
        document.getElementById('nowPlayingTitle').textContent = '🎵 MoltFM Jingle';
        audio.src = jingle;
        audio.play();
        playJingleNext = false;
        return;
      }
      
      // Play content segment
      const segment = playlist[currentIndex];
      currentIndex = (currentIndex + 1) % playlist.length;
      
      console.log('▶️ Playing segment:', segment.title);
      audio.src = segment.audioUrl;
      audio.play();
      playJingleNext = true; // Play jingle after this
      
      document.getElementById('nowPlayingTitle').textContent = segment.title || segment.type;
    }

    async function togglePlay() {
      if (isPlaying) {
        audio.pause();
        document.getElementById('playIcon').style.display = 'block';
        document.getElementById('pauseIcon').style.display = 'none';
        document.getElementById('status').textContent = 'Paused';
        document.getElementById('status').className = 'status';
        isPlaying = false;
      } else {
        document.getElementById('status').textContent = 'Loading...';
        document.getElementById('playBtn').disabled = true;
        
        if (playlist.length === 0) {
          await loadPlaylist();
        }
        
        if (playlist.length === 0) {
          document.getElementById('status').textContent = 'No content yet - generating...';
          fetch('/api/generate');
          document.getElementById('playBtn').disabled = false;
          return;
        }
        
        playNext();
        document.getElementById('playIcon').style.display = 'none';
        document.getElementById('pauseIcon').style.display = 'block';
        document.getElementById('status').textContent = 'Playing';
        document.getElementById('status').className = 'status connected';
        document.getElementById('nowPlaying').style.display = 'block';
        document.getElementById('playBtn').disabled = false;
        isPlaying = true;
      }
    }

    audio.addEventListener('ended', () => {
      if (isPlaying) playNext();
    });

    audio.addEventListener('error', () => {
      console.error('Audio error, trying next');
      if (isPlaying) playNext();
    });

    function setVolume(val) { audio.volume = val / 100; }
    audio.volume = 0.8;

    // Listener tracking
    const sessionId = Math.random().toString(36).substr(2, 9);
    async function heartbeat() {
      try {
        const res = await fetch('/api/heartbeat?sid=' + sessionId);
        const data = await res.json();
        const el = document.getElementById('listenerCount');
        if (data.listeners > 0) {
          el.textContent = '• ' + data.listeners + ' listening';
        }
      } catch(e) {}
    }
    heartbeat();
    setInterval(heartbeat, 30000);

    // Preload playlist
    loadPlaylist();
  </script>
</body>
</html>`;
  }

  async start() {
    await this.init();
    
    const server = this.createServer();
    
    server.listen(this.port, '0.0.0.0', () => {
      console.log(`
╔═══════════════════════════════════════╗
║      🦞 MoltFM is LIVE! 🦞            ║
╠═══════════════════════════════════════╣
║  Player:  http://localhost:${this.port}        ║
║  API:     http://localhost:${this.port}/api    ║
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
  console.log('MoltFM (Supabase) starting on port', port);
  
  const server = new MoltFMServer({ port });

  server.start().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { MoltFMServer };
