import { InjectContextError } from "./errors.js";
import { tokenName } from "./token.js";
import type { InjectionToken, ResolutionContext, TokenValue } from "./types.js";

let activeResolutionContext: ResolutionContext | undefined;

export function inject<TToken extends InjectionToken>(token: TToken): TokenValue<TToken> {
  if (activeResolutionContext === undefined) {
    throw new InjectContextError(tokenName(token));
  }

  return activeResolutionContext.resolve(token) as TokenValue<TToken>;
}

export function runWithInjectContext<T>(context: ResolutionContext, callback: () => T): T {
  const previousContext = activeResolutionContext;
  activeResolutionContext = context;

  try {
    return callback();
  } finally {
    activeResolutionContext = previousContext;
  }
}
