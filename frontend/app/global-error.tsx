"use client";

// Error boundary de dernier recours (erreur dans le layout racine).
// Doit rendre ses propres <html>/<body> car il remplace tout le document.
export default function GlobalError({
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <html lang="fr">
            <body
                style={{
                    display: "flex",
                    minHeight: "100vh",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "system-ui, sans-serif",
                    background: "#f8fafc",
                    padding: "1.5rem",
                }}
            >
                <div style={{ maxWidth: "28rem", textAlign: "center" }}>
                    <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#0f172a" }}>
                        Une erreur est survenue
                    </h1>
                    <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#64748b" }}>
                        Un problème inattendu s&apos;est produit. Vous pouvez réessayer.
                    </p>
                    <button
                        onClick={reset}
                        style={{
                            marginTop: "1.5rem",
                            borderRadius: "0.5rem",
                            background: "#2563eb",
                            color: "#fff",
                            border: "none",
                            padding: "0.5rem 1rem",
                            fontSize: "0.875rem",
                            fontWeight: 500,
                            cursor: "pointer",
                        }}
                    >
                        Réessayer
                    </button>
                </div>
            </body>
        </html>
    );
}
