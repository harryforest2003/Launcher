/**
 * Boykov-Kolmogorov max-flow / min-cut over flat typed arrays.
 *
 * GrabCut solves one of these per iteration on a graph with a node per pixel, so
 * this keeps two search trees and reuses them between augmentations instead of
 * searching from scratch. Edge 0 and 1 are reserved so that 0 can mean "no edge"
 * and an edge's reverse is always `edge ^ 1`.
 */

const TERMINAL = -1;
const ORPHAN = -2;
const INT_MAX = 0x7fffffff;

export class FlowGraph {
  private readonly nodeCount: number;
  private readonly firstEdge: Int32Array;
  private readonly nextActive: Int32Array;
  private readonly parent: Int32Array;
  private readonly timestamp: Int32Array;
  private readonly dist: Int32Array;
  private readonly tree: Uint8Array;
  private readonly terminal: Float64Array;
  private readonly edgeTarget: Int32Array;
  private readonly edgeNext: Int32Array;
  private readonly capacity: Float64Array;
  private edgeCount = 2;

  constructor(nodeCount: number, maxUndirectedEdges: number) {
    this.nodeCount = nodeCount;
    this.firstEdge = new Int32Array(nodeCount);
    this.nextActive = new Int32Array(nodeCount + 1);
    this.parent = new Int32Array(nodeCount);
    this.timestamp = new Int32Array(nodeCount);
    this.dist = new Int32Array(nodeCount);
    this.tree = new Uint8Array(nodeCount);
    this.terminal = new Float64Array(nodeCount);

    const directed = maxUndirectedEdges * 2 + 2;
    this.edgeTarget = new Int32Array(directed);
    this.edgeNext = new Int32Array(directed);
    this.capacity = new Float64Array(directed);
  }

  reset() {
    this.firstEdge.fill(0);
    this.tree.fill(0);
    this.terminal.fill(0);
    this.edgeCount = 2;
  }

  addEdge(a: number, b: number, forward: number, backward: number) {
    const e = this.edgeCount;
    this.edgeCount += 2;

    this.edgeTarget[e] = b;
    this.edgeNext[e] = this.firstEdge[a];
    this.capacity[e] = forward;
    this.firstEdge[a] = e;

    this.edgeTarget[e + 1] = a;
    this.edgeNext[e + 1] = this.firstEdge[b];
    this.capacity[e + 1] = backward;
    this.firstEdge[b] = e + 1;
  }

  addTerminal(node: number, fromSource: number, toSink: number) {
    const existing = this.terminal[node];
    if (existing > 0) fromSource += existing;
    else toSink -= existing;
    this.terminal[node] = fromSource - toSink;
  }

  /** After maxFlow(): true when the node is on the source (foreground) side. */
  inSource(node: number) {
    return this.tree[node] === 0;
  }

  maxFlow() {
    const { nodeCount, firstEdge, nextActive, parent, timestamp, dist, tree, terminal } = this;
    const { edgeTarget, edgeNext, capacity } = this;
    const nil = nodeCount;
    const orphans: number[] = [];
    let currentStamp = 0;

    nextActive.fill(-1);
    nextActive[nil] = nil;

    let first = nil;
    let last = nil;

    for (let v = 0; v < nodeCount; v += 1) {
      timestamp[v] = 0;
      if (terminal[v] !== 0) {
        nextActive[last] = v;
        last = v;
        dist[v] = 1;
        parent[v] = TERMINAL;
        tree[v] = terminal[v] < 0 ? 1 : 0;
      } else {
        parent[v] = 0;
      }
    }

    first = nextActive[first];
    nextActive[last] = nil;
    nextActive[nil] = -1;

    for (;;) {
      let bridge = -1;

      // Grow the two trees until an edge connects them.
      while (first !== nil) {
        const v = first;

        if (parent[v] !== 0) {
          const vt = tree[v];

          for (let e = firstEdge[v]; e !== 0; e = edgeNext[e]) {
            if (capacity[e ^ vt] === 0) continue;

            const u = edgeTarget[e];

            if (parent[u] === 0) {
              tree[u] = vt;
              parent[u] = e ^ 1;
              timestamp[u] = timestamp[v];
              dist[u] = dist[v] + 1;
              if (nextActive[u] === -1) {
                nextActive[u] = nil;
                nextActive[last] = u;
                last = u;
              }
              continue;
            }

            if (tree[u] !== vt) {
              bridge = e ^ vt;
              break;
            }

            if (dist[u] > dist[v] + 1 && timestamp[u] <= timestamp[v]) {
              parent[u] = e ^ 1;
              timestamp[u] = timestamp[v];
              dist[u] = dist[v] + 1;
            }
          }

          if (bridge > 0) break;
        }

        first = nextActive[first];
        nextActive[v] = -1;
      }

      if (bridge <= 0) break;

      // Find the bottleneck along source -> bridge -> sink.
      let bottleneck = capacity[bridge];
      for (let k = 1; k >= 0; k -= 1) {
        let v = edgeTarget[bridge ^ k];
        for (;;) {
          const e = parent[v];
          if (e < 0) break;
          bottleneck = Math.min(bottleneck, capacity[e ^ k]);
          v = edgeTarget[e];
        }
        bottleneck = Math.min(bottleneck, Math.abs(terminal[v]));
      }

      // Push the flow and collect nodes that lost their parent.
      capacity[bridge] -= bottleneck;
      capacity[bridge ^ 1] += bottleneck;

      for (let k = 1; k >= 0; k -= 1) {
        let v = edgeTarget[bridge ^ k];
        for (;;) {
          const e = parent[v];
          if (e < 0) break;
          capacity[e ^ (k ^ 1)] += bottleneck;
          capacity[e ^ k] -= bottleneck;
          if (capacity[e ^ k] === 0) {
            orphans.push(v);
            parent[v] = ORPHAN;
          }
          v = edgeTarget[e];
        }

        terminal[v] += bottleneck * (1 - k * 2);
        if (terminal[v] === 0) {
          orphans.push(v);
          parent[v] = ORPHAN;
        }
      }

      // Re-attach orphans to their tree, or release them.
      currentStamp += 1;
      while (orphans.length > 0) {
        const orphan = orphans.pop() as number;
        const vt = tree[orphan];
        let bestDist = INT_MAX;
        let bestEdge = 0;

        for (let e = firstEdge[orphan]; e !== 0; e = edgeNext[e]) {
          if (capacity[e ^ (vt ^ 1)] === 0) continue;

          let u = edgeTarget[e];
          if (tree[u] !== vt || parent[u] === 0) continue;

          // Walk to the root to confirm the candidate is really connected.
          let d = 0;
          for (;;) {
            if (timestamp[u] === currentStamp) {
              d += dist[u];
              break;
            }
            const up = parent[u];
            d += 1;
            if (up < 0) {
              if (up === ORPHAN) {
                d = INT_MAX - 1;
              } else {
                timestamp[u] = currentStamp;
                dist[u] = 1;
              }
              break;
            }
            u = edgeTarget[up];
          }

          d += 1;
          if (d < INT_MAX) {
            if (d < bestDist) {
              bestDist = d;
              bestEdge = e;
            }
            for (u = edgeTarget[e]; timestamp[u] !== currentStamp; u = edgeTarget[parent[u]]) {
              timestamp[u] = currentStamp;
              d -= 1;
              dist[u] = d;
            }
          }
        }

        parent[orphan] = bestEdge;
        if (bestEdge > 0) {
          timestamp[orphan] = currentStamp;
          dist[orphan] = bestDist;
          continue;
        }

        // No parent exists: the orphan leaves the tree and its children orphan too.
        timestamp[orphan] = 0;
        for (let e = firstEdge[orphan]; e !== 0; e = edgeNext[e]) {
          const u = edgeTarget[e];
          const up = parent[u];
          if (tree[u] !== vt || up === 0) continue;

          if (capacity[e ^ (vt ^ 1)] !== 0 && nextActive[u] === -1) {
            nextActive[u] = nil;
            nextActive[last] = u;
            last = u;
          }
          if (up > 0 && edgeTarget[up] === orphan) {
            orphans.push(u);
            parent[u] = ORPHAN;
          }
        }
      }
    }
  }
}
