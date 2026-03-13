/**
 * Knowledge Graph - Store and query relationships using Supabase
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

class KnowledgeGraph extends EventEmitter {
    constructor() {
        super();
        this.nodesTable = 'knowledge_graph_nodes';
        this.edgesTable = 'knowledge_graph_edges';
        console.log('📚 Knowledge graph initialized (Supabase)');
    }

    generateId() {
        return `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    generateEdgeId() {
        return `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Add a node (entity) to the graph
     */
    async addNode(entity, properties = {}) {
        const id = entity; // we use the entity name as ID for simplicity
        const { data, error } = await supabase
            .from(this.nodesTable)
            .upsert({
                id,
                properties
            })
            .select()
            .single();

        if (error) {
            console.error('Error adding node:', error);
            return { success: false, error: error.message };
        }

        this.emit('nodeAdded', { entity: id });
        return { success: true, id };
    }

    /**
     * Create a link between entities
     */
    async link(a, relation, b, properties = {}) {
        // Ensure both nodes exist
        await this.addNode(a);
        await this.addNode(b);

        const edgeId = this.generateEdgeId();
        const { data, error } = await supabase
            .from(this.edgesTable)
            .insert({
                id: edgeId,
                source: a,
                target: b,
                relation,
                properties
            })
            .select()
            .single();

        if (error) {
            console.error('Error creating link:', error);
            return { success: false, error: error.message };
        }

        this.emit('linkCreated', data);
        return { success: true, edge: data };
    }

    /**
     * Get all relations for an entity
     */
    async get(entity) {
        const { data: outgoing, error: err1 } = await supabase
            .from(this.edgesTable)
            .select('*')
            .eq('source', entity);

        const { data: incoming, error: err2 } = await supabase
            .from(this.edgesTable)
            .select('*')
            .eq('target', entity);

        if (err1 || err2) {
            console.error('Error fetching relations:', err1 || err2);
            return [];
        }

        const relations = [
            ...(outgoing || []).map(e => ({
                relation: e.relation,
                entity: e.target,
                direction: 'outgoing',
                properties: e.properties,
                id: e.id,
                createdAt: e.created_at
            })),
            ...(incoming || []).map(e => ({
                relation: e.relation,
                entity: e.source,
                direction: 'incoming',
                properties: e.properties,
                id: e.id,
                createdAt: e.created_at
            }))
        ];

        return relations;
    }

    /**
     * Query the graph with depth (simplified BFS)
     */
    async query(entity, depth = 1) {
        const visited = new Set();
        const relations = [];
        await this._traverse(entity, depth, visited, relations);
        return {
            entity,
            found: visited.has(entity),
            properties: (await this._getNodeProperties(entity)) || {},
            relations,
            depth
        };
    }

    async _traverse(entity, depth, visited, relations, currentDepth = 0) {
        if (currentDepth >= depth || visited.has(entity)) return;
        visited.add(entity);

        const edges = await this._getEdges(entity);
        for (const edge of edges) {
            const neighbor = edge.source === entity ? edge.target : edge.source;
            relations.push({
                from: entity,
                to: neighbor,
                relation: edge.relation,
                depth: currentDepth + 1,
                properties: edge.properties,
                id: edge.id
            });

            if (currentDepth + 1 < depth) {
                await this._traverse(neighbor, depth, visited, relations, currentDepth + 1);
            }
        }
    }

    async _getEdges(entity) {
        const { data: outgoing } = await supabase
            .from(this.edgesTable)
            .select('*')
            .eq('source', entity);

        const { data: incoming } = await supabase
            .from(this.edgesTable)
            .select('*')
            .eq('target', entity);

        return [...(outgoing || []), ...(incoming || [])];
    }

    async _getNodeProperties(entity) {
        const { data } = await supabase
            .from(this.nodesTable)
            .select('properties')
            .eq('id', entity)
            .single();
        return data?.properties;
    }

    /**
     * Find path between two entities (BFS)
     */
    async findPath(from, to, maxDepth = 5) {
        const queue = [{ node: from, path: [from] }];
        const visited = new Set([from]);

        while (queue.length > 0) {
            const { node, path } = queue.shift();

            if (node === to) {
                return { found: true, path, length: path.length - 1 };
            }

            if (path.length > maxDepth) continue;

            const neighbors = await this._getNeighbors(node);
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push({ node: neighbor, path: [...path, neighbor] });
                }
            }
        }

        return { found: false, path: [], length: Infinity };
    }

    async _getNeighbors(entity) {
        const outgoing = await supabase
            .from(this.edgesTable)
            .select('target')
            .eq('source', entity);
        const incoming = await supabase
            .from(this.edgesTable)
            .select('source')
            .eq('target', entity);

        const targets = (outgoing.data || []).map(e => e.target);
        const sources = (incoming.data || []).map(e => e.source);
        return [...new Set([...targets, ...sources])];
    }

    /**
     * Remove an entity and its relations
     */
    async removeEntity(entity) {
        // Delete all edges where entity is source or target
        await supabase.from(this.edgesTable).delete().eq('source', entity);
        await supabase.from(this.edgesTable).delete().eq('target', entity);

        // Delete the node
        const { error } = await supabase
            .from(this.nodesTable)
            .delete()
            .eq('id', entity);

        if (error) {
            return { success: false, error: error.message };
        }
        return { success: true, entity };
    }

    /**
     * Remove a specific relation
     */
    async removeRelation(edgeId) {
        const { error } = await supabase
            .from(this.edgesTable)
            .delete()
            .eq('id', edgeId);

        if (error) {
            return { success: false, error: error.message };
        }
        return { success: true };
    }

    /**
     * Search for entities by name
     */
    async search(query) {
        const { data, error } = await supabase
            .from(this.nodesTable)
            .select('id, properties')
            .ilike('id', `%${query}%`);

        if (error) return [];
        return data.map(row => ({ entity: row.id, properties: row.properties, match: 'name' }));
    }

    /**
     * Get graph statistics
     */
    async getStats() {
        const { count: nodes, error: err1 } = await supabase
            .from(this.nodesTable)
            .select('*', { count: 'exact', head: true });

        const { count: edges, error: err2 } = await supabase
            .from(this.edgesTable)
            .select('*', { count: 'exact', head: true });

        return {
            nodes: nodes || 0,
            edges: edges || 0,
            density: nodes ? (edges / (nodes * (nodes - 1))) : 0
        };
    }

    /**
     * Clear the entire graph
     */
    async clear() {
        await supabase.from(this.edgesTable).delete().neq('id', '');
        await supabase.from(this.nodesTable).delete().neq('id', '');
        return { success: true };
    }

    // Optional: export/import can be implemented if needed
}

module.exports = new KnowledgeGraph();
