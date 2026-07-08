// lipdverse.org doesn't send CORS headers on .lpd downloads, so the Express
// app exposes a restricted proxy (GET /lpd-proxy?url=...) for opening remote
// datasets in the editor.
export function proxiedLpdUrl(url: string): string {
  return `/lpd-proxy?url=${encodeURIComponent(url)}`
}
