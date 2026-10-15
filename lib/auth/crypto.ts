const HEX = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));

export function randomOpaqueToken(byteLength = 32): string {
  if (!Number.isInteger(byteLength) || byteLength < 32) {
    throw new Error("Opaque auth material must contain at least 256 bits of entropy.");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => HEX[byte]).join("");
}
