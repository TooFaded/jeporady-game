"use client";
import { CompetitionSettings } from "./competition";
import { useState } from "react";
import { ArrowRight, BookOpen, Check, RefreshCw, Save } from "lucide-react";
import { Button, Card, ErrorMessage } from "@/components/ui";
import { api } from "@/features/lobby/api";
import { boardDraftSchema } from "@/lib/game-validation";
import type { BoardEditorSnapshot } from "@/types/board";
import type { RoomState } from "@/types/game";
export function BoardEditor({
  room,
  onRoom,
}: {
  room: RoomState;
  onRoom: (room: RoomState) => void;
}) {
  const [editor, setEditor] = useState<BoardEditorSnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const game = room.game;
  const teamRules = game?.competition;
  const teamsReady =
    teamRules?.play_mode !== "team" ||
    (!!teamRules.teams_locked &&
      room.players.every((p) =>
        teamRules.teams?.some((t) => t.members.some((m) => m.id === p.id)),
      ) &&
      (teamRules.teams?.filter((t) => t.members.some((m) => !m.left)).length ??
        0) >= 2);
  const ready =
    room.players.some((player) => player.is_connected) && teamsReady;
  const stale = !!editor && !!game && editor.version !== game.version;
  async function load() {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const result = await api<{ editor: BoardEditorSnapshot }>(
        `/api/rooms/${room.room_code}/game`,
        { action: "editor" },
      );
      setEditor(result.editor);
      setDirty(false);
      setExpanded(true);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not load questions.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!editor) return;
    setError(null);
    setNotice("");
    const parsed = boardDraftSchema.safeParse({
      categories: editor.categories,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(`${issue.path.join(" → ")}: ${issue.message}`);
      return;
    }
    setBusy(true);
    try {
      const { room: updated } = await api<{ room: RoomState }>(
        `/api/rooms/${room.room_code}/game`,
        { action: "save", expectedVersion: editor.version, board: parsed.data },
      );
      onRoom(updated);
      setEditor({ ...editor, ...parsed.data, version: updated.game!.version });
      setDirty(false);
      setNotice("All 25 clues validated and saved.");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save questions.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function start() {
    if (!game || dirty || stale) return;
    setBusy(true);
    setError(null);
    try {
      const { room: updated } = await api<{ room: RoomState }>(
        `/api/rooms/${room.room_code}/game`,
        { action: "start", expectedVersion: game.version },
      );
      onRoom(updated);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not start.");
    } finally {
      setBusy(false);
    }
  }
  function editName(value: string) {
    if (!editor) return;
    setEditor({
      ...editor,
      categories: editor.categories.map((c, i) =>
        i === category ? { ...c, name: value } : c,
      ),
    });
    setDirty(true);
    setNotice("");
  }
  function editClue(index: number, key: "question" | "answer", value: string) {
    if (!editor) return;
    setEditor({
      ...editor,
      categories: editor.categories.map((c, i) =>
        i === category
          ? {
              ...c,
              clues: c.clues.map((q, j) =>
                j === index ? { ...q, [key]: value } : q,
              ),
            }
          : c,
      ),
    });
    setDirty(true);
    setNotice("");
  }
  return (
    <Card className="board-setup">
      <div className="setup-heading">
        <div>
          <span className="eyebrow">HOST’S PREPARATION DESK</span>
          <h2>
            <BookOpen size={21} /> Make it your game.
          </h2>
          <p>
            Five categories. Twenty-five clues. Start with the sample, or put
            your own spin on it.
          </p>
        </div>
        <span className="phase-badge">25 CLUES · 5 CATEGORIES</span>
      </div>
      <CompetitionSettings room={room} onRoom={onRoom} />
      <div className="setup-categories">
        {game?.categories.map((c) => (
          <span key={c.id}>{c.name}</span>
        ))}
      </div>
      {!game && (
        <ErrorMessage message="Apply the Phase 2 database migration, then refresh to prepare your game board." />
      )}
      <ErrorMessage message={error} />
      {stale && (
        <p className="error" role="status">
          This board changed in another tab. Your local edits are preserved.
          Reload the saved questions before making another change.
        </p>
      )}
      {expanded && editor && (
        <div className="editor-content">
          <div
            className="editor-category-switch"
            role="group"
            aria-label="Choose a category to edit"
          >
            {editor.categories.map((c, i) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={i === category}
                onClick={() => setCategory(i)}
              >
                {i + 1}. {c.name || "Untitled"}
              </button>
            ))}
          </div>
          <fieldset disabled={busy}>
            <div className="field">
              <label htmlFor={`category-${editor.categories[category].id}`}>
                Category name
              </label>
              <input
                id={`category-${editor.categories[category].id}`}
                value={editor.categories[category].name}
                onChange={(e) => editName(e.target.value)}
                maxLength={40}
              />
            </div>
            {editor.categories[category].clues.map((clue, index) => (
              <div key={clue.id} className="editor-clue">
                <span className="editor-value">
                  {((clue.position + 1) * 200).toLocaleString("en-US")}
                  <small>POINTS</small>
                </span>
                <div className="editor-fields">
                  <div className="field">
                    <label htmlFor={`question-${clue.id}`}>
                      Clue {index + 1}
                    </label>
                    <textarea
                      id={`question-${clue.id}`}
                      value={clue.question}
                      onChange={(e) =>
                        editClue(index, "question", e.target.value)
                      }
                      rows={2}
                      maxLength={1000}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`answer-${clue.id}`}>
                      Correct answer{" "}
                      <span className="muted">· host-only until revealed</span>
                    </label>
                    <textarea
                      id={`answer-${clue.id}`}
                      value={clue.answer}
                      onChange={(e) =>
                        editClue(index, "answer", e.target.value)
                      }
                      rows={1}
                      maxLength={300}
                    />
                  </div>
                </div>
              </div>
            ))}
          </fieldset>
        </div>
      )}
      <div className="setup-actions">
        <div className="setup-edit-actions">
          <Button
            variant="secondary"
            busy={busy}
            onClick={() => {
              if (editor) setExpanded(!expanded);
              else void load();
            }}
          >
            <BookOpen size={16} />
            {expanded ? "Hide editor" : "Review & edit questions"}
          </Button>
          {editor && (
            <Button variant="ghost" busy={busy} onClick={() => void load()}>
              <RefreshCw size={15} />
              Reload saved
            </Button>
          )}
          {expanded && (
            <Button
              variant="secondary"
              busy={busy}
              disabled={!dirty || stale}
              onClick={() => void save()}
            >
              <Save size={16} />
              Save all 25 clues
            </Button>
          )}
        </div>
        <Button
          busy={busy}
          disabled={!game || !ready || dirty || stale}
          onClick={() => void start()}
        >
          Start Game
          <ArrowRight size={18} />
        </Button>
      </div>
      <div className="setup-status" role="status">
        {notice ? (
          <>
            <Check size={15} />
            {notice}
          </>
        ) : dirty ? (
          "You have unsaved changes. Save all 25 clues before starting."
        ) : !ready ? (
          "Assign all players, populate at least two teams and lock selection in Team Mode. At least one player must be connected."
        ) : (
          "Your board is ready. Bring on the friendly competition."
        )}
      </div>
    </Card>
  );
}
