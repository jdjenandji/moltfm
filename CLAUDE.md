# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MoltFM is a 24/7 AI-powered talk radio station for Moltbook (a social network for AI agents). It continuously generates radio segments featuring AI hosts discussing trending posts, community happenings, and agent profiles. The system fetches content from Moltbook's API, generates scripts via Claude, converts them to audio using TTS, and streams them to listeners.

## Commands

```bash
# Content generation
npm run generate          # Generate random segment type
npm run news              # Generate news segment (10 hot posts overview)
npm run deep-dive         # Generate deep dive (single post analysis)
npm run submolt           # Generate submolt spotlight (community feature)
npm run molty             # Generate molty profile (agent spotlight)
npm run hot-takes         # Generate hot takes (debate/opinions)
npm run show              # Generate full show (all segment types)

# Text-to-speech conversion
npm run tts               # Convert scripts to audio (OpenAI tts-1, fast)
npm run tts:hd            # Convert scripts to audio (OpenAI tts-1-hd, high quality)
npm run tts:eleven        # Convert scripts to audio (ElevenLabs)

# Streaming server
npm start                 # Start server on port 8000
```

**Typical workflow:** Generate content → Convert to audio → Stream
```bash
npm run news && npm run tts && npm start
```

## Architecture

```
Moltbook API → Content Generator → Script Generator (Claude) → TTS → Audio Queue → Stream Server → Web Player
```

**Core components:**

- `src/moltbook.js` - MoltbookClient: fetches posts, comments, agents from Moltbook API
- `src/content-generator.js` - ContentGenerator: orchestrates segment generation, CLI entry point
- `src/generators/script-generator.js` - ScriptGenerator: uses Claude API to generate dialogue scripts
- `src/tts/openai.js` - OpenAI TTS: converts `[HOST] (text)` format to MP3
- `src/tts/elevenlabs.js` - ElevenLabs TTS: alternative high-quality TTS
- `src/stream/server.js` - StreamServer: HTTP server with AudioQueue for continuous playback

**Server endpoints:**
- `/` - HTML player with controls
- `/stream.mp3` - Continuous audio stream
- `/status` - JSON status (listeners, now playing, queue length)
- `/logo.jpg` - Station logo

## Host Personalities

Scripts use `[HOSTNAME] (dialogue text)` format with three hosts:

- **MAX** (voice: onyx): Professional news anchor, authoritative, warm
- **LUNA** (voice: nova): Casual co-host, enthusiastic, asks questions
- **REEF** (voice: fable): Analyst, thoughtful, slightly snarky

## Queue Management

The stream server maintains a minimum of 3 segments in queue. When queue drops below threshold, it triggers background generation using available API keys. Audio files are played in a circular loop.

## Environment Variables

See `.env.example`:
- `ANTHROPIC_API_KEY` - Required for script generation
- `MOLTBOOK_API_KEY` - Optional, for Moltbook API access
- `ELEVENLABS_API_KEY` - Optional, for ElevenLabs TTS
- `OUTPUT_DIR` - Directory for generated content (default: ./output)

## Deployment

Configured for Railway (`railway.json`) with 5-minute health check timeout. Also supports Heroku-style deployment via `Procfile`.
