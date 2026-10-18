"use client";

import Link from "next/link";
import { Fragment } from "react";
import { parseMessage, type ChatNode } from "@/lib/chat-format";
import { cn } from "@/lib/utils";

/** Mensagem formatada a partir dos nós (nunca HTML cru). */
export function MessageBody({
  body,
  nameOf,
  me,
  className,
}: {
  body: string;
  nameOf: (userId: string) => string | undefined;
  me: string;
  className?: string;
}) {
  const nodes = parseMessage(body);
  return (
    <div className={cn("text-sm leading-relaxed break-words whitespace-pre-wrap", className)}>{render(nodes)}</div>
  );

  function render(list: ChatNode[]): React.ReactNode {
    return list.map((n, i) => {
      switch (n.t) {
        case "text":
          return <Fragment key={i}>{n.v}</Fragment>;
        case "br":
          return <br key={i} />;
        case "bold":
          return <strong key={i}>{render(n.c)}</strong>;
        case "italic":
          return <em key={i}>{render(n.c)}</em>;
        case "strike":
          return <s key={i}>{render(n.c)}</s>;
        case "code":
          return (
            <code key={i} className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[0.85em]">
              {n.v}
            </code>
          );
        case "pre":
          return (
            <pre key={i} className="my-1 overflow-x-auto rounded-md bg-surface-3 p-2 font-mono text-xs whitespace-pre">
              {n.v}
            </pre>
          );
        case "mention": {
          const name = nameOf(n.id);
          return (
            <span
              key={i}
              className={cn("rounded px-0.5 font-medium", n.id === me ? "bg-accent/25 text-fg" : "text-accent-text")}
            >
              @{name ?? "alguém"}
            </span>
          );
        }
        case "link":
          return n.href.startsWith("/") ? (
            <Link key={i} href={n.href} className="text-accent-text underline underline-offset-2 hover:no-underline">
              {n.v}
            </Link>
          ) : (
            <a
              key={i}
              href={n.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-accent-text underline underline-offset-2 hover:no-underline"
            >
              {n.v}
            </a>
          );
      }
    });
  }
}
