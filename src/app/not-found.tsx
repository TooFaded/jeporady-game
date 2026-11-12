import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="entry-page">
      <h1>That arena is off the map.</h1>
      <p>Check your six-character room code and try again.</p>
      <Link href="/" className="button button-primary">
        Back to QuizArena
      </Link>
    </main>
  );
}
