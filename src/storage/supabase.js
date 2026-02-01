/**
 * Supabase Storage Integration
 * Stores audio segments and metadata in Supabase
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');

class SupabaseStorage {
  constructor(url, serviceKey) {
    this.supabase = createClient(url, serviceKey);
    this.bucket = 'moltfm-audio';
    this.table = 'moltfm_segments';
  }

  // Upload audio file to Supabase Storage
  async uploadAudio(localPath, filename) {
    const fileBuffer = await fs.readFile(localPath);
    
    const { data, error } = await this.supabase
      .storage
      .from(this.bucket)
      .upload(`segments/${filename}`, fileBuffer, {
        contentType: 'audio/mpeg',
        upsert: true
      });

    if (error) throw new Error(`Upload failed: ${error.message}`);

    // Get public URL
    const { data: urlData } = this.supabase
      .storage
      .from(this.bucket)
      .getPublicUrl(`segments/${filename}`);

    return urlData.publicUrl;
  }

  // Save segment metadata to database
  async saveSegment(metadata) {
    const { data, error } = await this.supabase
      .from(this.table)
      .insert({
        type: metadata.type,
        title: metadata.title,
        script: metadata.script,
        audio_url: metadata.audioUrl,
        duration_seconds: metadata.durationSeconds || null,
        status: 'ready'
      })
      .select()
      .single();

    if (error) throw new Error(`Save failed: ${error.message}`);
    return data;
  }

  // Get playlist of available segments
  async getPlaylist(limit = 20) {
    const { data, error } = await this.supabase
      .from(this.table)
      .select('*')
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Fetch failed: ${error.message}`);
    return data || [];
  }

  // Get random segments for playback
  async getRandomSegments(count = 5) {
    const { data, error } = await this.supabase
      .from(this.table)
      .select('*')
      .eq('status', 'ready')
      .order('played_count', { ascending: true })
      .limit(count * 2); // Get more, then shuffle

    if (error) throw new Error(`Fetch failed: ${error.message}`);
    
    // Shuffle and return requested count
    const shuffled = (data || []).sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  // Increment play count
  async incrementPlayCount(id) {
    const { error } = await this.supabase
      .rpc('increment_play_count', { segment_id: id })
      .catch(() => {
        // Fallback if RPC doesn't exist
        return this.supabase
          .from(this.table)
          .update({ played_count: this.supabase.raw('played_count + 1') })
          .eq('id', id);
      });
    
    // Simple update as fallback
    if (error) {
      await this.supabase
        .from(this.table)
        .select('played_count')
        .eq('id', id)
        .single()
        .then(async ({ data }) => {
          await this.supabase
            .from(this.table)
            .update({ played_count: (data?.played_count || 0) + 1 })
            .eq('id', id);
        });
    }
  }

  // Get segment count
  async getSegmentCount() {
    const { count, error } = await this.supabase
      .from(this.table)
      .select('*', { count: 'exact', head: true })
      .eq('status', 'ready');

    return count || 0;
  }

  // Delete old segments (keep last N)
  async cleanupOldSegments(keepCount = 50) {
    const { data: segments } = await this.supabase
      .from(this.table)
      .select('id, audio_url')
      .order('created_at', { ascending: true });

    if (!segments || segments.length <= keepCount) return 0;

    const toDelete = segments.slice(0, segments.length - keepCount);
    
    for (const segment of toDelete) {
      // Delete from storage
      const filename = segment.audio_url.split('/').pop();
      await this.supabase.storage.from(this.bucket).remove([`segments/${filename}`]);
      
      // Delete from database
      await this.supabase.from(this.table).delete().eq('id', segment.id);
    }

    return toDelete.length;
  }
}

module.exports = { SupabaseStorage };
