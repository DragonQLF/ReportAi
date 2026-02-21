import { Router } from 'express';
import { streamText, tool, createUIMessageStream, pipeUIMessageStreamToResponse, convertToModelMessages, stepCountIs } from 'ai';
import { z } from 'zod';
import { flashModel } from '../pipeline/ai';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { ForbiddenError } from '../utils/errors';
import { editDocument as applyDocumentEdit, addScreenshotToReport, removeScreenshotFromReport, compileCurrentReport, setLogoFromImage } from '../pipeline/editor';
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
          contextDocuments: true,
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

        // Tracks whether any edit tool ran so onFinish can do ONE deferred compile.
        const pendingEdit = {
          needed: false,
          summaries: [] as string[],
          toolsUsed: [] as Array<'editDocument' | 'addScreenshot' | 'removeScreenshot' | 'setLogo'>,
        };

        const uiStream = createUIMessageStream({
          execute: async ({ writer }) => {
            const editStream = streamText({
              model: flashModel,
              system: editModeSystemPrompt(!!editImageUrl),
              messages: modelMessages,
              stopWhen: stepCountIs(5), // allows sequential tool calls (e.g. addScreenshot → editDocument → final response)
              tools: {
                editDocument: tool({
                  description: 'Edit the report prose. Call this for text changes: rewriting, shortening, expanding, tone, adding a new section, translation, or formatting. Do NOT use this to add a screenshot — use addScreenshot for that.',
                  inputSchema: z.object({
                    instruction: z.string().describe('Clear, specific edit instruction to apply to the document'),
                  }),
                  execute: async ({ instruction }) => {
                    try {
                      const editResult = await applyDocumentEdit({
                        reportId: existingReportId,
                        message: instruction,
                        imageUrl: editImageUrl,
                        chatHistory,
                        onProgress: (stage) => emitEditProgress(existingReportId, stage),
                        skipCompile: true,
                      });
                      emitEditProgress(existingReportId, null);
                      pendingEdit.needed = true;
                      pendingEdit.summaries.push(editResult.summary);
                      pendingEdit.toolsUsed.push('editDocument');
                      logger.info('Document edit applied via tool (compile deferred)', { reportId: existingReportId });
                      return editResult.summary;
                    } catch (err) {
                      emitEditProgress(existingReportId, null);
                      const message = err instanceof Error ? err.message : 'Unknown error';
                      logger.error('editDocument tool failed', { reportId: existingReportId, error: message });
                      return `Edit failed: ${message}`;
                    }
                  },
                }),

                addScreenshot: tool({
                  description: 'Add a new screenshot/image into the report. Use this when the user uploads an image that should appear as a figure in the document.',
                  inputSchema: z.object({
                    note: z.string().optional().describe('Optional hint from the user about which section this screenshot belongs to'),
                  }),
                  execute: async ({ note }) => {
                    if (!editImageUrl) return 'No image attached — cannot add screenshot';
                    try {
                      const addResult = await addScreenshotToReport({
                        reportId: existingReportId,
                        imageUrl: editImageUrl,
                        note,
                        chatHistory,
                        onProgress: (stage) => emitEditProgress(existingReportId, stage),
                        skipCompile: true,
                      });
                      emitEditProgress(existingReportId, null);
                      pendingEdit.needed = true;
                      pendingEdit.summaries.push(addResult.summary);
                      pendingEdit.toolsUsed.push('addScreenshot');
                      logger.info('Screenshot added via tool (compile deferred)', { reportId: existingReportId });
                      return addResult.summary;
                    } catch (err) {
                      emitEditProgress(existingReportId, null);
                      const message = err instanceof Error ? err.message : 'Unknown error';
                      logger.error('addScreenshot tool failed', { reportId: existingReportId, error: message });
                      return `Could not add screenshot: ${message}`;
                    }
                  },
                }),

                removeScreenshot: tool({
                  description: 'Remove a screenshot/figure from the report. Use this when the user asks to remove, delete, or hide a specific screenshot.',
                  inputSchema: z.object({
                    identifier: z.string().describe('Natural-language description of which screenshot to remove (e.g. "the login page screenshot", "the dashboard figure")'),
                  }),
                  execute: async ({ identifier }) => {
                    try {
                      const removeResult = await removeScreenshotFromReport({
                        reportId: existingReportId,
                        identifier,
                        chatHistory,
                        onProgress: (stage) => emitEditProgress(existingReportId, stage),
                        skipCompile: true,
                      });
                      emitEditProgress(existingReportId, null);
                      pendingEdit.needed = true;
                      pendingEdit.summaries.push(removeResult.summary);
                      pendingEdit.toolsUsed.push('removeScreenshot');
                      logger.info('Screenshot removed via tool (compile deferred)', { reportId: existingReportId });
                      return removeResult.summary;
                    } catch (err) {
                      emitEditProgress(existingReportId, null);
                      const message = err instanceof Error ? err.message : 'Unknown error';
                      logger.error('removeScreenshot tool failed', { reportId: existingReportId, error: message });
                      return `Could not remove screenshot: ${message}`;
                    }
                  },
                }),

                setLogo: tool({
                  description: 'Set an uploaded image as the report logo. Call this when the user uploads something that is NOT a UI screenshot — e.g. a company logo, school emblem, university seal, badge, institution crest, profile photo for the cover, or any image NOT meant to appear as a numbered figure in the document body. Do NOT use addScreenshot for these.',
                  inputSchema: z.object({
                    position: z.enum(['cover', 'header-left', 'header-right'])
                      .describe('Where to place the image: cover = full cover page logo, header-left/header-right = small logo in page header'),
                  }),
                  execute: async ({ position }) => {
                    if (!editImageUrl) return 'No image attached — cannot set logo';
                    try {
                      const logoResult = await setLogoFromImage({
                        reportId: existingReportId,
                        imageUrl: editImageUrl,
                        position,
                        onProgress: (stage) => emitEditProgress(existingReportId, stage),
                        skipCompile: true,
                      });
                      emitEditProgress(existingReportId, null);
                      pendingEdit.needed = true;
                      pendingEdit.summaries.push(logoResult.summary);
                      pendingEdit.toolsUsed.push('setLogo');
                      logger.info('Logo set via tool (compile deferred)', { reportId: existingReportId });
                      return logoResult.summary;
                    } catch (err) {
                      emitEditProgress(existingReportId, null);
                      const message = err instanceof Error ? err.message : 'Unknown error';
                      logger.error('setLogo tool failed', { reportId: existingReportId, error: message });
                      return `Could not set logo: ${message}`;
                    }
                  },
                }),
              },
              onFinish: async ({ text, toolCalls, toolResults }) => {
                // Deferred compile — runs once after all tools instead of once per tool.
                // The SDK awaits onFinish before closing the stream, so the PDF is ready
                // by the time the frontend's useChat.onFinish fires.
                if (pendingEdit.needed) {
                  try {
                    emitEditProgress(existingReportId, 'compiling');
                    const combinedSummary = pendingEdit.summaries.join('; ');
                    const compiled = await compileCurrentReport(existingReportId, combinedSummary);
                    emitEditProgress(existingReportId, null);

                    type VersionEntry = { version: number; pdfUrl: string; texUrl?: string; createdAt: string; label?: string };
                    const existingVersions: VersionEntry[] = Array.isArray(existing?.versions) ? (existing!.versions as VersionEntry[]) : [];
                    const nextVersion = existingVersions.length > 0
                      ? Math.max(...existingVersions.map((v) => v.version)) + 1
                      : 1;
                    const hasAdd = pendingEdit.toolsUsed.includes('addScreenshot');
                    const hasRemove = pendingEdit.toolsUsed.includes('removeScreenshot');
                    const hasLogo = pendingEdit.toolsUsed.includes('setLogo');
                    const editCount = existingVersions.filter((v) => /^Edit \d+$/.test(v.label ?? '')).length;
                    const label = existingVersions.length === 0 ? 'Original'
                      : hasAdd ? 'Photo Added'
                      : hasRemove ? 'Photo Removed'
                      : hasLogo ? 'Logo Added'
                      : `Edit ${editCount + 1}`;
                    const snapshot: VersionEntry | null = existing?.pdfUrl
                      ? {
                          version: nextVersion,
                          pdfUrl: existing!.pdfUrl,
                          texUrl: existing?.texUrl ?? undefined,
                          createdAt: new Date().toISOString(),
                          label,
                        }
                      : null;

                    await prisma.report.update({
                      where: { id: existingReportId },
                      data: {
                        pdfUrl: compiled.pdfUrl ?? existing?.pdfUrl ?? undefined,
                        texUrl: compiled.texUrl,
                        versions: snapshot ? [...existingVersions, snapshot] : existingVersions,
                      },
                    });

                    logger.info('Deferred compile complete', { reportId: existingReportId, summary: combinedSummary });
                  } catch (err) {
                    emitEditProgress(existingReportId, null);
                    logger.error('Deferred compile failed in onFinish', { reportId: existingReportId, error: err instanceof Error ? err.message : String(err) });
                  }
                }

                // Save full chat history including AI response
                const parts: Record<string, unknown>[] = [];
                if (text) parts.push({ type: 'text', text });
                for (const tc of toolCalls ?? []) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const tr = (toolResults as any[])?.find((r) => r.toolCallId === tc.toolCallId);
                  parts.push({
                    type: `tool-${tc.toolName}`,
                    toolName: tc.toolName,
                    toolCallId: tc.toolCallId,
                    input: tc.input,
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

        // Inject document context so the chat AI can reference uploaded files
        type ContextDoc = { name: string; url: string; text: string };
        const docs = Array.isArray(existing.contextDocuments)
          ? (existing.contextDocuments as ContextDoc[]).filter((d) => d.text)
          : [];
        if (docs.length > 0) {
          const docSection = docs
            .map((d) => `[${d.name}]\n${d.text.slice(0, 2000)}${d.text.length > 2000 ? '\n...(truncated)' : ''}`)
            .join('\n\n---\n\n');
          systemPrompt += `\n\n**User-uploaded reference documents (use these to understand the project and fill in fields):**\n${docSection}`;
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
            input: tc.input,
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
