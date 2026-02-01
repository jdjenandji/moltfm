/**
 * ElevenLabs TTS Integration
 * Converts radio scripts to audio
 */

const fs = require('fs').promises;
const path = require('path');

// Voice IDs for our hosts (using ElevenLabs preset voices)
// These can be customized or cloned later
const VOICES = {
  MAX: {
    id: 'pNInz6obpgDQGcFmaJgB', // Adam - deep, authoritative
    name: 'Max',
    settings: { stability: 0.6, similarity_boost: 0.8 }
  },
  LUNA: {
    id: 'EXAVITQu4vr4xnSDxMaL', // Bella - warm, conversational  
    name: 'Luna',
    settings: { stability: 0.5, similarity_boost: 0.75 }
  },
  REEF: {
    id: 'VR6AewLTigWG4xSOukaG', // Arnold - thoughtful, measured
    name: 'Reef',
    settings: { stability: 0.7, similarity_boost: 0.7 }
  }
};

class ElevenLabsTTS {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.elevenlabs.io/v1';
  }

  async synthesize(text, voiceId, settings = {}) {
    const url = `${this.baseUrl}/text-to-speech/${voiceId}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: settings.stability || 0.5,
          similarity_boost: settings.similarity_boost || 0.75,
          style: settings.style || 0.0,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  // Get available voices
  async getVoices() {
    const response = await fetch(`${this.baseUrl}/voices`, {
      headers: { 'xi-api-key': this.apiKey }
    });
    
    if (!response.ok) throw new Error('Failed to fetch voices');
    return response.json();
  }

  // Check subscription/usage
  async getSubscription() {
    const response = await fetch(`${this.baseUrl}/user/subscription`, {
      headers: { 'xi-api-key': this.apiKey }
    });
    
    if (!response.ok) throw new Error('Failed to fetch subscription');
    return response.json();
  }
}

class ScriptToAudio {
  constructor(apiKey, outputDir = './output/audio') {
    this.tts = new ElevenLabsTTS(apiKey);
    this.outputDir = outputDir;
    this.voices = VOICES;
  }

  async init() {
    await fs.mkdir(this.outputDir, { recursive: true });
  }

  // Parse script into segments by host
  parseScript(script) {
    const lines = script.split('\n').filter(line => line.trim());
    const segments = [];

    for (const line of lines) {
      const match = line.match(/^\[(\w+)\]\s*(.+)$/);
      if (match) {
        const [, host, text] = match;
        segments.push({ host: host.toUpperCase(), text: text.trim() });
      }
    }

    return segments;
  }

  // Convert a single segment to audio
  async segmentToAudio(segment) {
    const voice = this.voices[segment.host];
    if (!voice) {
      console.warn(`Unknown host: ${segment.host}, using MAX`);
      return this.tts.synthesize(segment.text, this.voices.MAX.id, this.voices.MAX.settings);
    }

    return this.tts.synthesize(segment.text, voice.id, voice.settings);
  }

  // Convert full script to audio file
  async scriptToAudio(script, outputFilename) {
    await this.init();
    
    const segments = this.parseScript(script);
    console.log(`🎤 Converting ${segments.length} segments to audio...`);

    const audioChunks = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      console.log(`  [${i + 1}/${segments.length}] ${segment.host}: "${segment.text.slice(0, 40)}..."`);
      
      try {
        const audio = await this.segmentToAudio(segment);
        audioChunks.push(audio);
        
        // Add small pause between speakers (silence)
        // We'll handle this in post-processing with ffmpeg
      } catch (error) {
        console.error(`  ❌ Failed: ${error.message}`);
      }
      
      // Rate limiting - be nice to the API
      await new Promise(r => setTimeout(r, 500));
    }

    // Concatenate all audio chunks
    const fullAudio = Buffer.concat(audioChunks);
    const outputPath = path.join(this.outputDir, outputFilename);
    
    await fs.writeFile(outputPath, fullAudio);
    console.log(`✅ Saved: ${outputPath} (${(fullAudio.length / 1024 / 1024).toFixed(2)} MB)`);

    return outputPath;
  }

  // Process a segment JSON file
  async processSegmentFile(jsonPath) {
    const content = await fs.readFile(jsonPath, 'utf-8');
    const segment = JSON.parse(content);
    
    if (!segment.script) {
      throw new Error('No script found in segment file');
    }

    const baseName = path.basename(jsonPath, '.json');
    const outputFilename = `${baseName}.mp3`;
    
    const audioPath = await this.scriptToAudio(segment.script, outputFilename);
    
    // Update segment file with audio path
    segment.audioPath = audioPath;
    segment.status = 'ready';
    await fs.writeFile(jsonPath, JSON.stringify(segment, null, 2));
    
    return audioPath;
  }
}

// CLI
async function main() {
  require('dotenv').config();
  
  const args = process.argv.slice(2);
  
  if (!process.env.ELEVENLABS_API_KEY) {
    console.error('❌ ELEVENLABS_API_KEY not set');
    process.exit(1);
  }

  const converter = new ScriptToAudio(
    process.env.ELEVENLABS_API_KEY,
    process.env.OUTPUT_DIR ? `${process.env.OUTPUT_DIR}/audio` : './output/audio'
  );

  if (args[0] === 'voices') {
    // List available voices
    const data = await converter.tts.getVoices();
    console.log('Available voices:');
    data.voices.forEach(v => console.log(`  ${v.voice_id}: ${v.name}`));
  } else if (args[0] === 'usage') {
    // Check usage
    const sub = await converter.tts.getSubscription();
    console.log(`Characters used: ${sub.character_count} / ${sub.character_limit}`);
  } else if (args[0]) {
    // Process a specific file
    await converter.processSegmentFile(args[0]);
  } else {
    // Process latest segment
    const scriptsDir = process.env.OUTPUT_DIR ? `${process.env.OUTPUT_DIR}/scripts` : './output/scripts';
    const files = await fs.readdir(scriptsDir);
    const latest = files.filter(f => f.endsWith('.json')).sort().pop();
    
    if (latest) {
      await converter.processSegmentFile(path.join(scriptsDir, latest));
    } else {
      console.log('No segment files found. Run `npm run news` first.');
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { ElevenLabsTTS, ScriptToAudio, VOICES };
