export type GamePhase =
  | "lobby"
  | "board"
  | "clue_active"
  | "answer_revealed"
  | "completed"
  | "buzzers_open"
  | "player_answering"
  | "answer_judging"
  | "rebound_open";
export type ClueTile = {
  id: string;
  position: number;
  value: number;
  completed: boolean;
};
export type BoardCategory = {
  id: string;
  position: number;
  name: string;
  clues: ClueTile[];
};
export type ActiveClue = {
  id: string;
  category_id: string;
  category_name: string;
  value: number;
  question: string;
  answer?: string;
};
export type GameSnapshot = {
  id: string;
  version: number;
  phase: GamePhase;
  categories: BoardCategory[];
  active_clue: ActiveClue | null;
  completed_count: number;
  ended_early: boolean;
  competition?: CompetitionSnapshot;
  host_answer?: string;
  participants: { id: string; nickname: string }[];
};
export type EditorClue = {
  id: string;
  position: number;
  question: string;
  answer: string;
};
export type EditorCategory = {
  id: string;
  position: number;
  name: string;
  clues: EditorClue[];
};
export type BoardDraft = { categories: EditorCategory[] };
export type BoardEditorSnapshot = BoardDraft & { id: string; version: number };

export type CompetitionSnapshot = {
  scoring_mode: "classic" | "casual";
  answer_seconds: number;
  server_time: string;
  round_id: string | null;
  attempt: {
    id: string;
    player_id: string;
    nickname: string;
    deadline: string;
    outcome: "correct" | "incorrect" | "void" | null;
  } | null;
  attempted_player_ids: string[];
  leaderboard: {
    id: string;
    nickname: string;
    rank: number;
    score: number;
    correct: number;
    incorrect: number;
  }[];
};
