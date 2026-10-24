"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";

type Theme = "light" | "dark" | "system";

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function read(): Theme {
  try {
    return (localStorage.getItem("theme") as Theme) || "system";
  } catch {
    return "system";
  }
}

// Com "Sistema", a troca de esquema do sistema operacional vale na hora (sem recarregar).
if (typeof window !== "undefined" && "matchMedia" in window) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (read() === "system") apply("system");
  });
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem("theme", theme);
  } catch {}
  apply(theme);
  listeners.forEach((l) => l());
}

export function useTheme() {
  return useSyncExternalStore(subscribe, read, () => "system" as Theme);
}

/** Itens de tema para o menu de perfil. */
export function ThemeMenuItems() {
  const theme = useTheme();
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
      <DropdownMenuRadioItem value="light">
        <Sun /> Claro
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="dark">
        <Moon /> Escuro
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="system">
        <Monitor /> Sistema
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}
