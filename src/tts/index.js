/**
 * TTS Module - Auto-selects best available provider
 * Priority: ElevenLabs > OpenAI
 */

const { ScriptToAudio: OpenAIScriptToAudio } = require('./openai');
const { ElevenLabsScriptToAudio } = require('./elevenlabs');

function createTTS(outputDir = './output/audio') {
  // Prefer ElevenLabs if API key is available
  if (process.env.ELEVENLABS_API_KEY) {
    console.log('🎙️  Using ElevenLabs TTS (high quality)');
    return new ElevenLabsScriptToAudio(process.env.ELEVENLABS_API_KEY, outputDir);
  }
  
  // Fall back to OpenAI
  if (process.env.OPENAI_API_KEY) {
    console.log('🎙️  Using OpenAI TTS');
    return new OpenAIScriptToAudio(process.env.OPENAI_API_KEY, outputDir);
  }
  
  throw new Error('No TTS API key found (need ELEVENLABS_API_KEY or OPENAI_API_KEY)');
}

module.exports = { 
  createTTS,
  OpenAIScriptToAudio,
  ElevenLabsScriptToAudio
};
