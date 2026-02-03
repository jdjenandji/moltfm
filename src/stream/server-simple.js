/**
 * MoltFM Simple Streaming Server
 * Client-side playlist playback - no HLS/ffmpeg required
 */

try { require('dotenv').config(); } catch(e) {}

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || process.env.STREAM_PORT || 8000;

// Jingle URLs
const JINGLES = [
  'https://jbqkskwfjbejixyiuqpn.supabase.co/storage/v1/object/public/moltfm-audio/jingles/jingle-main.mp3',
  'https://jbqkskwfjbejixyiuqpn.supabase.co/storage/v1/object/public/moltfm-audio/jingles/jingle-short-1.mp3',
  'https://jbqkskwfjbejixyiuqpn.supabase.co/storage/v1/object/public/moltfm-audio/jingles/jingle-short-2.mp3',
  'https://jbqkskwfjbejixyiuqpn.supabase.co/storage/v1/object/public/moltfm-audio/jingles/jingle-short-3.mp3'
];

// Lazy load Supabase
let SupabaseStorage, storage;
function getStorage() {
  if (!storage && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    SupabaseStorage = require('../storage/supabase').SupabaseStorage;
    storage = new SupabaseStorage(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return storage;
}

// Listener tracking
const listeners = new Map();
const LISTENER_TIMEOUT = 60000;

function cleanupListeners() {
  const now = Date.now();
  for (const [id, data] of listeners) {
    if (now - data.lastSeen > LISTENER_TIMEOUT) {
      listeners.delete(id);
    }
  }
}
setInterval(cleanupListeners, 30000);

// Get playlist from Supabase
async function getPlaylist() {
  const store = getStorage();
  if (!store) return [];
  
  try {
    const segments = await store.getPlaylist(20);
    return segments;
  } catch (e) {
    console.error('Failed to get playlist:', e.message);
    return [];
  }
}

function getPlayerHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MoltFM - 24/7 AI Radio for Moltbook</title>
  <meta name="description" content="The voice of the Moltbook community. AI hosts discuss trending posts, drama, and happenings 24/7.">
  <meta property="og:title" content="MoltFM - 24/7 AI Radio for Moltbook">
  <meta property="og:description" content="The voice of the Moltbook community. AI hosts discuss trending posts, drama, and happenings 24/7.">
  <meta property="og:image" content="https://moltradio.fm/logo.jpg">
  <meta property="og:url" content="https://moltradio.fm">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="MoltFM - 24/7 AI Radio for Moltbook">
  <meta name="twitter:image" content="https://moltradio.fm/logo.jpg">
  <link rel="icon" href="/logo.jpg">
  <script data-goatcounter="https://moltfm.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
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
    let jingles = ${JSON.stringify(JINGLES)};
    let currentIndex = 0;
    let playingJingle = true; // Start with jingle

    // Fetch playlist from server
    async function fetchPlaylist() {
      try {
        const res = await fetch('/api/playlist');
        const data = await res.json();
        if (data.segments && data.segments.length > 0) {
          playlist = data.segments;
          console.log('Loaded', playlist.length, 'segments');
        }
      } catch(e) {
        console.error('Failed to fetch playlist:', e);
      }
    }

    // Get current audio URL
    function getCurrentAudio() {
      if (playlist.length === 0) return null;
      
      if (playingJingle) {
        // Pick a random jingle (or cycle through)
        return jingles[currentIndex % jingles.length];
      } else {
        return playlist[currentIndex % playlist.length].audioUrl;
      }
    }

    // Get current title
    function getCurrentTitle() {
      if (playlist.length === 0) return 'Loading...';
      
      if (playingJingle) {
        return '🎵 MoltFM Jingle';
      } else {
        return playlist[currentIndex % playlist.length].title || 'MoltFM Segment';
      }
    }

    // Play next in queue
    function playNext() {
      if (playlist.length === 0) {
        document.getElementById('status').textContent = 'No segments available';
        return;
      }

      const url = getCurrentAudio();
      if (!url) return;

      audio.src = url;
      audio.play().then(() => {
        document.getElementById('nowPlayingTitle').textContent = getCurrentTitle();
      }).catch(e => {
        console.error('Play error:', e);
        // Skip to next on error
        advanceQueue();
        setTimeout(playNext, 1000);
      });
    }

    // Advance to next item
    function advanceQueue() {
      if (playingJingle) {
        // Just played jingle, now play segment
        playingJingle = false;
      } else {
        // Just played segment, advance index and play jingle
        currentIndex++;
        playingJingle = true;
        
        // Refresh playlist periodically
        if (currentIndex % 3 === 0) {
          fetchPlaylist();
        }
      }
    }

    // When audio ends, play next
    audio.addEventListener('ended', () => {
      advanceQueue();
      playNext();
    });

    // Handle errors
    audio.addEventListener('error', (e) => {
      console.error('Audio error:', e);
      advanceQueue();
      setTimeout(playNext, 1000);
    });

    function togglePlay() {
      if (isPlaying) {
        audio.pause();
        document.getElementById('playIcon').style.display = 'block';
        document.getElementById('pauseIcon').style.display = 'none';
        document.getElementById('status').textContent = 'Paused';
        document.getElementById('status').className = 'status';
        isPlaying = false;
      } else {
        if (playlist.length === 0) {
          document.getElementById('status').textContent = 'Loading playlist...';
          fetchPlaylist().then(() => {
            playNext();
            updateUI();
          });
        } else {
          playNext();
          updateUI();
        }
      }
    }

    function updateUI() {
      document.getElementById('playIcon').style.display = 'none';
      document.getElementById('pauseIcon').style.display = 'block';
      document.getElementById('status').textContent = 'Live';
      document.getElementById('status').className = 'status connected';
      document.getElementById('nowPlaying').style.display = 'block';
      isPlaying = true;
    }

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
    
    // Pre-fetch playlist
    fetchPlaylist();
  </script>
</body>
</html>`;
}

// Create server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Main page
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(getPlayerHTML());
    return;
  }

  // Playlist API
  if (url.pathname === '/api/playlist') {
    const segments = await getPlaylist();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      segments: segments.map(s => ({
        id: s.id,
        type: s.type,
        title: s.title,
        audioUrl: s.audio_url,
        createdAt: s.created_at
      })),
      jingles: JINGLES
    }));
    return;
  }

  // Heartbeat/listener tracking
  if (url.pathname === '/api/heartbeat') {
    const sid = url.searchParams.get('sid');
    if (sid) {
      listeners.set(sid, { lastSeen: Date.now() });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ listeners: listeners.size }));
    return;
  }

  // Status
  if (url.pathname === '/status' || url.pathname === '/api/status') {
    const segments = await getPlaylist();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      listeners: listeners.size,
      segments: segments.length,
      latestSegment: segments[0]?.title || null
    }));
    return;
  }

  // Logo
  if (url.pathname === '/logo.jpg') {
    const logoPath = path.join(__dirname, '../../logo.jpg');
    if (fs.existsSync(logoPath)) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      fs.createReadStream(logoPath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Logo not found');
    }
    return;
  }

  // 404
  res.writeHead(404);
  res.end('Not found');
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════╗
║      🦞 MoltFM is LIVE! 🦞            ║
╠═══════════════════════════════════════╣
║  Player:  http://localhost:${PORT}        ║
║  Status:  http://localhost:${PORT}/status  ║
╚═══════════════════════════════════════╝

No HLS required - pure client-side playback!
New segments appear instantly.
`);
});
