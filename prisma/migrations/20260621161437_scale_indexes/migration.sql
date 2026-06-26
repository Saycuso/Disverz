-- CreateIndex
CREATE INDEX "Question_category_idx" ON "Question"("category");

-- CreateIndex
CREATE INDEX "Server_isDormant_lastChallengeAt_idx" ON "Server"("isDormant", "lastChallengeAt");
