import { Router } from 'express';
import { streamText, tool, createUIMessageStream, pipeUIMessageStreamToResponse, convertToModelMessages, stepCountIs } from 'ai';
import { z } from 'zod';
import { flashModel } from '../pipeline/ai';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { ForbiddenError } from '../utils/errors';
import { editDocument as applyDocumentEdit } from '../pipeline/editor';
import { chatSystemPrompt, editModeSystemPrompt } from '../pipeline/prompts';
import { emitEditProgress } from '../utils/edit-progress';

const router = Router();


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
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    let systemPrompt = `Today's date is ${today}.\n\n${chatSystemPrompt()}`;
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
      if (existing?.status === 'completed' && (existing.texUrl || existing.pdfUrl)) {
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

        const modelMessages = await convertToModelMessages(messages);

        const uiStream = createUIMessageStream({
          execute: async ({ writer }) => {
            const editStream = streamText({
              model: flashModel,
              system: editModeSystemPrompt(!!editImageUrl),
              messages: modelMessages,
              stopWhen: stepCountIs(3), // respond → (optionally) call tool → follow-up
              tools: {
                editDocument: tool({
                  description: 'Edit the report. Call this for any requested change to content, structure, tone, length, or formatting.',
                  inputSchema: z.object({
                    instruction: z.string().describe('Clear, specific edit instruction to apply to the document'),
                  }),
                  execute: async ({ instruction }) => {
                    const editResult = await applyDocumentEdit({
                      reportId: existingReportId,
                      message: instruction,
                      imageUrl: editImageUrl,
                      chatHistory,
                      onProgress: (stage) => emitEditProgress(existingReportId, stage),
                    });
                    emitEditProgress(existingReportId, null);

                    // Re-read versions fresh right before writing to minimise the stale-read window
                    type VersionEntry = { version: number; pdfUrl: string; texUrl?: string; createdAt: string; label?: string };
                    const fresh = await prisma.report.findUnique({
                      where: { id: existingReportId },
                      select: { versions: true, pdfUrl: true },
                    });
                    const freshVersions: VersionEntry[] = Array.isArray(fresh?.versions) ? (fresh!.versions as VersionEntry[]) : [];
                    const nextVersion = freshVersions.length > 0
                      ? Math.max(...freshVersions.map((v) => v.version)) + 1
                      : 1;
                    const editCount = freshVersions.filter((v) => v.label !== 'Original').length;
                    const snapshot: VersionEntry | null = fresh?.pdfUrl
                      ? {
                          version: nextVersion,
                          pdfUrl: fresh!.pdfUrl,
                          texUrl: existing.texUrl ?? undefined,
                          createdAt: new Date().toISOString(),
                          label: freshVersions.length === 0 ? 'Original' : `Edit ${editCount + 1}`,
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

            // Pipe the streamText chunks through the writer (recommended SDK pattern)
            writer.merge(editStream.toUIMessageStream());
          },
        });

        pipeUIMessageStreamToResponse({ stream: uiStream, response: res });
        return;
      }

      if (existing) {
        const lines: string[] = [];
        if (existing.title)       lines.push(`- title: "${existing.title}"`);
        if (existing.company)     lines.push(`- organization: "${existing.company}"`);
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

    // Accumulate every setReportField / addCustomField value so onFinish can do a
    // guaranteed batch save. Individual tool executes also attempt immediate saves,
    // but concurrent updates to the same row can fail silently — the accumulator
    // catches any that were missed.
    const pendingFields: Record<string, unknown> = {};
    const pendingCustom: Record<string, { label: string; value: string }> = {};

    const result = streamText({
      model: flashModel,
      system: systemPrompt,
      messages: await convertToModelMessages(messages),
      onFinish: async ({ text, toolCalls, toolResults }) => {
        // Batch-save all accumulated fields (retry for any individual failures)
        if (Object.keys(pendingFields).length > 0) {
          prisma.report.update({ where: { id: reportId }, data: pendingFields }).catch(() => {});
        }
        if (Object.keys(pendingCustom).length > 0) {
          prisma.report
            .findUnique({ where: { id: reportId }, select: { customFields: true } })
            .then((r) => {
              const base = (r?.customFields as Record<string, { label: string; value: string }>) ?? {};
              return prisma.report.update({
                where: { id: reportId },
                data: { customFields: { ...base, ...pendingCustom } },
              });
            })
            .catch(() => {});
        }
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
            field: z.enum(['title', 'company', 'role', 'dates', 'techStack', 'description', 'language', 'style', 'font']),
            value: z.string(),
          }),
          execute: async ({ field, value }) => {
            if (field === 'techStack') {
              pendingFields.techStack = value.split(',').map((s) => s.trim()).filter(Boolean);
            } else {
              pendingFields[field] = value;
            }
            try {
              if (field === 'techStack') {
                await prisma.report.update({ where: { id: reportId }, data: { techStack: pendingFields.techStack as string[] } });
              } else {
                await prisma.report.update({ where: { id: reportId }, data: { [field]: value } });
              }
            } catch (err) {
              logger.warn('Failed to persist report field (will retry in onFinish)', { field, reportId, error: err instanceof Error ? err.message : String(err) });
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
            pendingCustom[key] = { label, value };
            try {
              const report = await prisma.report.findUnique({ where: { id: reportId }, select: { customFields: true } });
              const current = (report?.customFields as Record<string, { label: string; value: string }>) ?? {};
              current[key] = { label, value };
              await prisma.report.update({ where: { id: reportId }, data: { customFields: current } });
            } catch (err) {
              logger.warn('Failed to persist custom field (will retry in onFinish)', { key, reportId, error: err instanceof Error ? err.message : String(err) });
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
