// Runs once when the Node.js server starts: refuse to boot with unsafe production configuration.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertAuthSecret } = await import("./lib/env");
    assertAuthSecret();
  }
}
