import { APP_NAME } from "@/lib/constants";
import type { PortalSettings } from "@/lib/portal-settings";
import { portalThemeStyle } from "@/lib/portal-theme";
import { cn } from "@/lib/utils";

/**
 * Tela de entrada do portal com a identidade do cliente. Recebe o formulário
 * como filho: na página real, o login de verdade; na prévia, uma amostra.
 * Sem personalização, usa a apresentação padrão da agência (sem imagens quebradas).
 */
export function PortalLoginView({
  settings,
  name,
  orgName,
  logoUrl,
  logoAltUrl,
  backgroundUrl,
  children,
  frame,
}: {
  settings: PortalSettings;
  name: string;
  orgName: string;
  logoUrl: string | null;
  logoAltUrl: string | null;
  backgroundUrl: string | null;
  children: React.ReactNode;
  /** Na prévia, ocupa o contêiner em vez da tela inteira. */
  frame?: "desktop" | "mobile";
}) {
  const title = settings.login.title ?? settings.welcomeTitle ?? `Portal ${name}`;
  const message =
    settings.login.message ??
    settings.welcomeText ??
    `Acompanhe projetos, aprove materiais e envie novas demandas para a ${orgName}.`;
  const heroLogo = logoAltUrl ?? logoUrl;
  const mobile = frame === "mobile";
  // Na prévia "desktop", o layout de duas colunas vale qualquer que seja a tela de quem edita.
  const desktop = frame === "desktop";

  const hero = (
    <div
      className={cn(
        "relative isolate flex flex-col justify-between overflow-hidden text-white",
        mobile ? "h-44 p-5" : desktop ? "h-auto p-10" : "h-48 p-6 lg:h-auto lg:p-10",
      )}
    >
      {backgroundUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={backgroundUrl} alt="" className="absolute inset-0 -z-20 size-full object-cover" />
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20"
          style={{
            background:
              "radial-gradient(120% 120% at 100% 100%, color-mix(in oklab, var(--portal-highlight) 45%, transparent) 0%, transparent 60%), linear-gradient(160deg, var(--portal-secondary) 0%, color-mix(in oklab, var(--portal-secondary) 65%, black) 100%)",
          }}
        />
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{ background: "linear-gradient(180deg, rgb(10 10 10 / 0.15) 0%, rgb(10 10 10 / 0.6) 100%)" }}
      />
      {heroLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={heroLogo} alt={name} className="max-h-10 w-auto max-w-[200px] self-start object-contain" />
      ) : (
        <span className="text-lg font-semibold tracking-tight">{name}</span>
      )}
      <div className={cn("max-w-md", mobile ? "hidden" : desktop ? "block" : "hidden lg:block")}>
        <p className="text-2xl leading-snug font-semibold tracking-tight">{title}</p>
        <p className="mt-3 text-sm leading-relaxed text-white/80">{message}</p>
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "grid bg-bg text-fg",
        frame ? "h-full" : "min-h-dvh",
        desktop ? "grid-cols-[1fr_minmax(0,520px)]" : !mobile && "lg:grid-cols-[1fr_minmax(0,520px)]",
      )}
      style={portalThemeStyle(settings)}
    >
      {hero}
      <main className={cn("flex flex-col px-5 py-8", desktop ? "px-10" : !mobile && "sm:px-10")}>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-6">
          <div className={cn(desktop ? "hidden" : !mobile && "lg:hidden")}>
            <p className="text-lg font-semibold tracking-tight">{title}</p>
            <p className="mt-1 text-sm text-fg-muted">{message}</p>
          </div>
          {children}
        </div>
        <p className="text-center text-[11px] text-fg-subtle">
          Portal de {name} · operado por {orgName} com {APP_NAME}
        </p>
      </main>
    </div>
  );
}
