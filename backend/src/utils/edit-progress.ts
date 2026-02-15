import { EventEmitter } from 'events';

const emitter = new EventEmitter();
emitter.setMaxListeners(200); // one listener per open SSE connection

export type EditStage = 'fetching' | 'analyzing_image' | 'editing' | 'compiling' | null;

export function emitEditProgress(reportId: string, stage: EditStage): void {
  emitter.emit(`edit:${reportId}`, stage);
}

/**
 * Subscribe to edit progress events for a report.
 * Returns an unsubscribe function — always call it to avoid memory leaks.
 */
export function onEditProgress(reportId: string, cb: (stage: EditStage) => void): () => void {
  emitter.on(`edit:${reportId}`, cb);
  return () => emitter.off(`edit:${reportId}`, cb);
}
