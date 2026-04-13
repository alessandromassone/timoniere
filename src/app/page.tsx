"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, FormEvent, ReactNode, RefObject, SetStateAction } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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

const COLOR_SWATCH_ROWS = [
  ["#1b1b1b", "#4a4a4a", "#737373", "#9b9b9b", "#bfbfbf", "#e1e1e1", "#ffffff"],
  ["#7d1216", "#9b5618", "#868614", "#4f8a1c", "#1f7a34", "#1d7f67", "#155c8f", "#1d318f", "#4d218f", "#7f1a8a", "#9a1a66"],
  ["#e13a2f", "#f18a22", "#e6ea2b", "#7ed33b", "#31c24a", "#35cdbb", "#2b8ae8", "#243edb", "#7a32d4", "#c033bc", "#e23583"],
  ["#f17f79", "#f0bd62", "#edf17d", "#b7ee78", "#88ec8f", "#87eee0", "#7fc4f2", "#7d89f1", "#b885eb", "#e087dc", "#ef8abb"],
  ["#c73536", "#cda842", "#c7cd43", "#7fc440", "#4dbd55", "#4bb6a8", "#4e9ac8", "#4550ba", "#7a48bf", "#b54eb8", "#c64f8a"],
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
const UNTAGGED_STATUS_COLOR = "#cfd6d2";
const KEEP_BULK_VALUE = "__keep";

const BOARD_ZOOM_LEVELS = [
  { description: "piu pagine", id: "overview", label: "Compatta" },
  { description: "equilibrata", id: "standard", label: "Normale" },
  { description: "piu testo", id: "detail", label: "Ampia" },
] as const;

type BoardZoom = (typeof BOARD_ZOOM_LEVELS)[number]["id"];
type IssuePanel = "create" | "edit" | null;
type BulkWarningMode = "keep" | "off" | "on";

type ContextMenuState =
  | { issueId: string; type: "issue"; x: number; y: number }
  | { pageId: string; type: "page"; x: number; y: number }
  | null;

type SelectionRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

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

function percentValue(count: number, total: number) {
  if (total === 0) return 0;

  return Math.round((count / total) * 100);
}

export default function Home() {
  return <TimoniereApp />;
}

function TimoniereApp() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [statuses, setStatuses] = useState<EditorialStatus[]>([]);
  const [pages, setPages] = useState<MagazinePage[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [selectionAnchorPageId, setSelectionAnchorPageId] = useState<string | null>(null);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [newIssueTitle, setNewIssueTitle] = useState("");
  const [newIssueDescription, setNewIssueDescription] = useState("");
  const [issueDraftTitle, setIssueDraftTitle] = useState("");
  const [issueDraftDescription, setIssueDraftDescription] = useState("");
  const [initialPageCount, setInitialPageCount] = useState(16);
  const [newStatusName, setNewStatusName] = useState("");
  const [newStatusColor, setNewStatusColor] = useState(DEFAULT_STATUS_COLORS[0]);
  const [bulkStatusId, setBulkStatusId] = useState(KEEP_BULK_VALUE);
  const [bulkTitle, setBulkTitle] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkCharacterCount, setBulkCharacterCount] = useState("");
  const [bulkWarningMode, setBulkWarningMode] = useState<BulkWarningMode>("keep");
  const [bulkWarningNote, setBulkWarningNote] = useState("");
  const [openColorPickerId, setOpenColorPickerId] = useState<string | null>(null);
  const [pageDraft, setPageDraft] = useState<PageDraft>(EMPTY_PAGE_DRAFT);
  const [inlineEditorPageId, setInlineEditorPageId] = useState<string | null>(null);
  const [inlineEditorPlacement, setInlineEditorPlacement] = useState<InlineEditorPlacement | null>(null);
  const [boardZoom, setBoardZoom] = useState<BoardZoom>("standard");
  const [activeIssuePanel, setActiveIssuePanel] = useState<IssuePanel>(null);
  const [isIssueInfoModalOpen, setIsIssueInfoModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const selectedPageIdRef = useRef(selectedPageId);
  const inlineEditorRef = useRef<HTMLFormElement | null>(null);
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
  const inProgressPageCount = contentPages.filter((page) => page.status_id).length;
  const untaggedPageCount = Math.max(0, contentPages.length - inProgressPageCount);
  const warningPageCount = contentPages.filter((page) => page.warning_enabled).length;
  const selectedZoomLabel = BOARD_ZOOM_LEVELS.find((level) => level.id === boardZoom)?.label ?? "Normale";
  const statusOverviewItems = useMemo(
    () => [
      ...statuses.map((status) => ({
        color: status.color,
        count: statusCounts[status.id] ?? 0,
        id: status.id,
        name: status.name,
      })),
      {
        color: UNTAGGED_STATUS_COLOR,
        count: untaggedPageCount,
        id: "untagged",
        name: "Da impostare",
      },
    ],
    [statuses, statusCounts, untaggedPageCount],
  );
  const selectedPageIsContent = selectedPage?.kind === "content";
  const selectedContentPages = contentPages.filter((page) => selectedPageIds.includes(page.id));
  const hasMultipleSelectedPages = selectedContentPages.length > 1;

  const closeIssueInfoModal = useCallback(() => {
    setIsIssueInfoModalOpen(false);
    setIssueDraftTitle(selectedIssue?.title ?? "");
    setIssueDraftDescription(selectedIssue?.description ?? "");
  }, [selectedIssue]);

  const persistPageDraft = useCallback(
    async (targetPage: MagazinePage, draft: PageDraft, options: { closeInline?: boolean } = {}) => {
      if (!supabase) return;

      if (options.closeInline) {
        setInlineEditorPageId(null);
        setInlineEditorPlacement(null);
      }

      setIsSaving(true);
      const isContentPage = targetPage.kind === "content";
      const payload = {
        title: draft.title.trim(),
        assignee: isContentPage ? draft.assignee.trim() : "",
        character_count: isContentPage ? draft.character_count : null,
        status_id: draft.status_id || null,
        warning_enabled: draft.warning_enabled,
        warning_note: draft.warning_enabled ? draft.warning_note?.trim() || null : null,
      };

      const { data, error } = await supabase.from("pages").update(payload).eq("id", targetPage.id).select("*").single();

      if (error) {
        setNotice(error.message);
      } else {
        setPages((current) => sortPages(current.map((page) => (page.id === targetPage.id ? (data as MagazinePage) : page))));
        setNotice("Pagina salvata.");
      }

      setIsSaving(false);
    },
    [],
  );

  const saveInlineEditorAndClose = useCallback(async () => {
    if (!inlineEditorPageId) return;

    const inlinePage = pages.find((page) => page.id === inlineEditorPageId);
    if (!inlinePage) {
      setInlineEditorPageId(null);
      setInlineEditorPlacement(null);
      return;
    }

    await persistPageDraft(inlinePage, pageDraft, { closeInline: true });
  }, [inlineEditorPageId, pageDraft, pages, persistPageDraft]);

  useEffect(() => {
    selectedPageIdRef.current = selectedPageId;
  }, [selectedPageId]);

  useEffect(() => {
    setSelectedPageIds((current) => current.filter((pageId) => pages.some((page) => page.id === pageId)));
  }, [pages]);

  useEffect(() => {
    if (selectedPageIds.length <= 1) {
      setBulkStatusId(KEEP_BULK_VALUE);
      setBulkTitle("");
      setBulkAssignee("");
      setBulkCharacterCount("");
      setBulkWarningMode("keep");
      setBulkWarningNote("");
    }
  }, [selectedPageIds.length]);

  useEffect(() => {
    setSelectedPageIds([]);
    setSelectionAnchorPageId(null);
    setContextMenu(null);
  }, [selectedIssueId]);

  useEffect(() => {
    if (!notice) return;

    const timer = window.setTimeout(() => {
      setNotice("");
    }, 3600);

    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const issueId = new URLSearchParams(window.location.search).get("issue");
    if (issueId) setSelectedIssueId(issueId);
  }, []);

  useEffect(() => {
    if (!inlineEditorPageId || selectedPage?.id !== inlineEditorPageId) return;

    const animationFrame = window.requestAnimationFrame(() => {
      inlineTitleInputRef.current?.focus();
      inlineTitleInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [inlineEditorPageId, selectedPage?.id]);

  useEffect(() => {
    if (!inlineEditorPageId) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (inlineEditorRef.current?.contains(target)) return;

      void saveInlineEditorAndClose();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      void saveInlineEditorAndClose();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [inlineEditorPageId, saveInlineEditorAndClose]);

  useEffect(() => {
    if (!contextMenu) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".context-menu")) return;

      setContextMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setContextMenu(null);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!isIssueInfoModalOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeIssueInfoModal();
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeIssueInfoModal, isIssueInfoModalOpen]);

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
    setIssueDraftTitle(selectedIssue?.title ?? "");
    setIssueDraftDescription(selectedIssue?.description ?? "");
  }, [selectedIssue]);

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
      setActiveIssuePanel(null);
      setSelectedIssueId((issue as Issue).id);
      await loadIssues();
      await loadPages((issue as Issue).id);
      setNotice("Numero creato.");
    }

    setIsSaving(false);
  }

  async function updateSelectedIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedIssue || !issueDraftTitle.trim()) return;

    setIsSaving(true);
    const payload = {
      title: issueDraftTitle.trim(),
      description: issueDraftDescription.trim() || null,
    };

    const { data, error } = await supabase
      .from("issues")
      .update(payload)
      .eq("id", selectedIssue.id)
      .select("*")
      .single();

    if (error) {
      setNotice(error.message);
    } else {
      setIssues((current) =>
        current.map((issue) => (issue.id === selectedIssue.id ? (data as Issue) : issue)),
      );
      setActiveIssuePanel(null);
      setIsIssueInfoModalOpen(false);
      setNotice("Numero aggiornato.");
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

    await persistPageDraft(selectedPage, pageDraft, { closeInline: true });
  }

  async function deleteIssue(issue: Issue) {
    if (!supabase) return;

    const confirmed = window.confirm(
      `Vuoi cancellare il numero "${issue.title}"? Questa azione elimina anche tutte le sue pagine.`,
    );
    if (!confirmed) return;

    setIsSaving(true);
    const issueIdToDelete = issue.id;
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

  async function deleteSelectedIssue() {
    if (!selectedIssue) return;

    await deleteIssue(selectedIssue);
  }

  async function deleteContentPages(pageIds: string[]) {
    if (!supabase || pageIds.length === 0) return;

    setIsSaving(true);
    const { error } = await supabase.from("pages").delete().in("id", pageIds);

    if (error) {
      setNotice(error.message);
      setIsSaving(false);
      return;
    }

    const nextContentPages = contentPages.filter((page) => !pageIds.includes(page.id));
    setSelectedPageId(nextContentPages[0]?.id ?? coverPages[0]?.id ?? null);
    setSelectedPageIds([]);
    setSelectionAnchorPageId(null);
    await reflowContentPages(nextContentPages);
    setIsSaving(false);
  }

  async function deleteSelectedPage() {
    if (!selectedPage || selectedPage.kind !== "content") return;

    await deleteContentPages([selectedPage.id]);
  }

  async function applyBulkPageEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || selectedContentPages.length < 2) return;

    const payload: Partial<MagazinePage> = {};

    if (bulkStatusId !== KEEP_BULK_VALUE) {
      payload.status_id = bulkStatusId || null;
    }

    if (bulkTitle.trim()) {
      payload.title = bulkTitle.trim();
    }

    if (bulkAssignee.trim()) {
      payload.assignee = bulkAssignee.trim();
    }

    if (bulkCharacterCount.trim() !== "") {
      payload.character_count = Number(bulkCharacterCount);
    }

    if (bulkWarningMode !== "keep") {
      payload.warning_enabled = bulkWarningMode === "on";
      payload.warning_note =
        bulkWarningMode === "on" ? bulkWarningNote.trim() || null : null;
    }

    if (Object.keys(payload).length === 0) {
      setNotice("Nessuna modifica da applicare.");
      return;
    }

    setIsSaving(true);
    const pageIds = selectedContentPages.map((page) => page.id);
    const { data, error } = await supabase.from("pages").update(payload).in("id", pageIds).select("*");

    if (error) {
      setNotice(error.message);
    } else {
      const updatedPages = new Map(((data ?? []) as MagazinePage[]).map((page) => [page.id, page]));
      setPages((current) => sortPages(current.map((page) => updatedPages.get(page.id) ?? page)));
      setNotice(`${pageIds.length} pagine aggiornate.`);
      setBulkStatusId(KEEP_BULK_VALUE);
      setBulkTitle("");
      setBulkAssignee("");
      setBulkCharacterCount("");
      setBulkWarningMode("keep");
      setBulkWarningNote("");
    }

    setIsSaving(false);
  }

  async function insertContentPageNear(anchorPage: MagazinePage, placement: "after" | "before") {
    if (!supabase || !selectedIssueId || anchorPage.kind !== "content") return;

    const anchorIndex = contentPages.findIndex((page) => page.id === anchorPage.id);
    if (anchorIndex < 0) return;

    const insertIndex = placement === "before" ? anchorIndex : anchorIndex + 1;
    const { data, error } = await supabase
      .from("pages")
      .insert({
        issue_id: selectedIssueId,
        position: insertIndex + 1,
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

    const nextContentPages = [...contentPages];
    nextContentPages.splice(insertIndex, 0, data as MagazinePage);
    await reflowContentPages(nextContentPages);
    setSelectedPageId((data as MagazinePage).id);
    setSelectedPageIds([(data as MagazinePage).id]);
    setSelectionAnchorPageId((data as MagazinePage).id);
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

  async function selectStatusColor(status: EditorialStatus, color: string) {
    setStatuses((current) =>
      current.map((item) => (item.id === status.id ? { ...item, color } : item)),
    );
    setOpenColorPickerId(null);
    await updateStatus(status, { color });
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

  async function copyIssueLink(issueId: string) {
    if (typeof window === "undefined") return;

    const url = new URL(window.location.href);
    url.searchParams.set("issue", issueId);
    try {
      await navigator.clipboard.writeText(url.toString());
      setNotice("Link del numero copiato.");
    } catch {
      setNotice(url.toString());
    }
  }

  async function copyShareLink() {
    if (!selectedIssueId) return;

    await copyIssueLink(selectedIssueId);
  }

  function handleIssueContextMenu(event: ReactMouseEvent<HTMLButtonElement>, issue: Issue) {
    event.preventDefault();
    setSelectedIssueId(issue.id);
    setContextMenu({ issueId: issue.id, type: "issue", x: event.clientX, y: event.clientY });
  }

  function handlePageSelection(page: MagazinePage, event: ReactMouseEvent<HTMLButtonElement>) {
    setSelectedPageId(page.id);

    if (page.kind !== "content") {
      setSelectedPageIds([]);
      setSelectionAnchorPageId(null);
      return;
    }

    if (event.shiftKey && selectionAnchorPageId) {
      const anchorIndex = contentPages.findIndex((contentPage) => contentPage.id === selectionAnchorPageId);
      const targetIndex = contentPages.findIndex((contentPage) => contentPage.id === page.id);

      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        setSelectedPageIds(contentPages.slice(start, end + 1).map((contentPage) => contentPage.id));
        return;
      }
    }

    if (event.metaKey || event.ctrlKey) {
      setSelectedPageIds((current) => {
        if (current.includes(page.id)) return current.filter((pageId) => pageId !== page.id);

        return [...current, page.id];
      });
      setSelectionAnchorPageId(page.id);
      return;
    }

    setSelectedPageIds([page.id]);
    setSelectionAnchorPageId(page.id);
  }

  function handlePageContextMenu(event: ReactMouseEvent<HTMLButtonElement>, page: MagazinePage) {
    if (page.kind !== "content") return;

    event.preventDefault();
    setSelectedPageId(page.id);
    setSelectedPageIds((current) => (current.includes(page.id) ? current : [page.id]));
    setSelectionAnchorPageId(page.id);
    setContextMenu({ pageId: page.id, type: "page", x: event.clientX, y: event.clientY });
  }

  function beginMarqueeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !boardWrapRef.current) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("button, input, textarea, select, form, .inline-page-editor, .status-dashboard, .board-viewbar")) return;

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const contentPageIds = new Set(contentPages.map((page) => page.id));

    function updateSelection(clientX: number, clientY: number) {
      const left = Math.min(startX, clientX);
      const top = Math.min(startY, clientY);
      const width = Math.abs(clientX - startX);
      const height = Math.abs(clientY - startY);
      const rect = { bottom: top + height, left, right: left + width, top };
      const selectedIds = Array.from(boardWrapRef.current?.querySelectorAll<HTMLElement>("[data-page-id]") ?? [])
        .filter((tile) => {
          const pageId = tile.dataset.pageId;
          if (!pageId || !contentPageIds.has(pageId)) return false;

          const tileRect = tile.getBoundingClientRect();
          return tileRect.left < rect.right && tileRect.right > rect.left && tileRect.top < rect.bottom && tileRect.bottom > rect.top;
        })
        .map((tile) => tile.dataset.pageId)
        .filter((pageId): pageId is string => Boolean(pageId));

      setSelectionRect({ height, left, top, width });
      setSelectedPageIds(selectedIds);
      if (selectedIds.length > 0) {
        setSelectedPageId(selectedIds[selectedIds.length - 1]);
        setSelectionAnchorPageId(selectedIds[0]);
      }
    }

    function handlePointerMove(pointerEvent: PointerEvent) {
      updateSelection(pointerEvent.clientX, pointerEvent.clientY);
    }

    function handlePointerUp(pointerEvent: PointerEvent) {
      updateSelection(pointerEvent.clientX, pointerEvent.clientY);
      setSelectionRect(null);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    }

    setSelectedPageIds([]);
    setSelectionRect({ height: 0, left: startX, top: startY, width: 0 });
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
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

        <div className="issue-tools" aria-label="Azioni numero">
          <button
            className={activeIssuePanel === "create" ? "primary active" : "primary"}
            onClick={() => setActiveIssuePanel((panel) => (panel === "create" ? null : "create"))}
            type="button"
          >
            Nuovo numero
          </button>
        </div>

        {activeIssuePanel === "create" ? (
          <form className="creation-panel" onSubmit={createIssue}>
            <div className="panel-head">
              <h2>Nuovo numero</h2>
              <button
                className="icon-button close-button"
                aria-label="Chiudi nuovo numero"
                onClick={() => setActiveIssuePanel(null)}
                type="button"
              />
            </div>
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
        ) : null}

        <section className="issue-list">
          <h2>Numeri</h2>
          {isLoading ? <p>Caricamento...</p> : null}
          {issues.map((issue) => (
            <button
              className={issue.id === selectedIssueId ? "issue-item active" : "issue-item"}
              key={issue.id}
              onClick={() => setSelectedIssueId(issue.id)}
              onContextMenu={(event) => handleIssueContextMenu(event, issue)}
              type="button"
            >
              <span>{issue.title}</span>
              <small>{issue.description || "Timone condiviso"}</small>
            </button>
          ))}
        </section>

        {activeIssuePanel === "edit" && selectedIssue ? (
          <form className="issue-editor" onSubmit={updateSelectedIssue}>
            <div className="panel-head">
              <h2>Dettagli numero</h2>
              <button
                className="icon-button close-button"
                aria-label="Chiudi dettagli numero"
                onClick={() => setActiveIssuePanel(null)}
                type="button"
              />
            </div>
            <label>
              Titolo
              <input
                value={issueDraftTitle}
                onChange={(event) => setIssueDraftTitle(event.target.value)}
                placeholder="Titolo numero"
                required
              />
            </label>
            <label>
              Note
              <textarea
                value={issueDraftDescription}
                onChange={(event) => setIssueDraftDescription(event.target.value)}
                placeholder="Tema, uscita, deadline"
                rows={3}
              />
            </label>
            <button type="submit" disabled={isSaving || !issueDraftTitle.trim()}>
              Salva dettagli
            </button>
          </form>
        ) : null}
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar-copy">
            <h2>{selectedIssue?.title ?? "Nessun numero selezionato"}</h2>
            <div className="issue-meta-row">
              <p>
                {selectedIssue
                  ? `${contentPages.length} pagine interne`
                  : "Crea o seleziona un numero dalla sidebar."}
                {selectedIssue?.description ? ` · ${selectedIssue.description}` : ""}
              </p>
              {selectedIssue ? (
                <button
                  className="issue-info-button"
                  onClick={() => setIsIssueInfoModalOpen(true)}
                  type="button"
                >
                  Modifica info numero
                </button>
              ) : null}
            </div>
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

        {selectedIssue ? (
          <div className="board-wrap" data-zoom={boardZoom} onPointerDown={beginMarqueeSelection} ref={boardWrapRef}>
            <section className="status-dashboard" aria-label="Stato lavorazione">
              <div className="status-dashboard-head">
                <div>
                  <span>Stato lavorazione</span>
                  <strong>
                    {inProgressPageCount} / {contentPages.length} pagine in lavorazione
                  </strong>
                  <small>{untaggedPageCount} pagine da impostare</small>
                </div>
                <div>
                  <span>Warning</span>
                  <strong>{warningPageCount}</strong>
                  <small>{warningPageCount === 1 ? "pagina segnalata" : "pagine segnalate"}</small>
                </div>
              </div>

              <div className="status-progress" aria-label="Distribuzione status">
                {statusOverviewItems.map((item) =>
                  item.count > 0 ? (
                    <span
                      key={item.id}
                      style={
                        {
                          "--status-color": item.color,
                          width: `${Math.max(2, percentValue(item.count, contentPages.length))}%`,
                        } as CSSProperties & { "--status-color": string }
                      }
                      title={`${item.name}: ${item.count} pagine`}
                    />
                  ) : null,
                )}
              </div>

              <div className="status-cards">
                {statusOverviewItems.map((item) => (
                  <article
                    className="status-card"
                    key={item.id}
                    style={{ "--status-color": item.color } as CSSProperties & { "--status-color": string }}
                    title={`${item.name}: ${item.count} pagine, ${percentValue(item.count, contentPages.length)}%`}
                  >
                    <div className="status-card-main">
                      <strong>{item.count}</strong>
                      <span>{item.name}</span>
                    </div>
                    <div className="status-card-meter" aria-label={`${percentValue(item.count, contentPages.length)}%`}>
                      <i
                        style={{ width: `${percentValue(item.count, contentPages.length)}%` }}
                        aria-hidden="true"
                      />
                    </div>
                  </article>
                ))}
              </div>

              <div className="heatmap-block">
                <div className="heatmap-head">
                  <span>Mappa pagine</span>
                  <small>Ogni cella e una pagina. Il bordo rosso indica un warning.</small>
                </div>
                <div className="status-heatmap" aria-label="Heatmap pagine">
                  {contentPages.map((page) => {
                    const status = page.status_id ? statusById.get(page.status_id) : undefined;
                    const label = pageLabel(page, contentPages);
                    return (
                      <button
                        aria-label={`Pagina ${label}: ${status?.name ?? "da impostare"}`}
                        className={[
                          "heatmap-cell",
                          selectedPageId === page.id ? "active" : "",
                          page.warning_enabled ? "has-warning" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        key={page.id}
                        onClick={(event) => handlePageSelection(page, event)}
                        style={{ "--status-color": status?.color ?? UNTAGGED_STATUS_COLOR } as CSSProperties & { "--status-color": string }}
                        title={`Pagina ${label}: ${status?.name ?? "da impostare"}${page.warning_enabled ? " · warning" : ""}`}
                        type="button"
                      />
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="board-viewbar" aria-label="Vista timone">
              <div className="view-copy">
                <span>Vista pagine</span>
                <strong>{selectedZoomLabel}</strong>
                <small>{BOARD_ZOOM_LEVELS.find((level) => level.id === boardZoom)?.description}</small>
              </div>
              <div className="zoom-control" aria-label="Zoom visualizzazione pagine">
                {BOARD_ZOOM_LEVELS.map((level) => (
                  <button
                    aria-pressed={boardZoom === level.id}
                    className={boardZoom === level.id ? "zoom-button active" : "zoom-button"}
                    key={level.id}
                    onClick={() => setBoardZoom(level.id)}
                    type="button"
                  >
                    <span>{level.label}</span>
                  </button>
                ))}
              </div>
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
                      onClick={(event) => handlePageSelection(page, event)}
                      onDoubleClick={(event) => openInlineEditor(page, event.currentTarget)}
                      onContextMenu={(event) => handlePageContextMenu(event, page)}
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
                        isSelected={selectedPageId === page.id || selectedPageIds.includes(page.id)}
                        onClick={(event) => handlePageSelection(page, event)}
                        onContextMenu={(event) => handlePageContextMenu(event, page)}
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

      {selectionRect ? (
        <div
          className="marquee-selection"
          style={{
            height: selectionRect.height,
            left: selectionRect.left,
            top: selectionRect.top,
            width: selectionRect.width,
          }}
        />
      ) : null}

      {isIssueInfoModalOpen && selectedIssue ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeIssueInfoModal();
          }}
        >
          <form className="issue-info-modal" onSubmit={updateSelectedIssue}>
            <div className="panel-head">
              <div>
                <span>Numero</span>
                <h2>Modifica info numero</h2>
              </div>
              <button
                className="icon-button close-button"
                aria-label="Chiudi modifica info numero"
                onClick={closeIssueInfoModal}
                type="button"
              />
            </div>
            <label>
              Titolo
              <input
                value={issueDraftTitle}
                onChange={(event) => setIssueDraftTitle(event.target.value)}
                placeholder="Titolo numero"
                required
              />
            </label>
            <label>
              Note
              <textarea
                value={issueDraftDescription}
                onChange={(event) => setIssueDraftDescription(event.target.value)}
                placeholder="Tema, uscita, deadline"
                rows={5}
              />
            </label>
            <div className="modal-actions">
              <button type="submit" disabled={isSaving || !issueDraftTitle.trim()}>
                Salva modifiche
              </button>
              <button onClick={closeIssueInfoModal} type="button">
                Annulla
              </button>
            </div>
          </form>
        </div>
      ) : null}

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
          onClose={() => void saveInlineEditorAndClose()}
          onSave={savePage}
          placement={inlineEditorPlacement}
          editorRef={inlineEditorRef}
          setDraft={setPageDraft}
          statuses={statuses}
          titleInputRef={inlineTitleInputRef}
        />
      ) : null}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        >
          {contextMenu.type === "issue" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setActiveIssuePanel("edit");
                  setContextMenu(null);
                }}
              >
                Modifica Info
              </button>
              <button
                type="button"
                onClick={() => {
                  void copyIssueLink(contextMenu.issueId);
                  setContextMenu(null);
                }}
              >
                Copia Link
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => {
                  const issue = issues.find((item) => item.id === contextMenu.issueId);
                  setContextMenu(null);
                  if (issue) void deleteIssue(issue);
                }}
              >
                Elimina Numero
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  const page = contentPages.find((item) => item.id === contextMenu.pageId);
                  setContextMenu(null);
                  if (page) void insertContentPageNear(page, "after");
                }}
              >
                Aggiungi pagina dopo
              </button>
              <button
                type="button"
                onClick={() => {
                  const page = contentPages.find((item) => item.id === contextMenu.pageId);
                  setContextMenu(null);
                  if (page) void insertContentPageNear(page, "before");
                }}
              >
                Aggiungi pagina prima
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => {
                  const pageIds =
                    selectedPageIds.includes(contextMenu.pageId) && selectedPageIds.length > 1
                      ? selectedPageIds
                      : [contextMenu.pageId];
                  setContextMenu(null);
                  void deleteContentPages(pageIds);
                }}
              >
                Cancella pagina
              </button>
            </>
          )}
        </ContextMenu>
      ) : null}

      <aside className="editor-rail" aria-label="Dettagli pagina">
        {notice ? (
          <div className="toast-region" aria-live="polite" aria-atomic="true">
            <button className="toast" type="button" onClick={() => setNotice("")}>
              {notice}
            </button>
          </div>
        ) : null}

        <section className="editor-panel">
          <h2>Pagina</h2>
          {hasMultipleSelectedPages ? (
            <form className="bulk-editor" onSubmit={applyBulkPageEdit}>
              <p className="page-kind">{selectedContentPages.length} pagine selezionate</p>
              <label>
                Nome articolo
                <input
                  value={bulkTitle}
                  onChange={(event) => setBulkTitle(event.target.value)}
                  placeholder="Lascia vuoto per non modificare"
                />
              </label>
              <label>
                Status
                <StatusSelect
                  includeKeepOption
                  statuses={statuses}
                  value={bulkStatusId}
                  onChange={(statusId) => setBulkStatusId(statusId ?? "")}
                />
              </label>
              <label>
                Assegnato a
                <input
                  value={bulkAssignee}
                  onChange={(event) => setBulkAssignee(event.target.value)}
                  placeholder="Lascia vuoto per non modificare"
                />
              </label>
              <label>
                Battute
                <input
                  min={0}
                  type="number"
                  value={bulkCharacterCount}
                  onChange={(event) => setBulkCharacterCount(event.target.value)}
                  placeholder="Lascia vuoto per non modificare"
                />
              </label>
              <label>
                Warning
                <select
                  value={bulkWarningMode}
                  onChange={(event) => setBulkWarningMode(event.target.value as BulkWarningMode)}
                >
                  <option value="keep">Non modificare</option>
                  <option value="on">Attiva warning</option>
                  <option value="off">Disattiva warning</option>
                </select>
              </label>
              {bulkWarningMode === "on" ? (
                <label>
                  Spiegazione warning
                  <textarea
                    value={bulkWarningNote}
                    onChange={(event) => setBulkWarningNote(event.target.value)}
                    placeholder="Testo troppo breve, immagini mancanti..."
                    rows={4}
                  />
                </label>
              ) : null}
              <button type="submit" disabled={isSaving}>
                Applica alle pagine selezionate
              </button>
              <button
                className="danger-button"
                disabled={isSaving}
                onClick={() => void deleteContentPages(selectedContentPages.map((page) => page.id))}
                type="button"
              >
                Elimina pagine selezionate
              </button>
            </form>
          ) : selectedPage ? (
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
                <StatusSelect
                  statuses={statuses}
                  value={pageDraft.status_id ?? ""}
                  onChange={(statusId) => setPageDraft((draft) => ({ ...draft, status_id: statusId }))}
                />
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
            <SwatchColorPicker
              id="new-status"
              isOpen={openColorPickerId === "new-status"}
              onOpenChange={(isOpen) => setOpenColorPickerId(isOpen ? "new-status" : null)}
              onSelect={(color) => {
                setNewStatusColor(color);
                setOpenColorPickerId(null);
              }}
              value={newStatusColor}
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
                <SwatchColorPicker
                  id={status.id}
                  isOpen={openColorPickerId === status.id}
                  onOpenChange={(isOpen) => setOpenColorPickerId(isOpen ? status.id : null)}
                  onSelect={(color) => void selectStatusColor(status, color)}
                  value={status.color}
                />
                <button
                  aria-label={`Elimina ${status.name}`}
                  className="icon-button close-button status-delete"
                  onClick={() => void deleteStatus(status)}
                  type="button"
                />
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
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
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
  onContextMenu,
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
      data-page-id={page.id}
      onClick={onClick}
      onContextMenu={onContextMenu}
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
  editorRef: RefObject<HTMLFormElement | null>;
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
  editorRef,
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
      ref={editorRef}
      onKeyDown={(event) => {
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
        <button className="icon-button close-button" aria-label="Chiudi editor pagina" onClick={onClose} type="button" />
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
        <StatusSelect
          statuses={statuses}
          value={draft.status_id ?? ""}
          onChange={(statusId) => setDraft((currentDraft) => ({ ...currentDraft, status_id: statusId }))}
        />
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

type ContextMenuProps = {
  children: ReactNode;
  onClose: () => void;
  x: number;
  y: number;
};

function ContextMenu({ children, onClose, x, y }: ContextMenuProps) {
  return (
    <div
      className="context-menu"
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => event.stopPropagation()}
      role="menu"
      style={{ left: x, top: y }}
    >
      <div className="context-menu-head">
        <span>Azioni</span>
        <button className="icon-button close-button" aria-label="Chiudi menu" onClick={onClose} type="button" />
      </div>
      {children}
    </div>
  );
}

type StatusSelectProps = {
  includeKeepOption?: boolean;
  onChange: (statusId: string | null) => void;
  statuses: EditorialStatus[];
  value: string;
};

function StatusSelect({ includeKeepOption = false, onChange, statuses, value }: StatusSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement | null>(null);
  const selectedStatus = statuses.find((status) => status.id === value) ?? null;
  const isKeepingValue = includeKeepOption && value === KEEP_BULK_VALUE;

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (selectRef.current?.contains(target)) return;

      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="status-select" ref={selectRef}>
      <button
        aria-expanded={isOpen}
        className="status-select-trigger"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span
          className="status-select-dot"
          style={{ "--status-color": selectedStatus?.color ?? UNTAGGED_STATUS_COLOR } as CSSProperties & { "--status-color": string }}
        />
        <span>{isKeepingValue ? "Non modificare" : selectedStatus?.name ?? "Nessuno status"}</span>
      </button>
      {isOpen ? (
        <div className="status-select-menu" role="listbox">
          {includeKeepOption ? (
            <button
              aria-selected={value === KEEP_BULK_VALUE}
              onClick={() => {
                onChange(KEEP_BULK_VALUE);
                setIsOpen(false);
              }}
              role="option"
              type="button"
            >
              <span
                className="status-select-dot"
                style={{ "--status-color": UNTAGGED_STATUS_COLOR } as CSSProperties & { "--status-color": string }}
              />
              Non modificare
            </button>
          ) : null}
          <button
            aria-selected={!selectedStatus && !isKeepingValue}
            onClick={() => {
              onChange(null);
              setIsOpen(false);
            }}
            role="option"
            type="button"
          >
            <span
              className="status-select-dot"
              style={{ "--status-color": UNTAGGED_STATUS_COLOR } as CSSProperties & { "--status-color": string }}
            />
            Nessuno status
          </button>
          {statuses.map((status) => (
            <button
              aria-selected={status.id === value}
              key={status.id}
              onClick={() => {
                onChange(status.id);
                setIsOpen(false);
              }}
              role="option"
              type="button"
            >
              <span
                className="status-select-dot"
                style={{ "--status-color": status.color } as CSSProperties & { "--status-color": string }}
              />
              {status.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type SwatchColorPickerProps = {
  id: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (color: string) => void;
  value: string;
};

function SwatchColorPicker({ id, isOpen, onOpenChange, onSelect, value }: SwatchColorPickerProps) {
  return (
    <div className="swatch-picker">
      <button
        aria-expanded={isOpen}
        aria-label={`Scegli colore ${id}`}
        className="swatch-picker-trigger"
        onClick={() => onOpenChange(!isOpen)}
        type="button"
      >
        <span style={{ backgroundColor: value }} />
      </button>
      {isOpen ? (
        <div className="swatch-popover" role="dialog" aria-label="Scegli colore tag">
          <div className="swatch-popover-head">
            <strong>Colori</strong>
            <button className="icon-button close-button" aria-label="Chiudi colori" onClick={() => onOpenChange(false)} type="button" />
          </div>
          <div className="swatch-rows">
            {COLOR_SWATCH_ROWS.map((row, rowIndex) => (
              <div className="swatch-row" key={rowIndex}>
                {row.map((color) => (
                  <button
                    aria-label={`Colore ${color}`}
                    aria-pressed={value.toLowerCase() === color.toLowerCase()}
                    className="swatch-color"
                    key={color}
                    onClick={() => onSelect(color)}
                    style={{ "--swatch-color": color } as CSSProperties & { "--swatch-color": string }}
                    type="button"
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
