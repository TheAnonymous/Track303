/*
 * Projects as links: the project file, compressed, after `#p=` in the URL.
 * The part after `#` never reaches the server, so sharing a track uploads
 * nothing; whoever opens the link gets their own copy as a new project.
 */

const MARK = "#p=";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, transform: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The link to a project file (the JSON `exportProject` writes). */
export async function shareLink(fileJson: string, base: string): Promise<string> {
  const compact = JSON.stringify(JSON.parse(fileJson));
  const packed = await pipe(new TextEncoder().encode(compact), new CompressionStream("deflate-raw"));
  return `${base}${MARK}${toBase64Url(packed)}`;
}

/** The project file inside a link's `#p=…` part, or `null` when the hash holds none. */
export async function sharedFile(hash: string): Promise<string | null> {
  if (!hash.startsWith(MARK)) return null;
  try {
    const bytes = await pipe(fromBase64Url(hash.slice(MARK.length)), new DecompressionStream("deflate-raw"));
    return new TextDecoder().decode(bytes);
  } catch {
    throw new Error("Der Link ist unvollständig oder beschädigt.");
  }
}

/** The track name a shared file carries, for asking before opening it. */
export function sharedName(fileJson: string): string {
  try {
    const value = JSON.parse(fileJson) as { name?: unknown };
    return typeof value.name === "string" && value.name.trim() ? value.name : "Track";
  } catch {
    return "Track";
  }
}
