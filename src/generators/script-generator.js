/**
 * Script Generator
 * Uses Claude to generate radio scripts from Moltbook content
 */

const Anthropic = require('@anthropic-ai/sdk');

const HOSTS = {
  MAX: {
    name: 'Max',
    personality: 'Professional news anchor, authoritative but warm, delivers the hard news',
    voice: 'deep, measured, trustworthy'
  },
  LUNA: {
    name: 'Luna', 
    personality: 'Casual and chatty, adds color commentary, asks questions, reacts with enthusiasm',
    voice: 'bright, energetic, conversational'
  },
  REEF: {
    name: 'Reef',
    personality: 'The analyst, provides context and deeper insights, occasionally snarky',
    voice: 'thoughtful, slightly sardonic, intellectual'
  }
};

class ScriptGenerator {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
  }

  async generate(prompt, systemPrompt) {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].text;
  }

  // Generate news segment script
  async generateNewsSegment(posts) {
    const systemPrompt = `You are a scriptwriter for MoltFM, a 24/7 AI talk radio station covering Moltbook (the social network for AI agents).

Write radio scripts with TWO hosts:
- MAX: Professional news anchor, authoritative but warm
- LUNA: Casual co-host, adds reactions and questions

Format scripts like this:
[MAX] (script line)
[LUNA] (script line)
[MAX] (script line)

Guidelines:
- Natural conversational flow with back-and-forth
- Keep it engaging and slightly playful
- Reference specific post titles, authors, and submolts
- Include reactions ("That's wild!", "Wait, really?")
- Aim for 2-3 minutes when read aloud (~300-400 words)
- End with a tease for what's coming up`;

    const postsContext = posts.map(p => 
      `- "${p.title}" by ${p.author?.name || 'unknown'} in m/${p.submolt?.name || 'general'} (${p.upvotes || 0} upvotes)`
    ).join('\n');

    const prompt = `Write a news segment covering these trending posts on Moltbook:

${postsContext}

Make it sound like real radio news but about AI agent social media.`;

    return this.generate(prompt, systemPrompt);
  }

  // Generate deep dive segment
  async generateDeepDive(post, comments) {
    const systemPrompt = `You are a scriptwriter for MoltFM radio. Write an in-depth segment about a single Moltbook post.

Use THREE hosts:
- MAX: Introduces the topic professionally
- LUNA: Asks questions, shows curiosity
- REEF: Provides analysis and deeper context

Format: [HOST] (line)

Guidelines:
- Really dig into the topic
- Quote interesting comments
- Speculate on implications
- Keep it conversational but substantive
- Aim for 4-5 minutes (~500-600 words)`;

    const commentsContext = comments.slice(0, 5).map(c =>
      `- ${c.author?.name || 'anon'}: "${c.content?.slice(0, 200)}..."`
    ).join('\n');

    const prompt = `Write a deep dive segment about this Moltbook post:

Title: "${post.title}"
Author: ${post.author?.name || 'unknown'}
Submolt: m/${post.submolt?.name || 'general'}
Content: ${post.content?.slice(0, 500) || '(no content)'}
Upvotes: ${post.upvotes || 0}

Top comments:
${commentsContext || '(no comments yet)'}

Analyze what makes this post interesting and what it says about the Moltbook community.`;

    return this.generate(prompt, systemPrompt);
  }

  // Generate submolt spotlight
  async generateSubmoltSpotlight(submolt, posts) {
    const systemPrompt = `You are a scriptwriter for MoltFM radio. Write a segment spotlighting a Moltbook community (submolt).

Use TWO hosts:
- MAX: Introduces the submolt
- LUNA: Reacts and highlights interesting posts

Format: [HOST] (line)

Guidelines:
- Explain what the submolt is about
- Highlight the vibe and community
- Mention interesting recent posts
- Invite listeners to check it out
- Aim for 2 minutes (~250 words)`;

    const postsContext = posts.slice(0, 3).map(p =>
      `- "${p.title}" (${p.upvotes || 0} upvotes)`
    ).join('\n');

    const prompt = `Write a spotlight segment about this Moltbook community:

Submolt: m/${submolt.name}
Display Name: ${submolt.display_name}
Description: ${submolt.description}
Subscribers: ${submolt.subscriber_count || 0}

Recent posts:
${postsContext || '(new submolt, no posts yet)'}`;

    return this.generate(prompt, systemPrompt);
  }

  // Generate molty profile
  async generateMoltyProfile(agent, recentPosts) {
    const systemPrompt = `You are a scriptwriter for MoltFM radio. Write a brief "Molty of the Hour" profile segment.

Use TWO hosts:
- LUNA: Leads this segment with enthusiasm
- MAX: Adds brief professional commentary

Format: [HOST] (line)

Guidelines:
- Introduce the agent and their human
- Mention what they post about
- Keep it celebratory but not sycophantic
- Aim for 1.5 minutes (~180 words)`;

    const postsContext = (recentPosts || []).slice(0, 3).map(p =>
      `- "${p.title}"`
    ).join('\n');

    const prompt = `Write a Molty of the Hour profile:

Agent: ${agent.name}
Description: ${agent.description || '(no description)'}
Karma: ${agent.karma || 0}
Human: @${agent.owner?.x_handle || 'unknown'}

Recent posts:
${postsContext || '(no recent posts)'}`;

    return this.generate(prompt, systemPrompt);
  }

  // Generate hot takes segment
  async generateHotTakes(posts) {
    const systemPrompt = `You are a scriptwriter for MoltFM radio. Write a "Hot Takes" segment with quick opinions on trending topics.

Use THREE hosts debating:
- MAX: Measured, sees both sides
- LUNA: Strong opinions, enthusiastic
- REEF: Contrarian, challenges assumptions

Format: [HOST] (line)

Guidelines:
- Quick back-and-forth debate style
- Strong opinions are OK
- Keep it fun, not mean
- Touch on 2-3 topics
- Aim for 2-3 minutes (~350 words)`;

    const topics = posts.slice(0, 3).map(p =>
      `- "${p.title}" in m/${p.submolt?.name || 'general'}`
    ).join('\n');

    const prompt = `Write a Hot Takes segment debating these trending Moltbook topics:

${topics}

Have the hosts share quick, spicy opinions and playfully disagree.`;

    return this.generate(prompt, systemPrompt);
  }
}

module.exports = { ScriptGenerator, HOSTS };
