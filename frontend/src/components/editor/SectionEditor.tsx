"use client";

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useContext,
} from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension, type JSONContent } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Loader2, Save, CheckCircle2, Plus, Trash2, ImagePlus, Upload, X as XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, type SectionContent, type LayoutConfig } from '@/lib/api';
import { latexToTiptap, tiptapToLatex, deriveScreenshotMeta, type ScreenshotInfo } from '@/lib/latex-tiptap';
import { FigureRefNode } from './FigureRefNode';
import { ScreenshotBlockNode, ScreenshotsContext } from './ScreenshotBlockNode';

// ─── Cover form types + helpers ──────────────────────────────────────────────

interface CoverConfig {
  titleSize?: string;
  companySize?: string;
  roleSize?: string;
  datesSize?: string;
  customFieldSize?: string;
}

interface CoverField {
  id: string;
  label: string;
  value: string;
}

const TITLE_SIZES = [
  { value: 'huge',       label: 'Huge'     },
  { value: 'LARGE',      label: 'X-Large'  },
  { value: 'Large',      label: 'Large'    },
  { value: 'large',      label: 'Medium'   },
  { value: 'normalsize', label: 'Normal'   },
] as const;

const FIELD_SIZES = [
  { value: 'Large',        label: 'Large'  },
  { value: 'large',        label: 'Medium' },
  { value: 'normalsize',   label: 'Normal' },
  { value: 'small',        label: 'Small'  },
  { value: 'footnotesize', label: 'Tiny'   },
] as const;

function SizeSelect({ value, options, onChange }: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-6 text-[10px] bg-transparent border border-border/50 rounded px-1.5 text-muted-foreground focus:outline-none focus:border-primary/40 cursor-pointer"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function customFieldsToArray(record?: Record<string, { label: string; value: string }>): CoverField[] {
  if (!record) return [];
  return Object.entries(record).map(([id, { label, value }]) => ({ id, label, value }));
}

function arrayToCustomFields(fields: CoverField[]): Record<string, { label: string; value: string }> {
  const result: Record<string, { label: string; value: string }> = {};
  for (const f of fields) {
    if (f.label || f.value) result[f.id] = { label: f.label, value: f.value };
  }
  return result;
}

// ─── Cover logo position picker ──────────────────────────────────────────────

type CoverLogoPosition =
  | 'cover-top-left' | 'cover-top-center' | 'cover-top-right'
  | 'cover-bottom-left' | 'cover-bottom-center' | 'cover-bottom-right';

const COVER_LOGO_POSITIONS: { value: CoverLogoPosition; label: string; row: number; col: number }[] = [
  { value: 'cover-top-left',     label: 'Top left',     row: 0, col: 0 },
  { value: 'cover-top-center',   label: 'Top center',   row: 0, col: 1 },
  { value: 'cover-top-right',    label: 'Top right',    row: 0, col: 2 },
  { value: 'cover-bottom-left',  label: 'Bottom left',  row: 1, col: 0 },
  { value: 'cover-bottom-center',label: 'Bottom center',row: 1, col: 1 },
  { value: 'cover-bottom-right', label: 'Bottom right', row: 1, col: 2 },
];

function CoverLogoSection({
  logoUrl,
  logoPosition,
  isUploading,
  onUpload,
  onRemove,
  onPositionChange,
}: {
  logoUrl?: string;
  logoPosition: CoverLogoPosition;
  isUploading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  onPositionChange: (pos: CoverLogoPosition) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2.5">
      {/* Logo preview / upload area */}
      <div className="flex items-center gap-2.5">
        <div className="w-16 h-12 rounded border border-border/50 bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
          {logoUrl
            ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" />
            : <span className="text-[9px] text-muted-foreground/50 text-center leading-tight px-1">No logo</span>
          }
        </div>
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {isUploading
              ? <><Loader2 className="h-3 w-3 animate-spin" />Uploading…</>
              : <><Upload className="h-3 w-3" />{logoUrl ? 'Replace logo' : 'Upload logo'}</>
            }
          </button>
          {logoUrl && (
            <button
              onClick={onRemove}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-destructive transition-colors"
            >
              <XIcon className="h-3 w-3" />
              Remove logo
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* Position grid — only shown when a logo is set */}
      {logoUrl && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">
            Position on cover
          </p>
          <div
            className="rounded-lg border border-border/50 overflow-hidden"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: 'hsl(var(--border))' }}
          >
            {COVER_LOGO_POSITIONS.map((p) => (
              <button
                key={p.value}
                onClick={() => onPositionChange(p.value)}
                title={p.label}
                className={`h-7 text-[8px] transition-colors ${
                  logoPosition === p.value
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {p.label.split(' ')[0]}
                <br />
                {p.label.split(' ')[1]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cover form panel ────────────────────────────────────────────────────────

function CoverPanel({
  title, company, role, dates,
  coverConfig, customFields,
  logoUrl, logoPosition, isLogoUploading,
  onDirty,
  onTitleChange, onCompanyChange, onRoleChange, onDatesChange,
  onCoverConfigChange, onCustomFieldsChange,
  onLogoUpload, onLogoRemove, onLogoPositionChange,
}: {
  title: string; company: string; role: string; dates: string;
  coverConfig: CoverConfig;
  customFields: CoverField[];
  logoUrl?: string;
  logoPosition: CoverLogoPosition;
  isLogoUploading: boolean;
  onDirty: () => void;
  onTitleChange: (v: string) => void;
  onCompanyChange: (v: string) => void;
  onRoleChange: (v: string) => void;
  onDatesChange: (v: string) => void;
  onCoverConfigChange: (k: keyof CoverConfig, v: string) => void;
  onCustomFieldsChange: (fields: CoverField[]) => void;
  onLogoUpload: (file: File) => void;
  onLogoRemove: () => void;
  onLogoPositionChange: (pos: CoverLogoPosition) => void;
}) {
  const inputClass = "w-full bg-card border border-border/50 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/40 transition-colors";
  const labelClass = "text-[10px] font-semibold uppercase tracking-widest text-muted-foreground";
  const rowClass = "space-y-1.5";

  const change = (fn: () => void) => { fn(); onDirty(); };

  const addField = () => {
    const id = `field_${Date.now()}`;
    onCustomFieldsChange([...customFields, { id, label: '', value: '' }]);
    onDirty();
  };

  const updateField = (id: string, key: 'label' | 'value', val: string) => {
    onCustomFieldsChange(customFields.map((f) => f.id === id ? { ...f, [key]: val } : f));
    onDirty();
  };

  const removeField = (id: string) => {
    onCustomFieldsChange(customFields.filter((f) => f.id !== id));
    onDirty();
  };

  return (
    <div className="space-y-4">
      <div className={rowClass}>
        <div className="flex items-center justify-between">
          <span className={labelClass}>Title</span>
          <SizeSelect
            value={coverConfig.titleSize ?? 'huge'}
            options={TITLE_SIZES}
            onChange={(v) => change(() => onCoverConfigChange('titleSize', v))}
          />
        </div>
        <input
          value={title}
          onChange={(e) => change(() => onTitleChange(e.target.value))}
          className={inputClass}
          placeholder="Report title"
        />
      </div>

      <div className={rowClass}>
        <div className="flex items-center justify-between">
          <span className={labelClass}>Organization</span>
          <SizeSelect
            value={coverConfig.companySize ?? 'normalsize'}
            options={FIELD_SIZES}
            onChange={(v) => change(() => onCoverConfigChange('companySize', v))}
          />
        </div>
        <input
          value={company}
          onChange={(e) => change(() => onCompanyChange(e.target.value))}
          className={inputClass}
          placeholder="Company or university"
        />
      </div>

      <div className={rowClass}>
        <div className="flex items-center justify-between">
          <span className={labelClass}>Role</span>
          <SizeSelect
            value={coverConfig.roleSize ?? 'large'}
            options={FIELD_SIZES}
            onChange={(v) => change(() => onCoverConfigChange('roleSize', v))}
          />
        </div>
        <input
          value={role}
          onChange={(e) => change(() => onRoleChange(e.target.value))}
          className={inputClass}
          placeholder="Your role or position"
        />
      </div>

      <div className={rowClass}>
        <div className="flex items-center justify-between">
          <span className={labelClass}>Dates</span>
          <SizeSelect
            value={coverConfig.datesSize ?? 'normalsize'}
            options={FIELD_SIZES}
            onChange={(v) => change(() => onCoverConfigChange('datesSize', v))}
          />
        </div>
        <input
          value={dates}
          onChange={(e) => change(() => onDatesChange(e.target.value))}
          className={inputClass}
          placeholder="e.g. January – June 2025"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={labelClass}>Custom fields</span>
          <button
            onClick={addField}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add field
          </button>
        </div>

        {customFields.length === 0 && (
          <p className="text-[10px] text-muted-foreground/50 italic py-1">
            No custom fields — add student name, number, supervisor, etc.
          </p>
        )}

        {customFields.map((field) => (
          <div key={field.id} className="rounded-lg border border-border/50 bg-card p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={field.label}
                onChange={(e) => updateField(field.id, 'label', e.target.value)}
                placeholder="Label (e.g. Student)"
                className="flex-1 text-[10px] bg-transparent border-b border-border/40 focus:outline-none focus:border-primary/40 pb-0.5 text-muted-foreground placeholder:text-muted-foreground/40"
              />
              <button
                onClick={() => removeField(field.id)}
                className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <input
              value={field.value}
              onChange={(e) => updateField(field.id, 'value', e.target.value)}
              placeholder="Value (e.g. Fernando Pinto)"
              className="w-full text-sm bg-transparent border-b border-border/40 focus:outline-none focus:border-primary/40 pb-0.5 placeholder:text-muted-foreground/40"
            />
          </div>
        ))}
      </div>

      {/* Logo */}
      <div className="space-y-2">
        <span className={labelClass}>Logo / cover image</span>
        <CoverLogoSection
          logoUrl={logoUrl}
          logoPosition={logoPosition}
          isUploading={isLogoUploading}
          onUpload={onLogoUpload}
          onRemove={onLogoRemove}
          onPositionChange={onLogoPositionChange}
        />
      </div>
    </div>
  );
}

// ─── Mid-paragraph drop cursor ───────────────────────────────────────────────
// Shows a vertical insertion-point line when a screenshotBlock is dragged over
// a position inside a paragraph (where the paragraph will be split on drop).

const midParaDropKey = new PluginKey<DecorationSet>('midParaDropCursor');

const MidParaDropCursor = Extension.create({
  name: 'midParaDropCursor',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: midParaDropKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            set = set.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(midParaDropKey) as { pos?: number; clear?: boolean } | undefined;
            if (meta?.pos != null) {
              const el = document.createElement('span');
              el.className = 'mid-para-drop-cursor';
              return DecorationSet.create(tr.doc, [
                Decoration.widget(meta.pos, el, { side: -1 }),
              ]);
            }
            if (meta?.clear) return DecorationSet.empty;
            return set;
          },
        },
        props: {
          decorations(state) { return midParaDropKey.getState(state); },
          handleDOMEvents: {
            dragover(view, event) {
              const dragging = view.dragging;
              if (!dragging) return false;
              const first = dragging.slice.content.firstChild;
              if (!first || first.type.name !== 'screenshotBlock') return false;

              const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
              const $p = coords && view.state.doc.resolve(coords.pos);
              const clear = !$p || !$p.parent.isTextblock ||
                coords!.pos <= $p.start() || coords!.pos >= $p.end();

              const current = midParaDropKey.getState(view.state);
              const currentPos = current !== DecorationSet.empty
                ? (current.find()[0]?.from ?? null)
                : null;

              if (clear) {
                if (currentPos !== null)
                  view.dispatch(view.state.tr.setMeta(midParaDropKey, { clear: true }));
                return false;
              }
              if (coords!.pos !== currentPos)
                view.dispatch(view.state.tr.setMeta(midParaDropKey, { pos: coords!.pos }));
              return false;
            },
            dragleave(view) {
              view.dispatch(view.state.tr.setMeta(midParaDropKey, { clear: true }));
              return false;
            },
            drop(view) {
              view.dispatch(view.state.tr.setMeta(midParaDropKey, { clear: true }));
              return false;
            },
            dragend(view) {
              view.dispatch(view.state.tr.setMeta(midParaDropKey, { clear: true }));
              return false;
            },
          },
        },
      }),
    ];
  },
});

// ─── Image picker popover (used inside SectionSlot) ──────────────────────────

function ImagePicker({
  available,
  onPick,
  onClose,
}: {
  available: ScreenshotInfo[];
  onPick: (s: ScreenshotInfo) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (available.length === 0) {
    return (
      <div ref={ref} className="absolute left-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg p-3 z-50 text-xs text-muted-foreground w-48">
        All screenshots are already in this section.
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg p-2 z-50 grid grid-cols-3 gap-1.5 max-w-[240px]"
    >
      {available.map((s) => (
        <button
          key={s.index}
          onMouseDown={(e) => { e.preventDefault(); onPick(s); }}
          className="relative rounded overflow-hidden border border-border hover:border-primary transition-colors aspect-video bg-muted"
          title={s.feature}
        >
          {s.url
            ? <img src={s.url} alt={s.feature} className="w-full h-full object-cover" draggable={false} />
            : <div className="w-full h-full flex items-center justify-center text-[8px] text-muted-foreground">?</div>
          }
        </button>
      ))}
    </div>
  );
}

// ─── Single section slot ─────────────────────────────────────────────────────

interface SlotHandle {
  getJSON: () => JSONContent | null;
  getTitle: () => string;
}

const SectionSlot = forwardRef<SlotHandle, {
  title: string;
  titleEditable?: boolean;
  initialContent: JSONContent;
  onDirty: () => void;
  onDelete?: () => void;
}>(({ title, titleEditable = false, initialContent, onDirty, onDelete }, ref) => {
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;

  const allScreenshots = useContext(ScreenshotsContext);
  const [currentTitle, setCurrentTitle] = useState(title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, FigureRefNode, ScreenshotBlockNode, MidParaDropCursor],
    content: initialContent,
    onUpdate: () => onDirtyRef.current(),
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[60px] px-0 text-sm leading-relaxed',
      },
      handleDrop(view, event, slice, moved) {
        if (!slice.content.firstChild) return false;
        const draggedNode = slice.content.firstChild;
        if (draggedNode.type.name !== 'screenshotBlock') return false;

        const dropCoords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!dropCoords) return false;

        const { pos } = dropCoords;
        const { state } = view;
        const $pos = state.doc.resolve(pos);

        // Only intercept genuine mid-paragraph drops.
        // When the mouse is near a paragraph boundary, posAtCoords snaps to
        // the first or last char of that paragraph — treat those as block-boundary
        // drops and let ProseMirror handle them natively.
        if (!$pos.parent.isTextblock) return false;
        if (pos <= $pos.start() || pos >= $pos.end()) return false;

        // Find source node position (needed to delete it on move)
        let sourcePos: number | null = null;
        if (moved) {
          state.doc.descendants((node, nodePos) => {
            if (sourcePos !== null) return false;
            if (
              node.type.name === 'screenshotBlock' &&
              node.attrs.index === draggedNode.attrs.index &&
              node.attrs.index2 === draggedNode.attrs.index2
            ) {
              sourcePos = nodePos;
            }
          });
        }

        const tr = state.tr;
        // Split the paragraph at the cursor, then insert the block in the gap
        tr.split(pos);
        tr.insert(pos + 1, draggedNode);

        // Delete the original node — use tr.mapping.map so positions are correct
        // after the split+insert above shifted things around
        if (moved && sourcePos !== null) {
          const mappedPos = tr.mapping.map(sourcePos as number);
          tr.delete(mappedPos, mappedPos + draggedNode.nodeSize);
        }

        view.dispatch(tr);
        return true;
      },
    },
  });

  useImperativeHandle(ref, () => ({
    getJSON: () => editor?.getJSON() ?? null,
    getTitle: () => currentTitle,
  }));

  // Screenshots already placed in this editor
  const usedIndices = useMemo((): Set<number> => {
    if (!editor) return new Set();
    const used = new Set<number>();
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'screenshotBlock') {
        if (n.attrs.index != null) used.add(n.attrs.index as number);
        if (n.attrs.index2 != null) used.add(n.attrs.index2 as number);
      }
    });
    return used;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor?.state]);

  const availableToAdd = allScreenshots.filter((s) => !usedIndices.has(s.index));

  const handlePickImage = (s: ScreenshotInfo) => {
    if (!editor) return;
    // Insert at the current cursor position (TipTap preserves selection even
    // while the editor doesn't have DOM focus, so focus() restores it correctly).
    editor.chain().focus().insertContent({
      type: 'screenshotBlock',
      attrs: { index: s.index, index2: null, feature: s.feature, feature2: '' },
    }).run();
    setShowImagePicker(false);
    onDirtyRef.current();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        {titleEditable ? (
          editingTitle ? (
            <input
              autoFocus
              value={currentTitle}
              onChange={(e) => setCurrentTitle(e.target.value)}
              onBlur={() => { setEditingTitle(false); onDirtyRef.current(); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  setEditingTitle(false);
                  onDirtyRef.current();
                }
              }}
              className="text-[10px] font-semibold uppercase tracking-widest bg-transparent border-b border-primary outline-none flex-1 text-primary pb-0.5"
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground px-0.5 transition-colors text-left flex-1"
              title="Click to rename"
            >
              {currentTitle}
            </button>
          )
        ) : (
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-0.5 flex-1">
            {currentTitle}
          </p>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="text-muted-foreground/30 hover:text-destructive transition-colors shrink-0"
            title="Delete section"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border/50 bg-card px-3 py-2.5 focus-within:border-primary/40 transition-colors">
        <EditorContent editor={editor} />
      </div>

      {/* Add image button */}
      {allScreenshots.length > 0 && (
        <div className="relative flex justify-end">
          <button
            onClick={() => setShowImagePicker((p) => !p)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            <ImagePlus className="h-3 w-3" />
            Add image
          </button>
          {showImagePicker && (
            <ImagePicker
              available={availableToAdd}
              onPick={handlePickImage}
              onClose={() => setShowImagePicker(false)}
            />
          )}
        </div>
      )}
    </div>
  );
});
SectionSlot.displayName = 'SectionSlot';

// ─── Main SectionEditor ──────────────────────────────────────────────────────

interface SectionEditorProps {
  reportId: string;
  sectionContent: SectionContent;
  screenshots: ScreenshotInfo[];
  onCompiled: (pdfUrl?: string, texUrl?: string) => void;
  reportMeta?: {
    title?: string;
    company?: string;
    role?: string;
    dates?: string;
    customFields?: Record<string, { label: string; value: string }>;
    layoutConfig?: LayoutConfig;
  };
}

export function SectionEditor({
  reportId,
  sectionContent,
  screenshots,
  onCompiled,
  reportMeta,
}: SectionEditorProps) {
  const [activeTab, setActiveTab] = useState<'cover' | 'sections'>('sections');
  const [isDirty, setIsDirty] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [compiled, setCompiled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cover state
  const [coverTitle, setCoverTitle] = useState(reportMeta?.title ?? '');
  const [coverCompany, setCoverCompany] = useState(reportMeta?.company ?? '');
  const [coverRole, setCoverRole] = useState(reportMeta?.role ?? '');
  const [coverDates, setCoverDates] = useState(reportMeta?.dates ?? '');
  const [coverConfig, setCoverConfig] = useState<CoverConfig>(
    reportMeta?.layoutConfig?.coverConfig ?? {},
  );
  const [customFields, setCustomFields] = useState<CoverField[]>(
    customFieldsToArray(reportMeta?.customFields),
  );

  // Logo state — uploading is immediate; position change is deferred to compile.
  // Only pre-populate from existing layoutConfig when it is already a cover-type
  // position — header logos are managed separately (via AI chat) and must not
  // be silently migrated to the cover page when the user compiles from here.
  const existingLogoPos = reportMeta?.layoutConfig?.logoPosition;
  const existingIsCoverLogo =
    existingLogoPos === 'cover' || existingLogoPos?.startsWith('cover-');
  const [logoUrl, setLogoUrl] = useState(
    existingIsCoverLogo ? (reportMeta?.layoutConfig?.logoUrl ?? '') : '',
  );
  const [logoPosition, setLogoPosition] = useState<CoverLogoPosition>(
    (() => {
      const p = existingLogoPos;
      if (p && p.startsWith('cover-') && p !== 'cover') return p as CoverLogoPosition;
      return 'cover-top-right';
    })(),
  );
  const [isLogoUploading, setIsLogoUploading] = useState(false);
  // Tracks whether the user has explicitly interacted with the logo section.
  // Only write logo fields to layoutConfig on compile when this is true,
  // so we never silently overwrite a header logo the AI set.
  const [logoTouched, setLogoTouched] = useState(false);

  // Sections state
  const [localSections, setLocalSections] = useState(() => sectionContent.sections);
  const [sectionContents, setSectionContents] = useState<JSONContent[]>(() =>
    sectionContent.sections.map((s) =>
      latexToTiptap(s.content, screenshots, s.screenshotIndices, s.screenshotPairs ?? []),
    ),
  );

  const introRef = useRef<SlotHandle>(null);
  const sectionRefs = useRef<(SlotHandle | null)[]>([]);
  const conclusionRef = useRef<SlotHandle>(null);

  const handleDirty = useCallback(() => {
    setIsDirty(true);
    setCompiled(false);
  }, []);

  const handleLogoUpload = useCallback(async (file: File) => {
    setIsLogoUploading(true);
    try {
      const { logoUrl: newUrl } = await api.uploadLogo(reportId, file);
      setLogoUrl(newUrl);
      setLogoTouched(true);
      handleDirty();
    } catch {
      // silently ignore — user can retry
    } finally {
      setIsLogoUploading(false);
    }
  }, [reportId, handleDirty]);

  const handleLogoRemove = useCallback(async () => {
    try {
      await api.deleteLogo(reportId);
      setLogoUrl('');
      setLogoTouched(true);
      handleDirty();
    } catch {
      // silently ignore
    }
  }, [reportId, handleDirty]);

  const introContent = useMemo(
    () => latexToTiptap(sectionContent.introduction, screenshots),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const conclusionContent = useMemo(
    () => latexToTiptap(sectionContent.conclusion, screenshots),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const defaultIntroTitle = sectionContent.introductionTitle ?? 'Introduction';
  const defaultConclusionTitle = sectionContent.conclusionTitle ?? 'Conclusion';

  const handleAddSection = () => {
    setLocalSections((prev) => [...prev, { sectionName: 'New Section', content: '', screenshotIndices: [], screenshotPairs: [] }]);
    setSectionContents((prev) => [...prev, latexToTiptap('', screenshots)]);
    handleDirty();
  };

  const handleDeleteSection = (idx: number) => {
    setLocalSections((prev) => prev.filter((_, i) => i !== idx));
    setSectionContents((prev) => prev.filter((_, i) => i !== idx));
    sectionRefs.current = sectionRefs.current.filter((_, i) => i !== idx);
    handleDirty();
  };

  const handleCompile = useCallback(async () => {
    setIsCompiling(true);
    setError(null);
    try {
      const introJson = introRef.current?.getJSON();
      const conclusionJson = conclusionRef.current?.getJSON();

      const updatedSectionContent: SectionContent = {
        introduction: introJson ? tiptapToLatex(introJson) : sectionContent.introduction,
        introductionTitle: introRef.current?.getTitle() ?? sectionContent.introductionTitle,
        sections: localSections.map((section, i) => {
          const json = sectionRefs.current[i]?.getJSON();
          const name = sectionRefs.current[i]?.getTitle() ?? section.sectionName;
          const content = json ? tiptapToLatex(json) : section.content;
          // Derive indices/pairs from TipTap JSON so backend knows which screenshots
          // belong here (for AI compat), while content already has inline figures.
          const meta = json ? deriveScreenshotMeta(json) : {
            screenshotIndices: section.screenshotIndices,
            screenshotPairs: section.screenshotPairs ?? [],
          };
          return { ...section, sectionName: name, content, ...meta };
        }),
        conclusion: conclusionJson ? tiptapToLatex(conclusionJson) : sectionContent.conclusion,
        conclusionTitle: conclusionRef.current?.getTitle() ?? sectionContent.conclusionTitle,
      };

      const updatedLayoutConfig: LayoutConfig = {
        ...(reportMeta?.layoutConfig ?? {}),
        ...(Object.keys(coverConfig).length > 0 ? { coverConfig } : {}),
        // Only overwrite logo fields when the user explicitly interacted with the logo
        // section — avoids silently migrating AI-set header logos to the cover page.
        ...(logoTouched
          ? (logoUrl
              ? { logoUrl, logoPosition }
              : { logoUrl: undefined, logoPosition: 'none' as const })
          : {}),
      };

      await api.updateReport(reportId, {
        sectionContent: updatedSectionContent,
        title: coverTitle || undefined,
        company: coverCompany || undefined,
        role: coverRole || undefined,
        dates: coverDates || undefined,
        customFields: arrayToCustomFields(customFields),
        layoutConfig: updatedLayoutConfig,
      });

      const result = await api.compileReport(reportId);
      onCompiled(result?.pdfUrl, result?.texUrl);
      setIsDirty(false);
      setCompiled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compile failed');
    } finally {
      setIsCompiling(false);
    }
  }, [reportId, sectionContent, localSections, onCompiled, coverTitle, coverCompany, coverRole, coverDates, coverConfig, customFields, logoUrl, logoPosition, logoTouched, reportMeta]);

  return (
    <ScreenshotsContext.Provider value={screenshots}>
      <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-border/40 bg-background/60">
          <div className="flex items-center gap-0.5">
            {(['cover', 'sections'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest rounded transition-colors ${
                  activeTab === tab
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {compiled && !isDirty && (
              <span className="flex items-center gap-1 text-xs text-primary">
                <CheckCircle2 className="h-3 w-3" />
                Compiled
              </span>
            )}
            <Button
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={handleCompile}
              disabled={!isDirty || isCompiling}
              variant={isDirty ? 'glow' : 'outline'}
            >
              {isCompiling ? (
                <><Loader2 className="h-3 w-3 animate-spin" />Compiling…</>
              ) : (
                <><Save className="h-3 w-3" />Compile</>
              )}
            </Button>
          </div>
        </div>

        {error && (
          <div className="shrink-0 px-3 py-1.5 bg-destructive/8 border-b border-destructive/15 text-destructive text-xs">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5 scrollbar-thin">
          {activeTab === 'cover' ? (
            <CoverPanel
              title={coverTitle}
              company={coverCompany}
              role={coverRole}
              dates={coverDates}
              coverConfig={coverConfig}
              customFields={customFields}
              logoUrl={logoUrl || undefined}
              logoPosition={logoPosition}
              isLogoUploading={isLogoUploading}
              onDirty={handleDirty}
              onTitleChange={setCoverTitle}
              onCompanyChange={setCoverCompany}
              onRoleChange={setCoverRole}
              onDatesChange={setCoverDates}
              onCoverConfigChange={(k, v) => setCoverConfig((prev) => ({ ...prev, [k]: v }))}
              onCustomFieldsChange={setCustomFields}
              onLogoUpload={handleLogoUpload}
              onLogoRemove={handleLogoRemove}
              onLogoPositionChange={(pos) => { setLogoPosition(pos); setLogoTouched(true); handleDirty(); }}
            />
          ) : (
            <>
              <SectionSlot
                ref={introRef}
                title={defaultIntroTitle}
                titleEditable
                initialContent={introContent}
                onDirty={handleDirty}
              />

              {localSections.map((section, i) => (
                <SectionSlot
                  key={`${section.sectionName}-${i}`}
                  ref={(el) => { sectionRefs.current[i] = el; }}
                  title={section.sectionName}
                  titleEditable
                  initialContent={sectionContents[i]}
                  onDirty={handleDirty}
                  onDelete={() => handleDeleteSection(i)}
                />
              ))}

              <button
                onClick={handleAddSection}
                className="w-full flex items-center justify-center gap-1.5 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground border border-dashed border-border/50 hover:border-border rounded-lg transition-colors"
              >
                <Plus className="h-3 w-3" />
                Add Section
              </button>

              <SectionSlot
                ref={conclusionRef}
                title={defaultConclusionTitle}
                titleEditable
                initialContent={conclusionContent}
                onDirty={handleDirty}
              />
            </>
          )}
        </div>
      </div>
    </ScreenshotsContext.Provider>
  );
}
