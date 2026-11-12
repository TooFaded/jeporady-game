import Link from "next/link";
import { Zap } from "lucide-react";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="QuizArena home">
      <span className="brand-icon">
        <Zap size={22} fill="currentColor" />
      </span>
      Quiz<span className="brand-light">Arena</span>
      <span className="brand-dot">.</span>
    </Link>
  );
}
export function Header() {
  return (
    <header className="header">
      <Brand />
      <span className="header-caption">GOOD FRIENDS. GREAT RIVALRIES.</span>
      <Link className="header-link" href="/host">
        Host a game <span aria-hidden="true">↗</span>
      </Link>
    </header>
  );
}
