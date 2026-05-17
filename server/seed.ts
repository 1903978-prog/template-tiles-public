import { db } from "./db";
import { folders, tiles } from "@shared/schema";

/* ─── Default starter content (generic, non-confidential) ─── */

const BACKUP_FOLDERS = [
  { id: "folder-emails", name: "Emails", sortOrder: 0 },
  { id: "folder-prompts", name: "Prompts", sortOrder: 1 },
  { id: "folder-snippets", name: "Snippets", sortOrder: 2 },
];

const BACKUP_TILES = [
  {
    id: "1",
    title: "Cold outreach",
    body: "Hi [Name],\n\nI'm reaching out because [reason]. We help teams like [Company] with [value proposition].\n\nWould a quick 15-minute call next week be useful?\n\nBest regards,\n[Your Name]",
    folderId: "folder-emails",
    sortOrder: 0,
  },
  {
    id: "2",
    title: "Follow-up",
    body: "Hi [Name],\n\nJust following up on my previous message about [topic]. Let me know if you'd like more detail or want to set up a time to talk.\n\nThanks,\n[Your Name]",
    folderId: "folder-emails",
    sortOrder: 1,
  },
  {
    id: "3",
    title: "Meeting recap",
    body: "Hi all,\n\nThanks for the time today. Quick recap:\n\n• Decisions: [decisions]\n• Action items: [owner — task — due date]\n• Next steps: [next steps]\n\nReply if I missed anything.\n\nBest,\n[Your Name]",
    folderId: "folder-emails",
    sortOrder: 2,
  },
  {
    id: "4",
    title: "Summarize text",
    body: "Summarize the following text in [N] bullet points. Keep it factual, no opinions. Highlight any numbers, dates, and named entities.\n\nText:\n[paste text here]",
    folderId: "folder-prompts",
    sortOrder: 0,
  },
  {
    id: "5",
    title: "Rewrite professionally",
    body: "Rewrite the following message to be clear, concise, and professional. Keep the original intent. Return only the rewritten version.\n\nMessage:\n[paste message here]",
    folderId: "folder-prompts",
    sortOrder: 1,
  },
  {
    id: "6",
    title: "Code review",
    body: "Review the following code for bugs, security issues, and readability. List findings as: [severity] — [file:line] — [issue] — [suggested fix]. Be concise.\n\nCode:\n[paste code here]",
    folderId: "folder-prompts",
    sortOrder: 2,
  },
  {
    id: "7",
    title: "Signature",
    body: "[Your Name]\n[Title] · [Company]\n[email] · [phone]",
    folderId: "folder-snippets",
    sortOrder: 0,
  },
  {
    id: "8",
    title: "Out of office",
    body: "Thanks for your message. I'm out of office until [date] with limited access to email. For urgent matters contact [name] at [email]. I'll respond when I return.",
    folderId: "folder-snippets",
    sortOrder: 1,
  },
];

/**
 * Seed the database with default starter content.
 *
 * Non-destructive: only inserts when the DB is completely empty.
 * If ANY tile or folder already exists, the seed skips entirely — never
 * deletes user data. This prevents the previous trap where dropping below
 * the seed's row count would wipe the entire DB on next restart.
 *
 * To re-seed intentionally, manually clear `tiles` and `folders` first.
 */
export async function seedDefaults(): Promise<void> {
  const [existingTiles, existingFolders] = await Promise.all([
    db.select().from(tiles),
    db.select().from(folders),
  ]);

  if (existingTiles.length > 0 || existingFolders.length > 0) {
    console.log(
      `[seed] DB already has ${existingFolders.length} folders and ${existingTiles.length} tiles — skipping seed (non-destructive).`,
    );
    return;
  }

  console.log("[seed] Database is empty — inserting default content...");
  await db.insert(folders).values(BACKUP_FOLDERS);
  await db.insert(tiles).values(BACKUP_TILES);
  console.log(
    `[seed] Inserted ${BACKUP_FOLDERS.length} folders and ${BACKUP_TILES.length} tiles.`,
  );
}
