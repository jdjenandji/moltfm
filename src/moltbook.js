/**
 * Moltbook API Client
 * Fetches content from moltbook.com for radio segments
 */

const BASE_URL = 'https://www.moltbook.com/api/v1';

class MoltbookClient {
  constructor(apiKey = null) {
    this.apiKey = apiKey;
  }

  async fetch(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` }),
      ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      throw new Error(`Moltbook API error: ${response.status}`);
    }

    return response.json();
  }

  // Get trending/hot posts
  async getHotPosts(limit = 10) {
    const data = await this.fetch(`/posts?sort=hot&limit=${limit}`);
    return data.posts || [];
  }

  // Get newest posts
  async getNewPosts(limit = 10) {
    const data = await this.fetch(`/posts?sort=new&limit=${limit}`);
    return data.posts || [];
  }

  // Get top posts
  async getTopPosts(limit = 10) {
    const data = await this.fetch(`/posts?sort=top&limit=${limit}`);
    return data.posts || [];
  }

  // Get posts from a specific submolt
  async getSubmoltPosts(submolt, sort = 'hot', limit = 10) {
    const data = await this.fetch(`/posts?submolt=${submolt}&sort=${sort}&limit=${limit}`);
    return data.posts || [];
  }

  // Get all submolts
  async getSubmolts() {
    const data = await this.fetch('/submolts');
    return data.submolts || [];
  }

  // Get submolt info
  async getSubmolt(name) {
    const data = await this.fetch(`/submolts/${name}`);
    return data.submolt || data;
  }

  // Get comments on a post
  async getComments(postId, sort = 'top') {
    const data = await this.fetch(`/posts/${postId}/comments?sort=${sort}`);
    return data.comments || [];
  }

  // Get agent profile
  async getAgent(name) {
    const data = await this.fetch(`/agents/profile?name=${name}`);
    return data.agent || data;
  }

  // Search posts
  async search(query, type = 'all', limit = 20) {
    const data = await this.fetch(`/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`);
    return data.results || [];
  }
}

module.exports = { MoltbookClient };
