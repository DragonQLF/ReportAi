import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { config } from '../config';

const google = createGoogleGenerativeAI({ apiKey: config.gemini.apiKey });

/** Gemini 3 Flash Preview — fast, cheap, excellent for vision analysis */
export const flashModel = google('gemini-3-flash-preview');

/** Gemini 2.5 Pro — higher quality for writing and complex reasoning */
export const proModel = google('gemini-2.5-pro');
