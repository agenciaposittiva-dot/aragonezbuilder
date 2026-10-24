/*
 * Validação de endereço de API informado pela pessoa (BYOK): só HTTPS, sem
 * credenciais na URL e nunca um endereço interno (proteção contra SSRF). A
 * parte de DNS fica no servidor (src/server/services/ai-connections.ts).
 */

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".arpa"];

/** Endereço IPv4 privado, de loopback, link-local, de metadados ou reservado. */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast e reservados
  return false;
}

/** Endereço IPv6 privado, de loopback, link-local ou IPv4 mapeado em faixa privada. */
export function isPrivateIPv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return isPrivateIPv4(mapped[1]!);
  return false;
}

export function isPrivateIp(ip: string): boolean {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

export type EndpointCheck = { ok: true; url: string; host: string } | { ok: false; error: string };

/**
 * Normaliza e valida a URL (sem DNS): devolve a origem + caminho sem barra
 * final. Rejeita http, usuário/senha na URL, portas fora de 443, IPs literais
 * privados e nomes internos.
 */
export function checkEndpointUrl(raw: string): EndpointCheck {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Informe o endereço." };
  if (text.length > 300) return { ok: false, error: "Endereço longo demais." };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: "Endereço inválido (use https://host/caminho)." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Só endereços https:// são aceitos." };
  if (u.username || u.password) return { ok: false, error: "Não inclua usuário ou senha no endereço." };
  if (u.port && u.port !== "443") return { ok: false, error: "Só a porta padrão (443) é aceita." };
  if (u.search || u.hash) return { ok: false, error: "O endereço não pode ter parâmetros (?…) nem âncora (#…)." };
  const host = u.hostname.toLowerCase();
  const ipLiteral = /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[");
  if (ipLiteral) {
    if (isPrivateIp(host)) return { ok: false, error: "Endereços internos não são permitidos." };
  } else {
    if (!host.includes(".")) return { ok: false, error: "Use um nome de domínio completo." };
    if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
      return { ok: false, error: "Endereços internos não são permitidos." };
    }
  }
  const path = u.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${u.protocol}//${u.host}${path}`, host };
}
