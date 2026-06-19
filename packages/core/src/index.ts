export function createGreeting(name = "world"): string {
  const normalizedName = name.trim();

  return `Hello, ${normalizedName || "world"}!`;
}
