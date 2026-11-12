"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="entry-page">
      <h1>A brief intermission.</h1>
      <p>Something went wrong. Give it another try.</p>
      <button className="button button-primary" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
