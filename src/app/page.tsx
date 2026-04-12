"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { CoverPageKind, EditorialStatus, Issue, MagazinePage, PageDraft, PageKind } from "@/lib/types";

const DEFAULT_STATUS_COLORS = [
  "#fff13d",
  "#77d84d",
  "#f59b2f",
  "#51d6d1",
  "#48a858",
  "#55aeb8",
];

const EMPTY_PAGE_DRAFT: PageDraft = {
  title: "",
  assignee: "",
  character_count: null,
  status_id: null,
  warning_enabled: false,
  warning_note: "",
};

const INLINE_EDITOR_WIDTH = 308;
const INLINE_EDITOR_ESTIMATED_HEIGHT = 560;
const INLINE_EDITOR_GAP = 14;
const VIEWPORT_MARGIN = 16;

type InlineEditorPlacement = {
  arrowTop: number;
  direction: "left" | "right";
  left: number;
  top: number;
};

const COVER_DEFINITIONS: Array<{
  kind: CoverPageKind;
  label: string;
  title: string;
  position: number;
}> = [
  { kind: "cover_3", label: "III", title: "Terza di copertina", position: -4 },
  { kind: "cover_4", label: "IV", title: "Quarta di copertina", position: -3 },
  { kind: "cover_1", label: "I", title: "Prima di copertina", position: -2 },
  { kind: "cover_2", label: "II", title: "Seconda di copertina", position: -1 },
];

const COVER_ORDER = new Map(COVER_DEFINITIONS.map((cover, index) => [cover.kind, index]));

function normalizeCoverKind(kind: PageKind): CoverPageKind | null {
  if (kind === "cover_front") return "cover_1";
  if (kind === "cover_back") return "cover_4";
  if (kind === "cover_1" || kind === "cover_2" || kind === "cover_3" || kind === "cover_4") return kind;

  return null;
}

function sortPages(pages: MagazinePage[]) {
  return [...pages].sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
}

function pageLabel(page: MagazinePage, contentPages: MagazinePage[]) {
  const coverKind = normalizeCoverKind(page.kind);
  if (coverKind) {
    return COVER_DEFINITIONS.find((cover) => cover.kind === coverKind)?.label ?? "";
  }

  const index = contentPages.findIndex((contentPage) => contentPage.id === page.id);
  return index >= 0 ? String(index + 1) : "";
}

function sortCoverPages(pages: MagazinePage[]) {
  return [...pages].sort((a, b) => {
    const aKind = normalizeCoverKind(a.kind);
    const bKind = normalizeCoverKind(b.kind);
    const aOrder = aKind ? COVER_ORDER.get(aKind) ?? 99 : 99;
    const bOrder = bKind ? COVER_ORDER.get(bKind) ?? 99 : 99;

    return aOrder - bOrder;
  });
}

function chunkInteriorPages(contentPages: MagazinePage[]) {
  if (contentPages.length <= 2) {
    return contentPages.map((page) => [page]);
  }

  const first = [[contentPages[0]]];
  const last = [[contentPages[contentPages.length - 1]]];
  const middle = contentPages.slice(1, -1);
  const spreads: MagazinePage[][] = [];

  for (let index = 0; index < middle.length; index += 2) {
    spreads.push(middle.slice(index, index + 2));
  }

  return [...first, ...spreads, ...last];
}

function draftFromPage(page: MagazinePage | null): PageDraft {
  if (!page) return EMPTY_PAGE_DRAFT;

  return {
    title: page.title,
    assignee: page.assignee,
    character_count: page.character_count,
    status_id: page.status_id,
    warning_enabled: page.warning_enabled,
    warning_note: page.warning_note ?? "",
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function Home() {
  return (
    <Suspense fallback={<main className="loading">Caricamento timone...</main>}>
      <TimoniereApp />
    </Suspense>
  );
}

function TimoniereApp() {
  const searchParams = useSearchParams();
  const issueFromUrl = searchParams.get("issue");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [statuses, setStatuses] = useState<EditorialStatus[]>([]);
  const [pages, setPages] = useState<MagazinePage[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(issueFromUrl);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [newIssueDescription, setNewIssueDescription] = useState("");
  const [initialPageCount, setInitialPageCount] = useState(16);
  const [newStatusName, setNewStatusName] = useState("");
  const [newStatusColor, setNewStatusColor] = useState(DEFAULT_STATUS_COLORS[0]);
  const [pageDraft, setPageDraft] = useState<PageDraft>(EMPTY_PAGE_DRAFT);
  const [inlineEditorPageId, setInlineEditorPageId] = useState<string | null>(null);
  const [inlineEditorPlacement, setInlineEditorPlacement] = useState<InlineEditorPlacement | null>(null);
  const selectedPageIdRef = useRef(selectedPageId);
  const inlineTitleInputRef = useRef<HTMLInputElement | null>(null);

  const selectedIssue = issues.find((issue) => issue.id === selectedIssueId) ?? null;
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;
  const orderedPages = useMemo(() => sortPages(pages), [pages]);
  const coverPages = useMemo(
    () => sortCoverPages(orderedPages.filter((page) => normalizeCoverKind(page.kind))),
    [orderedPages],
  );
  const contentPages = orderedPages.filter((page) => page.kind === "content");
  const spreads = useMemo(() => chunkInteriorPages(contentPages), [contentPages]);
  const statusCounts = useMemo(() => {
    return contentPages.reduce<Record<string, number>>((counts, page) => {
      if (!page.status_id) return counts;

      counts[page.status_id] = (counts[page.status_id] ?? 0) + 1;
      return counts;
    }, {});
  }, [contentPages]);
  const statusById = useMemo(
    () => new Map(statuses.map((status) => [status.id, status])),
    [statuses],
  );
  const selectedPageIsContent = selectedPage?.kind === "content";

  useEffect(() => {
    selectedPageIdRef.current = selectedPageId;
  }, [selectedPageId]);

  useEffect(() => {
    if (!inlineEditorPageId || selectedPage?.id !== inlineEditorPageId) return;

    const animationFrame = window.requestAnimationFrame(() => {
      inlineTitleInputRef.current?.focus();
      inlineTitleInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [inlineEditorPageId, selectedPage?.id]);

  const loadIssues = useCallback(async () => {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("issues")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setNotice(error.message);
      return;
    }

    setIssues((data ?? []) as Issue[]);
  }, []);

  const loadStatuses = useCallback(async () => {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("editorial_statuses")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error) {
      setNotice(error.message);
      return;
    }

    setStatuses((data ?? []) as EditorialStatus[]);
  }, []);

  const loadPages = useCallback(async (issueId: string) => {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("pages")
      .select("*")
      .eq("issue_id", issueId)
      .order("position", { ascending: true });

    if (error) {
      setNotice(error.message);
      return;
    }

    const nextPages = (data ?? []) as MagazinePage[];
    setPages(sortPages(nextPages));

    if (!selectedPageIdRef.current || !nextPages.some((page) => page.id === selectedPageIdRef.current)) {
      setSelectedPageId(nextPages[0]?.id ?? null);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([loadIssues(), loadStatuses()]);
    setIsLoading(false);
  }, [loadIssues, loadStatuses]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setIsLoading(false);
      return;
    }

    void loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (issues.length === 0) return;

    if (!selectedIssueId || !issues.some((issue) => issue.id === selectedIssueId)) {
      setSelectedIssueId(issues[0].id);
    }
  }, [issues, selectedIssueId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !selectedIssueId) return;

    const client = supabase;
    void loadPages(selectedIssueId);

    const channel = client
      .channel(`issue:${selectedIssueId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pages", filter: `issue_id=eq.${selectedIssueId}` },
        () => void loadPages(selectedIssueId),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "editorial_statuses" }, () => {
        void loadStatuses();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, () => {
        void loadIssues();
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadIssues, loadPages, loadStatuses, selectedIssueId]);

  useEffect(() => {
    setPageDraft(draftFromPage(selectedPage));
  }, [selectedPage]);

  useEffect(() => {
    setInlineEditorPageId(null);
    setInlineEditorPlacement(null);
  }, [selectedIssueId]);

  async function createIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !newIssueTitle.trim()) return;

    setIsSaving(true);
    const baseSlug = slugify(newIssueTitle);
    const slug = `${baseSlug || "numero"}-${Date.now().toString(36)}`;

    const { data: issue, error } = await supabase
      .from("issues")
      .insert({
        title: newIssueTitle.trim(),
        slug,
        description: newIssueDescription.trim() || null,
      })
      .select("*")
      .single();

    if (error || !issue) {
      setNotice(error?.message ?? "Impossibile creare il numero.");
      setIsSaving(false);
      return;
    }

    const safeCount = Math.max(1, Math.min(256, initialPageCount));
    const blankPages = [
      ...COVER_DEFINITIONS.map((cover) => ({
        issue_id: issue.id,
        position: cover.position,
        kind: cover.kind,
        title: cover.title,
        assignee: "",
        character_count: null,
        status_id: null,
      })),
      ...Array.from({ length: safeCount }, (_, index) => ({
        issue_id: issue.id,
        position: index + 1,
        kind: "content",
        title: "",
        assignee: "",
        character_count: null,
        status_id: null,
      })),
    ];

    const { error: pageError } = await supabase.from("pages").insert(blankPages);

    if (pageError) {
      setNotice(pageError.message);
    } else {
      setNewIssueTitle("");
      setNewIssueDescription("");
      setSelectedIssueId((issue as Issue).id);
      await loadIssues();
      await loadPages((issue as Issue).id);
      setNotice("Numero creato.");
    }

    setIsSaving(false);
  }

  async function addContentPage() {
    if (!supabase || !selectedIssueId) return;

    const nextPosition = contentPages.length + 1;
    const { data, error } = await supabase
      .from("pages")
      .insert({
        issue_id: selectedIssueId,
        position: nextPosition,
        kind: "content",
        title: "",
        assignee: "",
        character_count: null,
        status_id: null,
      })
      .select("*")
      .single();

    if (error) {
      setNotice(error.message);
      return;
    }

    await reflowContentPages([...contentPages, data as MagazinePage]);
    setSelectedPageId((data as MagazinePage).id);
  }

  async function addSpread() {
    if (!supabase || !selectedIssueId) return;

    const nextPosition = contentPages.length + 1;
    const { data, error } = await supabase
      .from("pages")
      .insert([
        {
          issue_id: selectedIssueId,
          position: nextPosition,
          kind: "content",
          title: "",
          assignee: "",
          character_count: null,
          status_id: null,
        },
        {
          issue_id: selectedIssueId,
          position: nextPosition + 1,
          kind: "content",
          title: "",
          assignee: "",
          character_count: null,
          status_id: null,
        },
      ])
      .select("*");

    if (error) {
      setNotice(error.message);
      return;
    }

    const newPages = (data ?? []) as MagazinePage[];
    await reflowContentPages([...contentPages, ...newPages]);
    setSelectedPageId(newPages[0]?.id ?? selectedPageId);
  }

  async function reflowContentPages(nextContentPages: MagazinePage[]) {
    if (!supabase || !selectedIssueId) return;

    const client = supabase;
    const orderedContentPages = nextContentPages.map((page, index) => ({
      ...page,
      position: index + 1,
    }));
    const nextPages = sortPages([...coverPages, ...orderedContentPages]);

    setPages(nextPages);

    const results = await Promise.all([
      ...orderedContentPages.map((page) =>
        client.from("pages").update({ position: page.position }).eq("id", page.id),
      ),
    ]);
    const failedUpdate = results.find((result) => result.error);

    if (failedUpdate?.error) {
      setNotice(failedUpdate.error.message);
    }
  }

  async function movePage(targetPageId: string) {
    if (!draggedPageId || draggedPageId === targetPageId) return;

    const fromIndex = contentPages.findIndex((page) => page.id === draggedPageId);
    const toIndex = contentPages.findIndex((page) => page.id === targetPageId);
    if (fromIndex < 0 || toIndex < 0) return;

    const nextContentPages = [...contentPages];
    const [movedPage] = nextContentPages.splice(fromIndex, 1);
    nextContentPages.splice(toIndex, 0, movedPage);
    setDraggedPageId(null);
    await reflowContentPages(nextContentPages);
  }

  async function savePage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedPage) return;

    setIsSaving(true);
    const isContentPage = selectedPage.kind === "content";
    const payload = {
      title: pageDraft.title.trim(),
      assignee: isContentPage ? pageDraft.assignee.trim() : "",
      character_count: isContentPage ? pageDraft.character_count : null,
      status_id: pageDraft.status_id || null,
      warning_enabled: pageDraft.warning_enabled,
      warning_note: pageDraft.warning_enabled ? pageDraft.warning_note?.trim() || null : null,
    };

    const { data, error } = await supabase.from("pages").update(payload).eq("id", selectedPage.id).select("*").single();

    if (error) {
      setNotice(error.message);
    } else {
      setPages((current) => sortPages(current.map((page) => (page.id === selectedPage.id ? (data as MagazinePage) : page))));
      setNotice("Pagina salvata.");
      setInlineEditorPageId(null);
    }

    setIsSaving(false);
  }

  async function deleteSelectedIssue() {
    if (!supabase || !selectedIssue) return;

    const confirmed = window.confirm(
      `Vuoi cancellare il numero "${selectedIssue.title}"? Questa azione elimina anche tutte le sue pagine.`,
    );
    if (!confirmed) return;

    setIsSaving(true);
    const issueIdToDelete = selectedIssue.id;
    const { error } = await supabase.from("issues").delete().eq("id", issueIdToDelete);

    if (error) {
      setNotice(error.message);
      setIsSaving(false);
      return;
    }

    const nextIssues = issues.filter((issue) => issue.id !== issueIdToDelete);
    const nextIssueId = nextIssues[0]?.id ?? null;

    setIssues(nextIssues);
    setSelectedIssueId(nextIssueId);
    setSelectedPageId(null);
    setPages([]);

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (nextIssueId) {
        url.searchParams.set("issue", nextIssueId);
      } else {
        url.searchParams.delete("issue");
      }
      window.history.replaceState(null, "", url.toString());
    }

    if (nextIssueId) {
      await loadPages(nextIssueId);
    }
    await loadIssues();
    setNotice("Numero cancellato.");
    setIsSaving(false);
  }

  async function deleteSelectedPage() {
    if (!supabase || !selectedPage || selectedPage.kind !== "content") return;

    setIsSaving(true);
    const { error } = await supabase.from("pages").delete().eq("id", selectedPage.id);

    if (error) {
      setNotice(error.message);
      setIsSaving(false);
      return;
    }

    const nextContentPages = contentPages.filter((page) => page.id !== selectedPage.id);
    setSelectedPageId(nextContentPages[0]?.id ?? coverPages[0]?.id ?? null);
    await reflowContentPages(nextContentPages);
    setIsSaving(false);
  }

  async function createStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !newStatusName.trim()) return;

    const nextOrder = statuses.length === 0 ? 1 : Math.max(...statuses.map((status) => status.sort_order)) + 1;
    const { error } = await supabase.from("editorial_statuses").insert({
      name: newStatusName.trim(),
      color: newStatusColor,
      sort_order: nextOrder,
    });

    if (error) {
      setNotice(error.message);
      return;
    }

    setNewStatusName("");
    await loadStatuses();
  }

  async function updateStatus(status: EditorialStatus, patch: Partial<EditorialStatus>) {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("editorial_statuses")
      .update(patch)
      .eq("id", status.id)
      .select("*")
      .single();

    if (error) {
      setNotice(error.message);
      return;
    }

    setStatuses((current) =>
      current.map((currentStatus) => (currentStatus.id === status.id ? (data as EditorialStatus) : currentStatus)),
    );
  }

  async function deleteStatus(status: EditorialStatus) {
    if (!supabase) return;

    const { error } = await supabase.from("editorial_statuses").delete().eq("id", status.id);

    if (error) {
      setNotice(error.message);
      return;
    }

    setStatuses((current) => current.filter((currentStatus) => currentStatus.id !== status.id));
  }

  async function copyShareLink() {
    if (!selectedIssueId || typeof window === "undefined") return;

    const url = new URL(window.location.href);
    url.searchParams.set("issue", selectedIssueId);
    try {
      await navigator.clipboard.writeText(url.toString());
      setNotice("Link del numero copiato.");
    } catch {
      setNotice(url.toString());
    }
  }

  function getInlineEditorPlacement(anchor: HTMLElement): InlineEditorPlacement {
    const rect = anchor.getBoundingClientRect();
    const spaceRight = window.innerWidth - rect.right - VIEWPORT_MARGIN;
    const spaceLeft = rect.left - VIEWPORT_MARGIN;
    const direction: InlineEditorPlacement["direction"] =
      spaceRight >= INLINE_EDITOR_WIDTH + INLINE_EDITOR_GAP || spaceRight >= spaceLeft ? "right" : "left";
    const rawLeft =
      direction === "right"
        ? rect.right + INLINE_EDITOR_GAP
        : rect.left - INLINE_EDITOR_WIDTH - INLINE_EDITOR_GAP;
    const maxLeft = window.innerWidth - INLINE_EDITOR_WIDTH - VIEWPORT_MARGIN;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rawLeft, maxLeft));
    const rawTop = rect.top;
    const maxTop = window.innerHeight - INLINE_EDITOR_ESTIMATED_HEIGHT - VIEWPORT_MARGIN;
    const top = Math.max(VIEWPORT_MARGIN, Math.min(rawTop, Math.max(VIEWPORT_MARGIN, maxTop)));
    const arrowTop = Math.max(18, Math.min(rect.top + 24 - top, INLINE_EDITOR_ESTIMATED_HEIGHT - 24));

    return { arrowTop, direction, left, top };
  }

  function openInlineEditor(page: MagazinePage, anchor: HTMLElement) {
    setSelectedPageId(page.id);
    setInlineEditorPageId(page.id);
    setInlineEditorPlacement(getInlineEditorPlacement(anchor));
  }

  function closeInlineEditor() {
    setInlineEditorPageId(null);
    setInlineEditorPlacement(null);
    setPageDraft(draftFromPage(selectedPage));
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="setup-screen">
        <section className="setup-copy">
          <p className="brand-logo">TIMONIERE</p>
          <h1>Serve il collegamento a Supabase.</h1>
          <p>
            Crea un progetto Supabase, esegui lo schema SQL incluso e inserisci le variabili
            `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`.
          </p>
          <p>
            Dopo il deploy, le stesse variabili vanno configurate anche sul provider di hosting.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="issue-rail" aria-label="Numeri">
        <div className="brand-block">
          <p className="brand-logo">TIMONIERE</p>
        </div>

        <form className="creation-panel" onSubmit={createIssue}>
          <h2>Nuovo numero</h2>
          <label>
            Titolo
            <input
              value={newIssueTitle}
              onChange={(event) => setNewIssueTitle(event.target.value)}
              placeholder="Iconografie A6N2"
              required
            />
          </label>
          <label>
            Note
            <textarea
              value={newIssueDescription}
              onChange={(event) => setNewIssueDescription(event.target.value)}
              placeholder="Tema, uscita, deadline"
              rows={3}
            />
          </label>
          <label>
            Pagine interne iniziali
            <input
              type="number"
              min={1}
              max={256}
              value={initialPageCount}
              onChange={(event) => setInitialPageCount(Number(event.target.value))}
            />
          </label>
          <button type="submit" disabled={isSaving}>
            Crea numero
          </button>
        </form>

        <section className="issue-list">
          <h2>Numeri</h2>
          {isLoading ? <p>Caricamento...</p> : null}
          {issues.map((issue) => (
            <button
              className={issue.id === selectedIssueId ? "issue-item active" : "issue-item"}
              key={issue.id}
              onClick={() => setSelectedIssueId(issue.id)}
              type="button"
            >
              <span>{issue.title}</span>
              <small>{issue.description || "Timone condiviso"}</small>
            </button>
          ))}
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h2>{selectedIssue?.title ?? "Nessun numero selezionato"}</h2>
            <p>
              {selectedIssue
                ? `${contentPages.length} pagine interne`
                : "Crea o seleziona un numero dalla sidebar."}
              {selectedIssue?.description ? ` · ${selectedIssue.description}` : ""}
            </p>
          </div>
          <div className="topbar-actions">
            <button type="button" onClick={addContentPage} disabled={!selectedIssue}>
              Aggiungi pagina
            </button>
            <button type="button" onClick={addSpread} disabled={!selectedIssue}>
              Aggiungi doppia
            </button>
            <button type="button" onClick={copyShareLink} disabled={!selectedIssue}>
              Copia link
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={deleteSelectedIssue}
              disabled={!selectedIssue || isSaving}
            >
              Elimina numero
            </button>
          </div>
        </header>

        {notice ? (
          <button className="notice" type="button" onClick={() => setNotice("")}>
            {notice}
          </button>
        ) : null}

        {selectedIssue ? (
          <div className="board-wrap">
            <section className="status-strip" aria-label="Legenda stati">
              {statuses.map((status) => (
                <span
                  className="status-chip"
                  key={status.id}
                  style={{ "--status-color": status.color } as CSSProperties & { "--status-color": string }}
                >
                  <i aria-hidden="true" />
                  <strong>{status.name}</strong>
                  <small>{statusCounts[status.id] ?? 0}</small>
                </span>
              ))}
            </section>

            <section className="cover-section" aria-label="Copertina">
              <h3>Copertina</h3>
              <div className="cover-grid">
                {coverPages.map((page) => (
                  <div
                    className={inlineEditorPageId === page.id ? "page-slot side-single editing" : "page-slot side-single"}
                    key={page.id}
                  >
                    <PageTile
                      contentPages={contentPages}
                      isSelected={selectedPageId === page.id}
                      onClick={() => setSelectedPageId(page.id)}
                      onDoubleClick={(event) => openInlineEditor(page, event.currentTarget)}
                      page={page}
                      status={page.status_id ? statusById.get(page.status_id) : undefined}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section className="timone-board" aria-label="Pagine interne">
              {spreads.map((spread, spreadIndex) => (
                <div
                  className={[
                    "spread",
                    spread.length === 1 ? "single" : "",
                    spreadIndex === 0 ? "opening-spread" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={spread.map((page) => page.id).join("-") || spreadIndex}
                >
                  {spread.map((page, pageIndex) => (
                    <div
                      className={[
                        "page-slot",
                        `side-${spread.length === 1 ? (spreadIndex === 0 ? "right" : "single") : pageIndex === 0 ? "left" : "right"}`,
                        inlineEditorPageId === page.id ? "editing" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={page.id}
                    >
                      <PageTile
                        contentPages={contentPages}
                        draggable
                        isDragging={draggedPageId === page.id}
                        isSelected={selectedPageId === page.id}
                        onClick={() => setSelectedPageId(page.id)}
                        onDoubleClick={(event) => openInlineEditor(page, event.currentTarget)}
                        onDragStart={() => setDraggedPageId(page.id)}
                        onDrop={() => void movePage(page.id)}
                        page={page}
                        side={spread.length === 1 ? (spreadIndex === 0 ? "right" : "single") : pageIndex === 0 ? "left" : "right"}
                        status={page.status_id ? statusById.get(page.status_id) : undefined}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </section>
          </div>
        ) : (
          <section className="empty-state">
            <h2>Crea il primo numero.</h2>
            <p>Il timone apparira qui appena esiste un numero condiviso nel database.</p>
          </section>
        )}
      </section>

      {inlineEditorPageId && selectedPage && inlineEditorPlacement ? (
        <InlinePageEditor
          draft={pageDraft}
          isContentPage={selectedPage.kind === "content"}
          isSaving={isSaving}
          label={
            selectedPage.kind === "content"
              ? `Pagina ${pageLabel(selectedPage, contentPages)}`
              : pageLabel(selectedPage, contentPages)
          }
          onClose={closeInlineEditor}
          onSave={savePage}
          placement={inlineEditorPlacement}
          setDraft={setPageDraft}
          statuses={statuses}
          titleInputRef={inlineTitleInputRef}
        />
      ) : null}

      <aside className="editor-rail" aria-label="Dettagli pagina">
        <section className="editor-panel">
          <h2>Pagina</h2>
          {selectedPage ? (
            <form onSubmit={savePage}>
              <p className="page-kind">
                {selectedPage.kind === "content" ? `Pagina ${pageLabel(selectedPage, contentPages)}` : pageLabel(selectedPage, contentPages)}
              </p>
              <label>
                Nome articolo
                <input
                  value={pageDraft.title}
                  onChange={(event) => setPageDraft((draft) => ({ ...draft, title: event.target.value }))}
                  placeholder="Breve storia del golf"
                />
              </label>
              {selectedPageIsContent ? (
                <>
                  <label>
                    Assegnato a
                    <input
                      value={pageDraft.assignee}
                      onChange={(event) => setPageDraft((draft) => ({ ...draft, assignee: event.target.value }))}
                      placeholder="Nome redattore"
                    />
                  </label>
                  <label>
                    Battute
                    <input
                      min={0}
                      type="number"
                      value={pageDraft.character_count ?? ""}
                      onChange={(event) =>
                        setPageDraft((draft) => ({
                          ...draft,
                          character_count: event.target.value === "" ? null : Number(event.target.value),
                        }))
                      }
                      placeholder="3200"
                    />
                  </label>
                </>
              ) : null}
              <label>
                Status
                <select
                  value={pageDraft.status_id ?? ""}
                  onChange={(event) => setPageDraft((draft) => ({ ...draft, status_id: event.target.value || null }))}
                >
                  <option value="">Nessuno status</option>
                  {statuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="warning-toggle">
                <input
                  checked={pageDraft.warning_enabled}
                  onChange={(event) =>
                    setPageDraft((draft) => ({ ...draft, warning_enabled: event.target.checked }))
                  }
                  type="checkbox"
                />
                Warning attivo
              </label>
              {pageDraft.warning_enabled ? (
                <label>
                  Spiegazione warning
                  <textarea
                    value={pageDraft.warning_note ?? ""}
                    onChange={(event) => setPageDraft((draft) => ({ ...draft, warning_note: event.target.value }))}
                    placeholder="Testo troppo breve, immagini mancanti..."
                    rows={4}
                  />
                </label>
              ) : null}
              <button type="submit" disabled={isSaving}>
                Salva pagina
              </button>
              {selectedPage.kind === "content" ? (
                <button className="danger-button" disabled={isSaving} onClick={deleteSelectedPage} type="button">
                  Elimina pagina
                </button>
              ) : null}
            </form>
          ) : (
            <p>Seleziona una pagina del timone.</p>
          )}
        </section>

        <section className="status-editor">
          <h2>Status</h2>
          <form className="status-create" onSubmit={createStatus}>
            <input
              value={newStatusName}
              onChange={(event) => setNewStatusName(event.target.value)}
              placeholder="Nuovo status"
            />
            <input
              aria-label="Colore status"
              type="color"
              value={newStatusColor}
              onChange={(event) => setNewStatusColor(event.target.value)}
            />
            <button type="submit">Aggiungi</button>
          </form>
          <div className="status-list">
            {statuses.map((status) => (
              <div className="status-row" key={status.id}>
                <input
                  aria-label={`Nome ${status.name}`}
                  value={status.name}
                  onChange={(event) => setStatuses((current) => current.map((item) => (item.id === status.id ? { ...item, name: event.target.value } : item)))}
                  onBlur={(event) => void updateStatus(status, { name: event.target.value })}
                />
                <input
                  aria-label={`Colore ${status.name}`}
                  type="color"
                  value={status.color}
                  onChange={(event) => {
                    setStatuses((current) => current.map((item) => (item.id === status.id ? { ...item, color: event.target.value } : item)));
                    void updateStatus(status, { color: event.target.value });
                  }}
                />
                <button aria-label={`Elimina ${status.name}`} onClick={() => void deleteStatus(status)} type="button">
                  x
                </button>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </main>
  );
}

type PageTileProps = {
  contentPages: MagazinePage[];
  draggable?: boolean;
  isDragging?: boolean;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onDragStart?: () => void;
  onDrop?: () => void;
  page: MagazinePage;
  side?: "left" | "right" | "single";
  status?: EditorialStatus;
};

function PageTile({
  contentPages,
  draggable = false,
  isDragging = false,
  isSelected,
  onClick,
  onDoubleClick,
  onDragStart,
  onDrop,
  page,
  side = "single",
  status,
}: PageTileProps) {
  const label = pageLabel(page, contentPages);
  const isContentPage = page.kind === "content";

  return (
    <button
      className={[
        "page-tile",
        page.kind,
        `side-${side}`,
        status ? "status-coded" : "",
        isSelected ? "selected" : "",
        isDragging ? "dragging" : "",
        page.warning_enabled ? "has-warning" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable={draggable}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onDragOver={(event) => {
        if (draggable) event.preventDefault();
      }}
      onDragStart={onDragStart}
      onDrop={(event) => {
        event.preventDefault();
        onDrop?.();
      }}
      style={{
        "--status-color": status?.color ?? "#b8bec8",
        borderTopColor: status?.color ?? "#b8bec8",
      } as CSSProperties & { "--status-color": string }}
      title={
        page.warning_enabled && page.warning_note
          ? `Warning: ${page.warning_note}`
          : undefined
      }
      type="button"
    >
      <span className="page-number">{label}</span>
      <strong>{page.title || "Pagina vuota"}</strong>
      {isContentPage && page.assignee ? <small>{page.assignee}</small> : null}
      {isContentPage && page.character_count ? (
        <span className="page-meta">{page.character_count.toLocaleString("it-IT")} battute</span>
      ) : null}
      {status ? (
        <span className="status-pill" style={{ backgroundColor: status.color }}>
          {status.name}
        </span>
      ) : null}
      {page.warning_enabled ? (
        <span className="warning-mark" aria-label="Warning">
          !
          <span className="warning-tooltip">{page.warning_note || "Warning attivo"}</span>
        </span>
      ) : null}
    </button>
  );
}

type InlinePageEditorProps = {
  draft: PageDraft;
  isContentPage: boolean;
  isSaving: boolean;
  label: string;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  placement: InlineEditorPlacement;
  setDraft: Dispatch<SetStateAction<PageDraft>>;
  statuses: EditorialStatus[];
  titleInputRef: RefObject<HTMLInputElement | null>;
};

function InlinePageEditor({
  draft,
  isContentPage,
  isSaving,
  label,
  onClose,
  onSave,
  placement,
  setDraft,
  statuses,
  titleInputRef,
}: InlinePageEditorProps) {
  return (
    <form
      className="inline-page-editor"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          onClose();
          return;
        }

        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !(event.target instanceof HTMLTextAreaElement) &&
          !(event.target instanceof HTMLButtonElement)
        ) {
          event.preventDefault();
          event.currentTarget.requestSubmit();
        }
      }}
      onSubmit={onSave}
      style={
        {
          "--inline-arrow-top": `${placement.arrowTop}px`,
          left: placement.left,
          top: placement.top,
        } as CSSProperties & { "--inline-arrow-top": string }
      }
      data-direction={placement.direction}
    >
      <div className="inline-editor-head">
        <strong>{label}</strong>
        <button aria-label="Chiudi editor pagina" onClick={onClose} type="button">
          x
        </button>
      </div>
      <label>
        Nome articolo
        <input
          ref={titleInputRef}
          value={draft.title}
          onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, title: event.target.value }))}
          placeholder="Breve storia del golf"
        />
      </label>
      {isContentPage ? (
        <>
          <label>
            Assegnato a
            <input
              value={draft.assignee}
              onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, assignee: event.target.value }))}
              placeholder="Nome redattore"
            />
          </label>
          <label>
            Battute
            <input
              min={0}
              type="number"
              value={draft.character_count ?? ""}
              onChange={(event) =>
                setDraft((currentDraft) => ({
                  ...currentDraft,
                  character_count: event.target.value === "" ? null : Number(event.target.value),
                }))
              }
              placeholder="3200"
            />
          </label>
        </>
      ) : null}
      <label>
        Status
        <select
          value={draft.status_id ?? ""}
          onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, status_id: event.target.value || null }))}
        >
          <option value="">Nessuno status</option>
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </label>
      <label className="warning-toggle">
        <input
          checked={draft.warning_enabled}
          onChange={(event) =>
            setDraft((currentDraft) => ({ ...currentDraft, warning_enabled: event.target.checked }))
          }
          type="checkbox"
        />
        Warning attivo
      </label>
      {draft.warning_enabled ? (
        <label>
          Spiegazione warning
          <textarea
            value={draft.warning_note ?? ""}
            onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, warning_note: event.target.value }))}
            placeholder="Testo troppo breve, immagini mancanti..."
            rows={3}
          />
        </label>
      ) : null}
      <div className="inline-editor-actions">
        <button type="submit" disabled={isSaving}>
          Salva
        </button>
        <button onClick={onClose} type="button">
          Chiudi
        </button>
      </div>
    </form>
  );
}
