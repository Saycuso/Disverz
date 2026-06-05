export const normalizeText = (text: string): string => {
  return text
    .toLocaleLowerCase()
    .trim()
    .replace(/['",]/g, "")
    .replace(/\s+/g, " ");
};

export const isCorrectAnswer = (userInput: string, dbAnswer: string): boolean => {
    return normalizeText(userInput) === normalizeText(dbAnswer)
}
