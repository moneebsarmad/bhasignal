"use client";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <section className="panel">
        <h1>Something went wrong</h1>
        <p>{error.message}</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}

