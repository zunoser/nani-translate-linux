export const PHASE_EXTRACTED_APP = "extracted-app";
export const PHASE_MAIN_BUNDLE = "main-bundle";

export const PATCH_PHASES = [PHASE_EXTRACTED_APP, PHASE_MAIN_BUNDLE];

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function definePatch(descriptor) {
  if (descriptor == null || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new TypeError("Patch descriptor must be an object");
  }
  if (typeof descriptor.id !== "string" || !ID_PATTERN.test(descriptor.id)) {
    throw new TypeError(`Patch descriptor id must match ${ID_PATTERN}`);
  }
  if (!PATCH_PHASES.includes(descriptor.phase)) {
    throw new TypeError(`Patch '${descriptor.id}' has unsupported phase '${descriptor.phase}'`);
  }
  if (!Number.isInteger(descriptor.order)) {
    throw new TypeError(`Patch '${descriptor.id}' order must be an integer`);
  }
  if (typeof descriptor.required !== "boolean") {
    throw new TypeError(`Patch '${descriptor.id}' required must be a boolean`);
  }
  if (typeof descriptor.apply !== "function") {
    throw new TypeError(`Patch '${descriptor.id}' must export an apply function`);
  }

  return Object.freeze({ ...descriptor });
}

export function normalizeDescriptors(descriptors) {
  const normalized = descriptors.map(definePatch);
  const seen = new Set();
  for (const descriptor of normalized) {
    if (seen.has(descriptor.id)) {
      throw new Error(`Duplicate patch descriptor id '${descriptor.id}'`);
    }
    seen.add(descriptor.id);
  }

  return [...normalized].sort((left, right) => {
    const phaseOrder = PATCH_PHASES.indexOf(left.phase) - PATCH_PHASES.indexOf(right.phase);
    return phaseOrder || left.order - right.order || left.id.localeCompare(right.id);
  });
}
