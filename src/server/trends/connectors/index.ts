import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "@/server/env";
import { calendarConnector } from "./calendar";
import { googleTrendsConnector } from "./google-trends";
import { rssConnector, validateFeedUrl } from "./rss";
import { ConnectorError, type FetchText, type TrendConnector, type TrendSourceKind } from "./types";
import { wikimediaConnector } from "./wikimedia";
import { youtubeConnector } from "./youtube";

export const CONNECTORS: Record<TrendSourceKind, TrendConnector> = {
  google_trends: googleTrendsConnector,
  wikimedia: wikimediaConnector,
  youtube: youtubeConnector,
  rss: rssConnector,
  calendar: calendarConnector,
};

export { ConnectorError };
export type { CollectedItem, SourceSpec, TrendSourceKind } from "./types";

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;

function privateAddress(ip: string) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return (
      v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.")
    );
  }
  return /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
    ip,
  );
}

/** Recusa hosts que resolvem para rede interna (proteção contra SSRF em feeds informados pela agência). */
async function assertPublicHost(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new ConnectorError(`Não foi possível resolver ${host}.`);
  if (addrs.some((a) => privateAddress(a.address)))
    throw new ConnectorError("Endereços de rede interna não são permitidos.");
}

/**
 * Busca um texto de fonte externa com tempo limite, tamanho máximo,
 * User-Agent identificável (exigido pela Wikimedia) e redirecionamentos
 * validados um a um.
 */
export const fetchText: FetchText = async (rawUrl, init) => {
  let url = new URL(validateFeedUrl(rawUrl));
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicHost(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": `AragonezBuilder/1.0 (Radar de Tendencias; +${env.APP_URL})`,
          accept: "application/rss+xml, application/atom+xml, application/json, application/xml, text/xml, */*;q=0.5",
          ...init?.headers,
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as Error).name === "AbortError";
      throw new ConnectorError(
        aborted ? "A fonte demorou demais para responder." : `Falha de conexão com ${url.hostname}.`,
      );
    }
    clearTimeout(timer);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(validateFeedUrl(new URL(res.headers.get("location")!, url).toString()));
      continue;
    }
    if (!res.ok)
      throw new ConnectorError(`A fonte respondeu ${res.status}${res.status === 403 ? " (acesso negado)" : ""}.`);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new ConnectorError("Resposta grande demais.");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new ConnectorError("Resposta grande demais.");
    return buf.toString("utf8");
  }
  throw new ConnectorError("Redirecionamentos demais.");
};
