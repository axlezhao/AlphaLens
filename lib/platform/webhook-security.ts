export function validateWebhookUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Webhook 必须是合法 HTTPS URL"); }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("Webhook 只允许标准 HTTPS endpoint");
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") || isPrivateIp(hostname)) throw new Error("Webhook 禁止本机、内网或保留地址");
  return url.toString();
}

function isPrivateIp(hostname: string) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) { const [a, b] = hostname.split(".").map(Number); return a === 10 || a === 127 || a === 0 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168; }
  return hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80");
}
