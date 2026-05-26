"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, Dispatch, FormEvent, ReactNode, RefObject, SetStateAction } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Article, CoverPageKind, EditorialStatus, Issue, MagazinePage, PageDraft, PageKind } from "@/lib/types";

const DEFAULT_STATUS_COLORS = [
  "#fff13d",
  "#77d84d",
  "#f59b2f",
  "#51d6d1",
  "#48a858",
  "#55aeb8",
];

const DEFAULT_STATUSES = [
  { color: "#fff13d", name: "da scrivere", sort_order: 10 },
  { color: "#77d84d", name: "scritto", sort_order: 20 },
  { color: "#f59b2f", name: "revisione 1", sort_order: 30 },
  { color: "#51d6d1", name: "revisione 2", sort_order: 40 },
  { color: "#48a858", name: "impaginato", sort_order: 50 },
  { color: "#55aeb8", name: "editabile su InCopy", sort_order: 60 },
] as const;

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
const INLINE_EDITOR_ESTIMATED_HEIGHT = 420;
const INLINE_EDITOR_GAP = 14;
const INLINE_EDITOR_ARROW_SIZE = 10;
const VIEWPORT_MARGIN = 16;
const UNTAGGED_STATUS_COLOR = "#cfd6d2";
const KEEP_BULK_VALUE = "__keep";

const BOARD_ZOOM_LEVELS = [
  { description: "piu pagine", id: "overview", label: "Compatta" },
  { description: "equilibrata", id: "standard", label: "Normale" },
  { description: "piu testo", id: "detail", label: "Ampia" },
] as const;

const KANBAN_VIEW_LEVELS = [
  { id: "compact", label: "Compatta" },
  { id: "standard", label: "Normale" },
  { id: "agile", label: "Ampia" },
] as const;

type BoardZoom = (typeof BOARD_ZOOM_LEVELS)[number]["id"];
type KanbanView = (typeof KANBAN_VIEW_LEVELS)[number]["id"];
type IssuePanel = "create" | "edit" | null;
type BulkWarningMode = "keep" | "off" | "on";
type WorkspaceView = "kanban" | "timone";

type ContextMenuState =
  | { issueId: string; type: "issue"; x: number; y: number }
  | { articleId: string; type: "article"; x: number; y: number }
  | { pageId: string; type: "page"; x: number; y: number }
  | null;

type SelectionRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

type InlineEditorPlacement = {
  arrowLeft: number;
  arrowTop: number;
  direction: "bottom" | "left" | "right" | "top";
  left: number;
  top: number;
};

type InlineEditorOrigin = {
  x: number;
  y: number;
};

type ArticleInlineDraft = {
  assignee: string;
  character_count: string;
  status_id: string;
  title: string;
};

type InlineArticleEditorState = {
  articleId: string | null;
  statusId: string | null;
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

function sortArticles(articles: Article[]) {
  return [...articles].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      a.created_at.localeCompare(b.created_at) ||
      a.title.localeCompare(b.title, "it"),
  );
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

function draftFromPage(page: MagazinePage | null, article: Article | null = null): PageDraft {
  if (!page) return EMPTY_PAGE_DRAFT;

  return {
    title: article?.title ?? page.title,
    assignee: article?.assignee ?? page.assignee,
    character_count: article?.character_count ?? page.character_count,
    status_id: article?.status_id ?? page.status_id,
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

function articleMatchKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function draftFromArticle(article: Article | null, statusId: string | null = null): ArticleInlineDraft {
  return {
    assignee: article?.assignee ?? "",
    character_count: article?.character_count?.toString() ?? "",
    status_id: article?.status_id ?? statusId ?? "",
    title: article?.title ?? "",
  };
}

function percentValue(count: number, total: number) {
  if (total === 0) return 0;

  return Math.round((count / total) * 100);
}

function articlePageSummary(count: number) {
  return count === 1 ? "1 pagina" : `${count} pagine`;
}

export default function Home() {
  return <TimoniereApp />;
}

function TimoniereApp() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [statuses, setStatuses] = useState<EditorialStatus[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [pages, setPages] = useState<MagazinePage[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [selectionAnchorPageId, setSelectionAnchorPageId] = useState<string | null>(null);
  const [selectedArticleIds, setSelectedArticleIds] = useState<string[]>([]);
  const [selectionAnchorArticleId, setSelectionAnchorArticleId] = useState<string | null>(null);
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
  const [bulkArticleStatusId, setBulkArticleStatusId] = useState(KEEP_BULK_VALUE);
  const [bulkArticleAssignee, setBulkArticleAssignee] = useState("");
  const [bulkArticleCharacterCount, setBulkArticleCharacterCount] = useState("");
  const [openColorPickerId, setOpenColorPickerId] = useState<string | null>(null);
  const [pageDraft, setPageDraft] = useState<PageDraft>(EMPTY_PAGE_DRAFT);
  const [articleDraft, setArticleDraft] = useState({
    assignee: "",
    character_count: "",
    status_id: "",
    title: "",
  });
  const [inlineEditorPageId, setInlineEditorPageId] = useState<string | null>(null);
  const [inlineEditorPlacement, setInlineEditorPlacement] = useState<InlineEditorPlacement | null>(null);
  const [boardZoom, setBoardZoom] = useState<BoardZoom>("standard");
  const [kanbanView, setKanbanView] = useState<KanbanView>("standard");
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("timone");
  const [activeIssuePanel, setActiveIssuePanel] = useState<IssuePanel>(null);
  const [isIssueInfoModalOpen, setIsIssueInfoModalOpen] = useState(false);
  const [issuePendingDelete, setIssuePendingDelete] = useState<Issue | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [selectionRect, setSelectionRect] = useState<SelectionRect | null>(null);
  const [kanbanComposerTitle, setKanbanComposerTitle] = useState("");
  const [kanbanComposerAssignee, setKanbanComposerAssignee] = useState("");
  const [kanbanComposerCharacterCount, setKanbanComposerCharacterCount] = useState("");
  const [draggedArticleId, setDraggedArticleId] = useState<string | null>(null);
  const [isIssueRailOpen, setIsIssueRailOpen] = useState(false);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [isStatusEditorOpen, setIsStatusEditorOpen] = useState(false);
  const [isCreatingArticle, setIsCreatingArticle] = useState(false);
  const [inlineArticleEditor, setInlineArticleEditor] = useState<InlineArticleEditorState | null>(null);
  const [inlineArticlePlacement, setInlineArticlePlacement] = useState<InlineEditorPlacement | null>(null);
  const [inlineArticleDraft, setInlineArticleDraft] = useState<ArticleInlineDraft>(draftFromArticle(null));
  const boardWrapRef = useRef<HTMLDivElement | null>(null);
  const selectedPageIdRef = useRef(selectedPageId);
  const inlineEditorRef = useRef<HTMLFormElement | null>(null);
  const inlineTitleInputRef = useRef<HTMLInputElement | null>(null);
  const inlineArticleEditorRef = useRef<HTMLFormElement | null>(null);
  const inlineArticleTitleInputRef = useRef<HTMLInputElement | null>(null);
  const kanbanComposerTitleInputRef = useRef<HTMLInputElement | null>(null);
  const newIssueTitleInputRef = useRef<HTMLInputElement | null>(null);
  const hydratedPageDraftIdRef = useRef<string | null>(null);
  const hydratedArticleDraftIdRef = useRef<string | null>(null);

  const selectedIssue = issues.find((issue) => issue.id === selectedIssueId) ?? null;
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;
  const selectedArticle = selectedArticleId ? articles.find((article) => article.id === selectedArticleId) ?? null : null;
  const articleTitles = useMemo(
    () =>
      Array.from(
        new Map(
          articles
            .filter((article) => article.title.trim())
            .map((article) => [articleMatchKey(article.title), article.title.trim()]),
        ).values(),
      ),
    [articles],
  );
  const articleById = useMemo(
    () => new Map(articles.map((article) => [article.id, article])),
    [articles],
  );
  const orderedPages = useMemo(() => sortPages(pages), [pages]);
  const coverPages = useMemo(
    () => sortCoverPages(orderedPages.filter((page) => normalizeCoverKind(page.kind))),
    [orderedPages],
  );
  const contentPages = orderedPages.filter((page) => page.kind === "content");
  const spreads = useMemo(() => chunkInteriorPages(contentPages), [contentPages]);
  const statusById = useMemo(
    () => new Map(statuses.map((status) => [status.id, status])),
    [statuses],
  );
  const getPageArticle = useCallback(
    (page: MagazinePage) => (page.article_id ? articleById.get(page.article_id) ?? null : null),
    [articleById],
  );
  const getPageTitle = useCallback(
    (page: MagazinePage) => getPageArticle(page)?.title ?? page.title,
    [getPageArticle],
  );
  const getPageAssignee = useCallback(
    (page: MagazinePage) => getPageArticle(page)?.assignee ?? page.assignee,
    [getPageArticle],
  );
  const getPageCharacterCount = useCallback(
    (page: MagazinePage) => getPageArticle(page)?.character_count ?? page.character_count,
    [getPageArticle],
  );
  const getPageStatusId = useCallback(
    (page: MagazinePage) => getPageArticle(page)?.status_id ?? page.status_id,
    [getPageArticle],
  );
  const getPageStatus = useCallback(
    (page: MagazinePage) => {
      const statusId = getPageStatusId(page);
      return statusId ? statusById.get(statusId) : undefined;
    },
    [getPageStatusId, statusById],
  );
  const inProgressPageCount = contentPages.filter((page) => getPageStatusId(page)).length;
  const untaggedPageCount = Math.max(0, contentPages.length - inProgressPageCount);
  const warningPageCount = contentPages.filter((page) => page.warning_enabled).length;
  const statusOverviewItems = useMemo(
    () => [
      ...statuses.map((status) => ({
        color: status.color,
        count: contentPages.filter((page) => getPageStatusId(page) === status.id).length,
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
    [contentPages, getPageStatusId, statuses, untaggedPageCount],
  );
  const selectedPageIsContent = selectedPage?.kind === "content";
  const selectedContentPages = contentPages.filter((page) => selectedPageIds.includes(page.id));
  const hasMultipleSelectedPages = selectedContentPages.length > 1;
  const articlePages = useMemo(() => {
    return contentPages.reduce<Record<string, MagazinePage[]>>((groups, page) => {
      if (!page.article_id) return groups;

      groups[page.article_id] = [...(groups[page.article_id] ?? []), page];
      return groups;
    }, {});
  }, [contentPages]);
  const kanbanColumns = useMemo(
    () => [
      { color: UNTAGGED_STATUS_COLOR, id: "untagged", name: "Da impostare", statusId: null as string | null },
      ...statuses.map((status) => ({
        color: status.color,
        id: status.id,
        name: status.name,
        statusId: status.id,
      })),
    ],
    [statuses],
  );
  const selectedArticlePages = selectedArticle ? articlePages[selectedArticle.id] ?? [] : [];
  const selectedArticles = useMemo(
    () => articles.filter((article) => selectedArticleIds.includes(article.id)),
    [articles, selectedArticleIds],
  );
  const hasMultipleSelectedArticles = selectedArticles.length > 1;
  const orderedKanbanArticles = useMemo(
    () =>
      kanbanColumns.flatMap((column) =>
        sortArticles(articles.filter((article) => (column.statusId ? article.status_id === column.statusId : !article.status_id))),
      ),
    [articles, kanbanColumns],
  );

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
      const warningPayload = {
        warning_enabled: draft.warning_enabled,
        warning_note: draft.warning_enabled ? draft.warning_note?.trim() || null : null,
      };

      if (!isContentPage) {
        const payload = {
          title: draft.title.trim(),
          assignee: "",
          character_count: null,
          status_id: draft.status_id || null,
          ...warningPayload,
        };

        const { data, error } = await supabase.from("pages").update(payload).eq("id", targetPage.id).select("*").single();

        if (error) {
          setNotice(error.message);
        } else {
          setPages((current) => sortPages(current.map((page) => (page.id === targetPage.id ? (data as MagazinePage) : page))));
          setNotice("Pagina salvata.");
        }

        setIsSaving(false);
        return;
      }

      const trimmedTitle = draft.title.trim();
      const currentArticle = targetPage.article_id ? articles.find((article) => article.id === targetPage.article_id) ?? null : null;
      let resolvedArticle: Article | null = null;

      if (trimmedTitle) {
        const matchKey = articleMatchKey(trimmedTitle);
        const matchedArticle =
          articles.find((article) => article.issue_id === targetPage.issue_id && article.match_key === matchKey) ?? null;
        const articlePayload = {
          assignee: draft.assignee.trim(),
          character_count: draft.character_count,
          match_key: matchKey,
          status_id: draft.status_id || null,
          title: trimmedTitle,
        };

        if (currentArticle && (!matchedArticle || matchedArticle.id === currentArticle.id)) {
          const { data, error } = await supabase
            .from("articles")
            .update(articlePayload)
            .eq("id", currentArticle.id)
            .select("*")
            .single();

          if (error) {
            setNotice(error.message);
            setIsSaving(false);
            return;
          }

          resolvedArticle = data as Article;
        } else if (matchedArticle) {
          resolvedArticle = matchedArticle;
        } else {
          const nextSortOrder = articles.length === 0 ? 1 : Math.max(...articles.map((article) => article.sort_order)) + 1;
          const { data, error } = await supabase
            .from("articles")
            .insert({
              issue_id: targetPage.issue_id,
              sort_order: nextSortOrder,
              ...articlePayload,
            })
            .select("*")
            .single();

          if (error) {
            setNotice(error.message);
            setIsSaving(false);
            return;
          }

          resolvedArticle = data as Article;
        }
      }

      const payload = {
        article_id: resolvedArticle?.id ?? null,
        title: resolvedArticle?.title ?? trimmedTitle,
        assignee: resolvedArticle?.assignee ?? draft.assignee.trim(),
        character_count: resolvedArticle?.character_count ?? draft.character_count,
        status_id: resolvedArticle?.status_id ?? (draft.status_id || null),
        ...warningPayload,
      };

      const { data, error } = await supabase.from("pages").update(payload).eq("id", targetPage.id).select("*").single();

      if (error) {
        setNotice(error.message);
        setIsSaving(false);
        return;
      }

      if (resolvedArticle) {
        await supabase
          .from("pages")
          .update({
            title: resolvedArticle.title,
            assignee: resolvedArticle.assignee,
            character_count: resolvedArticle.character_count,
            status_id: resolvedArticle.status_id,
          })
          .eq("article_id", resolvedArticle.id)
          .neq("id", targetPage.id);

        setArticles((current) => {
          const nextArticles = current.some((article) => article.id === resolvedArticle?.id)
            ? current.map((article) => (article.id === resolvedArticle?.id ? resolvedArticle : article))
            : [...current, resolvedArticle];

          return sortArticles(nextArticles);
        });
      }

      setPages((current) =>
        sortPages(
          current.map((page) => {
            if (page.id === targetPage.id) {
              return data as MagazinePage;
            }

            if (resolvedArticle && page.article_id === resolvedArticle.id) {
              return {
                ...page,
                assignee: resolvedArticle.assignee,
                character_count: resolvedArticle.character_count,
                status_id: resolvedArticle.status_id,
                title: resolvedArticle.title,
              };
            }

            return page;
          }),
        ),
      );
      setNotice("Pagina salvata.");

      setIsSaving(false);
    },
    [articles],
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

  const persistArticleDraft = useCallback(
    async (
      draft: ArticleInlineDraft,
      options: { article: Article | null; closeInline?: boolean; defaultStatusId?: string | null },
    ) => {
      if (!supabase || !selectedIssueId || !draft.title.trim()) return;

      if (options.closeInline) {
        setInlineArticleEditor(null);
        setInlineArticlePlacement(null);
      }

      const matchKey = articleMatchKey(draft.title);
      const duplicateArticle = articles.find(
        (article) =>
          article.id !== options.article?.id &&
          article.issue_id === selectedIssueId &&
          article.match_key === matchKey,
      );

      if (duplicateArticle) {
        setNotice("Esiste gia un articolo con questo nome nel numero.");
        return;
      }

      setIsSaving(true);
      const payload = {
        assignee: draft.assignee.trim(),
        character_count: draft.character_count.trim() === "" ? null : Number(draft.character_count),
        match_key: matchKey,
        status_id: draft.status_id || options.defaultStatusId || null,
        title: draft.title.trim(),
      };

      if (options.article) {
        const { data, error } = await supabase
          .from("articles")
          .update(payload)
          .eq("id", options.article.id)
          .select("*")
          .single();

        if (error) {
          setNotice(error.message);
          setIsSaving(false);
          return;
        }

        const updatedArticle = data as Article;
        await supabase
          .from("pages")
          .update({
            assignee: updatedArticle.assignee,
            character_count: updatedArticle.character_count,
            status_id: updatedArticle.status_id,
            title: updatedArticle.title,
          })
          .eq("article_id", updatedArticle.id);

        setArticles((current) =>
          sortArticles(current.map((article) => (article.id === updatedArticle.id ? updatedArticle : article))),
        );
        setPages((current) =>
          sortPages(
            current.map((page) =>
              page.article_id === updatedArticle.id
                ? {
                    ...page,
                    assignee: updatedArticle.assignee,
                    character_count: updatedArticle.character_count,
                    status_id: updatedArticle.status_id,
                    title: updatedArticle.title,
                  }
                : page,
            ),
          ),
        );
        setSelectedArticleId(updatedArticle.id);
        setSelectedArticleIds([updatedArticle.id]);
        setSelectionAnchorArticleId(updatedArticle.id);
        setNotice("Articolo aggiornato.");
        setIsSaving(false);
        return;
      }

      const nextSortOrder = articles.length === 0 ? 1 : Math.max(...articles.map((article) => article.sort_order)) + 1;
      const { data, error } = await supabase
        .from("articles")
        .insert({
          issue_id: selectedIssueId,
          sort_order: nextSortOrder,
          ...payload,
        })
        .select("*")
        .single();

      if (error) {
        setNotice(error.message);
      } else {
        const createdArticle = data as Article;
        setArticles((current) => sortArticles([...current, createdArticle]));
        setSelectedArticleId(createdArticle.id);
        setSelectedArticleIds([createdArticle.id]);
        setSelectionAnchorArticleId(createdArticle.id);
        setIsCreatingArticle(false);
        setNotice("Articolo creato.");
      }

      setIsSaving(false);
    },
    [articles, selectedIssueId],
  );

  const closeInlineArticleEditor = useCallback(() => {
    setInlineArticleEditor(null);
    setInlineArticlePlacement(null);
  }, []);

  useEffect(() => {
    selectedPageIdRef.current = selectedPageId;
  }, [selectedPageId]);

  useEffect(() => {
    setSelectedPageIds((current) => current.filter((pageId) => pages.some((page) => page.id === pageId)));
  }, [pages]);

  useEffect(() => {
    setSelectedArticleId((current) => (current && articles.some((article) => article.id === current) ? current : null));
  }, [articles]);

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
    setSelectedArticleIds((current) => current.filter((articleId) => articles.some((article) => article.id === articleId)));
  }, [articles]);

  useEffect(() => {
    if (selectedArticleIds.length <= 1) {
      setBulkArticleStatusId(KEEP_BULK_VALUE);
      setBulkArticleAssignee("");
      setBulkArticleCharacterCount("");
    }
  }, [selectedArticleIds.length]);

  useEffect(() => {
    setSelectedPageIds([]);
    setSelectionAnchorPageId(null);
    setSelectedArticleIds([]);
    setSelectionAnchorArticleId(null);
    setContextMenu(null);
    setKanbanComposerTitle("");
    setKanbanComposerAssignee("");
    setKanbanComposerCharacterCount("");
    setIsIssueRailOpen(false);
    setSelectedArticleId(null);
    setIsCreatingArticle(false);
    setInlineArticleEditor(null);
    setInlineArticlePlacement(null);
  }, [selectedIssueId]);

  useEffect(() => {
    if (!isIssueRailOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsIssueRailOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isIssueRailOpen]);

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
    if (!inlineArticleEditor) return;

    const animationFrame = window.requestAnimationFrame(() => {
      inlineArticleTitleInputRef.current?.focus();
      inlineArticleTitleInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [inlineArticleEditor]);

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
    if (!inlineArticleEditor) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (inlineArticleEditorRef.current?.contains(target)) return;

      closeInlineArticleEditor();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;

      event.preventDefault();
      closeInlineArticleEditor();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeInlineArticleEditor, inlineArticleEditor]);

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

  const loadStatuses = useCallback(async (issueId: string) => {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("editorial_statuses")
      .select("*")
      .eq("issue_id", issueId)
      .order("sort_order", { ascending: true });

    if (error) {
      setNotice(error.message);
      return;
    }

    setStatuses((data ?? []) as EditorialStatus[]);
  }, []);

  const loadArticles = useCallback(async (issueId: string) => {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("articles")
      .select("*")
      .eq("issue_id", issueId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) {
      setNotice(error.message);
      return;
    }

    setArticles(sortArticles((data ?? []) as Article[]));
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
    await loadIssues();
    setIsLoading(false);
  }, [loadIssues]);

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
    if (!isSupabaseConfigured || !supabase || !selectedIssueId) {
      setStatuses([]);
      setArticles([]);
      setPages([]);
      return;
    }

    const client = supabase;
    void Promise.all([loadPages(selectedIssueId), loadStatuses(selectedIssueId), loadArticles(selectedIssueId)]);

    const channel = client
      .channel(`issue:${selectedIssueId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pages", filter: `issue_id=eq.${selectedIssueId}` },
        () => void loadPages(selectedIssueId),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "articles", filter: `issue_id=eq.${selectedIssueId}` },
        () => void loadArticles(selectedIssueId),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "editorial_statuses" }, () => {
        void loadStatuses(selectedIssueId);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "issues" }, () => {
        void loadIssues();
      })
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [loadArticles, loadIssues, loadPages, loadStatuses, selectedIssueId]);

  useEffect(() => {
    const nextPageId = selectedPage?.id ?? null;
    if (hydratedPageDraftIdRef.current === nextPageId) return;

    hydratedPageDraftIdRef.current = nextPageId;
    setPageDraft(draftFromPage(selectedPage, selectedPage ? getPageArticle(selectedPage) : null));
  }, [getPageArticle, selectedPage]);

  useEffect(() => {
    const nextArticleId = selectedArticle?.id ?? null;
    if (hydratedArticleDraftIdRef.current === nextArticleId) return;

    hydratedArticleDraftIdRef.current = nextArticleId;
    setArticleDraft({
      assignee: selectedArticle?.assignee ?? "",
      character_count: selectedArticle?.character_count?.toString() ?? "",
      status_id: selectedArticle?.status_id ?? "",
      title: selectedArticle?.title ?? "",
    });
  }, [selectedArticle]);

  useEffect(() => {
    setIssueDraftTitle(selectedIssue?.title ?? "");
    setIssueDraftDescription(selectedIssue?.description ?? "");
  }, [selectedIssue]);

  useEffect(() => {
    setInlineEditorPageId(null);
    setInlineEditorPlacement(null);
  }, [selectedIssueId]);

  useEffect(() => {
    if (workspaceView !== "kanban") return;
    if (isCreatingArticle) return;
    if (selectedArticleId) return;
    if (selectedPage?.article_id) {
      setSelectedArticleId(selectedPage.article_id);
    }
  }, [isCreatingArticle, selectedArticleId, selectedPage?.article_id, workspaceView]);

  useEffect(() => {
    if (workspaceView === "timone" && isCreatingArticle) {
      setIsCreatingArticle(false);
    }
  }, [isCreatingArticle, workspaceView]);

  useEffect(() => {
    if (!isCreatingArticle || workspaceView !== "kanban") return;

    const animationFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        kanbanComposerTitleInputRef.current?.focus();
        kanbanComposerTitleInputRef.current?.select();
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isCreatingArticle, workspaceView]);

  useEffect(() => {
    if (activeIssuePanel !== "create") return;

    const animationFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        newIssueTitleInputRef.current?.focus();
        newIssueTitleInputRef.current?.select();
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeIssuePanel]);

  useEffect(() => {
    setInlineEditorPageId(null);
    setInlineEditorPlacement(null);
    setInlineArticleEditor(null);
    setInlineArticlePlacement(null);
  }, [workspaceView]);

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

    const { error: statusError } = await supabase.from("editorial_statuses").insert(
      DEFAULT_STATUSES.map((status) => ({
        issue_id: issue.id,
        name: status.name,
        color: status.color,
        sort_order: status.sort_order,
      })),
    );

    if (statusError) {
      setNotice(statusError.message);
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
      await Promise.all([
        loadPages((issue as Issue).id),
        loadStatuses((issue as Issue).id),
        loadArticles((issue as Issue).id),
      ]);
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
    setIssuePendingDelete(null);

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

    setIssuePendingDelete(selectedIssue);
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
    if (!supabase || !selectedIssueId || selectedContentPages.length < 2) return;

    const payload: Partial<MagazinePage> = {};
    const articlePatch: Partial<Article> = {};
    const trimmedTitle = bulkTitle.trim();

    if (bulkStatusId !== KEEP_BULK_VALUE) {
      payload.status_id = bulkStatusId || null;
      articlePatch.status_id = bulkStatusId || null;
    }

    if (bulkAssignee.trim()) {
      payload.assignee = bulkAssignee.trim();
      articlePatch.assignee = bulkAssignee.trim();
    }

    if (bulkCharacterCount.trim() !== "") {
      payload.character_count = Number(bulkCharacterCount);
      articlePatch.character_count = Number(bulkCharacterCount);
    }

    if (bulkWarningMode !== "keep") {
      payload.warning_enabled = bulkWarningMode === "on";
      payload.warning_note =
        bulkWarningMode === "on" ? bulkWarningNote.trim() || null : null;
    }

    if (!trimmedTitle && Object.keys(payload).length === 0) {
      setNotice("Nessuna modifica da applicare.");
      return;
    }

    setIsSaving(true);
    const pageIds = selectedContentPages.map((page) => page.id);
    let resolvedArticle: Article | null = null;

    if (trimmedTitle) {
      const matchKey = articleMatchKey(trimmedTitle);
      const matchedArticle =
        articles.find((article) => article.issue_id === selectedIssueId && article.match_key === matchKey) ?? null;

      if (matchedArticle) {
        if (Object.keys(articlePatch).length > 0) {
          const { data, error } = await supabase
            .from("articles")
            .update({ ...articlePatch, title: trimmedTitle, match_key: matchKey })
            .eq("id", matchedArticle.id)
            .select("*")
            .single();

          if (error) {
            setNotice(error.message);
            setIsSaving(false);
            return;
          }

          resolvedArticle = data as Article;
        } else {
          resolvedArticle = matchedArticle;
        }
      } else {
        const nextSortOrder = articles.length === 0 ? 1 : Math.max(...articles.map((article) => article.sort_order)) + 1;
        const { data, error } = await supabase
          .from("articles")
          .insert({
            issue_id: selectedIssueId,
            title: trimmedTitle,
            match_key: matchKey,
            assignee: articlePatch.assignee ?? "",
            character_count: articlePatch.character_count ?? null,
            status_id: articlePatch.status_id ?? null,
            sort_order: nextSortOrder,
          })
          .select("*")
          .single();

        if (error) {
          setNotice(error.message);
          setIsSaving(false);
          return;
        }

        resolvedArticle = data as Article;
      }

      payload.article_id = resolvedArticle.id;
      payload.title = resolvedArticle.title;
      payload.assignee = resolvedArticle.assignee;
      payload.character_count = resolvedArticle.character_count;
      payload.status_id = resolvedArticle.status_id;
    } else {
      const linkedArticles = Array.from(
        new Map(
          selectedContentPages
            .map((page) => (page.article_id ? articleById.get(page.article_id) ?? null : null))
            .filter((article): article is Article => Boolean(article))
            .map((article) => [article.id, article]),
        ).values(),
      );

      if (linkedArticles.length > 0 && Object.keys(articlePatch).length > 0) {
        for (const linkedArticle of linkedArticles) {
          const { error } = await supabase
            .from("articles")
            .update(articlePatch)
            .eq("id", linkedArticle.id);

          if (error) {
            setNotice(error.message);
            setIsSaving(false);
            return;
          }

          await supabase
            .from("pages")
            .update(articlePatch)
            .eq("article_id", linkedArticle.id);
        }
      }
    }

    const { error } = await supabase.from("pages").update(payload).in("id", pageIds);

    if (error) {
      setNotice(error.message);
      setIsSaving(false);
      return;
    }

    if (resolvedArticle) {
      await supabase
        .from("pages")
        .update({
          title: resolvedArticle.title,
          assignee: resolvedArticle.assignee,
          character_count: resolvedArticle.character_count,
          status_id: resolvedArticle.status_id,
        })
        .eq("article_id", resolvedArticle.id);
    }

    await Promise.all([loadPages(selectedIssueId), loadArticles(selectedIssueId)]);
    setNotice(`${pageIds.length} pagine aggiornate.`);
    setBulkStatusId(KEEP_BULK_VALUE);
    setBulkTitle("");
    setBulkAssignee("");
    setBulkCharacterCount("");
    setBulkWarningMode("keep");
    setBulkWarningNote("");

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
    if (!supabase || !selectedIssueId || !newStatusName.trim()) return;

    const nextOrder = statuses.length === 0 ? 1 : Math.max(...statuses.map((status) => status.sort_order)) + 1;
    const { error } = await supabase.from("editorial_statuses").insert({
      issue_id: selectedIssueId,
      name: newStatusName.trim(),
      color: newStatusColor,
      sort_order: nextOrder,
    });

    if (error) {
      setNotice(error.message);
      return;
    }

    setNewStatusName("");
    await loadStatuses(selectedIssueId);
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

  async function createKanbanArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persistArticleDraft(
      {
        assignee: kanbanComposerAssignee,
        character_count: kanbanComposerCharacterCount,
        status_id: "",
        title: kanbanComposerTitle,
      },
      { article: null },
    );
    setKanbanComposerTitle("");
    setKanbanComposerAssignee("");
    setKanbanComposerCharacterCount("");
  }

  async function saveSelectedArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedArticle) return;
    await persistArticleDraft(articleDraft, { article: selectedArticle });
  }

  const deleteArticles = useCallback(
    async (articleIds: string[]) => {
      if (!supabase || articleIds.length === 0) return;

      setIsSaving(true);

      const { error: detachError } = await supabase.from("pages").update({ article_id: null }).in("article_id", articleIds);

      if (detachError) {
        setNotice(detachError.message);
        setIsSaving(false);
        return;
      }

      const { error } = await supabase.from("articles").delete().in("id", articleIds);

      if (error) {
        setNotice(error.message);
        setIsSaving(false);
        return;
      }

      setPages((current) =>
        sortPages(
          current.map((page) => (page.article_id && articleIds.includes(page.article_id) ? { ...page, article_id: null } : page)),
        ),
      );
      setArticles((current) => sortArticles(current.filter((article) => !articleIds.includes(article.id))));
      setSelectedArticleId(null);
      setSelectedArticleIds([]);
      setSelectionAnchorArticleId(null);
      setIsCreatingArticle(false);
      setInlineArticleEditor((current) => (current && current.articleId && articleIds.includes(current.articleId) ? null : current));
      setInlineArticlePlacement((current) =>
        inlineArticleEditor && inlineArticleEditor.articleId && articleIds.includes(inlineArticleEditor.articleId) ? null : current,
      );
      setNotice(articleIds.length === 1 ? "Articolo eliminato." : `${articleIds.length} articoli eliminati.`);
      setIsSaving(false);
    },
    [inlineArticleEditor],
  );

  async function deleteSelectedArticles() {
    if (selectedArticleIds.length === 0) return;
    await deleteArticles(selectedArticleIds);
  }

  useEffect(() => {
    if (workspaceView !== "kanban" || selectedArticleIds.length === 0) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Backspace" || inlineArticleEditor) return;

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      void deleteArticles(selectedArticleIds);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteArticles, inlineArticleEditor, selectedArticleIds, workspaceView]);

  async function applyBulkArticleEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !selectedIssueId || selectedArticles.length < 2) return;

    const payload: Partial<Article> = {};
    const pagePayload: Partial<MagazinePage> = {};

    if (bulkArticleStatusId !== KEEP_BULK_VALUE) {
      payload.status_id = bulkArticleStatusId || null;
      pagePayload.status_id = bulkArticleStatusId || null;
    }

    if (bulkArticleAssignee.trim()) {
      payload.assignee = bulkArticleAssignee.trim();
      pagePayload.assignee = bulkArticleAssignee.trim();
    }

    if (bulkArticleCharacterCount.trim() !== "") {
      payload.character_count = Number(bulkArticleCharacterCount);
      pagePayload.character_count = Number(bulkArticleCharacterCount);
    }

    if (Object.keys(payload).length === 0) {
      setNotice("Nessuna modifica da applicare.");
      return;
    }

    setIsSaving(true);
    const articleIds = selectedArticles.map((article) => article.id);
    const { error } = await supabase.from("articles").update(payload).in("id", articleIds);

    if (error) {
      setNotice(error.message);
      setIsSaving(false);
      return;
    }

    if (Object.keys(pagePayload).length > 0) {
      const { error: pageError } = await supabase.from("pages").update(pagePayload).in("article_id", articleIds);
      if (pageError) {
        setNotice(pageError.message);
        setIsSaving(false);
        return;
      }
    }

    await Promise.all([loadArticles(selectedIssueId), loadPages(selectedIssueId)]);
    setBulkArticleStatusId(KEEP_BULK_VALUE);
    setBulkArticleAssignee("");
    setBulkArticleCharacterCount("");
    setNotice(`${articleIds.length} articoli aggiornati.`);
    setIsSaving(false);
  }

  async function moveArticleToStatus(article: Article, statusId: string | null) {
    if (!supabase) return;

    setIsSaving(true);
    const { data, error } = await supabase
      .from("articles")
      .update({ status_id: statusId })
      .eq("id", article.id)
      .select("*")
      .single();

    if (error) {
      setNotice(error.message);
      setIsSaving(false);
      return;
    }

    const updatedArticle = data as Article;
    await supabase
      .from("pages")
      .update({ status_id: updatedArticle.status_id })
      .eq("article_id", updatedArticle.id);

    setArticles((current) =>
      sortArticles(current.map((currentArticle) => (currentArticle.id === updatedArticle.id ? updatedArticle : currentArticle))),
    );
    setPages((current) =>
      sortPages(
        current.map((page) =>
          page.article_id === updatedArticle.id ? { ...page, status_id: updatedArticle.status_id } : page,
        ),
      ),
    );
    setNotice("Status articolo aggiornato.");
    setIsSaving(false);
  }

  function jumpArticleToTimone(articleId: string) {
    const linkedPages = articlePages[articleId] ?? [];
    const firstPage = linkedPages[0];
    if (!firstPage) return;

    setSelectedPageId(firstPage.id);
    setSelectedPageIds([firstPage.id]);
    setSelectionAnchorPageId(firstPage.id);
    setIsCreatingArticle(false);
    setWorkspaceView("timone");
  }

  function handleArticleSelection(article: Article, event: ReactMouseEvent<HTMLElement>) {
    setIsCreatingArticle(false);
    setSelectedArticleId(article.id);

    if (event.shiftKey && selectionAnchorArticleId) {
      const anchorIndex = orderedKanbanArticles.findIndex((currentArticle) => currentArticle.id === selectionAnchorArticleId);
      const targetIndex = orderedKanbanArticles.findIndex((currentArticle) => currentArticle.id === article.id);

      if (anchorIndex >= 0 && targetIndex >= 0) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        setSelectedArticleIds(orderedKanbanArticles.slice(start, end + 1).map((currentArticle) => currentArticle.id));
        return;
      }
    }

    if (event.metaKey || event.ctrlKey) {
      if (selectedArticleIds.includes(article.id)) {
        const nextSelectedArticleIds = selectedArticleIds.filter((articleId) => articleId !== article.id);
        setSelectedArticleIds(nextSelectedArticleIds);
        setSelectedArticleId(nextSelectedArticleIds[nextSelectedArticleIds.length - 1] ?? null);
      } else {
        setSelectedArticleIds([...selectedArticleIds, article.id]);
        setSelectedArticleId(article.id);
      }
      setSelectionAnchorArticleId(article.id);
      return;
    }

    setSelectedArticleIds([article.id]);
    setSelectionAnchorArticleId(article.id);
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

  function openArticleCreation() {
    setSelectedArticleId(null);
    setSelectedArticleIds([]);
    setSelectionAnchorArticleId(null);
    setKanbanComposerTitle("");
    setKanbanComposerAssignee("");
    setKanbanComposerCharacterCount("");
    setIsCreatingArticle(true);
  }

  function openIssueCreationPanel() {
    setIsIssueRailOpen(false);
    setActiveIssuePanel("create");
  }

  function closeIssueCreationPanel() {
    setActiveIssuePanel(null);
    setNewIssueTitle("");
    setNewIssueDescription("");
  }

  function openInlineArticleEditor(
    options: { article: Article | null; statusId: string | null },
    anchor: HTMLElement,
    origin?: InlineEditorOrigin,
  ) {
    setSelectedArticleId(options.article?.id ?? null);
    setSelectedArticleIds(options.article?.id ? [options.article.id] : []);
    setSelectionAnchorArticleId(options.article?.id ?? null);
    setIsCreatingArticle(false);
    setInlineEditorPageId(null);
    setInlineEditorPlacement(null);
    setInlineArticleDraft(draftFromArticle(options.article, options.statusId));
    setInlineArticleEditor({ articleId: options.article?.id ?? null, statusId: options.statusId });
    setInlineArticlePlacement(getInlineEditorPlacement(anchor, origin));
  }

  function handleArticleContextMenu(event: ReactMouseEvent<HTMLElement>, article: Article) {
    event.preventDefault();
    setIsCreatingArticle(false);
    setSelectedArticleId(article.id);
    setSelectedArticleIds((current) => {
      if (current.includes(article.id)) return current;
      return [article.id];
    });
    setSelectionAnchorArticleId(article.id);
    setContextMenu({ articleId: article.id, type: "article", x: event.clientX, y: event.clientY });
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
    if (target.closest("button, input, textarea, select, form, .inline-page-editor, .inline-article-editor, .status-dashboard, .board-viewbar")) return;

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

  function getInlineEditorPlacement(anchor: HTMLElement, origin?: InlineEditorOrigin): InlineEditorPlacement {
    const rect = anchor.getBoundingClientRect();
    const originX = origin?.x ?? (rect.left + rect.right) / 2;
    const originY = origin?.y ?? (rect.top + rect.bottom) / 2;
    const maxLeft = window.innerWidth - INLINE_EDITOR_WIDTH - VIEWPORT_MARGIN;
    const popoverHeight = Math.min(INLINE_EDITOR_ESTIMATED_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2);
    const maxTop = window.innerHeight - popoverHeight - VIEWPORT_MARGIN;
    const clampLeft = (value: number) => Math.max(VIEWPORT_MARGIN, Math.min(value, maxLeft));
    const clampTop = (value: number) => Math.max(VIEWPORT_MARGIN, Math.min(value, Math.max(VIEWPORT_MARGIN, maxTop)));
    const clampArrowLeft = (left: number) =>
      Math.max(18, Math.min(originX - left, INLINE_EDITOR_WIDTH - 18));
    const clampArrowTop = (top: number) =>
      Math.max(18, Math.min(originY - top, popoverHeight - 18));
    const spaceAbove = originY - VIEWPORT_MARGIN;
    const spaceBelow = window.innerHeight - originY - VIEWPORT_MARGIN;

    if (spaceAbove >= popoverHeight + INLINE_EDITOR_ARROW_SIZE) {
      const left = clampLeft(originX - INLINE_EDITOR_WIDTH / 2);
      const top = Math.max(VIEWPORT_MARGIN, originY - INLINE_EDITOR_ARROW_SIZE);

      return { arrowLeft: clampArrowLeft(left), arrowTop: popoverHeight, direction: "top", left, top };
    }

    if (spaceBelow >= popoverHeight + INLINE_EDITOR_ARROW_SIZE) {
      const left = clampLeft(originX - INLINE_EDITOR_WIDTH / 2);
      const top = clampTop(originY + INLINE_EDITOR_ARROW_SIZE);

      return { arrowLeft: clampArrowLeft(left), arrowTop: 0, direction: "bottom", left, top };
    }

    const spaceRight = window.innerWidth - originX - VIEWPORT_MARGIN;
    const spaceLeft = originX - VIEWPORT_MARGIN;
    const direction: InlineEditorPlacement["direction"] =
      spaceRight >= INLINE_EDITOR_WIDTH + INLINE_EDITOR_GAP || spaceRight >= spaceLeft ? "right" : "left";
    const rawLeft =
      direction === "right"
        ? originX + INLINE_EDITOR_ARROW_SIZE
        : originX - INLINE_EDITOR_WIDTH - INLINE_EDITOR_ARROW_SIZE;
    const left = clampLeft(rawLeft);
    const rawTop = originY - 28;
    const top = clampTop(rawTop);
    const arrowTop = clampArrowTop(top);

    return { arrowLeft: direction === "right" ? 0 : INLINE_EDITOR_WIDTH, arrowTop, direction, left, top };
  }

  function openInlineEditor(page: MagazinePage, anchor: HTMLElement, origin?: InlineEditorOrigin) {
    setSelectedPageId(page.id);
    setInlineArticleEditor(null);
    setInlineArticlePlacement(null);
    setInlineEditorPageId(page.id);
    setInlineEditorPlacement(getInlineEditorPlacement(anchor, origin));
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
      {isIssueRailOpen ? <button aria-label="Chiudi menu numeri" className="issue-rail-backdrop" onClick={() => setIsIssueRailOpen(false)} type="button" /> : null}

      <aside
        aria-label="Numeri"
        className={isIssueRailOpen ? "issue-rail open" : "issue-rail"}
      >
        <div className="brand-block">
          <div className="brand-head">
            <p className="brand-logo">TIMONIERE</p>
            <button
              className="icon-button close-button rail-close-button"
              aria-label="Chiudi menu numeri"
              onClick={() => setIsIssueRailOpen(false)}
              type="button"
            />
          </div>
        </div>

        <section className="issue-list">
          <h2>Numeri</h2>
          {isLoading ? <p>Caricamento...</p> : null}
          {issues.map((issue) => (
            <button
              className={issue.id === selectedIssueId ? "issue-item active" : "issue-item"}
              key={issue.id}
              onClick={() => {
                setSelectedIssueId(issue.id);
                setIsIssueRailOpen(false);
              }}
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
          <div className="topbar-main">
            <button
              aria-label="Apri menu numeri"
              className="hamburger-button"
              onClick={() => setIsIssueRailOpen(true)}
              type="button"
            >
              <span />
              <span />
              <span />
            </button>
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
                  <div className="issue-meta-actions">
                    <button
                      aria-label="Modifica info numero"
                      className="meta-icon-button"
                      onClick={() => setIsIssueInfoModalOpen(true)}
                      title="Modifica info numero"
                      type="button"
                    >
                      <PencilIcon />
                    </button>
                    <button
                      aria-label="Copia link del numero"
                      className="meta-icon-button"
                      onClick={copyShareLink}
                      title="Copia link"
                      type="button"
                    >
                      <LinkChainIcon />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        {selectedIssue ? (
          <div
            className={workspaceView === "kanban" ? "board-wrap kanban-wrap" : "board-wrap"}
            data-kanban-view={kanbanView}
            data-zoom={boardZoom}
            onPointerDown={workspaceView === "timone" ? beginMarqueeSelection : undefined}
            ref={boardWrapRef}
          >
            <section className="board-viewbar" aria-label="Vista timone">
              <div className="view-mode-switch" role="tablist" aria-label="Vista del numero">
                <button
                  aria-selected={workspaceView === "timone"}
                  className={workspaceView === "timone" ? "workspace-tab active" : "workspace-tab"}
                  onClick={() => setWorkspaceView("timone")}
                  role="tab"
                  type="button"
                >
                  Timone
                </button>
                <button
                  aria-selected={workspaceView === "kanban"}
                  className={workspaceView === "kanban" ? "workspace-tab active" : "workspace-tab"}
                  onClick={() => setWorkspaceView("kanban")}
                  role="tab"
                  type="button"
                >
                  Kanban
                </button>
              </div>
              {workspaceView === "timone" ? (
                <div className="zoom-control-wrap">
                  <span className="zoom-control-label">Vista pagine</span>
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
                </div>
              ) : (
                <div className="zoom-control-wrap">
                  <span className="zoom-control-label">Vista kanban</span>
                  <div className="zoom-control" aria-label="Vista visualizzazione kanban">
                    {KANBAN_VIEW_LEVELS.map((level) => (
                      <button
                        aria-pressed={kanbanView === level.id}
                        className={kanbanView === level.id ? "zoom-button active" : "zoom-button"}
                        key={level.id}
                        onClick={() => setKanbanView(level.id)}
                        type="button"
                      >
                        <span>{level.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

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
                </div>
                <div className="status-heatmap" aria-label="Heatmap pagine">
                  {contentPages.map((page) => {
                    const status = getPageStatus(page);
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

            {workspaceView === "timone" ? (
              <>
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
                      displayTitle={getPageTitle(page)}
                      isSelected={selectedPageId === page.id}
                      onClick={(event) => handlePageSelection(page, event)}
                      onDoubleClick={(event) =>
                        openInlineEditor(page, event.currentTarget, { x: event.clientX, y: event.clientY })
                      }
                      onContextMenu={(event) => handlePageContextMenu(event, page)}
                      page={page}
                      status={getPageStatus(page)}
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
                        displayAssignee={getPageAssignee(page)}
                        displayCharacterCount={getPageCharacterCount(page)}
                        displayTitle={getPageTitle(page)}
                        draggable
                        isDragging={draggedPageId === page.id}
                        isSelected={selectedPageId === page.id || selectedPageIds.includes(page.id)}
                        onClick={(event) => handlePageSelection(page, event)}
                        onContextMenu={(event) => handlePageContextMenu(event, page)}
                        onDoubleClick={(event) =>
                          openInlineEditor(page, event.currentTarget, { x: event.clientX, y: event.clientY })
                        }
                        onDragStart={() => setDraggedPageId(page.id)}
                        onDrop={() => void movePage(page.id)}
                        page={page}
                        side={spread.length === 1 ? (spreadIndex === 0 ? "right" : "single") : pageIndex === 0 ? "left" : "right"}
                        status={getPageStatus(page)}
                      />
                    </div>
                  ))}
                </div>
              ))}
                </section>
              </>
            ) : (
              <section className="kanban-board" aria-label="Kanban articoli">
                <div className="kanban-columns">
                  {kanbanColumns.map((column) => {
                    const columnArticles = sortArticles(
                      articles.filter((article) => (column.statusId ? article.status_id === column.statusId : !article.status_id)),
                    );

                    return (
                      <section
                        className="kanban-column"
                        key={column.id}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const articleId = draggedArticleId || event.dataTransfer.getData("text/plain");
                          const article = articles.find((item) => item.id === articleId);
                          setDraggedArticleId(null);
                          if (article) void moveArticleToStatus(article, column.statusId);
                        }}
                        style={{ "--status-color": column.color } as CSSProperties & { "--status-color": string }}
                      >
                        <header className="kanban-column-head">
                          <div>
                            <span>{column.name}</span>
                            <strong>{columnArticles.length}</strong>
                          </div>
                        </header>

                        <div className="kanban-column-body">
                          {columnArticles.map((article) => {
                            const linkedPages = articlePages[article.id] ?? [];
                            const linkedLabels = linkedPages.map((page) => pageLabel(page, contentPages));

                            return (
                              <article
                                className={selectedArticleIds.includes(article.id) ? "kanban-card selected" : "kanban-card"}
                                data-article-id={article.id}
                                draggable
                                key={article.id}
                                onClick={(event) => handleArticleSelection(article, event)}
                                onContextMenu={(event) => handleArticleContextMenu(event, article)}
                                onDoubleClick={(event) =>
                                  openInlineArticleEditor(
                                    { article, statusId: column.statusId },
                                    event.currentTarget,
                                    { x: event.clientX, y: event.clientY },
                                  )
                                }
                                onDragStart={(event) => {
                                  setDraggedArticleId(article.id);
                                  event.dataTransfer.setData("text/plain", article.id);
                                }}
                                onDragEnd={() => setDraggedArticleId(null)}
                              >
                                <button
                                  aria-label={
                                    linkedPages.length === 0
                                      ? `L'articolo ${article.title} non e ancora nel timone`
                                      : `Seleziona ${article.title} nel timone`
                                  }
                                  className="kanban-jump-button"
                                  disabled={linkedPages.length === 0}
                                  onClick={() => jumpArticleToTimone(article.id)}
                                  type="button"
                                >
                                  <KanbanJumpIcon />
                                </button>
                                <strong>{article.title}</strong>
                                {article.assignee ? <small>{article.assignee}</small> : null}
                                {article.character_count ? (
                                  <span className="kanban-card-meta">
                                    {article.character_count.toLocaleString("it-IT")} battute
                                  </span>
                                ) : null}
                                <div className="kanban-card-footer">
                                  <span>{linkedPages.length === 0 ? "Fuori dal timone" : articlePageSummary(linkedPages.length)}</span>
                                  {linkedLabels.length > 0 ? <span>pp. {linkedLabels.join(", ")}</span> : null}
                                </div>
                              </article>
                            );
                          })}
                          {columnArticles.length === 0 ? <p className="kanban-empty">Nessun articolo</p> : null}
                        </div>
                        <button
                          aria-label={`Nuovo articolo in ${column.name}`}
                          className="kanban-column-add"
                          onClick={(event) =>
                            openInlineArticleEditor(
                              { article: null, statusId: column.statusId },
                              event.currentTarget,
                              { x: event.clientX, y: event.clientY },
                            )
                          }
                          type="button"
                        />
                      </section>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="workspace-danger-zone" aria-label="Azioni distruttive">
              <button
                className="danger-button"
                type="button"
                onClick={deleteSelectedIssue}
                disabled={!selectedIssue || isSaving}
              >
                Elimina numero
              </button>
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

      {activeIssuePanel === "create" ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeIssueCreationPanel();
          }}
        >
          <form className="issue-info-modal new-issue-modal" onSubmit={createIssue}>
            <div className="new-issue-modal-accent" aria-hidden="true" />
            <div className="panel-head">
              <div>
                <span>Nuovo numero</span>
                <h2>Crea numero</h2>
              </div>
              <button
                className="icon-button close-button"
                aria-label="Chiudi nuovo numero"
                onClick={closeIssueCreationPanel}
                type="button"
              />
            </div>
            <label>
              Titolo
              <input
                ref={newIssueTitleInputRef}
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
                rows={5}
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
            <div className="modal-actions">
              <button type="submit" disabled={isSaving || !newIssueTitle.trim()}>
                Crea numero
              </button>
              <button onClick={closeIssueCreationPanel} type="button">
                Annulla
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {issuePendingDelete ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSaving) setIssuePendingDelete(null);
          }}
        >
          <section className="issue-info-modal delete-issue-modal" role="dialog" aria-modal="true" aria-labelledby="delete-issue-title">
            <div className="delete-issue-mark" aria-hidden="true">
              <span />
            </div>
            <div className="panel-head">
              <div>
                <span>Azione irreversibile</span>
                <h2 id="delete-issue-title">Eliminare questo numero?</h2>
              </div>
              <button
                className="icon-button close-button modal-close-button"
                aria-label="Annulla eliminazione numero"
                disabled={isSaving}
                onClick={() => setIssuePendingDelete(null)}
                type="button"
              />
            </div>
            <p className="delete-issue-copy">
              Stai per cancellare <strong>{issuePendingDelete.title}</strong>. Verranno eliminate anche tutte le sue pagine,
              gli articoli e gli status collegati.
            </p>
            <p className="delete-issue-note">
              {issuePendingDelete.id === selectedIssueId && pages.length > 0
                ? `${pages.length} pagine saranno rimosse.`
                : "Questa operazione non puo essere annullata."}
            </p>
            <div className="modal-actions danger-actions">
              <button
                className="danger-confirm-button"
                disabled={isSaving}
                onClick={() => void deleteIssue(issuePendingDelete)}
                type="button"
              >
                Elimina numero
              </button>
              <button disabled={isSaving} onClick={() => setIssuePendingDelete(null)} type="button">
                Annulla
              </button>
            </div>
          </section>
        </div>
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
          articleTitles={articleTitles}
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

      {inlineArticleEditor && inlineArticlePlacement ? (
        <InlineArticleEditor
          articleTitles={articleTitles}
          draft={inlineArticleDraft}
          editorRef={inlineArticleEditorRef}
          isSaving={isSaving}
          label={inlineArticleEditor.articleId ? "Articolo" : "Nuovo articolo"}
          onClose={closeInlineArticleEditor}
          onSave={async (event) => {
            event.preventDefault();
            const article = inlineArticleEditor.articleId
              ? articles.find((item) => item.id === inlineArticleEditor.articleId) ?? null
              : null;
            await persistArticleDraft(inlineArticleDraft, {
              article,
              closeInline: true,
              defaultStatusId: inlineArticleEditor.statusId,
            });
          }}
          placement={inlineArticlePlacement}
          setDraft={setInlineArticleDraft}
          statuses={statuses}
          titleInputRef={inlineArticleTitleInputRef}
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
          ) : contextMenu.type === "article" ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingArticle(false);
                  const article = articles.find((item) => item.id === contextMenu.articleId) ?? null;
                  const anchor =
                    typeof document !== "undefined"
                      ? document.querySelector<HTMLElement>(`[data-article-id="${contextMenu.articleId}"]`)
                      : null;
                  setContextMenu(null);
                  if (article && anchor) {
                    openInlineArticleEditor({ article, statusId: article.status_id ?? null }, anchor);
                  }
                }}
              >
                Modifica articolo
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => {
                  const articleIds =
                    selectedArticleIds.includes(contextMenu.articleId) && selectedArticleIds.length > 1
                      ? selectedArticleIds
                      : [contextMenu.articleId];
                  setContextMenu(null);
                  void deleteArticles(articleIds);
                }}
              >
                Elimina articolo
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

        <section className="editor-toolbar" aria-label="Azioni principali">
          {workspaceView === "timone" ? (
            <div className="editor-toolbar-grid">
              <button className="editor-toolbar-button primary" type="button" onClick={addContentPage} disabled={!selectedIssue}>
                Aggiungi pagina
              </button>
              <button className="editor-toolbar-button" type="button" onClick={addSpread} disabled={!selectedIssue}>
                Aggiungi doppia
              </button>
            </div>
          ) : (
            <button
              className={isCreatingArticle ? "editor-toolbar-button primary active" : "editor-toolbar-button primary"}
              type="button"
              onClick={openArticleCreation}
              disabled={!selectedIssue}
            >
              Crea articolo
            </button>
          )}
        </section>

        <section className="editor-panel">
          <h2>
            {workspaceView === "kanban"
              ? isCreatingArticle
                ? "Nuovo articolo"
                : hasMultipleSelectedArticles
                  ? "Articoli"
                  : "Articolo"
              : "Pagina"}
          </h2>
          {workspaceView === "kanban" ? (
            isCreatingArticle ? (
              <form onSubmit={createKanbanArticle}>
                <p className="page-kind">Articolo da assegnare alle pagine del numero</p>
                <label>
                  Nome articolo
                  <ArticleAutocompleteInput
                    articleTitles={articleTitles}
                    autoFocus
                    inputRef={kanbanComposerTitleInputRef}
                    onChange={setKanbanComposerTitle}
                    placeholder="Breve storia del golf"
                    value={kanbanComposerTitle}
                  />
                </label>
                <label>
                  Assegnato a
                  <input
                    value={kanbanComposerAssignee}
                    onChange={(event) => setKanbanComposerAssignee(event.target.value)}
                    placeholder="Nome redattore"
                  />
                </label>
                <label>
                  Battute
                  <input
                    min={0}
                    type="number"
                    value={kanbanComposerCharacterCount}
                    onChange={(event) => setKanbanComposerCharacterCount(event.target.value)}
                    placeholder="3200"
                  />
                </label>
                <button type="submit" disabled={isSaving || !kanbanComposerTitle.trim()}>
                  Crea articolo
                </button>
              </form>
            ) : hasMultipleSelectedArticles ? (
              <form className="bulk-editor" onSubmit={applyBulkArticleEdit}>
                <p className="page-kind">{selectedArticles.length} articoli selezionati</p>
                <label>
                  Status
                  <StatusSelect
                    includeKeepOption
                    statuses={statuses}
                    value={bulkArticleStatusId}
                    onChange={(statusId) => setBulkArticleStatusId(statusId ?? "")}
                  />
                </label>
                <label>
                  Assegnato a
                  <input
                    value={bulkArticleAssignee}
                    onChange={(event) => setBulkArticleAssignee(event.target.value)}
                    placeholder="Lascia vuoto per non modificare"
                  />
                </label>
                <label>
                  Battute
                  <input
                    min={0}
                    type="number"
                    value={bulkArticleCharacterCount}
                    onChange={(event) => setBulkArticleCharacterCount(event.target.value)}
                    placeholder="Lascia vuoto per non modificare"
                  />
                </label>
                <button type="submit" disabled={isSaving}>
                  Applica agli articoli selezionati
                </button>
                <button className="danger-button" disabled={isSaving} onClick={deleteSelectedArticles} type="button">
                  Elimina articoli selezionati
                </button>
              </form>
            ) : selectedArticle ? (
              <form onSubmit={saveSelectedArticle}>
                <p className="page-kind">
                  {selectedArticlePages.length === 0
                    ? "Articolo fuori dal timone"
                    : `${articlePageSummary(selectedArticlePages.length)} · pp. ${selectedArticlePages
                        .map((page) => pageLabel(page, contentPages))
                        .join(", ")}`}
                </p>
                <label>
                  Nome articolo
                  <ArticleAutocompleteInput
                    articleTitles={articleTitles}
                    onChange={(value) => setArticleDraft((draft) => ({ ...draft, title: value }))}
                    value={articleDraft.title}
                    placeholder="Breve storia del golf"
                  />
                </label>
                <label>
                  Assegnato a
                  <input
                    value={articleDraft.assignee}
                    onChange={(event) => setArticleDraft((draft) => ({ ...draft, assignee: event.target.value }))}
                    placeholder="Nome redattore"
                  />
                </label>
                <label>
                  Battute
                  <input
                    min={0}
                    type="number"
                    value={articleDraft.character_count}
                    onChange={(event) => setArticleDraft((draft) => ({ ...draft, character_count: event.target.value }))}
                    placeholder="3200"
                  />
                </label>
                <label>
                  Status
                  <StatusSelect
                    statuses={statuses}
                    value={articleDraft.status_id}
                    onChange={(statusId) => setArticleDraft((draft) => ({ ...draft, status_id: statusId ?? "" }))}
                  />
                </label>
                <button type="submit" disabled={isSaving || !articleDraft.title.trim()}>
                  Salva articolo
                </button>
                <button className="danger-button" disabled={isSaving} onClick={deleteSelectedArticles} type="button">
                  Elimina articolo
                </button>
              </form>
            ) : (
              <p>Seleziona un articolo dalla Kanban oppure creane uno nuovo.</p>
            )
          ) : hasMultipleSelectedPages ? (
            <form className="bulk-editor" onSubmit={applyBulkPageEdit}>
              <p className="page-kind">{selectedContentPages.length} pagine selezionate</p>
              <label>
                Nome articolo
                <ArticleAutocompleteInput
                  articleTitles={articleTitles}
                  onChange={setBulkTitle}
                  placeholder="Lascia vuoto per non modificare"
                  value={bulkTitle}
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
                <ArticleAutocompleteInput
                  articleTitles={articleTitles}
                  onChange={(value) => setPageDraft((draft) => ({ ...draft, title: value }))}
                  value={pageDraft.title}
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

        <section
          className={isStatusEditorOpen ? "status-editor open" : "status-editor collapsed"}
          onClick={!isStatusEditorOpen ? () => setIsStatusEditorOpen(true) : undefined}
        >
          <div className="status-editor-head">
            <div>
              <h2>Status</h2>
              <small>{statuses.length} voci</small>
            </div>
            <button
              aria-expanded={isStatusEditorOpen}
              className="status-editor-toggle"
              aria-label={isStatusEditorOpen ? "Chiudi menu status" : "Apri menu status"}
              onClick={(event) => {
                event.stopPropagation();
                setIsStatusEditorOpen((current) => !current);
              }}
              type="button"
            >
              <span aria-hidden="true" />
            </button>
          </div>
          {isStatusEditorOpen ? (
            <>
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
            </>
          ) : null}
        </section>

        <button
          aria-label="Crea nuovo numero"
          className="new-issue-fab"
          onClick={openIssueCreationPanel}
          title="Crea nuovo numero"
          type="button"
        >
          <span className="new-issue-fab-icon" aria-hidden="true" />
          <span>Nuovo numero</span>
        </button>
      </aside>
    </main>
  );
}

type PageTileProps = {
  contentPages: MagazinePage[];
  displayAssignee?: string;
  displayCharacterCount?: number | null;
  displayTitle?: string;
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
  displayAssignee,
  displayCharacterCount,
  displayTitle,
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
      <strong>{displayTitle || "Pagina vuota"}</strong>
      {isContentPage && displayAssignee ? <small>{displayAssignee}</small> : null}
      {isContentPage && displayCharacterCount ? (
        <span className="page-meta">{displayCharacterCount.toLocaleString("it-IT")} battute</span>
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
  articleTitles: string[];
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

type InlineArticleEditorProps = {
  articleTitles: string[];
  draft: ArticleInlineDraft;
  editorRef: RefObject<HTMLFormElement | null>;
  isSaving: boolean;
  label: string;
  onClose: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  placement: InlineEditorPlacement;
  setDraft: Dispatch<SetStateAction<ArticleInlineDraft>>;
  statuses: EditorialStatus[];
  titleInputRef: RefObject<HTMLInputElement | null>;
};

function InlinePageEditor({
  articleTitles,
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
          "--inline-arrow-left": `${placement.arrowLeft}px`,
          "--inline-arrow-top": `${placement.arrowTop}px`,
          left: placement.left,
          top: placement.top,
        } as CSSProperties & { "--inline-arrow-left": string; "--inline-arrow-top": string }
      }
      data-direction={placement.direction}
    >
      <div className="inline-editor-head">
        <strong>{label}</strong>
        <button className="icon-button close-button" aria-label="Chiudi editor pagina" onClick={onClose} type="button" />
      </div>
      <label>
        Nome articolo
        <ArticleAutocompleteInput
          articleTitles={articleTitles}
          inputRef={titleInputRef}
          onChange={(value) => setDraft((currentDraft) => ({ ...currentDraft, title: value }))}
          value={draft.title}
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

function InlineArticleEditor({
  articleTitles,
  draft,
  editorRef,
  isSaving,
  label,
  onClose,
  onSave,
  placement,
  setDraft,
  statuses,
  titleInputRef,
}: InlineArticleEditorProps) {
  return (
    <form
      className="inline-page-editor inline-article-editor"
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
          "--inline-arrow-left": `${placement.arrowLeft}px`,
          "--inline-arrow-top": `${placement.arrowTop}px`,
          left: placement.left,
          top: placement.top,
        } as CSSProperties & { "--inline-arrow-left": string; "--inline-arrow-top": string }
      }
      data-direction={placement.direction}
    >
      <div className="inline-editor-head">
        <strong>{label}</strong>
        <button className="icon-button close-button" aria-label="Chiudi editor articolo" onClick={onClose} type="button" />
      </div>
      <label>
        Nome articolo
        <ArticleAutocompleteInput
          articleTitles={articleTitles}
          inputRef={titleInputRef}
          onChange={(value) => setDraft((currentDraft) => ({ ...currentDraft, title: value }))}
          value={draft.title}
          placeholder="Breve storia del golf"
        />
      </label>
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
          value={draft.character_count}
          onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, character_count: event.target.value }))}
          placeholder="3200"
        />
      </label>
      <label>
        Status
        <StatusSelect
          statuses={statuses}
          value={draft.status_id}
          onChange={(statusId) => setDraft((currentDraft) => ({ ...currentDraft, status_id: statusId ?? "" }))}
        />
      </label>
      <div className="inline-editor-actions">
        <button type="submit" disabled={isSaving || !draft.title.trim()}>
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

function KanbanJumpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path
        d="M3.75 5.75C3.75 4.92 4.42 4.25 5.25 4.25H8.7C9.46 4.25 10.08 4.87 10.08 5.63V14.35C9.52 13.96 8.86 13.75 8.18 13.75H5.85C4.69 13.75 3.75 12.81 3.75 11.65V5.75Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M16.25 5.75C16.25 4.92 15.58 4.25 14.75 4.25H11.3C10.54 4.25 9.92 4.87 9.92 5.63V14.35C10.48 13.96 11.14 13.75 11.82 13.75H14.15C15.31 13.75 16.25 12.81 16.25 11.65V5.75Z"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M10 5.2V14.55"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M5.7 7.45H8.3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.55"
      />
      <path
        d="M11.7 7.45H14.3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.55"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M4 14.4 4.5 11.8 11.9 4.4a1.6 1.6 0 0 1 2.3 0l1.4 1.4a1.6 1.6 0 0 1 0 2.3l-7.4 7.4L5.6 16z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="M10.9 5.4 14.6 9.1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M4 16h12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function LinkChainIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M8.2 11.8 6.6 13.4a2.5 2.5 0 0 1-3.5-3.5l2.8-2.8a2.5 2.5 0 0 1 3.5 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="m11.8 8.2 1.6-1.6a2.5 2.5 0 0 1 3.5 3.5l-2.8 2.8a2.5 2.5 0 0 1-3.5 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path d="m7.2 12.8 5.6-5.6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

type ArticleAutocompleteInputProps = {
  articleTitles: string[];
  autoFocus?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
};

function ArticleAutocompleteInput({
  articleTitles,
  autoFocus = false,
  inputRef,
  onChange,
  placeholder,
  value,
}: ArticleAutocompleteInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasTyped, setHasTyped] = useState(false);
  const comboboxRef = useRef<HTMLDivElement | null>(null);
  const deferredTitles = useDeferredValue(articleTitles);
  const deferredValue = useDeferredValue(value);
  const normalizedValue = articleMatchKey(deferredValue);
  const suggestions = useMemo(() => {
    if (!normalizedValue) return [];

    const startsWith = deferredTitles.filter((title) => articleMatchKey(title).startsWith(normalizedValue));
    const contains = deferredTitles.filter(
      (title) =>
        !articleMatchKey(title).startsWith(normalizedValue) &&
        articleMatchKey(title).includes(normalizedValue),
    );

    return [...startsWith, ...contains].slice(0, 8);
  }, [deferredTitles, normalizedValue]);
  const shouldShowSuggestions = isOpen && hasTyped && value.trim().length > 0 && suggestions.length > 0;

  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (comboboxRef.current?.contains(target)) return;

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

  useEffect(() => {
    if (!autoFocus) return;

    const animationFrame = window.requestAnimationFrame(() => {
      inputRef?.current?.focus();
      inputRef?.current?.select();
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [autoFocus, inputRef]);

  return (
    <div className="article-combobox" ref={comboboxRef}>
      <input
        autoFocus={autoFocus}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        data-1p-ignore="true"
        data-form-type="other"
        data-lpignore="true"
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue);
          setHasTyped(true);
          setIsOpen(nextValue.length > 0);
        }}
        onFocus={() => {
          if (hasTyped && value.length > 0) setIsOpen(true);
        }}
        placeholder={placeholder}
        ref={inputRef}
        spellCheck={false}
        value={value}
      />
      {shouldShowSuggestions ? (
        <div className="article-combobox-menu" role="listbox">
          {suggestions.map((title) => (
            <button
              key={title}
              onClick={() => {
                onChange(title);
                setIsOpen(false);
                setHasTyped(false);
                inputRef?.current?.focus();
              }}
              onPointerDown={(event) => event.preventDefault()}
              type="button"
            >
              {title}
            </button>
          ))}
        </div>
      ) : null}
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
