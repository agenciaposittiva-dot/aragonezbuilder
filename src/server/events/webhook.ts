import { createHmac } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { env } from "@/server/env";

/*
 * Webhooks de automações com proteção contra SSRF:
 *  - só https (http apenas em desenvolvimento);
 *  - o endereço é validado NO MOMENTO DA CONEXÃO (lookup customizado), o que
 *    impede DNS rebinding entre a validação e o envio;
 *  - redes privadas, loopback, link-local, metadados de nuvem e multicast são bloqueados;
 *  - redirecionamentos não são seguidos; tempo limite de 5 s; resposta descartada.
 */

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function inV4Block(ip: string, base: string, bits: number) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/** true para endereços que não podem receber webhooks. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "");
  const family = isIP(ip);
  if (family === 4) return V4_BLOCKS.some(([base, bits]) => inV4Block(ip, base, bits));
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(lower)) return true; // v4 mapeado em hexa: bloqueia por segurança
    const first = parseInt(lower.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 (ULA)
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (lower.startsWith("64:ff9b:")) return true; // NAT64
    if (lower.startsWith("2001:db8:")) return true; // documentação
    return false;
  }
  return true; // não é um IP válido
}

export class WebhookUrlError extends Error {}

/** Valida a URL (sintaxe, protocolo e nome) antes de qualquer conexão. */
export function assertSafeWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError("URL inválida.");
  }
  const allowHttp = env.NODE_ENV === "development";
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new WebhookUrlError("Use uma URL https.");
  }
  if (url.username || url.password) throw new WebhookUrlError("A URL não pode conter credenciais.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new WebhookUrlError("Endereço não permitido.");
  }
  if (isIP(host) && isPrivateAddress(host)) throw new WebhookUrlError("Endereço de rede privada não permitido.");
  return url;
}

/** Lookup que recusa qualquer resolução para endereços privados. */
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  dnsLookup(hostname, { all: true, family: options.family }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as LookupAddress[];
    const blocked = list.find((a) => isPrivateAddress(a.address));
    if (!list.length || blocked) {
      const e = new Error(`Endereço bloqueado: ${hostname} resolve para rede privada.`) as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return callback(e, "", 4);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}

/** Segredo de assinatura dos webhooks da organização (derivado; mostrado aos administradores). */
export function webhookSecret(organizationId: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`webhook:${organizationId}`).digest("hex");
}

export function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function postWebhook(
  rawUrl: string,
  payload: unknown,
  secret: string,
  timeoutMs = 5000,
): Promise<{ status: number }> {
  const url = assertSafeWebhookUrl(rawUrl);
  const body = JSON.stringify(payload);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        lookup: guardedLookup as never,
        timeout: timeoutMs,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "Aragonez-Webhooks/1.0",
          "x-aragonez-signature": signPayload(secret, body),
        },
      },
      (res) => {
        res.resume(); // descarta o corpo
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve({ status });
        else
          reject(
            new Error(
              `Webhook respondeu ${status}${status >= 300 && status < 400 ? " (redirecionamentos não são seguidos)" : ""}`,
            ),
          );
      },
    );
    req.on("timeout", () => req.destroy(new Error("Tempo limite de 5 s excedido")));
    req.on("error", reject);
    req.end(body);
  });
}
