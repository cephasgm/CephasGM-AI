/**
 * Knowledge Graph - Store and query relationships between entities
 */
const fs = require('fs').promises;
const path = require('path');

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
      
      console.log(`Knowledge graph loaded with ${this.graph.nodes.size} nodes and ${this.graph.edges.length} edges`);
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
      console.log('Knowledge graph saved');
    } catch (error) {
      console.error('Failed to save knowledge graph:', error);
    }
  }

  /**
   * Add or update entity
   */
  addEntity(entity, properties = {}) {
    if (!entity || typeof entity !== 'string') {
      throw new Error('Entity must be a non-empty string');
    }

    const existing = this.graph.nodes.get(entity);
    
    this.graph.nodes.set(entity, {
      ...properties,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    this.saveGraph();

    return {
      success: true,
      entity,
      action: existing ? 'updated' : 'created'
    };
  }

  /**
   * Add relationship between entities
   */
  addRelation(entity, relation, target, properties = {}) {
    if (!entity || !relation || !target) {
      throw new Error('Entity, relation, and target are required');
    }

    // Ensure both entities exist
    if (!this.graph.nodes.has(entity)) {
      this.addEntity(entity);
    }
    
    if (!this.graph.nodes.has(target)) {
      this.addEntity(target);
    }

    const edge = {
      id: this.generateId(),
      source: entity,
      target: target,
      relation: relation,
      properties: properties,
      createdAt: new Date().toISOString()
    };

    this.graph.edges.push(edge);
    this.saveGraph();

    return {
      success: true,
      edge: edge
    };
  }

  /**
   * Query graph for entity relationships
   */
  query(entity, depth = 1) {
    if (!this.graph.nodes.has(entity)) {
      return {
        entity,
        found: false,
        nodes: [],
        edges: []
      };
    }

    const visitedNodes = new Set();
    const relevantEdges = new Set();
    
    this.traverseGraph(entity, depth, visitedNodes, relevantEdges);

    return {
      entity,
      found: true,
      properties: this.graph.nodes.get(entity),
      nodes: Array.from(visitedNodes).map(node => ({
        id: node,
        properties: this.graph.nodes.get(node)
      })),
      edges: Array.from(relevantEdges).map(edgeId => 
        this.graph.edges.find(e => e.id === edgeId)
      ),
      depth: depth
    };
  }

  /**
   * Traverse graph to find relationships
   */
  traverseGraph(entity, depth, visitedNodes, relevantEdges, currentDepth = 0) {
    if (currentDepth > depth) return;
    
    visitedNodes.add(entity);

    // Find edges connected to this entity
    const connectedEdges = this.graph.edges.filter(e => 
      e.source === entity || e.target === entity
    );

    for (const edge of connectedEdges) {
      relevantEdges.add(edge.id);
      
      const neighbor = edge.source === entity ? edge.target : edge.source;
      
      if (!visitedNodes.has(neighbor)) {
        this.traverseGraph(neighbor, depth, visitedNodes, relevantEdges, currentDepth + 1);
      }
    }
  }

  /**
   * Search for entities by property
   */
  searchEntities(query, property = 'name') {
    const results = [];
    
    for (const [entity, properties] of this.graph.nodes) {
      if (entity.toLowerCase().includes(query.toLowerCase())) {
        results.push({ entity, properties });
      } else if (properties[property] && 
                 String(properties[property]).toLowerCase().includes(query.toLowerCase())) {
        results.push({ entity, properties });
      }
    }

    return results;
  }

  /**
   * Find path between two entities
   */
  findPath(source, target, maxDepth = 5) {
    if (!this.graph.nodes.has(source) || !this.graph.nodes.has(target)) {
      return null;
    }

    const queue = [{ node: source, path: [source] }];
    const visited = new Set([source]);

    while (queue.length > 0) {
      const { node, path } = queue.shift();

      if (node === target) {
        return {
          found: true,
          path: path,
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
   * Get all relations for an entity
   */
  getRelations(entity) {
    if (!this.graph.nodes.has(entity)) {
      return [];
    }

    return this.graph.edges
      .filter(e => e.source === entity || e.target === entity)
      .map(e => ({
        type: e.relation,
        with: e.source === entity ? e.target : e.source,
        direction: e.source === entity ? 'outgoing' : 'incoming',
        properties: e.properties,
        createdAt: e.createdAt
      }));
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
      entity: entity
    };
  }

  /**
   * Remove relation
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
   * Get graph statistics
   */
  getStats() {
    return {
      nodes: this.graph.nodes.size,
      edges: this.graph.edges.length,
      nodeTypes: this.getNodeTypeDistribution(),
      relationTypes: this.getRelationTypeDistribution(),
      density: this.calculateDensity()
    };
  }

  /**
   * Get node type distribution
   */
  getNodeTypeDistribution() {
    const types = {};
    
    for (const [_, properties] of this.graph.nodes) {
      const type = properties.type || 'unknown';
      types[type] = (types[type] || 0) + 1;
    }
    
    return types;
  }

  /**
   * Get relation type distribution
   */
  getRelationTypeDistribution() {
    const types = {};
    
    for (const edge of this.graph.edges) {
      types[edge.relation] = (types[edge.relation] || 0) + 1;
    }
    
    return types;
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
   * Export graph as JSON-LD
   */
  exportJsonLd() {
    const nodes = [];
    const edges = [];

    // Convert nodes
    for (const [id, properties] of this.graph.nodes) {
      nodes.push({
        '@id': id,
        '@type': properties.type || 'Entity',
        ...properties
      });
    }

    // Convert edges
    for (const edge of this.graph.edges) {
      edges.push({
        '@id': edge.id,
        '@type': edge.relation,
        source: edge.source,
        target: edge.target,
        ...edge.properties
      });
    }

    return {
      '@context': 'https://schema.org',
      '@graph': [...nodes, ...edges]
    };
  }

  /**
   * Import from JSON-LD
   */
  importJsonLd(data) {
    try {
      const graph = data['@graph'] || [];
      
      for (const item of graph) {
        if (item['@id'] && !item.source && !item.target) {
          // This is a node
          const { '@id': id, '@type': type, ...properties } = item;
          this.addEntity(id, { ...properties, type });
        } else if (item.source && item.target) {
          // This is an edge
          this.addRelation(
            item.source,
            item['@type'] || 'relatedTo',
            item.target,
            item
          );
        }
      }
      
      return { success: true, imported: graph.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return 'edge_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
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
