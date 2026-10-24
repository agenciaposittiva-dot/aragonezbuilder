"use client";

import { useEffect } from "react";

/*
 * Ponte entre o chat dentro da janela flutuante (iframe) e a página de fora.
 * Links para outras áreas (tarefa, projeto, arquivo) abrem na página de fora,
 * nunca dentro da janela; anexos em nova aba continuam como estão.
 */

export const EMBED_NAVIGATE = "aragonez-chat:navigate";
export const EMBED_OPEN = "aragonez-chat:open";
export const EMBED_ACTIVE = "aragonez-chat:active";

export function ChatEmbedBridge() {
  useEffect(() => {
    if (window.parent === window) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/chat-dock/")) return;
      e.preventDefault();
      e.stopPropagation();
      window.parent.postMessage({ type: EMBED_NAVIGATE, href: url.pathname + url.search + url.hash }, location.origin);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
