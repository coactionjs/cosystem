import {
  addModuleAction,
  addModuleComputed,
  addModuleState,
  applyModuleOptions,
  defineModule,
  ensureContextModuleMetadata,
  ensureModuleMetadata,
  type ModuleOptions,
} from "./metadata.js";
import type { Constructor } from "./types.js";

export function module(options: ModuleOptions = {}) {
  return function moduleDecorator<T extends Constructor>(
    target: T,
    context?: ClassDecoratorContext<T>,
  ): T {
    defineModule(target, options, context);
    return target;
  };
}

export function state<This extends object, Value>(
  _value: ClassAccessorDecoratorTarget<This, Value>,
  context: ClassAccessorDecoratorContext<This, Value>,
): void {
  if (context.kind !== "accessor") {
    throw new TypeError("@state only supports standard accessor decorators.");
  }

  ensureContextModuleMetadata(context)?.state.add(context.name);

  context.addInitializer(function initializeState(this: This) {
    addModuleState(this.constructor, context.name);
  });
}

export function action<This extends object, Args extends unknown[], Return>(
  _value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
): void {
  if (context.kind !== "method") {
    throw new TypeError("@action only supports method decorators.");
  }

  ensureContextModuleMetadata(context)?.actions.add(context.name);

  context.addInitializer(function initializeAction(this: This) {
    addModuleAction(this.constructor, context.name);
  });
}

export function computed<This extends object, Value>(
  _value: (this: This) => Value,
  context: ClassGetterDecoratorContext<This, Value>,
): void {
  if (context.kind !== "getter") {
    throw new TypeError("@computed only supports getter decorators.");
  }

  ensureContextModuleMetadata(context)?.computed.add(context.name);

  context.addInitializer(function initializeComputed(this: This) {
    addModuleComputed(this.constructor, context.name);
  });
}

export function effect<This extends object, Args extends unknown[], Return>(
  _value: (this: This, ...args: Args) => Return,
  _context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
): void {
  // Effect scheduling is intentionally deferred until the app runtime has real
  // lifecycle semantics for reactive side effects.
}

export function moduleOptions(target: Constructor, options: ModuleOptions): void {
  applyModuleOptions(ensureModuleMetadata(target), options);
}
