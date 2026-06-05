import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const raw = readFileSync(join(__dirname, 'questionBank.json'), 'utf-8');

const questionBank = JSON.parse(raw) as Record<string, Array<{
  category: string;
  text: string;
  answer: string;
}>>;

const questions = Object.values(questionBank).flat();

async function main() {
  console.log('Seeding question bank...');

  await prisma.question.deleteMany();

  await prisma.question.createMany({
    data: questions.map(q => ({
      category: q.category,
      text: q.text,
      answer: q.answer,
    })),
  });

  console.log(`✅ Seeded ${questions.length} questions successfully.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });