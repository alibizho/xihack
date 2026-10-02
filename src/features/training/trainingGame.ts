export type Difficulty = "beginner" | "normal" | "advanced";

export function shuffledBoard(random = Math.random): number[] {
  const board = Array.from({ length: 25 }, (_, index) => index + 1);
  for (let index = board.length - 1; index > 0; index--) {
    const next = Math.floor(random() * (index + 1));
    [board[index], board[next]] = [board[next], board[index]];
  }
  return board;
}

export function cellFeedback(difficulty: Difficulty, number: number, target: number): "next" | "done" | "idle" {
  if (difficulty === "beginner" && number === target) return "next";
  if (difficulty !== "advanced" && number < target) return "done";
  return "idle";
}
