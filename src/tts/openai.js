/**
 * OpenAI TTS Integration
 * Converts radio scripts to audio using OpenAI's TTS API
 */

const fs = require('fs').promises;
const path = require('path');

// Voice mappings for our hosts
const VOICES = {
  MAX: {
    voice: 'onyx', // Deep, authoritative
    name: 'Max'
  },
  LUNA: {
    voice: 'nova', // Warm, conversational
    name: 'Luna'
  },
  REEF: {
    voice: 'fable', // Expressive, British-ish
    name: 'Reef'
  }
};

class OpenAITTS {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.openai.com/v1';
    this.speed = 1.15; // Speech speed (0.25 to 4.0, default 1.0)
  }

  async synthesize(text, voice = 'alloy', model = 'tts-1') {
    const url = `${this.baseUrl}/audio/speech`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model, // 'tts-1' (fast) or 'tts-1-hd' (quality)
        input: text,
        voice, // alloy, echo, fable, onyx, nova, shimmer
        response_format: 'mp3',
        speed: this.speed
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI TTS error: ${response.status} - ${error}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}

class ScriptToAudio {
  constructor(apiKey, outputDir = './output/audio') {
    this.tts = new OpenAITTS(apiKey);
    this.outputDir = outputDir;
    this.voices = VOICES;
    this.model = 'tts-1'; // Use 'tts-1-hd' for higher quality
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
    const voiceConfig = this.voices[segment.host];
    if (!voiceConfig) {
      console.warn(`Unknown host: ${segment.host}, using MAX`);
      return this.tts.synthesize(segment.text, this.voices.MAX.voice, this.model);
    }

    return this.tts.synthesize(segment.text, voiceConfig.voice, this.model);
  }

  // Convert full script to audio file
  async scriptToAudio(script, outputFilename) {
    await this.init();
    
    const segments = this.parseScript(script);
    console.log(`🎤 Converting ${segments.length} segments to audio...`);

    const audioChunks = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const preview = segment.text.slice(0, 40).replace(/\n/g, ' ');
      console.log(`  [${i + 1}/${segments.length}] ${segment.host}: "${preview}..."`);
      
      try {
        const audio = await this.segmentToAudio(segment);
        audioChunks.push(audio);
      } catch (error) {
        console.error(`  ❌ Failed: ${error.message}`);
      }
      
      // Small delay to be nice to the API
      await new Promise(r => setTimeout(r, 200));
    }

    // Concatenate all audio chunks
    const fullAudio = Buffer.concat(audioChunks);
    const outputPath = path.join(this.outputDir, outputFilename);
    
    await fs.writeFile(outputPath, fullAudio);
    const sizeMB = (fullAudio.length / 1024 / 1024).toFixed(2);
    console.log(`✅ Saved: ${outputPath} (${sizeMB} MB)`);

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
  
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set');
    process.exit(1);
  }

  const converter = new ScriptToAudio(
    process.env.OPENAI_API_KEY,
    process.env.OUTPUT_DIR ? `${process.env.OUTPUT_DIR}/audio` : './output/audio'
  );

  if (args[0] === 'hd') {
    converter.model = 'tts-1-hd';
    args.shift();
  }

  if (args[0]) {
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

module.exports = { OpenAITTS, ScriptToAudio, VOICES };
