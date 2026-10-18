"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420, padding: 16 }}>
          <h1 style={{ fontSize: 18 }}>A aplicação encontrou um erro inesperado</h1>
          <p style={{ color: "#5e5b55", fontSize: 14 }}>Recarregue a página. Código: {error.digest ?? "—"}</p>
          <p style={{ color: "#5e5b55", fontSize: 13, marginTop: 4 }}>
            Acabou de publicar a plataforma?{" "}
            <a href="/setup" style={{ color: "#8a6a12" }}>
              Veja o diagnóstico da instalação
            </a>
            .
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: 12,
              padding: "8px 16px",
              borderRadius: 8,
              background: "#161513",
              color: "#fff",
              border: 0,
            }}
          >
            Tentar novamente
          </button>
        </div>
      </body>
    </html>
  );
}
