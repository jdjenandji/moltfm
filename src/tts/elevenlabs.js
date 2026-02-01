/**
 * ElevenLabs TTS Integration
 * High-quality text-to-speech for MoltFM
 */

const fs = require('fs').promises;
const path = require('path');

// Voice IDs for our hosts (ElevenLabs preset voices)
// See: https://elevenlabs.io/docs/voices/premade-voices
const VOICES = {
  MAX: {
    voiceId: 'pNInz6obpgDQGcFmaJgB', // Adam - deep, authoritative
    name: 'Max'
  },
  LUNA: {
    voiceId: 'EXAVITQu4vr4xnSDxMaL', // Bella - warm, expressive  
    name: 'Luna'
  },
  REEF: {
    voiceId: 'onwK4e9ZLuTAKqWW03F9', // Daniel - British, analytical
    name: 'Reef'
  }
};

class ElevenLabsTTS {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseUrl = 'https://api.elevenlabs.io/v1';
    this.model = 'eleven_multilingual_v2'; // Best quality
  }

  async synthesize(text, voiceId) {
    const url = `${this.baseUrl}/text-to-speech/${voiceId}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: this.model,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
          use_speaker_boost: true
        }
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ElevenLabs error: ${response.status} - ${error}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async getVoices() {
    const response = await fetch(`${this.baseUrl}/voices`, {
      headers: { 'xi-api-key': this.apiKey }
    });
    return response.json();
  }
}

class ElevenLabsScriptToAudio {
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
    const voiceConfig = this.voices[segment.host];
    if (!voiceConfig) {
      console.warn(`Unknown host: ${segment.host}, using MAX`);
      return this.tts.synthesize(segment.text, this.voices.MAX.voiceId);
    }

    return this.tts.synthesize(segment.text, voiceConfig.voiceId);
  }

  // Convert full script to audio file
  async scriptToAudio(script, outputFilename) {
    await this.init();
    
    const segments = this.parseScript(script);
    console.log(`🎤 Converting ${segments.length} segments to audio (ElevenLabs)...`);

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
      
      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 100));
    }

    // Concatenate all audio chunks
    const fullAudio = Buffer.concat(audioChunks);
    const outputPath = path.join(this.outputDir, outputFilename);
    
    await fs.writeFile(outputPath, fullAudio);
    const sizeMB = (fullAudio.length / 1024 / 1024).toFixed(2);
    console.log(`✅ Saved: ${outputPath} (${sizeMB} MB)`);

    return outputPath;
  }
}

module.exports = { ElevenLabsTTS, ElevenLabsScriptToAudio, VOICES };
