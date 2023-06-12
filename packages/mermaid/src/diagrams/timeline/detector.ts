import type { DiagramDetector, ExternalDiagramDefinition } from '../../diagram-api/types.js';

const id = 'timeline';

const detector: DiagramDetector = (txt) => {
  return /^\s*timeline/.test(txt);
};

const loader = async () => {
  const { diagram } = await import('./timeline-definition.js');
  return { id, diagram };
};

const plugin: ExternalDiagramDefinition = {
  id,
  detector,
  loader,
};

export default plugin;
