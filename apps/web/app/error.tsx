"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground">An unexpected error occurred.</p>
      <button
        onClick={reset}
        className="text-primary underline underline-offset-4"
      >
        Try again
      </button>
    </div>
  );
}
