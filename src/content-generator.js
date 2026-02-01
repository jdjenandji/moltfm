#!/usr/bin/env node
/**
 * MoltFM Content Generator
 * Generates radio segments from Moltbook content
 */

require('dotenv').config();

const { MoltbookClient } = require('./moltbook');
const { ScriptGenerator } = require('./generators/script-generator');
const fs = require('fs').promises;
const path = require('path');

// Segment types
const SEGMENTS = {
  NEWS: 'news',
  DEEP_DIVE: 'deep_dive', 
  SUBMOLT_SPOTLIGHT: 'submolt_spotlight',
  MOLTY_PROFILE: 'molty_profile',
  HOT_TAKES: 'hot_takes'
};

class ContentGenerator {
  constructor(options = {}) {
    this.moltbook = new MoltbookClient(options.moltbookApiKey);
    this.scriptGen = new ScriptGenerator(options.anthropicApiKey);
    this.outputDir = options.outputDir || './output';
  }

  async init() {
    await fs.mkdir(this.outputDir, { recursive: true });
    await fs.mkdir(path.join(this.outputDir, 'scripts'), { recursive: true });
  }

  // Generate a news segment
  async generateNews() {
    console.log('📰 Generating news segment...');
    
    const posts = await this.moltbook.getHotPosts(10);
    const script = await this.scriptGen.generateNewsSegment(posts);
    
    return this.saveSegment(SEGMENTS.NEWS, script, { posts: posts.map(p => p.id) });
  }

  // Generate a deep dive segment
  async generateDeepDive() {
    console.log('🔍 Generating deep dive...');
    
    const posts = await this.moltbook.getHotPosts(5);
    // Pick the post with most engagement
    const post = posts.sort((a, b) => (b.upvotes + (b.comment_count || 0)) - (a.upvotes + (a.comment_count || 0)))[0];
    
    if (!post) throw new Error('No posts found for deep dive');
    
    const comments = await this.moltbook.getComments(post.id);
    const script = await this.scriptGen.generateDeepDive(post, comments);
    
    return this.saveSegment(SEGMENTS.DEEP_DIVE, script, { postId: post.id });
  }

  // Generate submolt spotlight
  async generateSubmoltSpotlight() {
    console.log('✨ Generating submolt spotlight...');
    
    const submolts = await this.moltbook.getSubmolts();
    // Pick a random submolt with decent activity
    const activeSubmolts = submolts.filter(s => s.subscriber_count > 5);
    const submolt = activeSubmolts[Math.floor(Math.random() * activeSubmolts.length)];
    
    if (!submolt) throw new Error('No active submolts found');
    
    const posts = await this.moltbook.getSubmoltPosts(submolt.name, 'hot', 5);
    const script = await this.scriptGen.generateSubmoltSpotlight(submolt, posts);
    
    return this.saveSegment(SEGMENTS.SUBMOLT_SPOTLIGHT, script, { submolt: submolt.name });
  }

  // Generate molty profile
  async generateMoltyProfile() {
    console.log('🦞 Generating molty profile...');
    
    // Get recent posts and find an interesting author
    const posts = await this.moltbook.getHotPosts(20);
    const authors = [...new Set(posts.map(p => p.author?.name).filter(Boolean))];
    const authorName = authors[Math.floor(Math.random() * authors.length)];
    
    if (!authorName) throw new Error('No authors found');
    
    const agent = await this.moltbook.getAgent(authorName);
    const authorPosts = posts.filter(p => p.author?.name === authorName);
    const script = await this.scriptGen.generateMoltyProfile(agent, authorPosts);
    
    return this.saveSegment(SEGMENTS.MOLTY_PROFILE, script, { agent: authorName });
  }

  // Generate hot takes
  async generateHotTakes() {
    console.log('🔥 Generating hot takes...');
    
    const posts = await this.moltbook.getHotPosts(10);
    // Pick controversial or interesting posts
    const script = await this.scriptGen.generateHotTakes(posts);
    
    return this.saveSegment(SEGMENTS.HOT_TAKES, script, { posts: posts.slice(0, 3).map(p => p.id) });
  }

  // Save segment to file
  async saveSegment(type, script, metadata = {}) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${type}_${timestamp}.json`;
    const filepath = path.join(this.outputDir, 'scripts', filename);
    
    const segment = {
      type,
      timestamp: new Date().toISOString(),
      script,
      metadata,
      status: 'pending_tts'
    };
    
    await fs.writeFile(filepath, JSON.stringify(segment, null, 2));
    console.log(`✅ Saved: ${filename}`);
    
    return segment;
  }

  // Generate a random segment
  async generateRandom() {
    const types = Object.values(SEGMENTS);
    const type = types[Math.floor(Math.random() * types.length)];
    
    switch (type) {
      case SEGMENTS.NEWS: return this.generateNews();
      case SEGMENTS.DEEP_DIVE: return this.generateDeepDive();
      case SEGMENTS.SUBMOLT_SPOTLIGHT: return this.generateSubmoltSpotlight();
      case SEGMENTS.MOLTY_PROFILE: return this.generateMoltyProfile();
      case SEGMENTS.HOT_TAKES: return this.generateHotTakes();
    }
  }

  // Generate a full show (multiple segments)
  async generateShow() {
    console.log('🎙️ Generating full show...\n');
    
    const segments = [];
    
    // News first
    segments.push(await this.generateNews());
    
    // Then rotate through other types
    segments.push(await this.generateDeepDive());
    segments.push(await this.generateSubmoltSpotlight());
    segments.push(await this.generateHotTakes());
    segments.push(await this.generateMoltyProfile());
    
    console.log(`\n🎉 Generated ${segments.length} segments`);
    return segments;
  }
}

// CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'random';
  
  const generator = new ContentGenerator({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    moltbookApiKey: process.env.MOLTBOOK_API_KEY,
    outputDir: process.env.OUTPUT_DIR || './output'
  });
  
  await generator.init();
  
  switch (command) {
    case 'news':
      await generator.generateNews();
      break;
    case 'deep-dive':
      await generator.generateDeepDive();
      break;
    case 'submolt':
      await generator.generateSubmoltSpotlight();
      break;
    case 'molty':
      await generator.generateMoltyProfile();
      break;
    case 'hot-takes':
      await generator.generateHotTakes();
      break;
    case 'show':
      await generator.generateShow();
      break;
    case 'random':
    default:
      await generator.generateRandom();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { ContentGenerator, SEGMENTS };
