"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "@/components/admin/Button";
import { Field, Input, Select, Switch, Textarea } from "@/components/admin/Field";
import { Panel, PanelBody, PanelHeader } from "@/components/admin/Panel";
import { SegmentedControl } from "@/components/admin/SegmentedControl";
import { StickyActionBar } from "@/components/admin/StickyActionBar";
import { useToast } from "@/components/admin/Toast";
import { saveArticleAction, type ArticleFormInput } from "./actions";

export type ArticleEditorValue = Omit<ArticleFormInput, "steps"> & {
  steps: Array<{ title: string; text: string; image: string }>;
};

type Step = ArticleEditorValue["steps"][number] & { key: string };

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
  { value: "ARCHIVED", label: "Archived" },
] as const;

const DIFFICULTY_LABEL = { EASY: "Easy", MEDIUM: "Medium", ADVANCED: "Advanced" } as const;

/** React keys for step rows (never rendered, so they needn't match between server and client). */
let stepKeySeq = 0;
const newStepKey = () => `step-${++stepKeySeq}`;

function fieldsOf(value: ArticleEditorValue): Omit<ArticleEditorValue, "steps"> {
  const rest: Partial<ArticleEditorValue> = { ...value };
  delete rest.steps;
  return rest as Omit<ArticleEditorValue, "steps">;
}

function stepsOf(value: ArticleEditorValue): Step[] {
  return (value.steps.length ? value.steps : [{ title: "", text: "", image: "" }]).map((s) => ({ ...s, key: newStepKey() }));
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/**
 * Help-article editor. Slug follows the title until edited by hand. Products:
 * none ticked = the article applies to every product. Read-only for roles
 * without articles.edit (the server action re-checks).
 */
export function ArticleEditor({
  id,
  initial,
  categories,
  products,
  articles,
  canEdit,
}: {
  id: string | null;
  initial: ArticleEditorValue;
  categories: Array<{ value: string; label: string }>;
  products: Array<{ id: string; name: string; group: string }>;
  articles: Array<{ slug: string; title: string }>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState(() => fieldsOf(initial));
  const [steps, setSteps] = useState<Step[]>(() => stepsOf(initial));
  const [slugTouched, setSlugTouched] = useState(id !== null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  /** Back to the last saved version (the page re-renders with it after every save). */
  function discard() {
    setV(fieldsOf(initial));
    setSteps(stepsOf(initial));
    setSlugTouched(id !== null);
    setDirty(false);
    setError(null);
  }

  function set<K extends keyof typeof v>(key: K, value: (typeof v)[K]) {
    setV((cur) => ({ ...cur, [key]: value }));
    setDirty(true);
  }
  function setStep(i: number, patch: Partial<Step>) {
    setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)));
    setDirty(true);
  }
  function moveStep(i: number, dir: -1 | 1) {
    setSteps((all) => {
      const j = i + dir;
      if (j < 0 || j >= all.length) return all;
      const next = [...all];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  }

  const skuSet = useMemo(() => new Set(v.skuIds), [v.skuIds]);
  const relatedSet = useMemo(() => new Set(v.relatedSlugs), [v.relatedSlugs]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof products>();
    for (const p of products) m.set(p.group, [...(m.get(p.group) ?? []), p]);
    return [...m.entries()];
  }, [products]);
  const otherArticles = articles.filter((a) => a.slug !== v.slug);

  function save() {
    setError(null);
    const payload: ArticleFormInput = { ...v, steps: steps.map(({ title, text, image }) => ({ title, text, image })) };
    startTransition(async () => {
      const r = await saveArticleAction(id, payload);
      if (!r.ok) {
        setError(r.error);
        toast({ title: "Not saved", description: r.error, tone: "error" });
        return;
      }
      setDirty(false);
      toast({ title: r.message ?? "Saved", tone: "success" });
      if (!id) router.replace(`/admin/support/articles/${r.id}`);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canEdit) save();
      }}
      className="pb-24"
    >
      <fieldset disabled={!canEdit || pending} className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Article" />
            <PanelBody className="space-y-4">
              <Field label="Title" htmlFor="a-title">
                <Input
                  id="a-title"
                  value={v.title}
                  maxLength={140}
                  required
                  onChange={(e) => {
                    const title = e.target.value;
                    setV((cur) => ({ ...cur, title, ...(slugTouched ? {} : { slug: slugify(title) }) }));
                    setDirty(true);
                  }}
                />
              </Field>
              <Field label="Slug" htmlFor="a-slug" hint={`Customer URL: /support/help/${v.slug || "…"}`}>
                <Input
                  id="a-slug"
                  value={v.slug}
                  maxLength={80}
                  required
                  className="font-mono"
                  spellCheck={false}
                  onChange={(e) => {
                    setSlugTouched(true);
                    set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"));
                  }}
                />
              </Field>
              <Field label="Summary" htmlFor="a-summary" hint="One line shown in search results and article lists." optional>
                <Textarea id="a-summary" value={v.summary} maxLength={300} rows={2} className="min-h-16" onChange={(e) => set("summary", e.target.value)} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category" htmlFor="a-category">
                  <Select id="a-category" value={v.category} onChange={(e) => set("category", e.target.value as typeof v.category)}>
                    {categories.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Difficulty" htmlFor="a-difficulty">
                  <Select id="a-difficulty" value={v.difficulty} onChange={(e) => set("difficulty", e.target.value as typeof v.difficulty)}>
                    {(Object.keys(DIFFICULTY_LABEL) as Array<keyof typeof DIFFICULTY_LABEL>).map((d) => (
                      <option key={d} value={d}>
                        {DIFFICULTY_LABEL[d]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Steps"
              description="Short, numbered actions. Don't restate product numbers — the article page shows each product's catalogue specs."
            />
            <ol className="divide-y divide-admin-line">
              {steps.map((s, i) => (
                <li key={s.key} className="space-y-3 px-4 py-4 sm:px-5">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-ink text-[11px] font-semibold text-white">{i + 1}</span>
                    <Input
                      aria-label={`Step ${i + 1} title`}
                      placeholder="Step title"
                      value={s.title}
                      maxLength={120}
                      onChange={(e) => setStep(i, { title: e.target.value })}
                      className="flex-1"
                    />
                    <div className="flex shrink-0 items-center">
                      <IconButton label="Move step up" size="sm" disabled={i === 0} onClick={() => moveStep(i, -1)}>
                        <ArrowUp size={15} aria-hidden />
                      </IconButton>
                      <IconButton label="Move step down" size="sm" disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)}>
                        <ArrowDown size={15} aria-hidden />
                      </IconButton>
                      <IconButton
                        label="Remove step"
                        size="sm"
                        disabled={steps.length === 1}
                        onClick={() => {
                          setSteps((all) => all.filter((_, j) => j !== i));
                          setDirty(true);
                        }}
                      >
                        <Trash2 size={15} aria-hidden />
                      </IconButton>
                    </div>
                  </div>
                  <Textarea
                    aria-label={`Step ${i + 1} text`}
                    placeholder="What the customer should do"
                    value={s.text}
                    maxLength={2000}
                    rows={3}
                    onChange={(e) => setStep(i, { text: e.target.value })}
                  />
                  <Input
                    aria-label={`Step ${i + 1} image URL`}
                    placeholder="Image URL (optional) — https://… or /path"
                    value={s.image}
                    maxLength={500}
                    onChange={(e) => setStep(i, { image: e.target.value })}
                    className="font-mono text-[13px]"
                  />
                </li>
              ))}
            </ol>
            <div className="border-t border-admin-line px-4 py-3 sm:px-5">
              <Button
                size="sm"
                icon={<Plus size={14} aria-hidden />}
                disabled={steps.length >= 30}
                onClick={() => {
                  setSteps((all) => [...all, { title: "", text: "", image: "", key: newStepKey() }]);
                  setDirty(true);
                }}
              >
                Add step
              </Button>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Extras" />
            <PanelBody className="space-y-4">
              <Field label="Note" htmlFor="a-note" optional hint="Shown below the steps — safety advice, when to contact support.">
                <Textarea id="a-note" value={v.note} maxLength={2000} rows={3} onChange={(e) => set("note", e.target.value)} />
              </Field>
              <Field label="Video URL" htmlFor="a-video" optional hint="https:// link to a hosted video (YouTube, Instagram…).">
                <Input id="a-video" type="url" value={v.videoUrl} maxLength={500} onChange={(e) => set("videoUrl", e.target.value)} className="font-mono text-[13px]" />
              </Field>
            </PanelBody>
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel>
            <PanelHeader title="Publishing" />
            <PanelBody className="space-y-4">
              <SegmentedControl
                ariaLabel="Status"
                value={v.status}
                onChange={(s) => set("status", s)}
                options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                className="w-full [&>button]:flex-1"
              />
              <Switch
                checked={v.needsVerification}
                onChange={(next) => set("needsVerification", next)}
                disabled={!canEdit}
                label="Needs verification"
                description="Customers see 'being verified' until this is off."
              />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              title="Products"
              description={v.skuIds.length ? `${v.skuIds.length} selected` : "None ticked — applies to all products"}
              actions={
                v.skuIds.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={() => set("skuIds", [])}>
                    Clear
                  </Button>
                ) : undefined
              }
            />
            <div className="max-h-72 overflow-y-auto px-4 py-2 sm:px-5">
              {groups.map(([group, list]) => (
                <div key={group} className="py-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-admin-muted">{group}</p>
                  {list.map((p) => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2.5 py-1.5 text-[13px] text-brand-ink">
                      <input
                        type="checkbox"
                        checked={skuSet.has(p.id)}
                        onChange={(e) => set("skuIds", e.target.checked ? [...v.skuIds, p.id] : v.skuIds.filter((x) => x !== p.id))}
                        className="h-4 w-4 shrink-0 accent-brand-ink"
                      />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-admin-muted">{p.id}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Related articles" description={`${v.relatedSlugs.length} of 10`} />
            {otherArticles.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-admin-muted sm:px-5">No other articles yet.</p>
            ) : (
              <div className="max-h-60 overflow-y-auto px-4 py-2 sm:px-5">
                {otherArticles.map((a) => (
                  <label key={a.slug} className="flex cursor-pointer items-center gap-2.5 py-1.5 text-[13px] text-brand-ink">
                    <input
                      type="checkbox"
                      checked={relatedSet.has(a.slug)}
                      disabled={!relatedSet.has(a.slug) && v.relatedSlugs.length >= 10}
                      onChange={(e) =>
                        set("relatedSlugs", e.target.checked ? [...v.relatedSlugs, a.slug] : v.relatedSlugs.filter((x) => x !== a.slug))
                      }
                      className="h-4 w-4 shrink-0 accent-brand-ink"
                    />
                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                  </label>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </fieldset>

      {canEdit && (
        <StickyActionBar
          status={
            error ? (
              <span className="text-tone-neg">{error}</span>
            ) : (
              <span className={cn(dirty && "font-medium text-brand-ink")}>{dirty ? "Unsaved changes" : id ? "All changes saved" : "New article"}</span>
            )
          }
        >
          {dirty && id && (
            <Button variant="secondary" onClick={discard} disabled={pending} className="max-sm:flex-1">
              Discard
            </Button>
          )}
          <Button type="submit" variant="primary" loading={pending} className="max-sm:flex-1">
            {id ? "Save" : "Create article"}
          </Button>
        </StickyActionBar>
      )}
    </form>
  );
}
