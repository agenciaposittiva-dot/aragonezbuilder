import { Fragment } from "react";
import { cn } from "@/lib/utils";

/**
 * Renderizador mínimo e seguro de Markdown (títulos, listas, negrito, itálico,
 * código e tabelas). Gera elementos React — nunca injeta HTML.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1]!.length;
      const cls = level <= 2 ? "mt-4 text-base font-semibold" : "mt-3 text-sm font-semibold";
      blocks.push(
        <p key={key++} className={cls}>
          {inline(heading[2]!)}
        </p>,
      );
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const cells = lines[i]!.trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={key++} className="my-3 scrollbar-thin overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            {head ? (
              <thead className="bg-surface-2/60">
                <tr>
                  {head.map((c, j) => (
                    <th key={j} className="px-3 py-2 text-left text-xs font-semibold text-fg-muted">
                      {inline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri} className="border-t border-border align-top">
                  {r.map((c, j) => (
                    <td key={j} className="px-3 py-2">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key++} className={cn("my-2 grid gap-1 pl-5", ordered ? "list-decimal" : "list-disc")}>
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      blocks.push(
        <blockquote key={key++} className="my-2 border-l-2 border-accent pl-3 text-fg-muted">
          {inline(line.replace(/^>\s?/, ""))}
        </blockquote>,
      );
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|\s*([-*•]|\d+[.)])\s|\||>)/.test(lines[i]!)) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-2">
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 ? <br /> : null}
            {inline(p)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className={cn("text-sm leading-relaxed text-fg", className)}>{blocks}</div>;
}

function inline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) out.push(<strong key={k++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`"))
      out.push(
        <code key={k++} className="rounded bg-surface-2 px-1 text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      );
    else out.push(<em key={k++}>{token.slice(1, -1)}</em>);
    last = m.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
