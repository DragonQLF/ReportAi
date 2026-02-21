"use client";

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { JSONContent } from '@tiptap/core';
import { Loader2, Save, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, type SectionContent, type LayoutConfig } from '@/lib/api';
import { latexToTiptap, tiptapToLatex, type ScreenshotInfo } from '@/lib/latex-tiptap';
import { FigureRefNode } from './FigureRefNode';

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
  { value: 'Large',      label: 'Large'    },
  { value: 'large',      label: 'Medium'   },
  { value: 'normalsize', label: 'Normal'   },
  { value: 'small',      label: 'Small'    },
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

// ─── Cover form panel ────────────────────────────────────────────────────────

function CoverPanel({
  title, company, role, dates,
  coverConfig, customFields,
  onDirty,
  onTitleChange, onCompanyChange, onRoleChange, onDatesChange,
  onCoverConfigChange, onCustomFieldsChange,
}: {
  title: string; company: string; role: string; dates: string;
  coverConfig: CoverConfig;
  customFields: CoverField[];
  onDirty: () => void;
  onTitleChange: (v: string) => void;
  onCompanyChange: (v: string) => void;
  onRoleChange: (v: string) => void;
  onDatesChange: (v: string) => void;
  onCoverConfigChange: (k: keyof CoverConfig, v: string) => void;
  onCustomFieldsChange: (fields: CoverField[]) => void;
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
      {/* Title */}
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

      {/* Organization */}
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

      {/* Role */}
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

      {/* Dates */}
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

      {/* Custom fields */}
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

  const [currentTitle, setCurrentTitle] = useState(title);
  const [editingTitle, setEditingTitle] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, FigureRefNode],
    content: initialContent,
    onUpdate: () => onDirtyRef.current(),
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[60px] px-0 text-sm leading-relaxed',
      },
    },
  });

  useImperativeHandle(ref, () => ({
    getJSON: () => editor?.getJSON() ?? null,
    getTitle: () => currentTitle,
  }));

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

  // Sections state — local so we can add/remove
  const [localSections, setLocalSections] = useState(() => sectionContent.sections);
  const [sectionContents, setSectionContents] = useState<JSONContent[]>(() =>
    sectionContent.sections.map((s) => latexToTiptap(s.content, screenshots)),
  );

  const introRef = useRef<SlotHandle>(null);
  const sectionRefs = useRef<(SlotHandle | null)[]>([]);
  const conclusionRef = useRef<SlotHandle>(null);

  const handleDirty = useCallback(() => {
    setIsDirty(true);
    setCompiled(false);
  }, []);

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
          return { ...section, sectionName: name, content: json ? tiptapToLatex(json) : section.content };
        }),
        conclusion: conclusionJson ? tiptapToLatex(conclusionJson) : sectionContent.conclusion,
        conclusionTitle: conclusionRef.current?.getTitle() ?? sectionContent.conclusionTitle,
      };

      const updatedLayoutConfig: LayoutConfig = {
        ...(reportMeta?.layoutConfig ?? {}),
        ...(Object.keys(coverConfig).length > 0 ? { coverConfig } : {}),
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
  }, [reportId, sectionContent, localSections, onCompiled, coverTitle, coverCompany, coverRole, coverDates, coverConfig, customFields, reportMeta]);

  return (
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
            onDirty={handleDirty}
            onTitleChange={setCoverTitle}
            onCompanyChange={setCoverCompany}
            onRoleChange={setCoverRole}
            onDatesChange={setCoverDates}
            onCoverConfigChange={(k, v) => setCoverConfig((prev) => ({ ...prev, [k]: v }))}
            onCustomFieldsChange={setCustomFields}
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
  );
}
