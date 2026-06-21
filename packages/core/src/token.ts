import type { InjectionToken, Token } from "./types.js";

export function token<T>(description?: string): Token<T> {
  const id = Symbol(description);

  if (description === undefined) {
    return { id };
  }

  return { id, description };
}

export function tokenName(tokenValue: InjectionToken): string {
  if (typeof tokenValue === "string") {
    return tokenValue;
  }

  if (typeof tokenValue === "symbol") {
    return tokenValue.description ?? tokenValue.toString();
  }

  if (typeof tokenValue === "function") {
    return tokenValue.name || "<anonymous class>";
  }

  return tokenValue.description ?? tokenValue.id.description ?? tokenValue.id.toString();
}
