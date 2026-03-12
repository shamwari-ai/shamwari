"use client";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: "bold" }}>Something went wrong</h1>
          <p>An unexpected error occurred.</p>
          <button onClick={reset} style={{ textDecoration: "underline" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
