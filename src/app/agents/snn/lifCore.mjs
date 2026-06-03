const DEFAULT_SIZE = 256;
const DEFAULT_THRESHOLD = 0.75;
const DEFAULT_DECAY = 0.9;
const DEFAULT_REFRACTORY_MS = 8;
const DEFAULT_RESET_POTENTIAL = 0;

function clamp(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function toValidNeuronId(value, size) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed >= size) return null;
  return parsed;
}

export function createLifNetwork(options = {}) {
  const size = Math.max(1, Math.min(4096, Number(options.size || DEFAULT_SIZE)));
  return {
    size,
    threshold: clamp(options.threshold ?? DEFAULT_THRESHOLD, 0.05, 10),
    decay: clamp(options.decay ?? DEFAULT_DECAY, 0, 1),
    refractoryMs: clamp(options.refractoryMs ?? DEFAULT_REFRACTORY_MS, 0, 250),
    resetPotential: Number.isFinite(Number(options.resetPotential))
      ? Number(options.resetPotential)
      : DEFAULT_RESET_POTENTIAL,
    tick: 0,
    lastSpikes: [],
    symbolicFacts: [],
    neurons: Array.from({ length: size }, () => ({
      membrane: 0,
      input: 0,
      refractoryLeftMs: 0,
      lastInjection: 0,
      totalSpikes: 0,
    })),
  };
}

export function applySpikeInjection(network, injection = {}) {
  if (!network?.neurons?.length) return 0;
  const neuronIds = Array.isArray(injection.neuronIds) ? injection.neuronIds : [];
  const strengths = Array.isArray(injection.strengths) ? injection.strengths : [];
  let accepted = 0;

  for (let index = 0; index < neuronIds.length; index += 1) {
    const neuronId = toValidNeuronId(neuronIds[index], network.size);
    if (neuronId === null) continue;
    const strength = clamp(strengths[index] ?? 1, 0, 1);
    const neuron = network.neurons[neuronId];
    neuron.input += strength;
    neuron.lastInjection = strength;
    accepted += 1;
  }

  const symbolicFacts = Array.isArray(injection.symbolicFacts)
    ? injection.symbolicFacts
    : Array.isArray(injection.facts)
      ? injection.facts
      : [];
  if (symbolicFacts.length) {
    network.symbolicFacts = symbolicFacts.slice(-24);
  }

  return accepted;
}

export function stepLifNetwork(network, options = {}) {
  if (!network?.neurons?.length) {
    return { tick: 0, spikes: [], spikeCount: 0, firingRate: 0 };
  }
  const dtMs = clamp(options.dtMs ?? 16, 1, 1000);
  const spikes = [];

  network.tick += 1;
  for (let neuronId = 0; neuronId < network.neurons.length; neuronId += 1) {
    const neuron = network.neurons[neuronId];
    neuron.refractoryLeftMs = Math.max(0, neuron.refractoryLeftMs - dtMs);
    neuron.membrane = neuron.membrane * network.decay + neuron.input;
    neuron.input = 0;

    if (neuron.refractoryLeftMs <= 0 && neuron.membrane >= network.threshold) {
      spikes.push(neuronId);
      neuron.totalSpikes += 1;
      neuron.membrane = network.resetPotential;
      neuron.refractoryLeftMs = network.refractoryMs;
    }
  }

  network.lastSpikes = spikes;
  return {
    tick: network.tick,
    dtMs,
    spikes,
    spikeCount: spikes.length,
    firingRate: Number((spikes.length / network.size).toFixed(4)),
  };
}

export function getNetworkSnapshot(network) {
  if (!network?.neurons?.length) {
    return {
      tick: 0,
      size: 0,
      lastSpikes: [],
      lastSpikeCount: 0,
      symbolicFacts: [],
      activeNeurons: [],
    };
  }
  const activeNeurons = network.neurons
    .map((neuron, neuronId) => ({
      neuronId,
      membrane: Number(neuron.membrane.toFixed(3)),
      lastInjection: Number(neuron.lastInjection.toFixed(3)),
      totalSpikes: neuron.totalSpikes,
    }))
    .filter((neuron) => neuron.membrane > 0 || neuron.lastInjection > 0 || neuron.totalSpikes > 0)
    .sort(
      (left, right) =>
        right.totalSpikes - left.totalSpikes || right.lastInjection - left.lastInjection
    )
    .slice(0, 16);

  return {
    tick: network.tick,
    size: network.size,
    lastSpikes: [...network.lastSpikes],
    lastSpikeCount: network.lastSpikes.length,
    symbolicFacts: [...network.symbolicFacts],
    activeNeurons,
  };
}

export function restoreNetworkFromSnapshot(snapshot = {}, options = {}) {
  const size = Math.max(1, Math.min(4096, Number(snapshot.size || options.size || DEFAULT_SIZE)));
  const network = createLifNetwork({ ...options, size });
  network.tick = Math.max(0, Math.floor(Number(snapshot.tick || 0)));
  network.lastSpikes = Array.isArray(snapshot.lastSpikes)
    ? snapshot.lastSpikes
        .map((item) => toValidNeuronId(item, network.size))
        .filter((item) => item !== null)
    : [];
  network.symbolicFacts = Array.isArray(snapshot.symbolicFacts)
    ? snapshot.symbolicFacts.slice(-24)
    : [];

  const activeNeurons = Array.isArray(snapshot.activeNeurons) ? snapshot.activeNeurons : [];
  for (const item of activeNeurons) {
    const neuronId = toValidNeuronId(item?.neuronId, network.size);
    if (neuronId === null) continue;
    const neuron = network.neurons[neuronId];
    neuron.membrane = clamp(item?.membrane ?? 0, -10, 10);
    neuron.lastInjection = clamp(item?.lastInjection ?? 0, 0, 1);
    neuron.totalSpikes = Math.max(0, Math.floor(Number(item?.totalSpikes || 0)));
  }

  return network;
}
