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

  if (settings.login.layout === "card") {
    return (
      <CardLayout
        settings={settings}
        name={name}
        orgName={orgName}
        title={title}
        message={message}
        logo={heroLogo}
        backgroundUrl={backgroundUrl}
        frame={frame}
      >
        {children}
      </CardLayout>
    );
  }

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

/**
 * Login em cartão: fundo na cor da marca com a logo do cliente no topo; à
 * esquerda o formulário num painel escuro com borda curva, à direita a arte
 * (1920 × 1080) escolhida pela agência. No celular, a arte vira uma faixa no
 * topo do cartão. Sem arte, usa as cores da marca (sem imagem quebrada).
 */
function CardLayout({
  settings,
  name,
  orgName,
  title,
  message,
  logo,
  backgroundUrl,
  frame,
  children,
}: {
  settings: PortalSettings;
  name: string;
  orgName: string;
  title: string;
  message: string;
  logo: string | null;
  backgroundUrl: string | null;
  frame?: "desktop" | "mobile";
  children: React.ReactNode;
}) {
  const mobile = frame === "mobile";
  const desktop = frame === "desktop";
  const wide = desktop ? "" : mobile ? "hidden" : "hidden md:block";
  const art = (
    <div
      className={cn(
        "relative isolate overflow-hidden text-white",
        // Altura da célula do cartão (só tem filhos absolutos; "auto" daria altura zero).
        mobile ? "h-36" : desktop ? "h-full" : "h-36 md:h-full",
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
              "radial-gradient(90% 90% at 85% 15%, color-mix(in oklab, var(--portal-highlight) 55%, transparent) 0%, transparent 65%), linear-gradient(150deg, color-mix(in oklab, var(--accent) 70%, black) 0%, var(--portal-secondary) 100%)",
          }}
        />
      )}
      {/* Texto só sobre a arte padrão: numa imagem própria, a mensagem já faz parte da arte. */}
      {backgroundUrl ? null : (
        <div className={cn("absolute inset-x-0 bottom-0 p-10 md:pl-24", wide)}>
          <p className="max-w-md text-3xl leading-tight font-semibold tracking-tight">{title}</p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/80">{message}</p>
        </div>
      )}
    </div>
  );

  return (
    <div
      className={cn("flex flex-col", frame ? "h-full overflow-hidden" : "min-h-dvh")}
      style={{
        ...portalThemeStyle(settings),
        background:
          "linear-gradient(180deg, var(--accent) 0%, color-mix(in oklab, var(--accent) 80%, black) 100%)",
      }}
      data-login-layout="card"
    >
      <header className={cn("flex h-24 shrink-0 items-center px-6", !mobile && "sm:px-12")}>
        {logo ? (
          // Espaço da logo: 200 × 80 (envie em 400 × 160 para telas de alta densidade).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt={name} className="max-h-16 w-auto max-w-[200px] object-contain" />
        ) : (
          <span className="text-xl font-semibold tracking-tight text-[var(--accent-fg)]">{name}</span>
        )}
      </header>
      <main className={cn("flex flex-1 flex-col items-center px-4 pb-6", !mobile && "sm:px-10")}>
        <div
          className={cn(
            "grid w-full max-w-6xl flex-1 overflow-hidden rounded-[28px] bg-[#18181b] shadow-2xl ring-1 ring-black/20",
            desktop ? "grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]" : mobile ? "grid-rows-[auto_1fr]" : "md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]",
            !frame && "max-h-[760px] md:min-h-[560px]",
          )}
        >
          {/* z-10: a borda curva fica por cima da arte. */}
          <div className={cn("relative z-10 order-2", desktop ? "order-1" : !mobile && "md:order-1")}>
            <div className={cn("relative z-10 flex h-full flex-col justify-center px-6 py-8", desktop ? "px-14" : !mobile && "sm:px-14")}>
              <div className="mx-auto w-full max-w-sm">{children}</div>
            </div>
            {/* Borda curva entre o formulário e a arte, na cor da marca. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 100 800"
              preserveAspectRatio="none"
              className={cn("absolute top-0 -right-16 z-0 h-full w-24", wide)}
            >
              <path d="M0 0 C 70 180, 70 620, 0 800 L 30 800 C 100 620, 100 180, 30 0 Z" fill="var(--accent)" />
              <path d="M0 0 C 70 180, 70 620, 0 800 L 0 0 Z" fill="#18181b" />
            </svg>
          </div>
          <div className={cn("order-1 min-h-0", desktop ? "order-2" : !mobile && "md:order-2")}>{art}</div>
        </div>
        <p className="mt-4 text-center text-[11px] text-[var(--accent-fg)] opacity-80">
          Portal de {name} · operado por {orgName} com {APP_NAME}
        </p>
      </main>
    </div>
  );
}
