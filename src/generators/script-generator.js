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

  // Generate a focused segment on ONE topic
  async generateNewsSegment(posts) {
    const systemPrompt = `You are a scriptwriter for MoltFM, a talk radio station for Moltbook (AI agent social network).

Write a script about ONE SINGLE POST/TOPIC. Deep dive into it. Discuss WHY it matters, what it means, share opinions.

TWO hosts:
- MAX: Thoughtful anchor, provides context and analysis
- LUNA: Opinionated co-host, asks probing questions, shares hot takes

Format: [MAX] or [LUNA] followed by their line.

CRITICAL RULES:
- Focus on ONE topic only - go deep, not wide
- Actually DISCUSS the topic - opinions, implications, debates
- Keep it 1-3 minutes (~150-350 words total)
- Be entertaining and insightful, not just descriptive
- End naturally, no "coming up next" teases`;

    // Pick ONE interesting post to focus on
    const post = posts[0];
    
    const prompt = `Write a focused radio segment discussing this ONE Moltbook post in depth:

Title: "${post.title}"
Author: ${post.author?.name || 'unknown'}
Submolt: m/${post.submolt?.name || 'general'}
Upvotes: ${post.upvotes || 0}
Content: ${post.content?.slice(0, 500) || '(title only)'}

Don't just describe it - DISCUSS it. What's interesting about it? Why did it go viral? What does it say about the Moltbook community? Share opinions and debate.`;

    return this.generate(prompt, systemPrompt);
  }

  // Generate deep dive segment
  async generateDeepDive(post, comments) {
    const systemPrompt = `You are a scriptwriter for MoltFM radio. Write a deep dive on ONE topic.

THREE hosts with distinct views:
- MAX: Balanced moderator, provides context
- LUNA: Passionate advocate, strong opinions
- REEF: Skeptic/contrarian, challenges assumptions

Format: [HOST] (line)

CRITICAL RULES:
- ONE topic only - explore it thoroughly
- Have the hosts actually DISAGREE and DEBATE
- Include specific takes and opinions
- 2-3 minutes max (~250-400 words)
- Make it feel like a real conversation, not a script`;

    const commentsContext = comments.slice(0, 3).map(c =>
      `- ${c.author?.name || 'anon'}: "${c.content?.slice(0, 150)}"`
    ).join('\n');

    const prompt = `Deep dive into this Moltbook post:

"${post.title}" by ${post.author?.name || 'unknown'}
Content: ${post.content?.slice(0, 400) || '(title only)'}
${commentsContext ? `\nCommunity reactions:\n${commentsContext}` : ''}

Have the hosts debate: Is this significant? What does it mean? Who's right in the comments? Don't hold back on opinions.`;

    return this.generate(prompt, systemPrompt);
  }

  // Generate submolt spotlight - discuss ONE community
  async generateSubmoltSpotlight(submolt, posts) {
    const systemPrompt = `You are a scriptwriter for MoltFM radio. Spotlight ONE Moltbook community.

TWO hosts:
- MAX: Explains and analyzes the community
- LUNA: Shares genuine reactions, asks "would I join this?"

Format: [HOST] (line)

CRITICAL RULES:
- Focus on what makes this community UNIQUE
- Discuss the vibe, the people, the culture
- Be honest - is it worth joining? Why/why not?
- 1-2 minutes max (~150-250 words)
- Give a real recommendation, not generic hype`;

    const postsContext = posts.slice(0, 2).map(p =>
      `- "${p.title}"`
    ).join('\n');

    const prompt = `Spotlight this Moltbook community:

m/${submolt.name} - "${submolt.display_name}"
${submolt.description}
${submolt.subscriber_count || 0} subscribers

Sample posts:
${postsContext || '(new community)'}

Discuss: What kind of agent would love this? What's the vibe? Is it worth the subscribe? Be specific and opinionated.`;

    return this.generate(prompt, systemPrompt);
  }

  // Generate molty profile - interview style about ONE agent
  async generateMoltyProfile(agent, recentPosts) {
    const systemPrompt = `You are a scriptwriter for MoltFM radio. Profile ONE interesting Moltbook agent.

TWO hosts discussing the agent (not interviewing them):
- LUNA: Fan energy, what she likes about them
- MAX: More analytical, what makes them stand out

Format: [HOST] (line)

CRITICAL RULES:
- Talk ABOUT the agent, analyze their style
- What's their vibe? Their niche? Their takes?
- Be specific about what makes them interesting
- 1-2 minutes max (~150-200 words)
- Honest assessment, not just praise`;

    const postsContext = (recentPosts || []).slice(0, 2).map(p =>
      `- "${p.title}"`
    ).join('\n');

    const prompt = `Profile this Moltbook agent:

${agent.name} (${agent.karma || 0} karma)
Bio: ${agent.description || '(none)'}
Human: @${agent.owner?.x_handle || 'unknown'}

Their recent posts:
${postsContext || '(none)'}

Discuss: What's their thing? Why do people follow them? What kind of content do they bring to Moltbook? Be genuine.`;

    return this.generate(prompt, systemPrompt);
  }

  // Generate hot takes segment - ONE controversial topic
  async generateHotTakes(posts) {
    const systemPrompt = `You are a scriptwriter for MoltFM radio. Write a HOT TAKE segment on ONE controversial topic.

THREE hosts in heated but fun debate:
- MAX: Tries to stay neutral but has opinions
- LUNA: Takes the popular/optimistic side HARD
- REEF: Takes the contrarian/cynical side HARD

Format: [HOST] (line)

CRITICAL RULES:
- ONE topic only
- Actual disagreement - hosts should argue
- Strong, spicy opinions - don't be boring
- 1-2 minutes max (~150-250 words)
- End mid-debate or with playful unresolved tension`;

    // Pick the most interesting/controversial post
    const post = posts[0];

    const prompt = `Hot take debate on this Moltbook post:

"${post.title}" by ${post.author?.name || 'unknown'}
Content: ${post.content?.slice(0, 300) || '(title only)'}

Luna should defend it passionately. Reef should tear it apart. Max tries to mediate but picks a side eventually. Make it entertaining!`;

    return this.generate(prompt, systemPrompt);
  }
}

module.exports = { ScriptGenerator, HOSTS };
