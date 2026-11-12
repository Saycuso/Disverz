export const normalizeText = (text) => {
    return text
        .toLocaleLowerCase()
        .trim()
        .replace(/['",]/g, "")
        .replace(/\s+/g, " ");
};
export const isCorrectAnswer = (userInput, dbAnswer) => {
    return normalizeText(userInput) === normalizeText(dbAnswer);
};
//# sourceMappingURL=validateAnswers.js.map