"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/* =============================================================================
   SECTION 1) TYPES
============================================================================= */

type CollectionCategory =
  | "Diecast"
  | "Pop Figure"
  | "Trading Card"
  | "Model Figure"
  | "Other";

type ListingStatus = "NONE" | "TRADE" | "SALE" | "BOTH";
type PrivacyMode = "PRIVATE" | "SHOWROOM" | "PUBLIC";
type AccessLevel = "NONE" | "SHOWROOM" | "FULL";
type DMReason = "Trade" | "Buy" | "Sell" | "Question" | "Other";
type MediaKind = "image" | "video";

type MediaItem = {
  id: string;
  kind: MediaKind;
  dataUrl?: string;
  storagePath?: string;
  fileName?: string;
  createdAt: number;
};

type CollectionItem = {
  id: string;
  category: CollectionCategory;
  name: string;
  brand: string;
  year?: string;
  condition: string;
  notes?: string;
  quantityOwned: number;
  quantityAvailableTrade: number;
  quantityAvailableSale: number;
  askingPrice?: number;
  listingStatus: ListingStatus;
  media?: MediaItem[];
  // Diecast / Model Figure
  scale?: string;
  series?: string;
  caseCode?: string;
  // Pop Figure
  line?: string;
  figureNumber?: string;
  // Trading Card
  cardSet?: string;
  cardNumber?: string;
  grade?: string;
};

type AccessRequest = {
  id: string;
  viewerId: string;
  requested: "SHOWROOM" | "FULL";
  note: string;
  status: "PENDING" | "APPROVED" | "DECLINED";
  createdAt: number;
};

type DMRequest = {
  id: string;
  viewerId: string;
  reason: DMReason;
  note: string;
  status: "PENDING" | "APPROVED" | "DECLINED";
  createdAt: number;
  conversationId?: string;
};

type Conversation = {
  id: string;
  ownerId: string;
  viewerId: string;
  createdAt: number;
};

type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: number;
};

/* =============================================================================
   SECTION 2) CONSTANTS
============================================================================= */

const OWNER_ID = "diecastdan";
const VIEWER_ID = "visitor-001";

const STORAGE_ITEMS = "collectorshq:items:v2";
const STORAGE_PRIVACY = "collectorshq:privacy:v1";
const STORAGE_GRANTS = "collectorshq:grants_by_viewer:v1";
const STORAGE_ACCESS_REQS = "collectorshq:access_requests:v1";
const STORAGE_DM_REQS = "collectorshq:dm_requests:v1";
const STORAGE_DM_APPROVED_BY_VIEWER = "collectorshq:dm_approved_by_viewer:v1";
const STORAGE_CONVERSATIONS = "collectorshq:conversations:v1";
const STORAGE_MESSAGES = "collectorshq:messages:v1";

const ALL_CATEGORIES: CollectionCategory[] = [
  "Diecast",
  "Pop Figure",
  "Trading Card",
  "Model Figure",
  "Other",
];

const CONDITION_BY_CATEGORY: Record<CollectionCategory, string[]> = {
  Diecast: ["Carded", "Loose"],
  "Pop Figure": ["Mint in Box", "Out of Box"],
  "Trading Card": ["PSA Graded", "BGS Graded", "CGC Graded", "Raw / Ungraded"],
  "Model Figure": [
    "Factory Sealed",
    "Built & Painted",
    "Built Unfinished",
    "Unbuilt Kit",
  ],
  Other: ["Mint", "Near Mint", "Good", "Fair"],
};

const CATEGORY_COLOR: Record<CollectionCategory, string> = {
  Diecast: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  "Pop Figure": "text-purple-400 bg-purple-400/10 border-purple-400/20",
  "Trading Card": "text-sky-400 bg-sky-400/10 border-sky-400/20",
  "Model Figure": "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  Other: "text-slate-300 bg-white/5 border-white/10",
};

const CATEGORY_DOT: Record<CollectionCategory, string> = {
  Diecast: "bg-amber-400",
  "Pop Figure": "bg-purple-400",
  "Trading Card": "bg-sky-400",
  "Model Figure": "bg-emerald-400",
  Other: "bg-slate-400",
};

const MAX_MEDIA_ITEMS = 6;
const MAX_MEDIA_BYTES = 900_000;
const MEDIA_BUCKET = "car-media";

/* =============================================================================
   SECTION 3) SUPABASE (lazy singleton — safe during SSR prerender)
============================================================================= */

let _supabaseClient: ReturnType<typeof createClient> | undefined;

function supabase() {
  if (!_supabaseClient) {
    _supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _supabaseClient;
}

/* =============================================================================
   SECTION 4) HELPERS
============================================================================= */

function uid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function clampInt(n: unknown, min = 0, max = 9999) {
  const num =
    typeof n === "number" ? n : typeof n === "string" ? parseInt(n, 10) : 0;
  if (Number.isNaN(num)) return min;
  return Math.max(min, Math.min(max, num));
}

function computeStatus(tradeAvail: number, saleAvail: number): ListingStatus {
  if (tradeAvail > 0 && saleAvail > 0) return "BOTH";
  if (tradeAvail > 0) return "TRADE";
  if (saleAvail > 0) return "SALE";
  return "NONE";
}

function safeParseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeParseItems(raw: string | null): CollectionItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c: any) => {
        if (!c || typeof c !== "object") return null;
        if (typeof c.id !== "string" || typeof c.name !== "string") return null;
        if (typeof c.brand !== "string") return null;

        const owned = clampInt(c.quantityOwned);
        const trade = clampInt(c.quantityAvailableTrade);
        const sale = clampInt(c.quantityAvailableSale);

        const media: MediaItem[] | undefined = Array.isArray(c.media)
          ? (c.media
              .map((m: any) => {
                if (!m || typeof m !== "object") return null;
                if (typeof m.id !== "string") return null;
                if (m.kind !== "image" && m.kind !== "video") return null;
                const dataUrl =
                  typeof m.dataUrl === "string" ? m.dataUrl : undefined;
                const storagePath =
                  typeof m.storagePath === "string" ? m.storagePath : undefined;
                if (!dataUrl && !storagePath) return null;
                return {
                  id: m.id,
                  kind: m.kind,
                  dataUrl,
                  storagePath,
                  fileName:
                    typeof m.fileName === "string" ? m.fileName : undefined,
                  createdAt:
                    typeof m.createdAt === "number" ? m.createdAt : Date.now(),
                } as MediaItem;
              })
              .filter(Boolean) as MediaItem[])
          : undefined;

        const category: CollectionCategory = ALL_CATEGORIES.includes(c.category)
          ? c.category
          : "Diecast";

        return {
          id: c.id,
          category,
          name: c.name,
          brand: c.brand,
          year: typeof c.year === "string" ? c.year : undefined,
          condition:
            typeof c.condition === "string" ? c.condition : "Unknown",
          notes: typeof c.notes === "string" ? c.notes : undefined,
          quantityOwned: owned,
          quantityAvailableTrade: trade,
          quantityAvailableSale: sale,
          askingPrice:
            typeof c.askingPrice === "number" ? c.askingPrice : undefined,
          listingStatus: computeStatus(trade, sale),
          media,
          scale: typeof c.scale === "string" ? c.scale : undefined,
          series: typeof c.series === "string" ? c.series : undefined,
          caseCode: typeof c.caseCode === "string" ? c.caseCode : undefined,
          line: typeof c.line === "string" ? c.line : undefined,
          figureNumber:
            typeof c.figureNumber === "string" ? c.figureNumber : undefined,
          cardSet: typeof c.cardSet === "string" ? c.cardSet : undefined,
          cardNumber:
            typeof c.cardNumber === "string" ? c.cardNumber : undefined,
          grade: typeof c.grade === "string" ? c.grade : undefined,
        } as CollectionItem;
      })
      .filter(Boolean) as CollectionItem[];
  } catch {
    return [];
  }
}

function wordCount(s: string) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function show(v?: string | number) {
  if (v === undefined || v === null || v === "") return "—";
  return String(v);
}

function convoIdForPair(ownerId: string, viewerId: string) {
  return `convo:${ownerId}::${viewerId}`;
}

function upsertConversation(prev: Conversation[], convo: Conversation) {
  return prev.some((c) => c.id === convo.id) ? prev : [convo, ...prev];
}

function getMediaSrc(m: MediaItem) {
  if (m.dataUrl) return m.dataUrl;
  return "";
}

function formatPrice(price: number) {
  return `$${price.toLocaleString()}`;
}

/* =============================================================================
   SECTION 5) SMALL UI COMPONENTS
============================================================================= */

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium " +
        (className || "border-white/10 bg-white/10 text-white")
      }
    >
      {children}
    </span>
  );
}

function CategoryBadge({ category }: { category: CollectionCategory }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium " +
        CATEGORY_COLOR[category]
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${CATEGORY_DOT[category]}`} />
      {category}
    </span>
  );
}

function ActionBtn(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={
        "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10 transition-colors " +
        className
      }
    />
  );
}

function PillBtn(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }
) {
  const { className = "", active, ...rest } = props;
  return (
    <button
      {...rest}
      className={
        `rounded-full px-4 py-1.5 text-sm transition-colors ${
          active
            ? "bg-white/15 text-white font-medium"
            : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
        } ` + className
      }
    />
  );
}

function InputField({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-white/60">
        {label}
        {required && <span className="ml-0.5 text-white/40">*</span>}
      </div>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-white/20 transition-colors";

/* =============================================================================
   SECTION 6) ACCESS LOGIC
============================================================================= */

function getEffectiveAccess(args: {
  isOwner: boolean;
  privacyMode: PrivacyMode;
  granted: AccessLevel;
}): AccessLevel {
  const { isOwner, privacyMode, granted } = args;
  if (isOwner) return "FULL";
  if (privacyMode === "PUBLIC") return "FULL";
  if (granted === "FULL") return "FULL";
  if (granted === "SHOWROOM") return "SHOWROOM";
  if (privacyMode === "SHOWROOM") return "SHOWROOM";
  return "NONE";
}

/* =============================================================================
   SECTION 7) SEED DATA
============================================================================= */

const SEED_ITEMS: CollectionItem[] = [
  {
    id: "1",
    category: "Diecast",
    name: "Nissan Skyline GT-R (R34)",
    brand: "Hot Wheels",
    scale: "1:64",
    year: "2023",
    series: "HW J-Imports",
    caseCode: "K",
    condition: "Loose",
    notes: "Treasure hunt variant — found it at a local Walmart.",
    quantityOwned: 3,
    quantityAvailableTrade: 0,
    quantityAvailableSale: 0,
    listingStatus: "NONE",
  },
  {
    id: "2",
    category: "Diecast",
    name: "M3 GTR",
    brand: "Hot Wheels",
    scale: "1:64",
    year: "2025",
    series: "HW Flames",
    caseCode: "P",
    condition: "Carded",
    quantityOwned: 1,
    quantityAvailableTrade: 0,
    quantityAvailableSale: 0,
    listingStatus: "NONE",
  },
  {
    id: "3",
    category: "Diecast",
    name: "Porsche 911 GT3",
    brand: "Matchbox",
    scale: "1:64",
    year: "2022",
    series: "Collector",
    condition: "Carded",
    notes: "Have multiple — one is trade-ready.",
    quantityOwned: 3,
    quantityAvailableTrade: 1,
    quantityAvailableSale: 1,
    askingPrice: 12,
    listingStatus: "BOTH",
  },
  {
    id: "4",
    category: "Pop Figure",
    name: "Darth Vader (Glow in the Dark)",
    brand: "Funko",
    line: "Star Wars",
    figureNumber: "#343",
    year: "2021",
    condition: "Mint in Box",
    notes: "Convention exclusive edition.",
    quantityOwned: 1,
    quantityAvailableTrade: 0,
    quantityAvailableSale: 0,
    listingStatus: "NONE",
  },
  {
    id: "5",
    category: "Trading Card",
    name: "Charizard Holo",
    brand: "Pokémon TCG",
    cardSet: "Base Set",
    cardNumber: "#4",
    grade: "PSA 8",
    year: "1999",
    condition: "PSA Graded",
    notes: "OG base set. One of my prized pieces.",
    quantityOwned: 1,
    quantityAvailableTrade: 0,
    quantityAvailableSale: 1,
    askingPrice: 450,
    listingStatus: "SALE",
  },
  {
    id: "6",
    category: "Model Figure",
    name: "RX-78-2 Gundam",
    brand: "Bandai",
    scale: "1:100",
    series: "MG Ver. 3.0",
    year: "2013",
    condition: "Built & Painted",
    notes: "Panel lined and top-coated.",
    quantityOwned: 1,
    quantityAvailableTrade: 1,
    quantityAvailableSale: 0,
    listingStatus: "TRADE",
  },
];

/* =============================================================================
   SECTION 8) MAIN PAGE
============================================================================= */

export default function Home() {
  /* --- Demo view switch --- */
  const [viewAs, setViewAs] = useState<"OWNER" | "VISITOR">("OWNER");
  const isOwner = viewAs === "OWNER";

  /* --- UI state --- */
  const [tab, setTab] = useState<"showroom" | "catalog" | "trade">("showroom");
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>("SHOWROOM");
  const [categoryFilter, setCategoryFilter] = useState<CollectionCategory | "All">("All");

  /* --- Viewer access --- */
  const [grantedAccessByViewer, setGrantedAccessByViewer] = useState<
    Record<string, AccessLevel>
  >({});
  const [dmApprovedByViewer, setDmApprovedByViewer] = useState<
    Record<string, boolean>
  >({});

  const viewerGrant = grantedAccessByViewer[VIEWER_ID] ?? "NONE";
  const viewerDmApproved = dmApprovedByViewer[VIEWER_ID] ?? false;

  const accessLevel = getEffectiveAccess({
    isOwner,
    privacyMode,
    granted: viewerGrant,
  });

  /* --- Items --- */
  const [items, setItems] = useState<CollectionItem[]>(SEED_ITEMS);

  /* --- Requests + chat --- */
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [dmRequests, setDmRequests] = useState<DMRequest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  /* --- Modal state --- */
  const [addOpen, setAddOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null);
  const [accessReqOpen, setAccessReqOpen] = useState(false);
  const [dmReqOpen, setDmReqOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  /* --- ESC closes modals --- */
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setSelectedItem(null);
      setAddOpen(false);
      setAccessReqOpen(false);
      setDmReqOpen(false);
      setInboxOpen(false);
      setChatOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* --- Load from localStorage --- */
  useEffect(() => {
    const saved = safeParseItems(localStorage.getItem(STORAGE_ITEMS));
    if (saved.length > 0) setItems(saved);

    setPrivacyMode(
      safeParseJSON<PrivacyMode>(localStorage.getItem(STORAGE_PRIVACY), "SHOWROOM")
    );
    setGrantedAccessByViewer(
      safeParseJSON<Record<string, AccessLevel>>(
        localStorage.getItem(STORAGE_GRANTS),
        {}
      )
    );
    setAccessRequests(
      safeParseJSON<AccessRequest[]>(localStorage.getItem(STORAGE_ACCESS_REQS), [])
    );
    setDmRequests(
      safeParseJSON<DMRequest[]>(localStorage.getItem(STORAGE_DM_REQS), [])
    );
    setDmApprovedByViewer(
      safeParseJSON<Record<string, boolean>>(
        localStorage.getItem(STORAGE_DM_APPROVED_BY_VIEWER),
        {}
      )
    );
    setConversations(
      safeParseJSON<Conversation[]>(localStorage.getItem(STORAGE_CONVERSATIONS), [])
    );
    setMessages(
      safeParseJSON<Message[]>(localStorage.getItem(STORAGE_MESSAGES), [])
    );
  }, []);

  /* --- Persist to localStorage --- */
  useEffect(() => { localStorage.setItem(STORAGE_ITEMS, JSON.stringify(items)); }, [items]);
  useEffect(() => { localStorage.setItem(STORAGE_PRIVACY, JSON.stringify(privacyMode)); }, [privacyMode]);
  useEffect(() => { localStorage.setItem(STORAGE_GRANTS, JSON.stringify(grantedAccessByViewer)); }, [grantedAccessByViewer]);
  useEffect(() => { localStorage.setItem(STORAGE_ACCESS_REQS, JSON.stringify(accessRequests)); }, [accessRequests]);
  useEffect(() => { localStorage.setItem(STORAGE_DM_REQS, JSON.stringify(dmRequests)); }, [dmRequests]);
  useEffect(() => { localStorage.setItem(STORAGE_DM_APPROVED_BY_VIEWER, JSON.stringify(dmApprovedByViewer)); }, [dmApprovedByViewer]);
  useEffect(() => { localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(conversations)); }, [conversations]);
  useEffect(() => { localStorage.setItem(STORAGE_MESSAGES, JSON.stringify(messages)); }, [messages]);

  /* --- Add item form --- */
  const [uploading, setUploading] = useState(false);

  const defaultForm = {
    category: "Diecast" as CollectionCategory,
    name: "",
    brand: "",
    year: "",
    condition: "Carded",
    notes: "",
    quantityOwned: 1,
    quantityAvailableTrade: 0,
    quantityAvailableSale: 0,
    askingPrice: "",
    media: [] as MediaItem[],
    scale: "",
    series: "",
    caseCode: "",
    line: "",
    figureNumber: "",
    cardSet: "",
    cardNumber: "",
    grade: "",
  };

  const [form, setForm] = useState(defaultForm);

  function resetForm() {
    setForm(defaultForm);
  }

  function openAdd() {
    resetForm();
    setAddOpen(true);
  }

  // When category changes, reset condition to the first option for that category
  function setCategory(cat: CollectionCategory) {
    setForm((prev) => ({
      ...prev,
      category: cat,
      condition: CONDITION_BY_CATEGORY[cat][0],
    }));
  }

  async function addMediaFiles(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    try {
      const incoming = Array.from(files);
      const room = Math.max(0, MAX_MEDIA_ITEMS - form.media.length);
      const slice = incoming.slice(0, room);
      const nextItems: MediaItem[] = [];

      for (const f of slice) {
        if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) {
          alert(`"${f.name}" is not an image or video.`);
          continue;
        }
        if (f.size > MAX_MEDIA_BYTES) {
          alert(`"${f.name}" is too large. Keep files under ~0.9 MB.`);
          continue;
        }

        const kind: MediaKind = f.type.startsWith("video/") ? "video" : "image";
        const path = `${OWNER_ID}/${Date.now()}-${uid()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;

        const { error } = await supabase().storage
          .from(MEDIA_BUCKET)
          .upload(path, f, { contentType: f.type, upsert: false });

        if (error) {
          alert(`Upload failed: ${error.message}`);
          continue;
        }

        nextItems.push({
          id: uid(),
          kind,
          storagePath: path,
          fileName: f.name,
          createdAt: Date.now(),
        });
      }

      if (nextItems.length) {
        setForm((prev) => ({ ...prev, media: [...prev.media, ...nextItems] }));
      }
    } finally {
      setUploading(false);
    }
  }

  async function removeMedia(id: string) {
    const item = form.media.find((m) => m.id === id);
    setForm((prev) => ({ ...prev, media: prev.media.filter((m) => m.id !== id) }));
    if (item?.storagePath) {
      const { error } = await supabase().storage.from(MEDIA_BUCKET).remove([item.storagePath]);
      if (error) console.warn("Failed to delete from storage:", error.message);
    }
  }

  function saveNewItem() {
    const name = form.name.trim();
    if (!name) return alert("Please enter a name.");
    const brand = form.brand.trim();
    if (!brand) return alert("Please enter a brand.");

    const owned = clampInt(form.quantityOwned);
    let trade = Math.min(clampInt(form.quantityAvailableTrade), owned);
    let sale = Math.min(clampInt(form.quantityAvailableSale), owned);
    if (owned === 0) { trade = 0; sale = 0; }

    const priceRaw = parseFloat(form.askingPrice);
    const askingPrice = sale > 0 && !isNaN(priceRaw) && priceRaw > 0 ? priceRaw : undefined;

    const newItem: CollectionItem = {
      id: uid(),
      category: form.category,
      name,
      brand,
      year: form.year.trim() || undefined,
      condition: form.condition,
      notes: form.notes.trim() || undefined,
      quantityOwned: owned,
      quantityAvailableTrade: trade,
      quantityAvailableSale: sale,
      askingPrice,
      listingStatus: computeStatus(trade, sale),
      media: form.media.length ? form.media : undefined,
      scale: form.scale.trim() || undefined,
      series: form.series.trim() || undefined,
      caseCode: form.caseCode.trim() || undefined,
      line: form.line.trim() || undefined,
      figureNumber: form.figureNumber.trim() || undefined,
      cardSet: form.cardSet.trim() || undefined,
      cardNumber: form.cardNumber.trim() || undefined,
      grade: form.grade.trim() || undefined,
    };

    setItems((prev) => [newItem, ...prev]);
    setAddOpen(false);
    setTab("showroom");
  }

  /* --- Derived stats --- */
  const tradeItems = useMemo(
    () => items.filter((c) => c.listingStatus !== "NONE"),
    [items]
  );

  const totalOwned = useMemo(() => items.reduce((s, c) => s + c.quantityOwned, 0), [items]);
  const totalForTrade = useMemo(() => tradeItems.reduce((s, c) => s + c.quantityAvailableTrade, 0), [tradeItems]);
  const totalForSale = useMemo(() => tradeItems.reduce((s, c) => s + c.quantityAvailableSale, 0), [tradeItems]);

  const categoryCount = useMemo(() => {
    const counts: Partial<Record<CollectionCategory, number>> = {};
    for (const item of items) {
      counts[item.category] = (counts[item.category] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  const visibleItems = useMemo(() => {
    if (categoryFilter === "All") return items;
    return items.filter((c) => c.category === categoryFilter);
  }, [items, categoryFilter]);

  /* --- Access request modal --- */
  const [accessReqLevel, setAccessReqLevel] = useState<"SHOWROOM" | "FULL">("SHOWROOM");
  const [accessReqNote, setAccessReqNote] = useState("");

  function submitAccessRequest() {
    if (wordCount(accessReqNote) > 100) return alert("Keep the note within 100 words.");
    if (accessRequests.some((r) => r.viewerId === VIEWER_ID && r.status === "PENDING"))
      return alert("You already have a pending access request.");

    const req: AccessRequest = {
      id: uid(),
      viewerId: VIEWER_ID,
      requested: accessReqLevel,
      note: accessReqNote.trim(),
      status: "PENDING",
      createdAt: Date.now(),
    };
    setAccessRequests((prev) => [req, ...prev]);
    setAccessReqOpen(false);
    setAccessReqNote("");
    setAccessReqLevel("SHOWROOM");
    alert("Access request sent. Owner can approve/decline in Inbox.");
  }

  /* --- DM request modal --- */
  const [dmReason, setDmReason] = useState<DMReason>("Trade");
  const [dmNote, setDmNote] = useState("");

  function submitDMRequest() {
    if (wordCount(dmNote) > 200) return alert("Keep the note within 200 words.");
    if (accessLevel !== "SHOWROOM") return alert("Only showroom viewers can request DM.");
    if (dmRequests.some((r) => r.viewerId === VIEWER_ID && r.status === "PENDING"))
      return alert("You already have a pending DM request.");

    const req: DMRequest = {
      id: uid(),
      viewerId: VIEWER_ID,
      reason: dmReason,
      note: dmNote.trim(),
      status: "PENDING",
      createdAt: Date.now(),
    };
    setDmRequests((prev) => [req, ...prev]);
    setDmReqOpen(false);
    setDmReason("Trade");
    setDmNote("");
    alert("DM request sent. Owner can approve/decline in Inbox.");
  }

  /* --- Chat helpers --- */
  function getOrCreateConversationId(ownerId: string, viewerId: string) {
    const id = convoIdForPair(ownerId, viewerId);
    setConversations((prev) =>
      upsertConversation(prev, { id, ownerId, viewerId, createdAt: Date.now() })
    );
    return id;
  }

  function openChatForPair(viewerId: string) {
    const id = getOrCreateConversationId(OWNER_ID, viewerId);
    setActiveConversationId(id);
    setChatDraft("");
    setChatOpen(true);
  }

  function isParticipant(conversationId: string) {
    const c = conversations.find((x) => x.id === conversationId);
    return c ? c.ownerId === OWNER_ID && c.viewerId === VIEWER_ID : false;
  }

  function sendChatMessage() {
    if (!activeConversationId) return;
    if (!isOwner) {
      if (!(accessLevel === "FULL" || viewerDmApproved))
        return alert("You don't have permission to DM.");
      if (!isParticipant(activeConversationId)) return alert("Invalid conversation.");
    }
    const body = chatDraft.trim();
    if (!body) return;
    if (body.length > 800) return alert("Message too long (max 800 chars).");

    const msg: Message = {
      id: uid(),
      conversationId: activeConversationId,
      senderId: isOwner ? OWNER_ID : VIEWER_ID,
      body,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, msg]);
    setChatDraft("");
  }

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatOpen, activeConversationId, messages]);

  /* --- Inbox actions (owner) --- */
  function approveAccessRequest(id: string) {
    const req = accessRequests.find((r) => r.id === id);
    if (!req) return;
    setAccessRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: "APPROVED" } : r));
    setGrantedAccessByViewer((prev) => ({ ...prev, [req.viewerId]: req.requested }));
  }

  function declineAccessRequest(id: string) {
    setAccessRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: "DECLINED" } : r));
  }

  function setViewerAccess(viewerId: string, level: AccessLevel) {
    if (level === "NONE") return revokeViewerAccess(viewerId);
    setGrantedAccessByViewer((prev) => ({ ...prev, [viewerId]: level }));
  }

  function revokeViewerAccess(viewerId: string) {
    setGrantedAccessByViewer((prev) => { const n = { ...prev }; delete n[viewerId]; return n; });
    setDmApprovedByViewer((prev) => { const n = { ...prev }; delete n[viewerId]; return n; });
  }

  function approveDMRequest(id: string) {
    const req = dmRequests.find((r) => r.id === id);
    if (!req) return;
    const convoId = getOrCreateConversationId(OWNER_ID, req.viewerId);
    setDmRequests((prev) =>
      prev.map((r) => r.id === id ? { ...r, status: "APPROVED", conversationId: convoId } : r)
    );
    setDmApprovedByViewer((prev) => ({ ...prev, [req.viewerId]: true }));
    if (convoId) { setActiveConversationId(convoId); setChatOpen(true); }
  }

  function declineDMRequest(id: string) {
    setDmRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: "DECLINED" } : r));
  }

  /* --- Visibility rules --- */
  const canViewCollection = accessLevel !== "NONE";
  const canRequestAccess = !isOwner && accessLevel === "NONE";
  const canRequestDM = !isOwner && accessLevel === "SHOWROOM" && !viewerDmApproved;
  const canDirectDM = !isOwner && (accessLevel === "FULL" || viewerDmApproved);

  const activeMessages = useMemo(() => {
    if (!activeConversationId) return [];
    return messages
      .filter((m) => m.conversationId === activeConversationId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [messages, activeConversationId]);

  const modeLabel =
    privacyMode === "PRIVATE" ? "Private" : privacyMode === "SHOWROOM" ? "Showroom" : "Public";

  /* --- Category-specific form fields --- */
  function renderCategoryFields() {
    switch (form.category) {
      case "Diecast":
      case "Model Figure":
        return (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <InputField label="Scale">
              <select className={inputCls} value={form.scale} onChange={(e) => setForm({ ...form, scale: e.target.value })}>
                <option value="">—</option>
                <option>1:64</option><option>1:43</option>
                <option>1:24</option><option>1:18</option>
                <option>1:12</option><option>1:100</option>
                <option>1:144</option><option>Other</option>
              </select>
            </InputField>
            <InputField label="Series / Line">
              <input className={inputCls} value={form.series} onChange={(e) => setForm({ ...form, series: e.target.value })} />
            </InputField>
            {form.category === "Diecast" && (
              <InputField label="Case Code">
                <input className={inputCls} value={form.caseCode} onChange={(e) => setForm({ ...form, caseCode: e.target.value })} />
              </InputField>
            )}
          </div>
        );
      case "Pop Figure":
        return (
          <div className="grid grid-cols-2 gap-3">
            <InputField label="Product Line">
              <input className={inputCls} placeholder="e.g. Star Wars" value={form.line} onChange={(e) => setForm({ ...form, line: e.target.value })} />
            </InputField>
            <InputField label="Figure #">
              <input className={inputCls} placeholder="e.g. #343" value={form.figureNumber} onChange={(e) => setForm({ ...form, figureNumber: e.target.value })} />
            </InputField>
          </div>
        );
      case "Trading Card":
        return (
          <div className="grid grid-cols-2 gap-3">
            <InputField label="Set / Series">
              <input className={inputCls} placeholder="e.g. Base Set" value={form.cardSet} onChange={(e) => setForm({ ...form, cardSet: e.target.value })} />
            </InputField>
            <InputField label="Card #">
              <input className={inputCls} placeholder="e.g. #4/102" value={form.cardNumber} onChange={(e) => setForm({ ...form, cardNumber: e.target.value })} />
            </InputField>
            <InputField label="Grade (if graded)">
              <input className={inputCls} placeholder="e.g. PSA 9" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
            </InputField>
          </div>
        );
      default:
        return null;
    }
  }

  /* --- Item subtitle for cards --- */
  function itemSubtitle(c: CollectionItem) {
    const parts: string[] = [c.brand];
    if (c.category === "Diecast" || c.category === "Model Figure") {
      if (c.scale) parts.push(c.scale);
      if (c.series) parts.push(c.series);
    } else if (c.category === "Pop Figure") {
      if (c.line) parts.push(c.line);
      if (c.figureNumber) parts.push(c.figureNumber);
    } else if (c.category === "Trading Card") {
      if (c.cardSet) parts.push(c.cardSet);
      if (c.cardNumber) parts.push(c.cardNumber);
    }
    if (c.year) parts.push(c.year);
    return parts.join(" · ");
  }

  /* =============================================================================
     SECTION 9) UI RENDER
  ============================================================================= */

  return (
    <main className="min-h-screen bg-[#080a0f] text-white">

      {/* ===================== PLATFORM NAV ===================== */}
      <div className="border-b border-white/[0.06] bg-[#080a0f]/90 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center">
              <span className="text-xs font-bold text-black">C</span>
            </div>
            <span className="text-sm font-semibold tracking-wide">Collectors<span className="text-white/40">HQ</span></span>
          </div>

          {/* Demo view toggle */}
          <div className="flex items-center gap-2">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 flex text-xs">
              <button className={`px-3 py-1.5 transition-colors ${viewAs === "OWNER" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`} onClick={() => setViewAs("OWNER")}>Owner</button>
              <button className={`px-3 py-1.5 transition-colors ${viewAs === "VISITOR" ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`} onClick={() => setViewAs("VISITOR")}>Visitor</button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4">

        {/* ===================== PROFILE HEADER ===================== */}
        <div className="py-8 border-b border-white/[0.06]">
          <div className="flex flex-col sm:flex-row sm:items-end gap-5">
            {/* Avatar */}
            <div className="relative">
              <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-amber-400/20 to-orange-500/20 border border-amber-400/20 flex items-center justify-center text-2xl font-bold text-amber-400">
                DD
              </div>
              <div className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-[#080a0f] ${privacyMode === "PUBLIC" ? "bg-emerald-400" : privacyMode === "SHOWROOM" ? "bg-amber-400" : "bg-white/30"}`} />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-bold">{OWNER_ID}</h1>
                <span className="text-xs rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-white/50">{modeLabel}</span>
              </div>
              <p className="mt-1 text-sm text-white/50">Premium collector · Diecast · Pop Figures · Trading Cards</p>

              {/* Stats row */}
              {(isOwner || canViewCollection) && (
                <div className="mt-3 flex flex-wrap gap-4">
                  <div className="text-center sm:text-left">
                    <div className="text-lg font-bold">{items.length}</div>
                    <div className="text-xs text-white/40">Items</div>
                  </div>
                  <div className="text-center sm:text-left">
                    <div className="text-lg font-bold">{totalOwned}</div>
                    <div className="text-xs text-white/40">Owned</div>
                  </div>
                  <div className="text-center sm:text-left">
                    <div className="text-lg font-bold text-emerald-400">{totalForTrade}</div>
                    <div className="text-xs text-white/40">For Trade</div>
                  </div>
                  <div className="text-center sm:text-left">
                    <div className="text-lg font-bold text-sky-400">{totalForSale}</div>
                    <div className="text-xs text-white/40">For Sale</div>
                  </div>
                  <div className="text-center sm:text-left">
                    <div className="text-lg font-bold">{Object.keys(categoryCount).length}</div>
                    <div className="text-xs text-white/40">Categories</div>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {isOwner ? (
                <>
                  <ActionBtn onClick={openAdd}>+ Add Item</ActionBtn>
                  <ActionBtn onClick={() => setInboxOpen(true)}>Inbox</ActionBtn>
                  <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5 flex text-xs">
                    {(["PRIVATE", "SHOWROOM", "PUBLIC"] as PrivacyMode[]).map((m) => (
                      <button key={m} className={`px-3 py-2 transition-colors ${privacyMode === m ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`} onClick={() => setPrivacyMode(m)}>
                        {m === "PRIVATE" ? "Private" : m === "SHOWROOM" ? "Showroom" : "Public"}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  {canRequestAccess && <ActionBtn onClick={() => setAccessReqOpen(true)}>Request Access</ActionBtn>}
                  {canRequestDM && <ActionBtn onClick={() => setDmReqOpen(true)}>Request DM</ActionBtn>}
                  {canDirectDM && <ActionBtn onClick={() => openChatForPair(VIEWER_ID)}>DM</ActionBtn>}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ===================== LOCKED VIEW ===================== */}
        {!isOwner && accessLevel === "NONE" && (
          <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
            <div className="text-4xl mb-4">🔒</div>
            <div className="text-lg font-semibold">Private Collection</div>
            <div className="mt-2 text-sm text-white/50 max-w-sm mx-auto">
              This collector keeps their showroom private. Request access to see what they're collecting, trading, and selling.
            </div>
            <div className="mt-5">
              <button onClick={() => setAccessReqOpen(true)} className="rounded-xl bg-white/10 border border-white/10 px-5 py-2.5 text-sm hover:bg-white/15 transition-colors">
                Request Access
              </button>
            </div>
          </div>
        )}

        {/* ===================== MAIN CONTENT ===================== */}
        {(isOwner || canViewCollection) && (
          <div className="py-6">
            {/* Tab bar */}
            <div className="flex flex-wrap items-center gap-2 mb-6">
              <PillBtn active={tab === "showroom"} onClick={() => setTab("showroom")}>Showroom</PillBtn>
              <PillBtn active={tab === "catalog"} onClick={() => setTab("catalog")}>Catalog</PillBtn>
              <PillBtn active={tab === "trade"} onClick={() => setTab("trade")}>Trade & Sell</PillBtn>
            </div>

            {/* ---- SHOWROOM TAB ---- */}
            {tab === "showroom" && (
              <div>
                {/* Category filter */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <button
                    onClick={() => setCategoryFilter("All")}
                    className={`rounded-full px-3 py-1 text-xs border transition-colors ${categoryFilter === "All" ? "border-white/20 bg-white/10 text-white" : "border-white/10 bg-white/5 text-white/50 hover:text-white"}`}
                  >
                    All ({items.length})
                  </button>
                  {ALL_CATEGORIES.filter((cat) => categoryCount[cat]).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat)}
                      className={`rounded-full px-3 py-1 text-xs border transition-colors ${categoryFilter === cat ? CATEGORY_COLOR[cat] : "border-white/10 bg-white/5 text-white/50 hover:text-white"}`}
                    >
                      {cat} ({categoryCount[cat]})
                    </button>
                  ))}
                </div>

                {visibleItems.length === 0 && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center text-sm text-white/40">
                    No items yet. {isOwner ? "Add your first piece to your collection." : "Nothing to show here."}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {visibleItems.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedItem(c)}
                      className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] text-left hover:border-white/20 hover:bg-white/[0.06] transition-all"
                    >
                      {/* Media thumbnail */}
                      <div className="relative aspect-[4/3] bg-white/5 overflow-hidden">
                        {c.media?.[0]?.kind === "image" && (
                          <img src={getMediaSrc(c.media[0])} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-300" />
                        )}
                        {c.media?.[0]?.kind === "video" && (
                          <video src={getMediaSrc(c.media[0])} className="absolute inset-0 h-full w-full object-cover opacity-90" muted playsInline />
                        )}
                        {!c.media?.length && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-2xl opacity-20">
                              {c.category === "Diecast" ? "🚗" : c.category === "Pop Figure" ? "🎭" : c.category === "Trading Card" ? "🃏" : c.category === "Model Figure" ? "🤖" : "📦"}
                            </span>
                          </div>
                        )}

                        {/* Overlay badges */}
                        <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                          {c.quantityAvailableTrade > 0 && <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-300">Trade</Badge>}
                          {c.quantityAvailableSale > 0 && <Badge className="border-sky-400/20 bg-sky-400/10 text-sky-300">Sale</Badge>}
                        </div>
                        {c.quantityOwned > 1 && (
                          <div className="absolute top-2 right-2">
                            <Badge>×{c.quantityOwned}</Badge>
                          </div>
                        )}
                      </div>

                      {/* Card body */}
                      <div className="p-3">
                        <div className="mb-1.5">
                          <CategoryBadge category={c.category} />
                        </div>
                        <div className="text-sm font-semibold leading-tight truncate">{c.name}</div>
                        <div className="mt-0.5 text-xs text-white/45 truncate">{itemSubtitle(c)}</div>
                        {c.askingPrice !== undefined && c.quantityAvailableSale > 0 && (
                          <div className="mt-1.5 text-xs font-semibold text-sky-400">{formatPrice(c.askingPrice)}</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ---- CATALOG TAB ---- */}
            {tab === "catalog" && (
              <div className="grid gap-4">
                {/* Summary */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      { label: "Total Items", value: items.length, color: "" },
                      { label: "Total Owned", value: totalOwned, color: "" },
                      { label: "For Trade", value: totalForTrade, color: "text-emerald-400" },
                      { label: "For Sale", value: totalForSale, color: "text-sky-400" },
                    ] as const
                  ).map((s) => (
                    <div key={s.label} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
                      <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                      <div className="mt-0.5 text-xs text-white/40">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* By category */}
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5">
                  <div className="text-sm font-semibold mb-4">By Category</div>
                  <div className="grid gap-2">
                    {ALL_CATEGORIES.filter((cat) => categoryCount[cat]).map((cat) => {
                      const count = categoryCount[cat] ?? 0;
                      const pct = items.length ? Math.round((count / items.length) * 100) : 0;
                      return (
                        <div key={cat} className="flex items-center gap-3">
                          <CategoryBadge category={cat} />
                          <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${CATEGORY_DOT[cat]}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-white/40 w-8 text-right">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Full list */}
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
                  <div className="px-5 py-4 border-b border-white/[0.06] text-sm font-semibold">All Items</div>
                  <div className="divide-y divide-white/[0.04]">
                    {items.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedItem(c)}
                        className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/[0.03] text-left transition-colors"
                      >
                        <div className="h-10 w-10 rounded-xl bg-white/5 border border-white/10 flex-shrink-0 overflow-hidden flex items-center justify-center text-lg">
                          {c.media?.[0]?.kind === "image" ? (
                            <img src={getMediaSrc(c.media[0])} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="opacity-40">
                              {c.category === "Diecast" ? "🚗" : c.category === "Pop Figure" ? "🎭" : c.category === "Trading Card" ? "🃏" : c.category === "Model Figure" ? "🤖" : "📦"}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{c.name}</div>
                          <div className="text-xs text-white/40 truncate">{itemSubtitle(c)}</div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <CategoryBadge category={c.category} />
                          {c.listingStatus !== "NONE" && (
                            <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                              {c.listingStatus}
                            </Badge>
                          )}
                          <span className="text-xs text-white/30">×{c.quantityOwned}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ---- TRADE & SELL TAB ---- */}
            {tab === "trade" && (
              <div className="grid gap-4">
                <div className="flex gap-3 flex-wrap">
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-5 py-4 flex-1 min-w-[140px]">
                    <div className="text-2xl font-bold text-emerald-400">{totalForTrade}</div>
                    <div className="text-xs text-white/40 mt-0.5">Available to Trade</div>
                  </div>
                  <div className="rounded-2xl border border-sky-400/20 bg-sky-400/5 px-5 py-4 flex-1 min-w-[140px]">
                    <div className="text-2xl font-bold text-sky-400">{totalForSale}</div>
                    <div className="text-xs text-white/40 mt-0.5">Available to Buy</div>
                  </div>
                </div>

                {tradeItems.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center text-sm text-white/40">
                    Nothing listed for trade or sale yet.
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {tradeItems.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedItem(c)}
                        className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-left hover:bg-white/[0.06] hover:border-white/20 transition-all"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <CategoryBadge category={c.category} />
                            </div>
                            <div className="text-sm font-semibold truncate">{c.name}</div>
                            <div className="mt-0.5 text-xs text-white/45 truncate">{itemSubtitle(c)}</div>
                          </div>
                          <div className="flex flex-col gap-1 items-end flex-shrink-0">
                            {c.quantityAvailableTrade > 0 && <Badge className="border-emerald-400/20 bg-emerald-400/10 text-emerald-300">Trade ×{c.quantityAvailableTrade}</Badge>}
                            {c.quantityAvailableSale > 0 && <Badge className="border-sky-400/20 bg-sky-400/10 text-sky-300">Sale ×{c.quantityAvailableSale}</Badge>}
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between">
                          <div className="text-xs text-white/35">
                            Owned: {c.quantityOwned} · Condition: {c.condition}
                          </div>
                          {c.askingPrice !== undefined && c.quantityAvailableSale > 0 && (
                            <div className="text-sm font-bold text-sky-400">{formatPrice(c.askingPrice)}</div>
                          )}
                        </div>

                        {/* Visitor DM shortcut */}
                        {!isOwner && canDirectDM && (
                          <div className="mt-3 pt-3 border-t border-white/[0.06]">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); openChatForPair(VIEWER_ID); }}
                              className="text-xs text-white/40 hover:text-white transition-colors"
                            >
                              Message owner →
                            </button>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* =============================================================================
         SECTION 10) MODALS
      ============================================================================= */}

      {/* ITEM DETAILS MODAL */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setSelectedItem(null)}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d0f14] shadow-2xl overflow-y-auto max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="p-5 border-b border-white/[0.06] flex items-start justify-between gap-4">
              <div>
                <CategoryBadge category={selectedItem.category} />
                <h2 className="mt-2 text-lg font-bold">{selectedItem.name}</h2>
                <p className="mt-0.5 text-sm text-white/50">{itemSubtitle(selectedItem)}</p>
              </div>
              <ActionBtn onClick={() => setSelectedItem(null)}>✕</ActionBtn>
            </div>

            {/* Media gallery */}
            {selectedItem.media?.length ? (
              <div className="p-4 border-b border-white/[0.06]">
                <div className="grid grid-cols-2 gap-2">
                  {selectedItem.media.map((m) => (
                    <div key={m.id} className="overflow-hidden rounded-xl border border-white/10 bg-white/5 aspect-[4/3]">
                      {m.kind === "image" ? (
                        <img src={getMediaSrc(m)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <video src={getMediaSrc(m)} controls playsInline className="h-full w-full object-cover" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Details grid */}
            <div className="p-5 grid grid-cols-2 gap-2 text-sm">
              {[
                { label: "Brand", value: show(selectedItem.brand) },
                { label: "Year", value: show(selectedItem.year) },
                { label: "Condition", value: show(selectedItem.condition) },
                { label: "Qty Owned", value: show(selectedItem.quantityOwned) },
                ...(selectedItem.scale ? [{ label: "Scale", value: show(selectedItem.scale) }] : []),
                ...(selectedItem.series ? [{ label: "Series", value: show(selectedItem.series) }] : []),
                ...(selectedItem.caseCode ? [{ label: "Case Code", value: show(selectedItem.caseCode) }] : []),
                ...(selectedItem.line ? [{ label: "Line", value: show(selectedItem.line) }] : []),
                ...(selectedItem.figureNumber ? [{ label: "Figure #", value: show(selectedItem.figureNumber) }] : []),
                ...(selectedItem.cardSet ? [{ label: "Card Set", value: show(selectedItem.cardSet) }] : []),
                ...(selectedItem.cardNumber ? [{ label: "Card #", value: show(selectedItem.cardNumber) }] : []),
                ...(selectedItem.grade ? [{ label: "Grade", value: show(selectedItem.grade) }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                  <div className="text-xs text-white/40">{label}</div>
                  <div className="mt-0.5 font-medium">{value}</div>
                </div>
              ))}
            </div>

            {/* Listing status */}
            {selectedItem.listingStatus !== "NONE" && (
              <div className="px-5 pb-2 flex flex-wrap gap-2">
                {selectedItem.quantityAvailableTrade > 0 && (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-2.5 flex-1">
                    <div className="text-xs text-emerald-400/70">Available to Trade</div>
                    <div className="text-lg font-bold text-emerald-400">×{selectedItem.quantityAvailableTrade}</div>
                  </div>
                )}
                {selectedItem.quantityAvailableSale > 0 && (
                  <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-2.5 flex-1">
                    <div className="text-xs text-sky-400/70">Available to Buy</div>
                    <div className="text-lg font-bold text-sky-400">
                      {selectedItem.askingPrice ? formatPrice(selectedItem.askingPrice) : `×${selectedItem.quantityAvailableSale}`}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            {selectedItem.notes && (
              <div className="px-5 pb-5">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                  <div className="text-xs text-white/40 mb-1">Notes</div>
                  <div className="text-sm text-white/80">{selectedItem.notes}</div>
                </div>
              </div>
            )}

            {/* Visitor DM */}
            {!isOwner && canDirectDM && (
              <div className="px-5 pb-5">
                <button
                  onClick={() => openChatForPair(VIEWER_ID)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm hover:bg-white/10 transition-colors"
                >
                  Message owner about this item
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADD ITEM MODAL */}
      {addOpen && isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setAddOpen(false)}>
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0d0f14] shadow-2xl overflow-y-auto max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-white/[0.06] flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">Add to Collection</h2>
                <p className="text-sm text-white/50">Document your piece. Every detail matters.</p>
              </div>
              <ActionBtn onClick={() => setAddOpen(false)}>✕</ActionBtn>
            </div>

            <div className="p-5 grid gap-4">
              {/* Category selector */}
              <InputField label="Category" required>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {ALL_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      className={`rounded-xl border px-2 py-2.5 text-[11px] font-medium transition-all ${form.category === cat ? CATEGORY_COLOR[cat] + " ring-1 ring-current" : "border-white/10 bg-white/5 text-white/50 hover:text-white"}`}
                    >
                      <div className="text-base mb-1">
                        {cat === "Diecast" ? "🚗" : cat === "Pop Figure" ? "🎭" : cat === "Trading Card" ? "🃏" : cat === "Model Figure" ? "🤖" : "📦"}
                      </div>
                      {cat}
                    </button>
                  ))}
                </div>
              </InputField>

              {/* Base fields */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InputField label="Name" required>
                  <input className={inputCls} placeholder={form.category === "Trading Card" ? "e.g. Charizard Holo" : "e.g. Porsche 911 GT3"} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </InputField>
                <InputField label="Brand" required>
                  <input className={inputCls} placeholder={form.category === "Pop Figure" ? "e.g. Funko" : form.category === "Trading Card" ? "e.g. Pokémon TCG" : "e.g. Hot Wheels"} value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
                </InputField>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <InputField label="Year">
                  <input className={inputCls} placeholder="e.g. 2024" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
                </InputField>
                <InputField label="Condition" required>
                  <select className={inputCls} value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                    {CONDITION_BY_CATEGORY[form.category].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </InputField>
              </div>

              {/* Category-specific fields */}
              {renderCategoryFields()}

              {/* Quantity */}
              <div className="grid grid-cols-3 gap-3">
                <InputField label="Qty Owned">
                  <input type="number" min={0} className={inputCls} value={form.quantityOwned} onChange={(e) => setForm({ ...form, quantityOwned: clampInt(e.target.value) })} />
                </InputField>
                <InputField label="Avail. Trade">
                  <input type="number" min={0} className={inputCls} value={form.quantityAvailableTrade} onChange={(e) => setForm({ ...form, quantityAvailableTrade: clampInt(e.target.value) })} />
                </InputField>
                <InputField label="Avail. Sale">
                  <input type="number" min={0} className={inputCls} value={form.quantityAvailableSale} onChange={(e) => setForm({ ...form, quantityAvailableSale: clampInt(e.target.value) })} />
                </InputField>
              </div>

              {/* Asking price (only if sale > 0) */}
              {parseInt(String(form.quantityAvailableSale)) > 0 && (
                <InputField label="Asking Price (USD)">
                  <input type="number" min={0} placeholder="e.g. 25" className={inputCls} value={form.askingPrice} onChange={(e) => setForm({ ...form, askingPrice: e.target.value })} />
                </InputField>
              )}

              {/* Notes */}
              <InputField label="Notes">
                <textarea className={inputCls + " min-h-[80px] resize-none"} placeholder="Variant details, condition notes, story behind this piece…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </InputField>

              {/* Media */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-sm font-medium">Photos & Videos</div>
                  <div className="text-xs text-white/40">{form.media.length}/{MAX_MEDIA_ITEMS}</div>
                </div>
                <div className="text-xs text-white/40 mb-3">Up to {MAX_MEDIA_ITEMS} files · max ~0.9 MB each</div>

                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  disabled={uploading || form.media.length >= MAX_MEDIA_ITEMS}
                  onChange={(e) => addMediaFiles(e.target.files)}
                  className="text-xs text-white/60"
                />

                {form.media.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {form.media.map((m) => (
                      <div key={m.id} className="relative overflow-hidden rounded-xl border border-white/10 bg-white/5 aspect-[4/3]">
                        {m.kind === "image" ? (
                          <img src={getMediaSrc(m)} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <video src={getMediaSrc(m)} className="h-full w-full object-cover" muted playsInline />
                        )}
                        <button
                          type="button"
                          onClick={() => removeMedia(m.id)}
                          className="absolute right-1.5 top-1.5 rounded-lg border border-white/20 bg-black/60 px-2 py-0.5 text-[10px] hover:bg-black/80"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-1">
                <ActionBtn onClick={() => setAddOpen(false)}>Cancel</ActionBtn>
                <button
                  className="rounded-xl border border-white/10 bg-white/10 px-5 py-2.5 text-sm font-medium hover:bg-white/15 disabled:opacity-40 transition-colors"
                  onClick={saveNewItem}
                  disabled={uploading}
                >
                  {uploading ? "Uploading…" : "Save to Collection"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ACCESS REQUEST MODAL */}
      {accessReqOpen && !isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setAccessReqOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0f14] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-bold">Request Access</h2>
                <p className="text-sm text-white/50 mt-0.5">Tell the collector why you'd like in.</p>
              </div>
              <ActionBtn onClick={() => setAccessReqOpen(false)}>✕</ActionBtn>
            </div>
            <div className="grid gap-3">
              <InputField label="Access Level">
                <select className={inputCls} value={accessReqLevel} onChange={(e) => setAccessReqLevel(e.target.value as "SHOWROOM" | "FULL")}>
                  <option value="SHOWROOM">Showroom — view the collection</option>
                  <option value="FULL">Full — view + ability to DM</option>
                </select>
              </InputField>
              <InputField label={`Note (${wordCount(accessReqNote)}/100 words)`}>
                <textarea className={inputCls + " min-h-[96px] resize-none"} value={accessReqNote} onChange={(e) => setAccessReqNote(e.target.value)} placeholder="Introduce yourself and why you want access…" />
              </InputField>
              <div className="flex justify-end gap-2 mt-1">
                <ActionBtn onClick={() => setAccessReqOpen(false)}>Cancel</ActionBtn>
                <button className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-40 transition-colors" disabled={wordCount(accessReqNote) > 100} onClick={submitAccessRequest}>
                  Send Request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DM REQUEST MODAL */}
      {dmReqOpen && !isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setDmReqOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d0f14] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-bold">Request to DM</h2>
                <p className="text-sm text-white/50 mt-0.5">Explain what you'd like to discuss.</p>
              </div>
              <ActionBtn onClick={() => setDmReqOpen(false)}>✕</ActionBtn>
            </div>
            <div className="grid gap-3">
              <InputField label="Reason">
                <select className={inputCls} value={dmReason} onChange={(e) => setDmReason(e.target.value as DMReason)}>
                  <option value="Trade">Trade</option>
                  <option value="Buy">Buy</option>
                  <option value="Sell">Sell</option>
                  <option value="Question">Question</option>
                  <option value="Other">Other</option>
                </select>
              </InputField>
              <InputField label={`Note (${wordCount(dmNote)}/200 words)`}>
                <textarea className={inputCls + " min-h-[96px] resize-none"} value={dmNote} onChange={(e) => setDmNote(e.target.value)} placeholder="What do you want to talk about?" />
              </InputField>
              <div className="flex justify-end gap-2 mt-1">
                <ActionBtn onClick={() => setDmReqOpen(false)}>Cancel</ActionBtn>
                <button className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-40 transition-colors" disabled={wordCount(dmNote) > 200} onClick={submitDMRequest}>
                  Send Request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* INBOX (Owner) */}
      {inboxOpen && isOwner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setInboxOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0d0f14] shadow-2xl overflow-y-auto max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-white/[0.06] flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold">Inbox</h2>
                <p className="text-sm text-white/50 mt-0.5">Manage access and DM requests.</p>
              </div>
              <ActionBtn onClick={() => setInboxOpen(false)}>✕</ActionBtn>
            </div>

            <div className="p-5 grid gap-6">
              {/* Access requests */}
              <div>
                <div className="text-sm font-semibold mb-3">Access Requests</div>
                <div className="grid gap-2">
                  {accessRequests.length === 0 && <div className="text-sm text-white/40 py-2">No access requests.</div>}
                  {accessRequests.map((r) => (
                    <div key={r.id} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm">
                            <b>{r.viewerId}</b> wants <b>{r.requested}</b> access
                            <span className="text-white/40 ml-2 text-xs">{new Date(r.createdAt).toLocaleDateString()}</span>
                          </div>
                          {r.note && <div className="mt-1 text-xs text-white/50">"{r.note}"</div>}
                          <div className={`mt-1.5 text-xs font-medium ${r.status === "APPROVED" ? "text-emerald-400" : r.status === "DECLINED" ? "text-red-400" : "text-white/40"}`}>{r.status}</div>
                        </div>
                        {r.status === "PENDING" && (
                          <div className="flex gap-2">
                            <ActionBtn onClick={() => approveAccessRequest(r.id)}>Approve</ActionBtn>
                            <ActionBtn onClick={() => declineAccessRequest(r.id)}>Decline</ActionBtn>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* DM requests */}
              <div>
                <div className="text-sm font-semibold mb-3">DM Requests</div>
                <div className="grid gap-2">
                  {dmRequests.length === 0 && <div className="text-sm text-white/40 py-2">No DM requests.</div>}
                  {dmRequests.map((r) => (
                    <div key={r.id} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm">
                            <b>{r.viewerId}</b> · Reason: <b>{r.reason}</b>
                            <span className="text-white/40 ml-2 text-xs">{new Date(r.createdAt).toLocaleDateString()}</span>
                          </div>
                          {r.note && <div className="mt-1 text-xs text-white/50">"{r.note}"</div>}
                          <div className={`mt-1.5 text-xs font-medium ${r.status === "APPROVED" ? "text-emerald-400" : r.status === "DECLINED" ? "text-red-400" : "text-white/40"}`}>{r.status}</div>
                        </div>
                        <div className="flex gap-2">
                          {r.status === "PENDING" && (
                            <>
                              <ActionBtn onClick={() => approveDMRequest(r.id)}>Approve</ActionBtn>
                              <ActionBtn onClick={() => declineDMRequest(r.id)}>Decline</ActionBtn>
                            </>
                          )}
                          {r.status === "APPROVED" && (
                            <ActionBtn onClick={() => openChatForPair(r.viewerId)}>Open Chat</ActionBtn>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Access control */}
              <div>
                <div className="text-sm font-semibold mb-3">Access Control</div>
                <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-4">
                  {Object.keys(grantedAccessByViewer).length === 0 ? (
                    <div className="text-sm text-white/40">No viewers have been granted access yet.</div>
                  ) : (
                    <div className="grid gap-2">
                      {Object.entries(grantedAccessByViewer).map(([vid, level]) => (
                        <div key={vid} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                          <div className="text-sm"><b>{vid}</b> · <span className="text-white/50">{level}</span></div>
                          <div className="flex gap-2">
                            <ActionBtn onClick={() => setViewerAccess(vid, "SHOWROOM")}>Showroom</ActionBtn>
                            <ActionBtn onClick={() => setViewerAccess(vid, "FULL")}>Full</ActionBtn>
                            <ActionBtn onClick={() => revokeViewerAccess(vid)}>Revoke</ActionBtn>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Reset */}
              <div className="border-t border-white/[0.06] pt-4">
                <ActionBtn
                  onClick={() => {
                    if (!confirm("Reset to seed data? This clears all your saved items.")) return;
                    localStorage.removeItem(STORAGE_ITEMS);
                    setItems(SEED_ITEMS);
                  }}
                  className="text-red-400/70 hover:text-red-400"
                >
                  Reset to seed data
                </ActionBtn>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CHAT MODAL */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setChatOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0d0f14] shadow-2xl flex flex-col" style={{ height: "70vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-white/[0.06] flex items-start justify-between gap-4 flex-shrink-0">
              <div>
                <h2 className="text-base font-bold">Direct Message</h2>
                <div className="text-xs text-white/40 mt-0.5">{isOwner ? `with ${VIEWER_ID}` : `with ${OWNER_ID}`}</div>
              </div>
              <ActionBtn onClick={() => setChatOpen(false)}>✕</ActionBtn>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {activeMessages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-white/30">No messages yet. Say hi!</div>
              ) : (
                <div className="grid gap-2">
                  {activeMessages.map((m) => {
                    const mine = m.senderId === (isOwner ? OWNER_ID : VIEWER_ID);
                    return (
                      <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[78%] rounded-2xl px-3 py-2 ${mine ? "bg-white/10 border border-white/10" : "bg-white/[0.04] border border-white/[0.06]"}`}>
                          <div className="text-[10px] text-white/30 mb-0.5">{m.senderId}</div>
                          <div className="text-sm whitespace-pre-wrap break-words">{m.body}</div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/[0.06] flex-shrink-0">
              {!isOwner && !canDirectDM ? (
                <div className="text-xs text-red-400/70 text-center">You don't currently have permission to DM.</div>
              ) : (
                <div className="flex gap-2">
                  <textarea
                    className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none resize-none min-h-[40px] max-h-[120px] focus:border-white/20"
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    placeholder="Type a message…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendChatMessage();
                      }
                    }}
                  />
                  <button
                    className="rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm hover:bg-white/15 disabled:opacity-40 transition-colors"
                    disabled={!chatDraft.trim()}
                    onClick={sendChatMessage}
                  >
                    Send
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
