/**
 * Knowledge Graph - Store and query relationships between entities
 */
const fs = require("fs").promises;
const path = require("path");

class KnowledgeGraph {
  constructor() {
    this.graph = {
      nodes: new Map(),
      edges: []
    };
    
    this.storagePath = path.join(__dirname, '../../knowledge-graph.json');
    this.loadGraph();
  }

  /**
   * Load graph from storage
   */
  async loadGraph() {
    try {
      const data = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Convert nodes back to Map
      this.graph.nodes = new Map(parsed.nodes);
      this.graph.edges = parsed.edges;
      
      console.log(`📚 Knowledge graph loaded: ${this.graph.nodes.size} nodes, ${this.graph.edges.length} edges`);
    } catch (error) {
      console.log('No existing knowledge graph found, starting fresh');
    }
  }

  /**
   * Save graph to storage
   */
  async saveGraph() {
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
   * Create a link between entities
   */
  link(a, rel, b, properties = {}) {
    if (!a || !rel || !b) {
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
      relation: rel,
      properties,
      createdAt: new Date().toISOString()
    };

    this.graph.edges.push(edge);
    this.saveGraph();

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
    
    return entity;
  }

  /**
   * Get all relations for an entity
   */
  get(a) {
    if (!this.graph.nodes.has(a)) {
      return [];
    }

    const relations = this.graph.edges
      .filter(e => e.source === a || e.target === a)
      .map(e => ({
        relation: e.relation,
        entity: e.source === a ? e.target : e.source,
        direction: e.source === a ? 'outgoing' : 'incoming',
        properties: e.properties,
        id: e.id
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
        properties: edge.properties
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
    
    this.saveGraph();

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
    
    this.saveGraph();

    return {
      success: true,
      removed: initialLength > this.graph.edges.length
    };
  }

  /**
   * Search for entities by name or property
   */
  search(query) {
    const results = [];
    const queryLower = query.toLowerCase();
    
    for (const [entity, properties] of this.graph.nodes) {
      if (entity.toLowerCase().includes(queryLower)) {
        results.push({ entity, properties, match: 'name' });
      } else if (properties.type && properties.type.toLowerCase().includes(queryLower)) {
        results.push({ entity, properties, match: 'type' });
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
      density: this.calculateDensity(),
      nodeTypes: this.getNodeTypes(),
      relationTypes: this.getRelationTypes()
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
   * Get distribution of node types
   */
  getNodeTypes() {
    const types = {};
    
    for (const [_, props] of this.graph.nodes) {
      const type = props.type || 'unknown';
      types[type] = (types[type] || 0) + 1;
    }
    
    return types;
  }

  /**
   * Get distribution of relation types
   */
  getRelationTypes() {
    const types = {};
    
    for (const edge of this.graph.edges) {
      types[edge.relation] = (types[edge.relation] || 0) + 1;
    }
    
    return types;
  }

  /**
   * Export graph as JSON
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
   * Import graph from JSON
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
    
    this.saveGraph();
    
    return {
      success: true,
      imported: {
        nodes: data.nodes?.length || 0,
        edges: data.edges?.length || 0
      }
    };
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Clear entire graph
   */
  clear() {
    this.graph = {
      nodes: new Map(),
      edges: []
    };
    
    this.saveGraph();
    
    return { success: true, message: 'Knowledge graph cleared' };
  }
}

module.exports = new KnowledgeGraph();
