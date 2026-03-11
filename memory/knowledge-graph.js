/**
 * Knowledge Graph - Store and query relationships between entities
 */
const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class KnowledgeGraph extends EventEmitter {
  constructor() {
    super();
    
    this.graph = {
      nodes: new Map(),
      edges: []
    };
    
    this.storagePath = path.join(__dirname, '../knowledge-graph.json');
    
    this.load();
    
    console.log('📚 Knowledge graph initialized');
  }

  /**
   * Create a link between entities
   */
  link(a, relation, b, properties = {}) {
    if (!a || !relation || !b) {
      throw new Error('Entity A, relation, and entity B are required');
    }

    // Ensure both nodes exist
    if (!this.graph.nodes.has(a)) {
      this.addNode(a);
    }
    
    if (!this.graph.nodes.has(b)) {
      this.addNode(b);
    }

    const edge = {
      id: this.generateId(),
      source: a,
      target: b,
      relation,
      properties,
      createdAt: new Date().toISOString()
    };

    this.graph.edges.push(edge);
    
    this.emit('linkCreated', edge);
    this.save();

    return {
      success: true,
      edge
    };
  }

  /**
   * Add a node to the graph
   */
  addNode(entity, properties = {}) {
    this.graph.nodes.set(entity, {
      ...properties,
      createdAt: properties.createdAt || new Date().toISOString()
    });
    
    this.emit('nodeAdded', { entity });
    
    return entity;
  }

  /**
   * Get all relations for an entity
   */
  get(entity) {
    if (!this.graph.nodes.has(entity)) {
      return [];
    }

    const relations = this.graph.edges
      .filter(e => e.source === entity || e.target === entity)
      .map(e => ({
        relation: e.relation,
        entity: e.source === entity ? e.target : e.source,
        direction: e.source === entity ? 'outgoing' : 'incoming',
        properties: e.properties,
        id: e.id,
        createdAt: e.createdAt
      }));

    return relations;
  }

  /**
   * Query the graph with depth
   */
  query(entity, depth = 1) {
    if (!this.graph.nodes.has(entity)) {
      return {
        entity,
        found: false,
        relations: []
      };
    }

    const visited = new Set();
    const relations = [];
    
    this.traverse(entity, depth, visited, relations);

    return {
      entity,
      found: true,
      properties: this.graph.nodes.get(entity),
      relations,
      depth
    };
  }

  /**
   * Traverse the graph
   */
  traverse(entity, depth, visited, relations, currentDepth = 0) {
    if (currentDepth >= depth || visited.has(entity)) return;
    
    visited.add(entity);
    
    const edges = this.graph.edges.filter(e => 
      e.source === entity || e.target === entity
    );
    
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
        this.traverse(neighbor, depth, visited, relations, currentDepth + 1);
      }
    }
  }

  /**
   * Find path between two entities
   */
  findPath(from, to, maxDepth = 5) {
    if (!this.graph.nodes.has(from) || !this.graph.nodes.has(to)) {
      return null;
    }

    const queue = [{ node: from, path: [from] }];
    const visited = new Set([from]);

    while (queue.length > 0) {
      const { node, path } = queue.shift();

      if (node === to) {
        return {
          found: true,
          path,
          length: path.length - 1
        };
      }

      if (path.length > maxDepth) continue;

      const neighbors = this.getNeighbors(node);
      
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({
            node: neighbor,
            path: [...path, neighbor]
          });
        }
      }
    }

    return {
      found: false,
      path: [],
      length: Infinity
    };
  }

  /**
   * Get neighbors of an entity
   */
  getNeighbors(entity) {
    const neighbors = new Set();
    
    for (const edge of this.graph.edges) {
      if (edge.source === entity) {
        neighbors.add(edge.target);
      }
      if (edge.target === entity) {
        neighbors.add(edge.source);
      }
    }

    return Array.from(neighbors);
  }

  /**
   * Remove entity and its relations
   */
  removeEntity(entity) {
    if (!this.graph.nodes.has(entity)) {
      return { success: false, error: 'Entity not found' };
    }

    // Remove all edges connected to this entity
    this.graph.edges = this.graph.edges.filter(e => 
      e.source !== entity && e.target !== entity
    );

    // Remove the entity
    this.graph.nodes.delete(entity);
    
    this.save();

    return {
      success: true,
      entity
    };
  }

  /**
   * Remove a specific relation
   */
  removeRelation(edgeId) {
    const initialLength = this.graph.edges.length;
    this.graph.edges = this.graph.edges.filter(e => e.id !== edgeId);
    
    this.save();

    return {
      success: true,
      removed: initialLength > this.graph.edges.length
    };
  }

  /**
   * Search for entities
   */
  search(query) {
    const results = [];
    const queryLower = query.toLowerCase();
    
    for (const [entity, properties] of this.graph.nodes) {
      if (entity.toLowerCase().includes(queryLower)) {
        results.push({ entity, properties, match: 'name' });
      }
    }
    
    return results;
  }

  /**
   * Get graph statistics
   */
  getStats() {
    return {
      nodes: this.graph.nodes.size,
      edges: this.graph.edges.length,
      density: this.calculateDensity()
    };
  }

  /**
   * Calculate graph density
   */
  calculateDensity() {
    const n = this.graph.nodes.size;
    if (n <= 1) return 0;
    
    const maxEdges = n * (n - 1);
    return this.graph.edges.length / maxEdges;
  }

  /**
   * Export graph
   */
  export() {
    return {
      nodes: Array.from(this.graph.nodes.entries()).map(([id, props]) => ({
        id,
        ...props
      })),
      edges: this.graph.edges
    };
  }

  /**
   * Import graph
   */
  import(data) {
    if (data.nodes) {
      data.nodes.forEach(node => {
        const { id, ...props } = node;
        this.graph.nodes.set(id, props);
      });
    }
    
    if (data.edges) {
      this.graph.edges.push(...data.edges);
    }
    
    this.save();
    
    return {
      success: true,
      imported: {
        nodes: data.nodes?.length || 0,
        edges: data.edges?.length || 0
      }
    };
  }

  /**
   * Save to disk
   */
  async save() {
    try {
      const data = {
        nodes: Array.from(this.graph.nodes.entries()),
        edges: this.graph.edges
      };
      
      await fs.writeFile(this.storagePath, JSON.stringify(data, null, 2));
      
    } catch (error) {
      console.error('Failed to save knowledge graph:', error);
    }
  }

  /**
   * Load from disk
   */
  async load() {
    try {
      const data = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(data);
      
      this.graph.nodes = new Map(parsed.nodes);
      this.graph.edges = parsed.edges;
      
      console.log(`📚 Loaded knowledge graph: ${this.graph.nodes.size} nodes, ${this.graph.edges.length} edges`);
      
    } catch {
      console.log('No existing knowledge graph found, starting fresh');
    }
  }

  /**
   * Clear graph
   */
  clear() {
    this.graph = {
      nodes: new Map(),
      edges: []
    };
    
    this.save();
    
    return { success: true };
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

module.exports = new KnowledgeGraph();
