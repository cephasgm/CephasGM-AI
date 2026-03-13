/**
 * Vector Database - Store and search vector embeddings using Supabase (pgvector)
 */
const { createClient } = require('@supabase/supabase-js');
const EventEmitter = require('events');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_KEY environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

class VectorDatabase extends EventEmitter {
    constructor() {
        super();
        this.tableName = 'vectors';
        console.log('🧠 Vector database initialized (Supabase)');
    }

    /**
     * Generate a unique ID
     */
    generateId() {
        return `vec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Add a vector to the database
     */
    async add(vector, metadata = {}) {
        const id = this.generateId();
        const vectorArray = vector.values || vector; // ensure it's an array

        const { data, error } = await supabase
            .from(this.tableName)
            .insert([{
                id,
                vector: vectorArray,
                metadata
            }])
            .select()
            .single();

        if (error) {
            console.error('Error adding vector:', error);
            return { success: false, error: error.message };
        }

        this.emit('vectorAdded', { id });
        return { success: true, id };
    }

    /**
     * Add multiple vectors
     */
    async addMany(vectors) {
        const results = [];
        for (const v of vectors) {
            const res = await this.add(v.vector, v.metadata);
            results.push(res);
        }
        return results;
    }

    /**
     * Search for similar vectors using cosine distance
     */
    async search(query, limit = 10, threshold = 0.5) {
        const queryVector = query.values || query;

        // Use pgvector's <=> operator for cosine distance
        const { data, error } = await supabase.rpc('match_vectors', {
            query_vector: queryVector,
            match_threshold: threshold,
            match_count: limit
        });

        if (error) {
            console.error('Error searching vectors:', error);
            return { success: false, error: error.message };
        }

        // Convert distance to similarity score (1 - distance)
        const results = (data || []).map(item => ({
            id: item.id,
            score: 1 - item.distance,
            metadata: item.metadata
        }));

        return {
            success: true,
            count: results.length,
            results
        };
    }

    /**
     * Get vector by ID
     */
    async get(id) {
        const { data, error } = await supabase
            .from(this.tableName)
            .select('*')
            .eq('id', id)
            .single();

        if (error) return null;
        return data;
    }

    /**
     * Update vector metadata
     */
    async update(id, vector, metadata = {}) {
        const updates = {};
        if (vector) updates.vector = vector.values || vector;
        if (metadata) updates.metadata = metadata;

        const { data, error } = await supabase
            .from(this.tableName)
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) {
            return { success: false, error: error.message };
        }
        return { success: true, id: data.id };
    }

    /**
     * Delete a vector
     */
    async delete(id) {
        const { error } = await supabase
            .from(this.tableName)
            .delete()
            .eq('id', id);

        if (error) {
            return { success: false, error: error.message };
        }
        return { success: true, id };
    }

    /**
     * List vectors with pagination
     */
    async list(limit = 100, offset = 0) {
        const { data, error, count } = await supabase
            .from(this.tableName)
            .select('id, metadata, created_at', { count: 'exact' })
            .range(offset, offset + limit - 1)
            .order('created_at', { ascending: false });

        if (error) {
            return { success: false, error: error.message };
        }

        return {
            success: true,
            total: count,
            offset,
            limit,
            vectors: data
        };
    }

    /**
     * Get database statistics
     */
    async getStats() {
        const { count, error } = await supabase
            .from(this.tableName)
            .select('*', { count: 'exact', head: true });

        return {
            totalVectors: count || 0,
            dimensions: null, // can be queried if needed
            indexSize: count || 0
        };
    }

    /**
     * Clear all vectors (use with caution!)
     */
    async clear() {
        const { error } = await supabase
            .from(this.tableName)
            .delete()
            .neq('id', ''); // delete all

        if (error) {
            return { success: false, error: error.message };
        }
        return { success: true };
    }
}

module.exports = new VectorDatabase();
