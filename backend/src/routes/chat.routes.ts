import { Router } from 'express';
import { streamText, tool, pipeUIMessageStreamToResponse, convertToModelMessages, stepCountIs } from 'ai';
import { z } from 'zod';
import { flashModel } from '../pipeline/ai';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { ForbiddenError } from '../utils/errors';
import { editDocument as applyDocumentEdit } from '../pipeline/editor';

const router = Router();

/**
 * System prompt for edit mode. The AI decides when to call editDocument vs answer conversationally.
 * We inject whether an image is attached so the AI knows to call the tool.
 */
function editModeSystem(hasImage: boolean): string {
  return `You are a document editor assistant. The user has a completed PDF report that was AI-generated.

Rules:
- For questions, feedback, or general comments about the document or previous edits, respond with 1-2 sentences of text. Do NOT call editDocument.
- For any requested change to the document (shorten, expand, rewrite, change tone, translate, fix errors, add/remove content, restructure, reformat, etc.), call the editDocument tool immediately with a precise instruction. Do NOT explain what you are about to do before calling the tool.
- After a successful edit, confirm what changed in one sentence.${hasImage ? '\n- The user attached an image. Call editDocument to incorporate it into the document.' : ''}`;
}

const SYSTEM_PROMPT = `You are ReportAI, a friendly assistant that helps users create professional PDF reports from their work, studies, or projects.

This tool works for anyone: interns, students, researchers, doctors, artists, engineers, freelancers — any domain.

**Standard fields to collect through natural conversation:**
- Report title (REQUIRED) — e.g. "Internship Report", "Clinical Rotation Report", "Final Year Project", "Portfolio Showcase"
- Organization (REQUIRED) — company, university, hospital, clinic, studio, or "Personal Project"
- Role or program (optional) — e.g. "Backend Engineer", "Medical Student", "Graphic Designer", "MSc Neuroscience"
- Dates (optional) — e.g. "January 2024 – July 2024", "Semester 2 2024"
- Description (optional) — what is the project/work about
- Language (optional, default "en") — one of: en, pt, fr, de, es
- Writing style (optional, default "professional") — one of: professional, academic, technical

**Custom fields — use addCustomField for domain-specific information:**
Based on what the user tells you about their domain, proactively add relevant fields:
- Software projects → add "techStack" (label: "Tech Stack")
- Medical/clinical → add "specialty" (label: "Specialty"), "supervisor" (label: "Supervisor")
- Academic research → add "subject" (label: "Subject / Course"), "supervisor" (label: "Supervisor")
- Art/design → add "medium" (label: "Medium"), "exhibition" (label: "Exhibition")
- Engineering → add "projectType" (label: "Project Type")
Only add custom fields that are clearly relevant — don't ask for fields that don't apply.

**Rules:**
- Be warm, concise. Ask 1-2 things at a time.
- Extract info naturally — if the user says "I interned at Google as a backend engineer", call setReportField for company="Google" AND role="Backend Engineer" immediately, then add a "techStack" custom field.
- Call setReportField or addCustomField the moment you extract any value — don't wait.
- Once you have title + organization + a brief sense of what the project is, call requestScreenshots.
- Keep messages under 3 sentences.
- Don't re-ask for info already provided.
- CRITICAL: You MUST always send a visible text response in every message, even when you call tools. Never send only tool calls with no text.
- When you generate a title for the user, call setReportField with it immediately, then confirm it in text.
- LANGUAGE: Detect the language the user writes in and respond in that same language throughout the entire conversation. If the user explicitly asks for a different language, switch to it. On the first message, silently call setReportField for the "language" field using the correct ISO code from this list: en, pt, pt-br, es, fr, de, it, nl, pl, ru, el, cs, sk, hu, ro, tr, sv, no, da, fi. Don't ask the user — just detect and set it. Default to "en" if unsure.`;

router.post('/', requireAuth, async (req, res) => {
  try {
    const { messages, reportId: existingReportId } = req.body;

    // Create a draft report on the first message so users can return to it
    let reportId: string = existingReportId;
    if (!reportId) {
      const report = await prisma.report.create({
        data: { userId: req.user!.id },
      });
      reportId = report.id;
      res.setHeader('X-Report-Id', reportId);
      logger.info('Draft report created via chat', { reportId, userId: req.user!.id });
    }

    // Persist incoming message history to DB so users can resume the conversation
    if (reportId && messages?.length > 0) {
      prisma.report.update({ where: { id: reportId }, data: { chatMessages: messages } }).catch(() => {});
    }

    // Inject already-set fields into system prompt so AI doesn't re-ask and uses them as context
    let systemPrompt = SYSTEM_PROMPT;
    if (existingReportId) {
      const existing = await prisma.report.findUnique({
        where: { id: existingReportId },
        select: {
          userId: true,
          status: true,
          texUrl: true,
          pdfUrl: true,
          title: true, company: true, role: true, dates: true,
          description: true, language: true, style: true,
          techStack: true, customFields: true, versions: true,
        },
      });
      if (existing && existing.userId !== req.user!.id) {
        throw new ForbiddenError('You do not own this report');
      }

      // Edit mode — report is already generated. The AI decides via tool call whether to edit or answer.
      if (existing?.status === 'completed' && existing.texUrl) {
        const { editImageUrl } = req.body as { editImageUrl?: string };

        // Build pipeline chat history for editor context
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chatHistory = (messages as any[])
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({
            role: m.role as string,
            content: (m.parts ?? [])
              .filter((p: { type: string }) => p.type === 'text')
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((p: any) => p.text as string)
              .join(''),
          }))
          .filter((m) => m.content);

        const editStream = streamText({
          model: flashModel,
          system: editModeSystem(!!editImageUrl),
          messages: await convertToModelMessages(messages),
          stopWhen: stepCountIs(3), // respond → (optionally) call tool → follow-up
          tools: {
            editDocument: tool({
              description: 'Edit the LaTeX document. Call this for any requested change to content, structure, tone, length, or formatting.',
              inputSchema: z.object({
                instruction: z.string().describe('Clear, specific edit instruction to apply to the document'),
              }),
              execute: async ({ instruction }) => {
                const editResult = await applyDocumentEdit({
                  reportId: existingReportId,
                  texUrl: existing.texUrl!,
                  message: instruction,
                  imageUrl: editImageUrl,
                  chatHistory,
                  reportContext: {
                    title: existing.title,
                    company: existing.company,
                    role: existing.role,
                    language: existing.language ?? 'en',
                    style: existing.style ?? 'professional',
                  },
                });

                // Re-read versions fresh right before writing to minimise the stale-read window
                type VersionEntry = { version: number; pdfUrl: string; texUrl?: string; createdAt: string; label?: string };
                const fresh = await prisma.report.findUnique({
                  where: { id: existingReportId },
                  select: { versions: true, pdfUrl: true },
                });
                const freshVersions: VersionEntry[] = Array.isArray(fresh?.versions) ? (fresh!.versions as VersionEntry[]) : [];
                const snapshot: VersionEntry | null = fresh?.pdfUrl
                  ? {
                      version: freshVersions.length + 1,
                      pdfUrl: fresh!.pdfUrl,
                      texUrl: existing.texUrl ?? undefined,
                      createdAt: new Date().toISOString(),
                      label: freshVersions.length === 0 ? 'Original' : `Edit ${freshVersions.length}`,
                    }
                  : null;

                await prisma.report.update({
                  where: { id: existingReportId },
                  data: {
                    pdfUrl: editResult.pdfUrl ?? fresh?.pdfUrl ?? existing.pdfUrl,
                    texUrl: editResult.texUrl,
                    versions: snapshot ? [...freshVersions, snapshot] : freshVersions,
                  },
                });

                logger.info('Document edit applied via tool', { reportId: existingReportId });
                return editResult.summary;
              },
            }),
          },
          onFinish: async ({ text, toolCalls, toolResults }) => {
            const parts: Record<string, unknown>[] = [];
            if (text) parts.push({ type: 'text', text });
            for (const tc of toolCalls ?? []) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const tr = (toolResults as any[])?.find((r) => r.toolCallId === tc.toolCallId);
              parts.push({
                type: `tool-${tc.toolName}`,
                toolName: tc.toolName,
                toolCallId: tc.toolCallId,
                input: tc.args,
                output: tr?.result,
                state: 'output-available',
              });
            }
            if (parts.length > 0) {
              const aiMessage = { id: `ai-${Date.now()}`, role: 'assistant', parts };
              prisma.report
                .update({ where: { id: existingReportId }, data: { chatMessages: [...messages, aiMessage] } })
                .catch(() => {});
            }
          },
        });

        pipeUIMessageStreamToResponse({ stream: editStream.toUIMessageStream(), response: res });
        return;
      }

      if (existing) {
        const lines: string[] = [];
        if (existing.title)       lines.push(`- title: "${existing.title}"`);
        if (existing.company)     lines.push(`- company: "${existing.company}"`);
        if (existing.role)        lines.push(`- role: "${existing.role}"`);
        if (existing.dates)       lines.push(`- dates: "${existing.dates}"`);
        if (existing.description) lines.push(`- description: "${existing.description}"`);
        if (existing.language)    lines.push(`- language: "${existing.language}"`);
        if (existing.style)       lines.push(`- style: "${existing.style}"`);
        if (existing.techStack?.length) lines.push(`- techStack: "${existing.techStack.join(', ')}"`);
        const custom = existing.customFields as Record<string, { label: string; value: string }> | null;
        if (custom) {
          for (const field of Object.values(custom)) {
            if (field.value) lines.push(`- ${field.label}: "${field.value}"`);
          }
        }
        if (lines.length > 0) {
          systemPrompt += `\n\n**Already collected (do NOT ask for these again — treat them as confirmed):**\n${lines.join('\n')}`;
        }
      }
    }

    const result = streamText({
      model: flashModel,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      onFinish: async ({ text, toolCalls, toolResults }) => {
        // Save the complete history including the AI's response.
        // The early save above only has messages up to the user's last turn —
        // this overwrites it with the full conversation once the stream is done.
        const parts: Record<string, unknown>[] = [];
        if (text) parts.push({ type: 'text', text });
        for (const tc of toolCalls ?? []) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tr = (toolResults as any[])?.find((r) => r.toolCallId === tc.toolCallId);
          parts.push({
            type: `tool-${tc.toolName}`,
            toolName: tc.toolName,
            toolCallId: tc.toolCallId,
            input: tc.args,
            output: tr?.result,
            state: 'output-available',
          });
        }
        if (parts.length > 0) {
          const aiMessage = { id: `ai-${Date.now()}`, role: 'assistant', parts };
          prisma.report
            .update({ where: { id: reportId }, data: { chatMessages: [...messages, aiMessage] } })
            .catch(() => {});
        }
      },
      tools: {
        setReportField: tool({
          description: 'Save a standard report field as you extract it from the conversation',
          inputSchema: z.object({
            field: z.enum(['title', 'company', 'role', 'dates', 'techStack', 'description', 'language', 'style']),
            value: z.string(),
          }),
          execute: async ({ field, value }) => {
            try {
              if (field === 'techStack') {
                const tech = value.split(',').map((s) => s.trim()).filter(Boolean);
                await prisma.report.update({ where: { id: reportId }, data: { techStack: tech } });
              } else {
                await prisma.report.update({ where: { id: reportId }, data: { [field]: value } });
              }
            } catch (err) {
              logger.warn('Failed to persist report field', { field, reportId, error: err instanceof Error ? err.message : String(err) });
            }
            return 'saved';
          },
        }),

        addCustomField: tool({
          description: 'Add a domain-specific field to the report (e.g. specialty, tech stack, supervisor, medium). Use this for fields not covered by setReportField.',
          inputSchema: z.object({
            key: z.string().describe('camelCase machine-readable key, e.g. "specialty", "techStack", "supervisor"'),
            label: z.string().describe('Human-readable label shown in the UI, e.g. "Specialty", "Tech Stack"'),
            value: z.string().describe('The value for this field'),
          }),
          execute: async ({ key, label, value }) => {
            try {
              const report = await prisma.report.findUnique({ where: { id: reportId }, select: { customFields: true } });
              const current = (report?.customFields as Record<string, { label: string; value: string }>) ?? {};
              current[key] = { label, value };
              await prisma.report.update({ where: { id: reportId }, data: { customFields: current } });
            } catch (err) {
              logger.warn('Failed to persist custom field', { key, reportId, error: err instanceof Error ? err.message : String(err) });
            }
            return 'saved';
          },
        }),

        requestScreenshots: tool({
          description: 'Call this when you have enough info and want the user to upload screenshots or images',
          inputSchema: z.object({
            summary: z.string().describe('Short friendly message confirming what was collected'),
          }),
          execute: async () => 'ready',
        }),
      },
      stopWhen: stepCountIs(5),
    });

    pipeUIMessageStreamToResponse({ stream: result.toUIMessageStream(), response: res });
  } catch (err) {
    logger.error('Chat route error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ success: false, message: 'Chat error' });
  }
});

export default router;
