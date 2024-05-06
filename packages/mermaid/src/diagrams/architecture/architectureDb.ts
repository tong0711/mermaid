// TODO remove no-console
/* eslint-disable no-console */
import type {
  ArchitectureState,
  ArchitectureDB,
  ArchitectureService,
  ArchitectureGroup,
  ArchitectureEdge,
  ArchitectureDirectionPairMap,
  ArchitectureDirectionPair,
  ArchitectureSpatialMap,
} from './architectureTypes.js';
import { getConfig } from '../../diagram-api/diagramAPI.js';
import {
  getArchitectureDirectionPair,
  isArchitectureDirection,
  shiftPositionByArchitectureDirectionPair,
} from './architectureTypes.js';
import {
  setAccTitle,
  getAccTitle,
  setDiagramTitle,
  getDiagramTitle,
  getAccDescription,
  setAccDescription,
  clear as commonClear,
} from '../common/commonDb.js';
import type { ArchitectureDiagramConfig } from '../../config.type.js';
import DEFAULT_CONFIG from '../../defaultConfig.js';
import type { D3Element } from '../../mermaidAPI.js';
import { ImperativeState } from '../../utils/imperativeState.js';

const DEFAULT_ARCHITECTURE_CONFIG: Required<ArchitectureDiagramConfig> =
  DEFAULT_CONFIG.architecture;

const state = new ImperativeState<ArchitectureState>(() => ({
  services: {},
  groups: {},
  edges: [],
  registeredIds: {},
  config: DEFAULT_ARCHITECTURE_CONFIG,
  dataStructures: undefined,
  elements: {}
}))

const clear = (): void => {
  state.reset()
  commonClear();
};

const addService = function ({ id, icon, in: parent, title, iconText }: Omit<ArchitectureService, "edges">) {
  if (state.records.registeredIds[id] !== undefined) {
    throw new Error(`The service id [${id}] is already in use by another ${state.records.registeredIds[id]}`);
  }
  if (parent !== undefined) {
    if (id === parent) {
      throw new Error(`The service [${id}] cannot be placed within itself`);
    }
    if (state.records.registeredIds[parent] === undefined) {
      throw new Error(
        `The service [${id}]'s parent does not exist. Please make sure the parent is created before this service`
      );
    }
    if (state.records.registeredIds[parent] === 'service') {
      throw new Error(`The service [${id}]'s parent is not a group`);
    }
  }

  state.records.registeredIds[id] = 'service';

  state.records.services[id] = {
    id,
    icon,
    iconText,
    title,
    edges: [],
    in: parent,
  };
};

const getServices = (): ArchitectureService[] => Object.values(state.records.services);

const addGroup = function ({ id, icon, in: parent, title }: ArchitectureGroup) {
  if (state.records.registeredIds[id] !== undefined) {
    throw new Error(`The group id [${id}] is already in use by another ${state.records.registeredIds[id]}`);
  }
  if (parent !== undefined) {
    if (id === parent) {
      throw new Error(`The group [${id}] cannot be placed within itself`);
    }
    if (state.records.registeredIds[parent] === undefined) {
      throw new Error(
        `The group [${id}]'s parent does not exist. Please make sure the parent is created before this group`
      );
    }
    if (state.records.registeredIds[parent] === 'service') {
      throw new Error(`The group [${id}]'s parent is not a group`);
    }
  }

  state.records.registeredIds[id] = 'group';

  state.records.groups[id] = {
    id,
    icon,
    title,
    in: parent,
  };
};
const getGroups = (): ArchitectureGroup[] => {
  return Object.values(state.records.groups);
};

const addEdge = function (
  { lhsId, rhsId, lhsDir, rhsDir, lhsInto, rhsInto, title }: ArchitectureEdge
) {

  if (!isArchitectureDirection(lhsDir)) {
    throw new Error(
      `Invalid direction given for left hand side of edge ${lhsId}--${rhsId}. Expected (L,R,T,B) got ${lhsDir}`
    );
  }
  if (!isArchitectureDirection(rhsDir)) {
    throw new Error(
      `Invalid direction given for right hand side of edge ${lhsId}--${rhsId}. Expected (L,R,T,B) got ${rhsDir}`
    );
  }

  if (state.records.services[lhsId] === undefined && state.records.groups[lhsId] === undefined) {
    throw new Error(
      `The left-hand id [${lhsId}] does not yet exist. Please create the service/group before declaring an edge to it.`
    );
  }
  if (state.records.services[rhsId] === undefined && state.records.groups[lhsId] === undefined) {
    throw new Error(
      `The right-hand id [${rhsId}] does not yet exist. Please create the service/group before declaring an edge to it.`
    );
  }

  const edge = {
    lhsId,
    lhsDir,
    rhsId,
    rhsDir,
    title,
    lhsInto,
    rhsInto,
  };

  state.records.edges.push(edge);
  if (state.records.services[lhsId] && state.records.services[rhsId]) {
    state.records.services[lhsId].edges.push(state.records.edges[state.records.edges.length - 1]);
    state.records.services[rhsId].edges.push(state.records.edges[state.records.edges.length - 1]);
  } else if (state.records.groups[lhsId] && state.records.groups[rhsId]) {

  }
};

const getEdges = (): ArchitectureEdge[] => state.records.edges;

/**
 * Returns the current diagram's adjacency list & spatial map.
 * If they have not been created, run the algorithms to generate them.
 * @returns
 */
const getDataStructures = () => {
  if (state.records.dataStructures === undefined) {
    // Create an adjacency list of the diagram to perform BFS on
    // Outer reduce applied on all services
    // Inner reduce applied on the edges for a service
    const adjList = Object.entries(state.records.services).reduce<{ [id: string]: ArchitectureDirectionPairMap }>(
      (prevOuter, [id, service]) => {
        prevOuter[id] = service.edges.reduce<ArchitectureDirectionPairMap>((prevInner, edge) => {
          if (edge.lhsId === id) {
            // source is LHS
            const pair = getArchitectureDirectionPair(edge.lhsDir, edge.rhsDir);
            if (pair) {
              prevInner[pair] = edge.rhsId;
            }
          } else {
            // source is RHS
            const pair = getArchitectureDirectionPair(edge.rhsDir, edge.lhsDir);
            if (pair) {
              prevInner[pair] = edge.lhsId;
            }
          }
          return prevInner;
        }, {});
        return prevOuter;
      },
      {}
    );

    // Configuration for the initial pass of BFS
    const firstId = Object.keys(adjList)[0];
    const visited = { [firstId]: 1 };
    const notVisited = Object.keys(adjList).reduce(
      (prev, id) => (id === firstId ? prev : { ...prev, [id]: 1 }),
      {} as Record<string, number>
    );

    // Perform BFS on the adjacency list
    const BFS = (startingId: string): ArchitectureSpatialMap => {
      const spatialMap = { [startingId]: [0, 0] };
      const queue = [startingId];
      while (queue.length > 0) {
        const id = queue.shift();
        if (id) {
          visited[id] = 1;
          delete notVisited[id];
          const adj = adjList[id];
          const [posX, posY] = spatialMap[id];
          Object.entries(adj).forEach(([dir, rhsId]) => {
            if (!visited[rhsId]) {
              spatialMap[rhsId] = shiftPositionByArchitectureDirectionPair(
                [posX, posY],
                dir as ArchitectureDirectionPair
              );
              queue.push(rhsId);
            }
          });
        }
      }
      return spatialMap;
    };
    const spatialMaps = [BFS(firstId)];

    // If our diagram is disconnected, keep adding additional spatial maps until all disconnected graphs have been found
    while (Object.keys(notVisited).length > 0) {
      spatialMaps.push(BFS(Object.keys(notVisited)[0]));
    }
    state.records.dataStructures = {
      adjList,
      spatialMaps,
    };
    console.log(state.records.dataStructures);
  }
  return state.records.dataStructures;
};

const setElementForId = (id: string, element: D3Element) => {
  state.records.elements[id] = element;
};
const getElementById = (id: string) => state.records.elements[id];

export const db: ArchitectureDB = {
  clear,
  setDiagramTitle,
  getDiagramTitle,
  setAccTitle,
  getAccTitle,
  setAccDescription,
  getAccDescription,

  addService,
  getServices,
  addGroup,
  getGroups,
  addEdge,
  getEdges,
  setElementForId,
  getElementById,
  getDataStructures,
};

/**
 * Typed wrapper for resolving an architecture diagram's config fields. Returns the default value if undefined
 * @param field - the config field to access
 * @returns
 */
export function getConfigField<T extends keyof ArchitectureDiagramConfig>(
  field: T
): Required<ArchitectureDiagramConfig>[T] {
  const arch = getConfig().architecture;
  if (arch && arch[field] !== undefined) {
    return arch[field] as Required<ArchitectureDiagramConfig>[T];
  }
  return DEFAULT_ARCHITECTURE_CONFIG[field];
}
