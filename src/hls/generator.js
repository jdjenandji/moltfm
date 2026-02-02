/**
 * HLS Stream Generator
 * Concatenates segments with jingles and generates HLS playlist
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');

const execAsync = promisify(exec);

const HLS_DIR = process.env.HLS_DIR || '/tmp/moltfm-hls';
const SEGMENT_DURATION = 10; // HLS chunk duration in seconds

class HLSGenerator {
  constructor(options = {}) {
    this.hlsDir = options.hlsDir || HLS_DIR;
    this.segmentDuration = options.segmentDuration || SEGMENT_DURATION;
    this.isGenerating = false;
  }

  async init() {
    await fs.mkdir(this.hlsDir, { recursive: true });
    await fs.mkdir(path.join(this.hlsDir, 'chunks'), { recursive: true });
  }

  // Download file from URL
  async downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const file = require('fs').createWriteStream(destPath);
      const client = url.startsWith('https') ? https : http;
      
      client.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          // Follow redirect
          client.get(response.headers.location, (res) => {
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
          }).on('error', reject);
        } else {
          response.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }
      }).on('error', reject);
    });
  }

  // Generate HLS from segments and jingles
  async generate(segments, jingles) {
    if (this.isGenerating) {
      console.log('HLS generation already in progress');
      return false;
    }
    
    this.isGenerating = true;
    console.log('🎬 Generating HLS stream...');
    
    try {
      await this.init();
      
      const tempDir = path.join(this.hlsDir, 'temp');
      await fs.mkdir(tempDir, { recursive: true });
      
      // Download all audio files
      const audioFiles = [];
      let fileIndex = 0;
      
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const jingle = jingles[i % jingles.length];
        
        // Download jingle
        const jinglePath = path.join(tempDir, `${fileIndex++}_jingle.mp3`);
        console.log(`  Downloading jingle ${i + 1}...`);
        await this.downloadFile(jingle, jinglePath);
        audioFiles.push(jinglePath);
        
        // Download segment
        const segmentPath = path.join(tempDir, `${fileIndex++}_segment.mp3`);
        console.log(`  Downloading segment: ${segment.title || segment.id}...`);
        await this.downloadFile(segment.audio_url, segmentPath);
        audioFiles.push(segmentPath);
      }
      
      // Create concat file for ffmpeg
      const concatFile = path.join(tempDir, 'concat.txt');
      const concatContent = audioFiles.map(f => `file '${f}'`).join('\n');
      await fs.writeFile(concatFile, concatContent);
      
      // Generate HLS with ffmpeg
      console.log('  Running ffmpeg...');
      const outputPath = path.join(this.hlsDir, 'stream.m3u8');
      const chunksPattern = path.join(this.hlsDir, 'chunks', 'chunk%03d.ts');
      
      const ffmpegCmd = [
        'ffmpeg -y',
        `-f concat -safe 0 -i "${concatFile}"`,
        '-c:a aac -b:a 128k',
        `-hls_time ${this.segmentDuration}`,
        '-hls_list_size 0', // Keep all segments in playlist (for looping)
        '-hls_segment_filename', `"${chunksPattern}"`,
        '-hls_flags append_list',
        `"${outputPath}"`
      ].join(' ');
      
      await execAsync(ffmpegCmd);
      
      // Clean up temp files
      await fs.rm(tempDir, { recursive: true, force: true });
      
      console.log('✅ HLS stream generated!');
      console.log(`   Playlist: ${outputPath}`);
      
      this.isGenerating = false;
      return true;
      
    } catch (error) {
      console.error('❌ HLS generation failed:', error.message);
      this.isGenerating = false;
      return false;
    }
  }

  // Get playlist path
  getPlaylistPath() {
    return path.join(this.hlsDir, 'stream.m3u8');
  }

  // Check if HLS files exist
  async hasStream() {
    try {
      await fs.access(this.getPlaylistPath());
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { HLSGenerator };
