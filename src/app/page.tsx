import Link from "next/link";
import {
  ArrowRight,
  Check,
  Crown,
  Globe2,
  Smartphone,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { JoinCode } from "@/features/lobby/join-code";
const categories = ["POP CULTURE", "SCIENCE", "WORLD", "WILD CARD", "HISTORY"];
export default function Home() {
  return (
    <main id="main">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span /> YOUR PEOPLE. YOUR PLAYGROUND.
          </div>
          <h1>
            Your Game Night,
            <br />
            <span>Reimagined.</span>
          </h1>
          <p className="hero-description">
            Big questions. Friendly rivalries. Unforgettable nights.
            <br className="desktop-break" /> Turn your crew into contestants in
            your own trivia arena.
          </p>
          <Link href="/host" className="button button-primary hero-cta">
            <Zap size={19} fill="currentColor" /> Host a Game{" "}
            <ArrowRight size={19} />
          </Link>
          <div className="hero-notes">
            <span>
              <Check size={14} /> No downloads
            </span>
            <span>
              <Check size={14} /> No player accounts
            </span>
            <span>
              <Check size={14} /> Just good company
            </span>
          </div>
          <JoinCode />
        </div>
        <div
          className="arena-visual"
          aria-label="Illustration of the QuizArena trivia board"
        >
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="floating-tag tag-top">
            <span className="live-dot" /> GAME NIGHT, UPGRADED
          </div>
          <div className="board-frame">
            <div className="board-title">
              <span>
                <Zap size={15} fill="currentColor" /> THE ARENA
              </span>
              <span>
                ROUND 01 <i />
              </span>
            </div>
            <div className="sample-board">
              {categories.map((category) => (
                <div className="sample-column" key={category}>
                  <div className="category">{category}</div>
                  {[200, 400, 600, 800, 1000].map((value) => (
                    <div
                      key={value}
                      className={`point ${category === "SCIENCE" && value === 400 ? "point-highlight" : ""}`}
                    >
                      {value === 400 && category === "SCIENCE" ? (
                        <Sparkles size={24} />
                      ) : (
                        `$${value.toLocaleString("en-US")}`
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="board-bottom">
              <span>
                <Users size={14} /> Your crew goes here
              </span>
              <span>
                LET’S PLAY <ArrowRight size={12} />
              </span>
            </div>
          </div>
          <div className="floating-tag tag-bottom">
            <span className="trophy-icon">
              <Crown size={22} />
            </span>
            <div>
              Bragging rights await.
              <small>Everyone’s got a winning category.</small>
            </div>
          </div>
          <div className="preview-label">
            A SNEAK PEEK AT THE ARENA · 25 CLUES. ONE SHARED ARENA.
          </div>
        </div>
      </section>
      <section className="how-section" aria-labelledby="how-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">LESS SETUP. MORE SHOWTIME.</span>
            <h2 id="how-title">From group chat to game night.</h2>
          </div>
          <span className="steps-caption">THREE STEPS. ONE GREAT NIGHT.</span>
        </div>
        <div className="steps">
          <article>
            <span className="step-icon">
              <Crown size={23} />
            </span>
            <div>
              <span className="step-number">01 / SET THE STAGE</span>
              <h3>One host. Endless possibility.</h3>
              <p>
                Create your room and take the host’s seat.
                <br />
                Your game night starts right here.
              </p>
            </div>
          </article>
          <article>
            <span className="step-icon">
              <Smartphone size={23} />
            </span>
            <div>
              <span className="step-number">02 / GATHER YOUR CREW</span>
              <h3>A code is all it takes.</h3>
              <p>
                Share the invite. Friends join on their phones.
                <br />
                No sign-ups, no app-store detours.
              </p>
            </div>
          </article>
          <article>
            <span className="step-icon">
              <Globe2 size={23} />
            </span>
            <div>
              <span className="step-number">03 / MAKE IT A NIGHT</span>
              <h3>Same room. Or miles apart.</h3>
              <p>
                Get everyone together in your live lobby.
                <br />
                Explore 25 clues together.
              </p>
            </div>
          </article>
        </div>
      </section>
      <section className="bottom-note">
        <span>
          <Sparkles size={17} /> Built for the “one more round” kind of people.
        </span>
        <Link href="/host">
          Meet in the arena <ArrowRight size={16} />
        </Link>
      </section>
    </main>
  );
}
