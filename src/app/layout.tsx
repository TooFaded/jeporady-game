import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/brand";
export const metadata: Metadata = {
  title: "QuizArena — Your game night, reimagined.",
  description:
    "Bring your people. Bring your trivia brain. Host a QuizArena lobby and invite friends with one simple code.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div className="site-shell">
          <Header />
          {children}
          <footer>
            <span>© {new Date().getFullYear()} QuizArena</span>
            <span>A little knowledge. A lot of friendly competition.</span>
            <span className="footer-badge">
              <i /> MADE FOR GAME NIGHT
            </span>
          </footer>
        </div>
      </body>
    </html>
  );
}
