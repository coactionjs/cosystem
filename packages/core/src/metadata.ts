import type { Constructor, DependencySpec, Scope } from "./types.js";

export interface ModuleOptions {
  readonly name?: string;
  readonly deps?: readonly DependencySpec[];
  readonly scope?: Scope;
}

export interface DefineModuleOptions extends ModuleOptions {
  readonly state?: readonly PropertyKey[];
  readonly actions?: readonly PropertyKey[];
  readonly computed?: readonly PropertyKey[];
}

export interface ModuleMetadata {
  readonly kind: "module";
  name?: string;
  deps?: readonly DependencySpec[];
  scope?: Scope;
  readonly state: Set<PropertyKey>;
  readonly actions: Set<PropertyKey>;
  readonly computed: Set<PropertyKey>;
}

const moduleMetadata = new WeakMap<Function, ModuleMetadata>();

export function defineModule<T extends Constructor>(
  target: T,
  options: DefineModuleOptions = {},
): T {
  const metadata = ensureModuleMetadata(target);
  applyModuleOptions(metadata, options);
  addProperties(metadata.state, options.state);
  addProperties(metadata.actions, options.actions);
  addProperties(metadata.computed, options.computed);
  return target;
}

export function getModuleMetadata(target: Function): ModuleMetadata | undefined {
  return moduleMetadata.get(target);
}

export function addModuleState(target: Function, property: PropertyKey): void {
  ensureModuleMetadata(target).state.add(property);
}

export function addModuleAction(target: Function, property: PropertyKey): void {
  ensureModuleMetadata(target).actions.add(property);
}

export function addModuleComputed(target: Function, property: PropertyKey): void {
  ensureModuleMetadata(target).computed.add(property);
}

export function applyModuleOptions(metadata: ModuleMetadata, options: ModuleOptions): void {
  if (options.name !== undefined) {
    metadata.name = options.name;
  }

  if (options.deps !== undefined) {
    metadata.deps = options.deps;
  }

  if (options.scope !== undefined) {
    metadata.scope = options.scope;
  }
}

export function ensureModuleMetadata(target: Function): ModuleMetadata {
  let metadata = moduleMetadata.get(target);

  if (metadata !== undefined) {
    return metadata;
  }

  metadata = {
    kind: "module",
    state: new Set(),
    actions: new Set(),
    computed: new Set(),
  };
  moduleMetadata.set(target, metadata);
  return metadata;
}

function addProperties(target: Set<PropertyKey>, properties: readonly PropertyKey[] | undefined) {
  for (const property of properties ?? []) {
    target.add(property);
  }
}
